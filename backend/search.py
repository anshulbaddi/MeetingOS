"""
Cross-meeting hybrid search using enriched chunks.

Same 4-arm hybrid strategy as chat.py (vector × 2, keyword × 2, RRF merge)
but scoped to all meetings for a user instead of a single meeting.
"""

from typing import List

from openai import OpenAI
from pgvector.psycopg2 import register_vector

from db import get_db

EMBEDDING_MODEL = "text-embedding-3-small"
RETRIEVAL_K = 15
FINAL_K = 8
RRF_K = 60

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def _embed(client: OpenAI, text: str) -> List[float]:
    return client.embeddings.create(model=EMBEDDING_MODEL, input=[text]).data[0].embedding


def _rewrite_query(client: OpenAI, question: str) -> str:
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
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
    )
    return resp.choices[0].message.content.strip()


def _rrf_merge(ranked_lists: List[List[dict]]) -> List[dict]:
    scores: dict = {}
    docs: dict = {}
    for ranked in ranked_lists:
        for rank, doc in enumerate(ranked):
            sid = doc["id"]
            scores[sid] = scores.get(sid, 0.0) + 1.0 / (RRF_K + rank + 1)
            docs[sid] = doc
    order = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [docs[sid] for sid in order]


def _user_has_chunks(conn, user_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT 1 FROM chunks c
               JOIN meetings m ON m.id = c.meeting_id
               WHERE m.user_id = %s AND c.embedding IS NOT NULL
               LIMIT 1""",
            (user_id,),
        )
        return cur.fetchone() is not None


def _cross_vector_search(
    conn, user_id: str, vector: List[float], limit: int, use_chunks: bool
) -> List[dict]:
    if use_chunks:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT c.id, c.body AS text, c.headline, c.summary,
                          c.start_sec, c.end_sec, c.source_segment_ids,
                          m.id AS meeting_id, m.title AS meeting_title
                   FROM chunks c
                   JOIN meetings m ON m.id = c.meeting_id
                   WHERE m.user_id = %s AND c.embedding IS NOT NULL
                   ORDER BY c.embedding <=> %s::vector
                   LIMIT %s""",
                (user_id, vector, limit),
            )
            return [dict(r) for r in cur.fetchall()]

    with conn.cursor() as cur:
        cur.execute(
            """SELECT s.id, s.text, s.start_sec,
                      m.id AS meeting_id, m.title AS meeting_title
               FROM segments s
               JOIN meetings m ON m.id = s.meeting_id
               WHERE m.user_id = %s AND s.embedding IS NOT NULL
               ORDER BY s.embedding <=> %s::vector
               LIMIT %s""",
            (user_id, vector, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def _cross_keyword_search(
    conn, user_id: str, query_text: str, limit: int, use_chunks: bool
) -> List[dict]:
    if use_chunks:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT c.id, c.body AS text, c.headline, c.summary,
                          c.start_sec, c.end_sec, c.source_segment_ids,
                          m.id AS meeting_id, m.title AS meeting_title
                   FROM chunks c
                   JOIN meetings m ON m.id = c.meeting_id
                   WHERE m.user_id = %s
                     AND to_tsvector('english', c.headline || ' ' || c.summary || ' ' || c.body)
                         @@ plainto_tsquery('english', %s)
                   ORDER BY ts_rank(
                       to_tsvector('english', c.headline || ' ' || c.summary || ' ' || c.body),
                       plainto_tsquery('english', %s)
                   ) DESC
                   LIMIT %s""",
                (user_id, query_text, query_text, limit),
            )
            return [dict(r) for r in cur.fetchall()]

    with conn.cursor() as cur:
        cur.execute(
            """SELECT s.id, s.text, s.start_sec,
                      m.id AS meeting_id, m.title AS meeting_title
               FROM segments s
               JOIN meetings m ON m.id = s.meeting_id
               WHERE m.user_id = %s
                 AND to_tsvector('english', s.text) @@ plainto_tsquery('english', %s)
               ORDER BY ts_rank(to_tsvector('english', s.text),
                                plainto_tsquery('english', %s)) DESC
               LIMIT %s""",
            (user_id, query_text, query_text, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def cross_meeting_search(user_id: str, query: str) -> List[dict]:
    """
    Hybrid search (vector × 2, keyword × 2, RRF) across all meetings for a user.
    Searches enriched chunks when available; falls back to raw segments.
    Returns up to FINAL_K results with meeting context.
    """
    client = _get_client()

    rewritten = _rewrite_query(client, query)
    orig_vec = _embed(client, query)
    rewr_vec = _embed(client, rewritten)

    with get_db() as conn:
        register_vector(conn)
        use_chunks = _user_has_chunks(conn, user_id)
        v1 = _cross_vector_search(conn, user_id, orig_vec, RETRIEVAL_K, use_chunks)
        v2 = _cross_vector_search(conn, user_id, rewr_vec, RETRIEVAL_K, use_chunks)
        k1 = _cross_keyword_search(conn, user_id, query, RETRIEVAL_K, use_chunks)
        k2 = _cross_keyword_search(conn, user_id, rewritten, RETRIEVAL_K, use_chunks)

    return _rrf_merge([v1, v2, k1, k2])[:FINAL_K]
