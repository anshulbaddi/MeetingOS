from openai import OpenAI
from pgvector.psycopg2 import register_vector

from db import get_db

EMBEDDING_MODEL = "text-embedding-3-small"
BATCH_SIZE = 100  # OpenAI allows up to 2048 inputs per request

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def embed_segments(meeting_id: str) -> None:
    """
    Fetches all un-embedded segments for a meeting, calls the OpenAI
    embeddings API in batches, then writes each vector back to the DB.
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

    client = get_client()
    vectors = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        vectors.extend([item.embedding for item in response.data])

    with get_db() as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for seg_id, vector in zip(ids, vectors):
                cur.execute(
                    "UPDATE segments SET embedding = %s WHERE id = %s",
                    (vector, seg_id),
                )
