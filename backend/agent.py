"""
LangGraph multi-agent system for MeetingOS.

A Supervisor routes incoming tasks to one of four specialist agents:
  meeting_agent   — transcript search, per-meeting Q&A, decisions
  conflict_agent  — cross-meeting contradiction detection
  web_agent       — DuckDuckGo web search
  github_agent    — GitHub repos, files, issues, PRs

After each specialist completes its tool-use loop, control returns to the
Supervisor, which decides whether to call another specialist or synthesize a
final answer and finish.

The public interface (stream_agent) is unchanged — it yields the same SSE
event shapes the UI already handles:
  {"type": "step",        "agent": "..."}
  {"type": "tool_call",   "tool": "...", "input": {...}}
  {"type": "tool_result", "tool": "...", "result": "..."}
  {"type": "done",        "answer": "..."}
  {"type": "error",       "message": "..."}
"""

import base64
import json
import os
from typing import Annotated, Generator, List, Optional, TypedDict

import httpx
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

from db import get_db
from llm import chat_complete
from search import cross_meeting_search
from chat import ask_meeting as _ask_meeting

_ROLE_MAP = {"human": "user", "ai": "assistant", "system": "system", "tool": "tool"}


def _to_oai(msg) -> dict:
    """Convert a LangChain BaseMessage (or plain dict) to an OpenAI-compatible dict."""
    if isinstance(msg, dict):
        return msg
    role = _ROLE_MAP.get(getattr(msg, "type", ""), "user")
    d: dict = {"role": role, "content": getattr(msg, "content", "") or ""}
    # tool_call_id is on ToolMessage
    tool_call_id = getattr(msg, "tool_call_id", None)
    if tool_call_id:
        d["tool_call_id"] = tool_call_id
    # tool_calls live in additional_kwargs on AIMessage (OpenAI format)
    tool_calls = getattr(msg, "additional_kwargs", {}).get("tool_calls")
    if tool_calls:
        d["tool_calls"] = tool_calls
    return d

GITHUB_API = "https://api.github.com"
MEMBERS = ["meeting_agent", "conflict_agent", "web_agent", "github_agent"]


# ── State ──────────────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    task: str
    user_id: str
    messages: Annotated[list, add_messages]  # full conversation history
    next_agent: str                           # supervisor's routing decision
    events: list                              # SSE events from each node (overwritten per turn)


# ── Tool schemas (grouped by specialist) ──────────────────────────────────────

_MEETING_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_meetings",
            "description": (
                "Hybrid semantic + keyword search across all meeting transcripts. "
                "Returns the most relevant chunks with meeting names and timestamps. "
                "Use this to find what was discussed about any topic."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Natural language search query"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_decisions",
            "description": "Return every decision extracted from all meetings, grouped by meeting.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_meeting",
            "description": (
                "Ask a specific question about one meeting using RAG. "
                "Use search_meetings first to find the meeting_id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "meeting_id": {"type": "string", "description": "UUID of the meeting"},
                    "question": {"type": "string", "description": "Question to answer"},
                },
                "required": ["meeting_id", "question"],
            },
        },
    },
]

_CONFLICT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_conflicts",
            "description": "Return cross-meeting conflicts: decisions that contradict each other across meetings.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

_WEB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for current information. Returns titles, snippets, and URLs.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search query"}},
                "required": ["query"],
            },
        },
    },
]

_GITHUB_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "github_list_repos",
            "description": "List GitHub repositories for the authenticated user (reads GITHUB_TOKEN from env).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_read_file",
            "description": "Read a file from a GitHub repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {"type": "string", "description": "Repository as 'owner/repo'"},
                    "path": {"type": "string", "description": "File path within the repo"},
                    "branch": {"type": "string", "description": "Branch name (default: main)"},
                },
                "required": ["repo", "path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_create_issue",
            "description": "Create a GitHub issue in a repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {"type": "string", "description": "Repository as 'owner/repo'"},
                    "title": {"type": "string"},
                    "body": {"type": "string", "description": "Issue body in markdown"},
                    "labels": {"type": "array", "items": {"type": "string"}, "description": "Optional label names"},
                },
                "required": ["repo", "title", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "github_create_pr",
            "description": "Create a GitHub pull request.",
            "parameters": {
                "type": "object",
                "properties": {
                    "repo": {"type": "string", "description": "Repository as 'owner/repo'"},
                    "title": {"type": "string"},
                    "body": {"type": "string", "description": "PR description in markdown"},
                    "head": {"type": "string", "description": "Branch containing the changes"},
                    "base": {"type": "string", "description": "Branch to merge into (e.g. 'main')"},
                },
                "required": ["repo", "title", "body", "head", "base"],
            },
        },
    },
]


# ── Tool implementations ───────────────────────────────────────────────────────

def _github_headers() -> dict:
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise ValueError("GITHUB_TOKEN is not set. Add it to backend/.env")
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _tool_search_meetings(user_id: str, query: str) -> str:
    results = cross_meeting_search(user_id, query)
    if not results:
        return "No results found."
    lines = []
    for r in results:
        m = int(r["start_sec"]) // 60
        s = int(r["start_sec"]) % 60
        headline = f" [{r['headline']}]" if r.get("headline") else ""
        lines.append(
            f"[{m}:{s:02d}] {r['meeting_title']}{headline} (meeting_id: {r['meeting_id']})\n"
            f"  {r['text']}"
        )
    return "\n\n".join(lines)


def _tool_get_decisions(user_id: str) -> str:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT d.text, d.start_sec, m.title AS meeting_title
                   FROM decisions d JOIN meetings m ON m.id = d.meeting_id
                   WHERE d.user_id = %s ORDER BY m.created_at DESC, d.start_sec""",
                (user_id,),
            )
            rows = cur.fetchall()
    if not rows:
        return "No decisions found."
    return "\n".join(
        f"[{int(r['start_sec'])//60}:{int(r['start_sec'])%60:02d}] {r['meeting_title']}: {r['text']}"
        for r in rows
    )


def _tool_ask_meeting(user_id: str, meeting_id: str, question: str) -> str:
    return _ask_meeting(meeting_id, user_id, question)["answer"]


def _tool_get_conflicts(user_id: str) -> str:
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT c.similarity_score,
                          nd.text AS new_text, nm.title AS new_meeting,
                          pd.text AS past_text, pm.title AS past_meeting
                   FROM conflicts c
                   JOIN decisions nd ON nd.id = c.new_decision_id
                   JOIN meetings  nm ON nm.id = nd.meeting_id
                   JOIN decisions pd ON pd.id = c.past_decision_id
                   JOIN meetings  pm ON pm.id = pd.meeting_id
                   WHERE nd.user_id = %s AND c.status = 'unreviewed'
                   ORDER BY c.created_at DESC""",
                (user_id,),
            )
            rows = cur.fetchall()
    if not rows:
        return "No unreviewed conflicts."
    return "\n\n".join(
        f"Conflict ({round(r['similarity_score'] * 100)}% similar):\n"
        f"  NEW  [{r['new_meeting']}] {r['new_text']}\n"
        f"  PAST [{r['past_meeting']}] {r['past_text']}"
        for r in rows
    )


def _tool_search_web(query: str) -> str:
    from duckduckgo_search import DDGS
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
        if not results:
            return "No web results found."
        return "\n\n".join(
            f"**{r['title']}**\n{r['body']}\nURL: {r['href']}" for r in results
        )
    except Exception as exc:
        return f"Web search error: {exc}"


def _tool_github_list_repos() -> str:
    with httpx.Client(timeout=10) as client:
        r = client.get(
            f"{GITHUB_API}/user/repos",
            headers=_github_headers(),
            params={"sort": "updated", "per_page": 20},
        )
        r.raise_for_status()
    repos = r.json()
    return "\n".join(
        f"- {repo['full_name']} (default branch: {repo['default_branch']}) "
        f"— {repo.get('description') or 'no description'}"
        for repo in repos
    ) or "No repositories found."


def _tool_github_read_file(repo: str, path: str, branch: str = "main") -> str:
    with httpx.Client(timeout=10) as client:
        r = client.get(
            f"{GITHUB_API}/repos/{repo}/contents/{path}",
            headers=_github_headers(),
            params={"ref": branch},
        )
        if r.status_code == 404:
            return f"File not found: {path} on branch {branch}"
        r.raise_for_status()
    content = base64.b64decode(r.json()["content"]).decode("utf-8")
    return content[:6000] + "\n...(truncated)" if len(content) > 6000 else content


def _tool_github_create_issue(
    repo: str, title: str, body: str, labels: Optional[List[str]] = None
) -> str:
    payload: dict = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels
    with httpx.Client(timeout=10) as client:
        r = client.post(
            f"{GITHUB_API}/repos/{repo}/issues",
            headers=_github_headers(),
            json=payload,
        )
        r.raise_for_status()
    issue = r.json()
    return f"Created issue #{issue['number']}: {issue['html_url']}"


def _tool_github_create_pr(repo: str, title: str, body: str, head: str, base: str) -> str:
    with httpx.Client(timeout=10) as client:
        r = client.post(
            f"{GITHUB_API}/repos/{repo}/pulls",
            headers=_github_headers(),
            json={"title": title, "body": body, "head": head, "base": base},
        )
        r.raise_for_status()
    pr = r.json()
    return f"Created PR #{pr['number']}: {pr['html_url']}"


def _execute_tool(name: str, args: dict, user_id: str) -> str:
    if name == "search_meetings":
        return _tool_search_meetings(user_id, args["query"])
    if name == "get_decisions":
        return _tool_get_decisions(user_id)
    if name == "ask_meeting":
        return _tool_ask_meeting(user_id, args["meeting_id"], args["question"])
    if name == "get_conflicts":
        return _tool_get_conflicts(user_id)
    if name == "search_web":
        return _tool_search_web(args["query"])
    if name == "github_list_repos":
        return _tool_github_list_repos()
    if name == "github_read_file":
        return _tool_github_read_file(args["repo"], args["path"], args.get("branch", "main"))
    if name == "github_create_issue":
        return _tool_github_create_issue(
            args["repo"], args["title"], args["body"], args.get("labels")
        )
    if name == "github_create_pr":
        return _tool_github_create_pr(
            args["repo"], args["title"], args["body"], args["head"], args["base"]
        )
    raise ValueError(f"Unknown tool: {name}")


# ── Supervisor ─────────────────────────────────────────────────────────────────

_ROUTING_PROMPT = """You are an orchestrator for MeetingOS. Decide which specialist to call next, or FINISH if the task is complete.

Specialists:
- meeting_agent   — searches meeting transcripts, answers questions, retrieves decisions
- conflict_agent  — finds contradictions between decisions across different meetings
- web_agent       — searches the web for current information
- github_agent    — lists repos, reads files, creates issues or pull requests

Rules:
- Route to the most relevant specialist for the current need.
- Do not call the same specialist twice unless the first call was clearly incomplete.
- Output FINISH once enough information has been gathered to answer the task.

Respond ONLY with valid JSON: {"next": "meeting_agent"|"conflict_agent"|"web_agent"|"github_agent"|"FINISH"}"""


def supervisor_node(state: AgentState) -> dict:
    history = [_to_oai(m) for m in state["messages"]]
    resp = chat_complete(
        [{"role": "system", "content": _ROUTING_PROMPT}, *history],
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(resp.choices[0].message.content)
        next_agent = data.get("next", "FINISH")
    except (json.JSONDecodeError, AttributeError):
        next_agent = "FINISH"

    if next_agent not in MEMBERS:
        # Synthesize the final answer from everything gathered so far
        synth = chat_complete(
            [
                {
                    "role": "system",
                    "content": (
                        "You are a helpful assistant. Synthesize a clear, comprehensive "
                        "final answer based on all the information gathered by your team."
                    ),
                },
                *history,
            ],
        )
        answer = synth.choices[0].message.content or "Task complete."
        return {
            "next_agent": "FINISH",
            "events": [{"type": "done", "answer": answer}],
        }

    return {
        "next_agent": next_agent,
        "events": [{"type": "step", "agent": next_agent}],
    }


# ── Specialist agents ──────────────────────────────────────────────────────────

def _run_specialist(state: AgentState, tools: list, system_prompt: str) -> dict:
    """
    Generic specialist: runs a focused tool-use loop until the model stops
    calling tools, then returns updated messages and SSE events.
    """
    user_id = state["user_id"]
    # Build a local message list (plain dicts, safe to pass to any OpenAI-compatible API)
    local_msgs: list = [{"role": "system", "content": system_prompt}, *[_to_oai(m) for m in state["messages"]]]
    new_messages: list = []
    events: list = []

    for _ in range(8):  # max tool-use rounds per specialist
        resp = chat_complete(local_msgs, tools=tools)
        msg = resp.choices[0].message

        # Serialize to a plain dict so it can be stored in LangGraph state
        msg_dict: dict = {"role": "assistant", "content": msg.content or ""}
        if msg.tool_calls:
            msg_dict["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ]

        local_msgs.append(msg_dict)
        new_messages.append(msg_dict)

        if not msg.tool_calls:
            break

        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}

            events.append({"type": "tool_call", "tool": tc.function.name, "input": args})

            try:
                result = _execute_tool(tc.function.name, args, user_id)
            except Exception as exc:
                result = f"Error: {exc}"

            events.append({"type": "tool_result", "tool": tc.function.name, "result": result[:2000]})

            tool_msg = {"role": "tool", "tool_call_id": tc.id, "content": result[:8000]}
            local_msgs.append(tool_msg)
            new_messages.append(tool_msg)

    return {"messages": new_messages, "events": events}


def meeting_agent_node(state: AgentState) -> dict:
    return _run_specialist(
        state,
        _MEETING_TOOLS,
        (
            "You are a meeting intelligence agent. Use your tools to search transcripts, "
            "answer questions about specific meetings, and retrieve decisions. "
            "Be thorough — search with multiple queries if the first doesn't return enough."
        ),
    )


def conflict_agent_node(state: AgentState) -> dict:
    return _run_specialist(
        state,
        _CONFLICT_TOOLS,
        (
            "You are a conflict detection agent. Retrieve and clearly explain any "
            "cross-meeting conflicts — decisions that contradict each other."
        ),
    )


def web_agent_node(state: AgentState) -> dict:
    return _run_specialist(
        state,
        _WEB_TOOLS,
        (
            "You are a web research agent. Search for current, relevant information "
            "that complements or provides context for the meeting data."
        ),
    )


def github_agent_node(state: AgentState) -> dict:
    return _run_specialist(
        state,
        _GITHUB_TOOLS,
        (
            "You are a GitHub agent. Use your tools to interact with GitHub — "
            "list repos, read files, create issues, or open pull requests as instructed."
        ),
    )


# ── Graph ──────────────────────────────────────────────────────────────────────

def _route(state: AgentState) -> str:
    return state["next_agent"]


_builder = StateGraph(AgentState)
_builder.add_node("supervisor", supervisor_node)
_builder.add_node("meeting_agent", meeting_agent_node)
_builder.add_node("conflict_agent", conflict_agent_node)
_builder.add_node("web_agent", web_agent_node)
_builder.add_node("github_agent", github_agent_node)

_builder.set_entry_point("supervisor")
_builder.add_conditional_edges(
    "supervisor",
    _route,
    {
        "meeting_agent": "meeting_agent",
        "conflict_agent": "conflict_agent",
        "web_agent": "web_agent",
        "github_agent": "github_agent",
        "FINISH": END,
    },
)
for _m in MEMBERS:
    _builder.add_edge(_m, "supervisor")

_graph = _builder.compile()


# ── Public interface ───────────────────────────────────────────────────────────

def stream_agent(user_id: str, task: str) -> Generator[str, None, None]:
    """
    Run the multi-agent graph and yield SSE-formatted events.
    Each graph node flushes its events via the `events` field in state updates,
    which stream_agent converts to SSE strings for the FastAPI StreamingResponse.
    """
    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    initial_state: AgentState = {
        "task": task,
        "user_id": user_id,
        "messages": [{"role": "user", "content": task}],
        "next_agent": "",
        "events": [],
    }

    done = False
    try:
        for graph_event in _graph.stream(
            initial_state,
            stream_mode="updates",
            config={"recursion_limit": 25},
        ):
            for _node, updates in graph_event.items():
                for sse_event in updates.get("events", []):
                    yield _sse(sse_event)
                    if sse_event.get("type") == "done":
                        done = True
                        return
    except Exception as exc:
        yield _sse({"type": "error", "message": str(exc)})
        return

    if not done:
        yield _sse({"type": "done", "answer": "Agent reached the step limit."})
