"""
MCP server for MeetingOS.

Exposes five tools to any MCP client (e.g. Claude Desktop):
  - list_meetings    — all meetings for the configured user
  - search_meetings  — hybrid semantic + keyword search across every meeting
  - ask_meeting      — RAG chat against a specific meeting transcript
  - get_decisions    — all decisions extracted from every meeting, newest first
  - get_conflicts    — cross-meeting contradictions that need review

Authentication: generates a short-lived HS256 JWT for MCP_USER_ID and
calls the FastAPI backend directly. Configure in .env:
  MCP_USER_ID=<your user ID — visit /me endpoint to retrieve it>
"""

import os
import time

import jwt
import httpx
from dotenv import load_dotenv
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types

load_dotenv()

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
NEXTAUTH_SECRET = os.environ["NEXTAUTH_SECRET"]
MCP_USER_ID = os.environ["MCP_USER_ID"]

server = Server("meetingos")


def _make_token() -> str:
    return jwt.encode(
        {"sub": MCP_USER_ID, "exp": int(time.time()) + 120},
        NEXTAUTH_SECRET,
        algorithm="HS256",
    )


def _headers() -> dict:
    return {"Authorization": f"Bearer {_make_token()}"}


def _get(path: str, **params) -> dict | list:
    with httpx.Client(timeout=60) as client:
        r = client.get(f"{BACKEND_URL}{path}", headers=_headers(), params=params)
        r.raise_for_status()
        return r.json()


def _post(path: str, body: dict) -> dict:
    with httpx.Client(timeout=60) as client:
        r = client.post(f"{BACKEND_URL}{path}", headers=_headers(), json=body)
        r.raise_for_status()
        return r.json()


def _fmt_time(secs: float) -> str:
    m = int(secs) // 60
    s = int(secs) % 60
    return f"{m}:{s:02d}"


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="list_meetings",
            description="List all meetings for the user, newest first. Returns id, title, status, and duration.",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        types.Tool(
            name="search_meetings",
            description=(
                "Hybrid semantic + keyword search across all meeting transcripts. "
                "Uses query rewriting and reciprocal rank fusion for high recall. "
                "Returns the most relevant transcript chunks with meeting names and timestamps."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural language search query"},
                },
                "required": ["query"],
            },
        ),
        types.Tool(
            name="ask_meeting",
            description=(
                "Ask a question about a specific meeting using RAG. "
                "Returns an answer grounded in the transcript with timestamp citations. "
                "Use list_meetings first to get the meeting_id."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "meeting_id": {"type": "string", "description": "UUID of the meeting"},
                    "question":   {"type": "string", "description": "Question to answer"},
                },
                "required": ["meeting_id", "question"],
            },
        ),
        types.Tool(
            name="get_decisions",
            description=(
                "Return every decision extracted from all meetings, newest meeting first. "
                "Each decision includes the meeting it came from and the timestamp where it was made."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        types.Tool(
            name="get_conflicts",
            description=(
                "Return cross-meeting conflicts: pairs of decisions that contradict each other. "
                "Only returns unreviewed conflicts. Useful for spotting when a new meeting "
                "reverses or contradicts a decision made in an earlier meeting."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:

    # ── list_meetings ──────────────────────────────────────────────────────────
    if name == "list_meetings":
        meetings = _get("/meetings")
        if not meetings:
            return [types.TextContent(type="text", text="No meetings found.")]
        lines = []
        for m in meetings:
            dur = m.get("duration_seconds")
            dur_str = f", duration={_fmt_time(dur)}" if dur else ""
            lines.append(
                f"- [{m['status']}] {m['title']} "
                f"(id: {m['id']}, date: {m['created_at'][:10]}{dur_str})"
            )
        return [types.TextContent(type="text", text="\n".join(lines))]

    # ── search_meetings ────────────────────────────────────────────────────────
    if name == "search_meetings":
        query = arguments["query"]
        results = _get("/search", q=query)
        if not results:
            return [types.TextContent(type="text", text="No results found.")]
        lines = []
        for r in results:
            headline = f" [{r['headline']}]" if r.get("headline") else ""
            lines.append(
                f"[{_fmt_time(r['start_sec'])}] {r['meeting_title']}{headline}\n"
                f"  {r['text']}"
            )
        return [types.TextContent(type="text", text="\n\n".join(lines))]

    # ── ask_meeting ────────────────────────────────────────────────────────────
    if name == "ask_meeting":
        meeting_id = arguments["meeting_id"]
        question   = arguments["question"]
        result     = _post(f"/meetings/{meeting_id}/chat", {"question": question})
        answer     = result["answer"]
        citations  = result.get("cited_segments", [])
        if citations:
            cited_str = ", ".join(_fmt_time(c["start_sec"]) for c in citations[:5])
            answer += f"\n\nSource timestamps: {cited_str}"
        return [types.TextContent(type="text", text=answer)]

    # ── get_decisions ──────────────────────────────────────────────────────────
    if name == "get_decisions":
        decisions = _get("/decisions")
        if not decisions:
            return [types.TextContent(type="text", text="No decisions found.")]

        # Group by meeting for readability
        groups: dict[str, dict] = {}
        for d in decisions:
            mid = d["meeting_id"]
            if mid not in groups:
                groups[mid] = {
                    "title": d["meeting_title"],
                    "date":  d["meeting_date"][:10],
                    "items": [],
                }
            groups[mid]["items"].append(d)

        lines = []
        for g in groups.values():
            lines.append(f"{g['title']} ({g['date']}):")
            for d in g["items"]:
                lines.append(f"  [{_fmt_time(d['start_sec'])}] {d['text']}")
        return [types.TextContent(type="text", text="\n".join(lines))]

    # ── get_conflicts ──────────────────────────────────────────────────────────
    if name == "get_conflicts":
        conflicts = _get("/conflicts")
        unreviewed = [c for c in conflicts if c["status"] == "unreviewed"]
        if not unreviewed:
            return [types.TextContent(type="text", text="No unreviewed conflicts.")]
        lines = []
        for c in unreviewed:
            pct = round(c["similarity_score"] * 100)
            lines.append(
                f"Conflict ({pct}% similar):\n"
                f"  NEW  [{c['new_meeting_title']}]  {c['new_decision_text']}\n"
                f"  PAST [{c['past_meeting_title']}] {c['past_decision_text']}\n"
                f"  conflict_id: {c['id']}"
            )
        return [types.TextContent(type="text", text="\n\n".join(lines))]

    raise ValueError(f"Unknown tool: {name}")


async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
