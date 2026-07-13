"""
OpenAI agent loop for MeetingOS.

The agent runs a tool-use loop using GPT-4o until the model produces a final
text answer (no more tool calls). It streams each step as a Server-Sent Event
so the UI can show progress in real time.

Available tools
───────────────
Meeting tools  search_meetings · get_decisions · ask_meeting · get_conflicts
GitHub tools   github_list_repos · github_read_file · github_create_issue · github_create_pr
Web            search_web  (DuckDuckGo, no API key required)
"""

import base64
import json
import os
from typing import Generator, List, Optional

import httpx
from openai import OpenAI

from db import get_db
from search import cross_meeting_search
from chat import ask_meeting as _ask_meeting

MAX_STEPS = 20          # hard ceiling to prevent runaway loops
GITHUB_API = "https://api.github.com"

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


# ── Tool schemas ───────────────────────────────────────────────────────────────

TOOLS = [
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
                "properties": {
                    "query": {"type": "string", "description": "Natural language search query"},
                },
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
                    "question":   {"type": "string", "description": "Question to answer"},
                },
                "required": ["meeting_id", "question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_conflicts",
            "description": "Return cross-meeting conflicts: decisions that contradict each other across meetings.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for current information. Returns titles, snippets, and URLs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                },
                "required": ["query"],
            },
        },
    },
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
                    "repo":   {"type": "string", "description": "Repository as 'owner/repo'"},
                    "path":   {"type": "string", "description": "File path within the repo"},
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
                    "repo":   {"type": "string", "description": "Repository as 'owner/repo'"},
                    "title":  {"type": "string", "description": "Issue title"},
                    "body":   {"type": "string", "description": "Issue body in markdown"},
                    "labels": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of label names",
                    },
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
                    "repo":  {"type": "string", "description": "Repository as 'owner/repo'"},
                    "title": {"type": "string", "description": "PR title"},
                    "body":  {"type": "string", "description": "PR description in markdown"},
                    "head":  {"type": "string", "description": "Branch that contains the changes"},
                    "base":  {"type": "string", "description": "Branch to merge into (e.g. 'main')"},
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
                   FROM decisions d
                   JOIN meetings m ON m.id = d.meeting_id
                   WHERE d.user_id = %s
                   ORDER BY m.created_at DESC, d.start_sec""",
                (user_id,),
            )
            rows = cur.fetchall()
    if not rows:
        return "No decisions found."
    lines = []
    for r in rows:
        m = int(r["start_sec"]) // 60
        s = int(r["start_sec"]) % 60
        lines.append(f"[{m}:{s:02d}] {r['meeting_title']}: {r['text']}")
    return "\n".join(lines)


def _tool_ask_meeting(user_id: str, meeting_id: str, question: str) -> str:
    result = _ask_meeting(meeting_id, user_id, question)
    return result["answer"]


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
    lines = []
    for r in rows:
        pct = round(r["similarity_score"] * 100)
        lines.append(
            f"Conflict ({pct}% similar):\n"
            f"  NEW  [{r['new_meeting']}] {r['new_text']}\n"
            f"  PAST [{r['past_meeting']}] {r['past_text']}"
        )
    return "\n\n".join(lines)


def _tool_search_web(query: str) -> str:
    from duckduckgo_search import DDGS
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=5))
        if not results:
            return "No web results found."
        lines = []
        for r in results:
            lines.append(f"**{r['title']}**\n{r['body']}\nURL: {r['href']}")
        return "\n\n".join(lines)
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
    lines = [
        f"- {repo['full_name']} (default branch: {repo['default_branch']}) "
        f"— {repo.get('description') or 'no description'}"
        for repo in repos
    ]
    return "\n".join(lines) if lines else "No repositories found."


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
    if len(content) > 6000:
        content = content[:6000] + "\n...(truncated)"
    return content


def _tool_github_create_issue(repo: str, title: str, body: str, labels: Optional[List[str]] = None) -> str:
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
        return _tool_github_create_issue(args["repo"], args["title"], args["body"], args.get("labels"))
    if name == "github_create_pr":
        return _tool_github_create_pr(args["repo"], args["title"], args["body"], args["head"], args["base"])
    raise ValueError(f"Unknown tool: {name}")


# ── Agent loop ─────────────────────────────────────────────────────────────────

def stream_agent(user_id: str, task: str) -> Generator[str, None, None]:
    """
    Run the agent loop and yield SSE-formatted events.

    Event types:
      {"type": "tool_call",   "tool": "...", "input": {...}}
      {"type": "tool_result", "tool": "...", "result": "..."}
      {"type": "done",        "answer": "..."}
      {"type": "error",       "message": "..."}
    """
    client = _get_client()
    messages = [{"role": "user", "content": task}]

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    try:
        for _ in range(MAX_STEPS):
            response = client.chat.completions.create(
                model="gpt-4o",
                tools=TOOLS,
                messages=messages,
            )

            msg = response.choices[0].message

            # No tool calls — the agent is done
            if not msg.tool_calls:
                yield _sse({"type": "done", "answer": msg.content or ""})
                return

            # Append the assistant message (with tool_calls) to history
            messages.append(msg)

            # Execute each requested tool call
            for tool_call in msg.tool_calls:
                name = tool_call.function.name
                try:
                    args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                yield _sse({"type": "tool_call", "tool": name, "input": args})

                try:
                    result = _execute_tool(name, args, user_id)
                except Exception as exc:
                    result = f"Error: {exc}"

                # Truncate long results before feeding back to the model
                model_result = result if len(result) <= 8000 else result[:8000] + "\n...(truncated)"

                yield _sse({"type": "tool_result", "tool": name, "result": result[:2000]})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": model_result,
                })

        # Hit the step ceiling
        yield _sse({"type": "done", "answer": f"Agent reached the {MAX_STEPS}-step limit."})

    except Exception as exc:
        yield _sse({"type": "error", "message": str(exc)})
