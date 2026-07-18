"""
Optimized RAG chat pipeline for meeting segments.

  1. Query rewriting   — Llama 3.1 8B (Groq) rewrites the question into a tighter search query
  2. Hybrid retrieval  — four search arms (vector × 2, keyword × 2) merged with RRF
  3. LLM re-ranking    — Llama 3.1 8B (Groq) picks the best FINAL_K from RETRIEVAL_K candidates
  4. Answer generation — Llama 3.1 8B (Groq) answers using only the re-ranked context
"""

import json
import uuid
from typing import List

from pgvector.psycopg2 import register_vector

from db import get_db
from llm import chat_complete, embed_text

RETRIEVAL_K = 15   # candidates per search arm before merging
FINAL_K = 5        # kept after re-ranking
RRF_K = 60         # standard RRF constant


def _format_time(secs: float) -> str:
    m = int(secs) // 60
    s = int(secs) % 60
    return f"{m}:{s:02d}"


def _rewrite_query(question: str) -> str:
    """
    Llama 3.1 8B reformulates the question into a short, precise search query.
    Running dual queries (original + rewritten) improves recall for conversational
    questions whose wording differs from the transcript's phrasing.
    """
    resp = chat_complete(
        [
            {
                "role": "system",
                "content": (
                    "Convert the question into a short, precise search query for a "
                    "meeting transcript database. Focus on the core topic, name, or "
                    "decision. Reply ONLY with the rewritten query — nothing else."
                ),
            },
            {"role": "user", "content": question},
        ],
        use_cache=True,
    )
    return resp.choices[0].message.content.strip()


def _has_chunks(conn, meeting_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM chunks WHERE meeting_id = %s AND embedding IS NOT NULL LIMIT 1",
            (meeting_id,),
        )
        return cur.fetchone() is not None


def _vector_search(conn, meeting_id: str, vector: List[float], limit: int) -> List[dict]:
    """
    Cosine-similarity search — uses the chunks table when available (richer embeddings),
    falls back to segments for meetings that haven't been chunked yet.
    """
    if _has_chunks(conn, meeting_id):
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, headline, summary, body AS text,
                          start_sec, end_sec, source_segment_ids
                   FROM chunks
                   WHERE meeting_id = %s AND embedding IS NOT NULL
                   ORDER BY embedding <=> %s::vector
                   LIMIT %s""",
                (meeting_id, vector, limit),
            )
            return [dict(r) for r in cur.fetchall()]
    # Fallback: raw segment search
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, text, start_sec
               FROM segments
               WHERE meeting_id = %s AND embedding IS NOT NULL
               ORDER BY embedding <=> %s::vector
               LIMIT %s""",
            (meeting_id, vector, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def _keyword_search(conn, meeting_id: str, query_text: str, limit: int) -> List[dict]:
    """
    Postgres full-text search — searches headline + summary + body on chunks
    (or just text on segments as fallback).
    """
    if _has_chunks(conn, meeting_id):
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, headline, summary, body AS text,
                          start_sec, end_sec, source_segment_ids
                   FROM chunks
                   WHERE meeting_id = %s
                     AND to_tsvector('english', headline || ' ' || summary || ' ' || body)
                         @@ plainto_tsquery('english', %s)
                   ORDER BY ts_rank(
                       to_tsvector('english', headline || ' ' || summary || ' ' || body),
                       plainto_tsquery('english', %s)
                   ) DESC
                   LIMIT %s""",
                (meeting_id, query_text, query_text, limit),
            )
            return [dict(r) for r in cur.fetchall()]
    # Fallback: raw segment keyword search
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, text, start_sec
               FROM segments
               WHERE meeting_id = %s
                 AND to_tsvector('english', text) @@ plainto_tsquery('english', %s)
               ORDER BY ts_rank(to_tsvector('english', text),
                                plainto_tsquery('english', %s)) DESC
               LIMIT %s""",
            (meeting_id, query_text, query_text, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def _rrf_merge(ranked_lists: List[List[dict]]) -> List[dict]:
    """
    Reciprocal Rank Fusion across N ranked lists.
    Each segment scores  Σ  1 / (RRF_K + rank)  across all lists it appears in.
    Segments that surface in multiple arms are boosted automatically.
    """
    scores: dict = {}
    segments: dict = {}
    for ranked in ranked_lists:
        for rank, seg in enumerate(ranked):
            sid = seg["id"]
            scores[sid] = scores.get(sid, 0.0) + 1.0 / (RRF_K + rank + 1)
            segments[sid] = seg
    order = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [segments[sid] for sid in order]


def _rerank(question: str, candidates: List[dict]) -> List[dict]:
    """
    LLM re-ranker: Llama 3.1 8B sorts the candidates by relevance and keeps FINAL_K.
    This ensures the best chunks are at the top of the context window.
    """
    if len(candidates) <= FINAL_K:
        return candidates

    chunk_lines = "\n\n".join(
        f"CHUNK {i + 1}: [{_format_time(seg['start_sec'])}] {seg.get('text', '')}"
        for i, seg in enumerate(candidates)
    )
    resp = chat_complete(
        [
            {
                "role": "system",
                "content": (
                    "You are a re-ranker for meeting transcript chunks. "
                    "Given a question and numbered chunks, return a JSON object with "
                    "key 'order': a list of ALL chunk numbers (1-indexed), sorted from "
                    "most relevant to least relevant. Include every chunk number exactly once."
                ),
            },
            {
                "role": "user",
                "content": f"Question: {question}\n\n{chunk_lines}",
            },
        ],
        response_format={"type": "json_object"},
    )
    try:
        order = json.loads(resp.choices[0].message.content)["order"]
        reranked = [candidates[i - 1] for i in order if 1 <= i <= len(candidates)]
        # Deduplicate (reranker occasionally repeats an index)
        seen: set = set()
        deduped = []
        for seg in reranked:
            if seg["id"] not in seen:
                seen.add(seg["id"])
                deduped.append(seg)
        return deduped[:FINAL_K]
    except (KeyError, IndexError, json.JSONDecodeError):
        return candidates[:FINAL_K]


def ask_meeting(meeting_id: str, user_id: str, question: str) -> dict:
    """
    Full RAG pipeline: rewrite → hybrid retrieval (RRF) → LLM rerank → generate.
    Returns the same shape as before plus `rewritten_query` for debugging.
    """
    # ── 1. Query rewriting ────────────────────────────────────────────────────
    rewritten = _rewrite_query(question)

    # ── 2. Embed both queries ─────────────────────────────────────────────────
    original_vec = embed_text(question)
    rewritten_vec = embed_text(rewritten)

    # ── 3. Four search arms → RRF merge ──────────────────────────────────────
    with get_db() as conn:
        register_vector(conn)
        v1 = _vector_search(conn, meeting_id, original_vec, RETRIEVAL_K)
        v2 = _vector_search(conn, meeting_id, rewritten_vec, RETRIEVAL_K)
        k1 = _keyword_search(conn, meeting_id, question, RETRIEVAL_K)
        k2 = _keyword_search(conn, meeting_id, rewritten, RETRIEVAL_K)

    candidates = _rrf_merge([v1, v2, k1, k2])

    if not candidates:
        raise ValueError("No segments found for this meeting.")

    # ── 4. LLM re-ranking ────────────────────────────────────────────────────
    top = _rerank(question, candidates)

    # ── 5. Build context ──────────────────────────────────────────────────────
    context = "\n".join(
        f"[{_format_time(seg['start_sec'])}] {seg.get('text', '')}" for seg in top
    )

    # ── 6. Answer generation ──────────────────────────────────────────────────
    completion = chat_complete(
        [
            {
                "role": "system",
                "content": (
                    "You are an assistant that answers questions about meeting recordings. "
                    "Answer using ONLY the transcript segments provided. "
                    "Always cite the timestamp where you found the answer, "
                    "e.g. 'At 0:02, the team decided...'. "
                    "If the answer is not in the segments, say so explicitly."
                ),
            },
            {
                "role": "user",
                "content": f"Transcript segments:\n{context}\n\nQuestion: {question}",
            },
        ],
    )
    answer = completion.choices[0].message.content or ""

    # ── 7. Citations ──────────────────────────────────────────────────────────
    # segment_id is the chunk or segment UUID; source_segment_ids lists the
    # original Whisper segment UUIDs that were merged into the chunk (empty
    # list when falling back to raw segment search).
    cited = [
        {
            "segment_id":         seg["id"],
            "start_sec":          seg["start_sec"],
            "text":               seg.get("text", ""),
            "source_segment_ids": seg.get("source_segment_ids", []),
            **({"headline": seg["headline"]} if seg.get("headline") else {}),
        }
        for seg in top
    ]

    # ── 8. Persist ────────────────────────────────────────────────────────────
    assistant_id = str(uuid.uuid4())
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO chat_messages
                   (id, meeting_id, user_id, role, content, cited_segments)
                   VALUES (%s, %s, %s, 'user', %s, '[]'::jsonb)""",
                (str(uuid.uuid4()), meeting_id, user_id, question),
            )
            cur.execute(
                """INSERT INTO chat_messages
                   (id, meeting_id, user_id, role, content, cited_segments)
                   VALUES (%s, %s, %s, 'assistant', %s, %s)""",
                (assistant_id, meeting_id, user_id, answer, json.dumps(cited)),
            )

    return {
        "message_id": assistant_id,
        "answer": answer,
        "cited_segments": cited,
        "rewritten_query": rewritten,
    }
