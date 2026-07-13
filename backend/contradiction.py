import uuid

from openai import OpenAI
from pgvector.psycopg2 import register_vector
from pydantic import BaseModel

from db import get_db

EMBEDDING_MODEL = "text-embedding-3-small"
# Decisions with cosine similarity above this are "on the same topic"
# and get sent to GPT-4o for a contradiction check.
SIMILARITY_THRESHOLD = 0.45

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


class ContradictionCheck(BaseModel):
    contradicts: bool
    explanation: str


def _check_contradiction(text_a: str, text_b: str) -> ContradictionCheck:
    client = get_client()
    result = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": (
                    "You compare two decisions made in different meetings and determine "
                    "whether they contradict each other. A contradiction means the two "
                    "decisions cannot both be true at the same time — one reverses, "
                    "overrides, or conflicts with the other. Similar topics alone are "
                    "not a contradiction."
                ),
            },
            {
                "role": "user",
                "content": f"Decision A: {text_a}\n\nDecision B: {text_b}",
            },
        ],
        response_format=ContradictionCheck,
    )
    return result.choices[0].message.parsed


def detect_contradictions(meeting_id: str, user_id: str) -> None:
    """
    For every decision in `meeting_id`:
      1. Embed it and write the embedding to decisions.
      2. Find past decisions (different meeting, same user) with cosine
         similarity above the threshold.
      3. Ask GPT-4o whether each similar pair actually contradicts.
      4. Write confirmed contradictions to the conflicts table.
    """
    client = get_client()

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, text FROM decisions WHERE meeting_id = %s",
                (meeting_id,),
            )
            new_decisions = [dict(r) for r in cur.fetchall()]

    if not new_decisions:
        return

    # Embed all new decisions in one batch
    texts = [d["text"] for d in new_decisions]
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    vectors = [item.embedding for item in response.data]

    # Write embeddings back
    with get_db() as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for decision, vector in zip(new_decisions, vectors):
                cur.execute(
                    "UPDATE decisions SET embedding = %s WHERE id = %s",
                    (vector, decision["id"]),
                )

    # For each new decision, find similar past decisions and check for contradictions
    with get_db() as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for decision, vector in zip(new_decisions, vectors):
                cur.execute(
                    """SELECT d.id, d.text,
                              1 - (d.embedding <=> %s::vector) AS similarity
                       FROM decisions d
                       WHERE d.user_id = %s
                         AND d.meeting_id != %s
                         AND d.embedding IS NOT NULL
                         AND 1 - (d.embedding <=> %s::vector) >= %s
                       ORDER BY similarity DESC
                       LIMIT 5""",
                    (vector, user_id, meeting_id, vector, SIMILARITY_THRESHOLD),
                )
                similar = [dict(r) for r in cur.fetchall()]

                for past in similar:
                    check = _check_contradiction(decision["text"], past["text"])
                    if check.contradicts:
                        cur.execute(
                            """INSERT INTO conflicts
                               (id, new_decision_id, past_decision_id, similarity_score, status)
                               VALUES (%s, %s, %s, %s, 'unreviewed')""",
                            (
                                str(uuid.uuid4()),
                                decision["id"],
                                past["id"],
                                past["similarity"],
                            ),
                        )
