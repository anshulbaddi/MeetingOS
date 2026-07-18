from pgvector.psycopg2 import register_vector

from db import get_db
from llm import embed_texts

BATCH_SIZE = 100


def embed_segments(meeting_id: str) -> None:
    """
    Fetches all un-embedded segments for a meeting, embeds them (with Redis
    caching), then writes each vector back to the DB.
    """
    with get_db() as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, text FROM segments
                   WHERE meeting_id = %s AND embedding IS NULL
                   ORDER BY start_sec""",
                (meeting_id,),
            )
            rows = cur.fetchall()

    if not rows:
        return

    ids = [r["id"] for r in rows]
    texts = [r["text"] for r in rows]
    vectors = embed_texts(texts)

    with get_db() as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for seg_id, vector in zip(ids, vectors):
                cur.execute(
                    "UPDATE segments SET embedding = %s WHERE id = %s",
                    (vector, seg_id),
                )
