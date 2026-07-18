import json
import uuid
from typing import Optional

from pydantic import BaseModel

from db import get_db
from contradiction import detect_contradictions
from llm import chat_complete


class DecisionItem(BaseModel):
    text: str
    context: str
    start_sec: Optional[float] = None


class ExtractionResult(BaseModel):
    summary: str
    action_items: list[str]
    participants: list[str]
    decisions: list[DecisionItem]


def extract_meeting_meta(meeting_id: str) -> None:
    """
    Reads segments for a completed meeting, calls the LLM to extract
    summary / action items / participants / decisions, then writes results
    to meeting_meta and decisions tables.
    """
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT text, start_sec FROM segments WHERE meeting_id = %s ORDER BY start_sec",
                (meeting_id,),
            )
            segments = cur.fetchall()
            cur.execute("SELECT user_id FROM meetings WHERE id = %s", (meeting_id,))
            row = cur.fetchone()

    if not segments or not row:
        return

    user_id = row["user_id"]

    transcript = "\n".join(
        f"[{int(s['start_sec']) // 60}:{int(s['start_sec']) % 60:02d}] {s['text']}"
        for s in segments
    )

    response = chat_complete(
        [
            {
                "role": "system",
                "content": (
                    "You extract structured information from meeting transcripts. "
                    "Be concise. For decisions, set start_sec to the number of seconds "
                    "shown in the timestamp closest to where the decision was made "
                    "(e.g. [1:30] → 90.0). If no clear decisions were made, return an empty list. "
                    "Return ONLY a JSON object with this exact schema:\n"
                    '{"summary": string, "action_items": [string], '
                    '"participants": [string], '
                    '"decisions": [{"text": string, "context": string, "start_sec": number|null}]}'
                ),
            },
            {"role": "user", "content": f"Transcript:\n\n{transcript}"},
        ],
        response_format={"type": "json_object"},
    )

    data = json.loads(response.choices[0].message.content)
    # Normalize decisions to ensure they have the required fields
    for d in data.get("decisions", []):
        d.setdefault("context", "")
        d.setdefault("start_sec", None)
    meta = ExtractionResult(**data)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO meeting_meta (id, meeting_id, summary, action_items, participants)
                   VALUES (%s, %s, %s, %s, %s)""",
                (
                    str(uuid.uuid4()),
                    meeting_id,
                    meta.summary,
                    json.dumps(meta.action_items),
                    json.dumps(meta.participants),
                ),
            )

            for decision in meta.decisions:
                cur.execute(
                    """INSERT INTO decisions (id, meeting_id, user_id, text, context, start_sec)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (
                        str(uuid.uuid4()),
                        meeting_id,
                        user_id,
                        decision.text,
                        decision.context,
                        decision.start_sec,
                    ),
                )

    detect_contradictions(meeting_id, user_id)
