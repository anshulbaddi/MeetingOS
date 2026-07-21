from dotenv import load_dotenv
load_dotenv()

import os
import uuid
from pathlib import Path
from typing import List

from fastapi import Body, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from pydantic import BaseModel

import jwt as pyjwt

from llm import chat_complete

PUBLIC_CHAT_SYSTEM_PROMPT = """You are a helpful assistant for MeetingOS, an AI-powered meeting intelligence platform. Help visitors understand the product.

MeetingOS features:
- Automatic transcription of any audio/video recording via OpenAI Whisper, with timestamps
- Per-meeting AI chat: ask questions, get grounded answers with cited timestamps
- Hybrid RAG pipeline: vector search + keyword search + query rewriting + LLM re-ranking
- Cross-meeting search: search across all meetings at once
- Conflict detection: flags decisions across different meetings that contradict each other
- Live transcription via WebSocket for real-time meetings
- AI Agent that can search meetings, GitHub repos, and the web to complete tasks

Be friendly, concise (2-4 sentences max per reply), and encourage visitors to sign in and try it. Only describe features listed above."""

class ChatMessage(BaseModel):
    role: str
    content: str

from agent import stream_agent
from auth import get_current_user_id, NEXTAUTH_SECRET
from chat import ask_meeting
from db import get_db
from live_transcription import handle_live_session
from search import cross_meeting_search
from storage import upload, get_public_url
from tasks import transcribe_meeting_task

# ── Config from environment ────────────────────────────────────────────────────
# Comma-separated list of allowed origins, e.g.
#   ALLOWED_ORIGINS=https://myapp.com,http://localhost:3000
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "500"))

ALLOWED_EXTENSIONS = {".mp3", ".mp4", ".wav", ".m4a", ".webm", ".ogg", ".mov"}

# ── App + middleware ───────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="MeetingOS API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post("/chat/public")
@limiter.limit("10/minute")
async def public_chat(
    request: Request,
    message: str = Body(..., embed=True),
    history: List[ChatMessage] = Body(default=[], embed=True),
):
    """Public chatbot — no auth required. Rate-limited by IP."""
    messages = [{"role": "system", "content": PUBLIC_CHAT_SYSTEM_PROMPT}]
    for h in history[-10:]:
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": message[:500]})

    response = chat_complete(messages, max_tokens=300)
    return {"reply": response.choices[0].message.content}


@app.get("/health")
def health():
    """Shallow liveness check — does not verify dependencies."""
    return {"status": "ok"}


@app.get("/healthz")
def healthz():
    """Deep readiness check — verifies DB and Redis are reachable."""
    import redis as _redis
    from db import get_db

    checks: dict[str, str] = {}

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        checks["db"] = "ok"
    except Exception as exc:
        checks["db"] = f"error: {exc}"

    try:
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        r = _redis.from_url(redis_url, socket_connect_timeout=2)
        r.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"

    all_ok = all(v == "ok" for v in checks.values())
    return {"status": "ok" if all_ok else "degraded", **checks}


@app.get("/me")
async def me(user_id: str = Depends(get_current_user_id)):
    return {"user_id": user_id}


@app.post("/meetings/upload")
@limiter.limit("10/minute")
async def upload_meeting(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    meeting_id = str(uuid.uuid4())
    object_key = f"meetings/{meeting_id}{ext}"

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_UPLOAD_MB} MB.",
        )

    upload(content, object_key)

    title = Path(filename).stem.replace("-", " ").replace("_", " ").title()

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO meetings (id, user_id, title, file_path, status)
                   VALUES (%s, %s, %s, %s, 'processing')
                   RETURNING id, title, status, created_at""",
                (meeting_id, user_id, title, object_key),
            )
            meeting = dict(cur.fetchone())

    transcribe_meeting_task.delay(meeting_id, object_key)
    return meeting


@app.get("/search")
@limiter.limit("20/minute")
def search(request: Request, q: str, user_id: str = Depends(get_current_user_id)):
    if not q.strip():
        return []
    return cross_meeting_search(user_id, q)


@app.get("/decisions")
def list_decisions(user_id: str = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT d.id, d.text, d.context, d.start_sec,
                          m.id AS meeting_id, m.title AS meeting_title,
                          m.created_at AS meeting_date
                   FROM decisions d
                   JOIN meetings m ON m.id = d.meeting_id
                   WHERE d.user_id = %s
                   ORDER BY m.created_at DESC, d.start_sec ASC""",
                (user_id,),
            )
            return [dict(r) for r in cur.fetchall()]


@app.get("/meetings")
def list_meetings(user_id: str = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, title, status, duration_seconds, created_at
                   FROM meetings WHERE user_id = %s ORDER BY created_at DESC""",
                (user_id,),
            )
            return [dict(r) for r in cur.fetchall()]


@app.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: str, user_id: str = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM meetings WHERE id = %s AND user_id = %s",
                (meeting_id, user_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404)
            meeting = dict(row)

            cur.execute(
                """SELECT id, text, start_sec, end_sec, speaker
                   FROM segments WHERE meeting_id = %s ORDER BY start_sec""",
                (meeting_id,),
            )
            meeting["segments"] = [dict(s) for s in cur.fetchall()]

            cur.execute(
                """SELECT summary, action_items, participants, slide_transitions
                   FROM meeting_meta WHERE meeting_id = %s LIMIT 1""",
                (meeting_id,),
            )
            meta_row = cur.fetchone()
            meeting["meta"] = dict(meta_row) if meta_row else None

            cur.execute(
                """SELECT id, text, context, start_sec
                   FROM decisions WHERE meeting_id = %s ORDER BY start_sec""",
                (meeting_id,),
            )
            meeting["decisions"] = [dict(d) for d in cur.fetchall()]

            cur.execute(
                """SELECT c.id, c.status, c.similarity_score,
                          nd.text AS new_decision_text,
                          pd.text AS past_decision_text,
                          pm.title AS past_meeting_title,
                          pm.id AS past_meeting_id
                   FROM conflicts c
                   JOIN decisions nd ON nd.id = c.new_decision_id
                   JOIN decisions pd ON pd.id = c.past_decision_id
                   JOIN meetings pm ON pm.id = pd.meeting_id
                   WHERE nd.meeting_id = %s
                   ORDER BY c.created_at""",
                (meeting_id,),
            )
            meeting["conflicts"] = [dict(r) for r in cur.fetchall()]

    file_path = meeting.get("file_path") or ""
    meeting["recording_url"] = get_public_url(file_path) if file_path else None
    return meeting


@app.get("/conflicts")
def list_conflicts(user_id: str = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT c.id, c.status, c.similarity_score,
                          nd.text AS new_decision_text,
                          nm.id  AS new_meeting_id,
                          nm.title AS new_meeting_title,
                          pd.text AS past_decision_text,
                          pm.id  AS past_meeting_id,
                          pm.title AS past_meeting_title,
                          c.created_at
                   FROM conflicts c
                   JOIN decisions nd ON nd.id = c.new_decision_id
                   JOIN meetings  nm ON nm.id = nd.meeting_id
                   JOIN decisions pd ON pd.id = c.past_decision_id
                   JOIN meetings  pm ON pm.id = pd.meeting_id
                   WHERE nd.user_id = %s
                   ORDER BY c.created_at DESC""",
                (user_id,),
            )
            return [dict(r) for r in cur.fetchall()]


@app.patch("/conflicts/{conflict_id}")
def update_conflict(
    conflict_id: str,
    status: str = Body(..., embed=True),
    user_id: str = Depends(get_current_user_id),
):
    if status not in ("confirmed", "dismissed"):
        raise HTTPException(status_code=400, detail="status must be 'confirmed' or 'dismissed'")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE conflicts c SET status = %s
                   FROM decisions d
                   WHERE c.id = %s
                     AND c.new_decision_id = d.id
                     AND d.user_id = %s
                   RETURNING c.id""",
                (status, conflict_id, user_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404)
    return {"id": conflict_id, "status": status}


@app.get("/meetings/{meeting_id}/chat")
def get_chat(meeting_id: str, user_id: str = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM meetings WHERE id = %s AND user_id = %s",
                (meeting_id, user_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404)

            cur.execute(
                """SELECT id, role, content, cited_segments, created_at
                   FROM chat_messages WHERE meeting_id = %s
                   ORDER BY created_at""",
                (meeting_id,),
            )
            return [dict(r) for r in cur.fetchall()]


@app.post("/meetings/{meeting_id}/chat")
@limiter.limit("30/minute")
def post_chat(
    request: Request,
    meeting_id: str,
    question: str = Body(..., embed=True),
    user_id: str = Depends(get_current_user_id),
):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM meetings WHERE id = %s AND user_id = %s",
                (meeting_id, user_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404)

    try:
        return ask_meeting(meeting_id, user_id, question)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/meetings/live")
def create_live_meeting(user_id: str = Depends(get_current_user_id)):
    meeting_id = str(uuid.uuid4())
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO meetings (id, user_id, title, file_path, status)
                   VALUES (%s, %s, %s, %s, 'live')
                   RETURNING id, title, status, created_at""",
                (meeting_id, user_id, "Live Recording", ""),
            )
            return dict(cur.fetchone())


@app.websocket("/ws/meetings/{meeting_id}/live")
async def live_transcription_ws(
    websocket: WebSocket,
    meeting_id: str,
    token: str = Query(...),
):
    try:
        payload = pyjwt.decode(token, NEXTAUTH_SECRET, algorithms=["HS256"])
        user_id = payload["sub"]
    except Exception:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM meetings WHERE id = %s AND user_id = %s AND status = 'live'",
                (meeting_id, user_id),
            )
            if not cur.fetchone():
                await websocket.close(code=4004, reason="Meeting not found")
                return

    await websocket.accept()
    await handle_live_session(websocket, meeting_id)


@app.post("/agent")
@limiter.limit("10/minute")
def run_agent(
    request: Request,
    task: str = Body(..., embed=True),
    user_id: str = Depends(get_current_user_id),
):
    return StreamingResponse(
        stream_agent(user_id, task),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},  # disable nginx buffering if behind a proxy
    )


@app.post("/meetings/{meeting_id}/share")
def create_share(meeting_id: str, user_id: str = Depends(get_current_user_id)):
    """Generate (or return existing) share token for a meeting."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT share_token FROM meetings WHERE id = %s AND user_id = %s",
                (meeting_id, user_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404)

            token = row["share_token"]
            if not token:
                token = str(uuid.uuid4())
                cur.execute(
                    "UPDATE meetings SET share_token = %s WHERE id = %s",
                    (token, meeting_id),
                )
    return {"share_token": token}


@app.get("/share/{token}")
def get_shared_meeting(token: str):
    """Public endpoint — no auth. Returns summary for a shared meeting."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, title, created_at
                   FROM meetings WHERE share_token = %s AND status = 'complete'""",
                (token,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404)

            meeting = dict(row)
            meeting_id = meeting["id"]

            cur.execute(
                "SELECT summary, action_items, participants FROM meeting_meta WHERE meeting_id = %s LIMIT 1",
                (meeting_id,),
            )
            meta_row = cur.fetchone()

            cur.execute(
                "SELECT text, context FROM decisions WHERE meeting_id = %s ORDER BY start_sec",
                (meeting_id,),
            )
            decisions = [dict(d) for d in cur.fetchall()]

    meta = dict(meta_row) if meta_row else {}
    return {
        "title": meeting["title"],
        "created_at": str(meeting["created_at"]),
        "summary": meta.get("summary", ""),
        "participants": meta.get("participants") or [],
        "action_items": meta.get("action_items") or [],
        "decisions": decisions,
    }


@app.post("/feedback")
def post_feedback(
    type: str = Body(..., embed=True),
    reference_id: str = Body(..., embed=True),
    rating: int = Body(..., embed=True),
    user_id: str = Depends(get_current_user_id),
):
    if type not in ("chat_quality", "conflict_relevance", "summary_quality"):
        raise HTTPException(status_code=400, detail="Invalid feedback type")
    if rating not in (1, -1):
        raise HTTPException(status_code=400, detail="Rating must be 1 or -1")

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO feedback (id, user_id, type, reference_id, rating)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING""",
                (str(uuid.uuid4()), user_id, type, reference_id, rating),
            )
    return {"ok": True}
