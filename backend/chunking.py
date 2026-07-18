"""
Builds enriched, overlapping chunks from Whisper segments.

Why this exists
---------------
Whisper produces short, sentence-level segments (~5-20 words). Those are good for
pinpointing timestamps in the timeline, but bad for retrieval: a concept that spans
a sentence boundary belongs to whichever chunk Whisper happened to split it into.

This module:
  1. Merges consecutive segments into ~TARGET_WORDS-word chunks
  2. Overlaps consecutive chunks by ~OVERLAP_WORDS so boundary concepts appear twice
  3. Asks GPT-4o-mini to generate a headline + 2-sentence summary per chunk
  4. Embeds  headline + summary + body  (richer signal than raw transcript text)
  5. Stores the result in the `chunks` table

The segments table is left untouched — it's still used for the timeline display.
The chunks table is what chat.py searches.
"""

import json
from typing import List, Dict

from pgvector.psycopg2 import register_vector

from db import get_db
from llm import chat_complete, embed_texts

TARGET_WORDS  = 75   # aim for chunks of this size
OVERLAP_WORDS = 20   # leading overlap from the previous chunk (~27%)



# ── Merging ────────────────────────────────────────────────────────────────────

def _merge_into_chunks(segments: List[Dict]) -> List[Dict]:
    """
    Greedy sliding-window merge.

    Each chunk accumulates segments until it hits TARGET_WORDS words, then the
    next chunk rewinds by OVERLAP_WORDS so the boundary area is covered twice.
    """
    if not segments:
        return []

    result = []
    start = 0

    while start < len(segments):
        end = start
        words = 0

        # Grow the window until we hit the target
        while end < len(segments):
            words += len(segments[end]["text"].split())
            end += 1
            if words >= TARGET_WORDS:
                break

        chunk_segs = segments[start:end]
        result.append({
            "body":               " ".join(s["text"].strip() for s in chunk_segs),
            "start_sec":          chunk_segs[0]["start_sec"],
            "end_sec":            chunk_segs[-1]["end_sec"],
            "source_segment_ids": [str(s["id"]) for s in chunk_segs],
        })

        if end >= len(segments):
            break

        # Rewind to create overlap: walk backwards from end until OVERLAP_WORDS seen
        overlap = 0
        next_start = end
        for k in range(end - 1, start, -1):
            overlap += len(segments[k]["text"].split())
            if overlap >= OVERLAP_WORDS:
                next_start = k
                break

        # Always advance at least one segment to avoid an infinite loop
        start = max(next_start, start + 1)

    return result


# ── Enrichment ─────────────────────────────────────────────────────────────────

def _enrich(chunks: List[Dict], meeting_title: str) -> List[Dict]:
    """
    Add a headline and 2-sentence summary to each chunk via the LLM.
    The enriched text is what gets embedded, making retrieval work for
    conversational queries that don't match the transcript's exact wording.
    """
    enriched = []
    for chunk in chunks:
        resp = chat_complete(
            [
                {
                    "role": "system",
                    "content": (
                        "You generate search metadata for meeting transcript chunks.\n"
                        "Given a chunk of transcript text, produce:\n"
                        "  headline: 3-8 words capturing the main topic\n"
                        "  summary: 1-2 sentences summarising what was said, "
                        "including any decisions or action items\n"
                        'Respond ONLY with valid JSON: {"headline": "...", "summary": "..."}'
                    ),
                },
                {
                    "role": "user",
                    "content": f"Meeting: {meeting_title}\n\nTranscript:\n{chunk['body']}",
                },
            ],
            response_format={"type": "json_object"},
        )
        try:
            meta = json.loads(resp.choices[0].message.content)
            headline = meta.get("headline", "").strip()
            summary  = meta.get("summary",  "").strip()
        except (json.JSONDecodeError, KeyError):
            headline = ""
            summary  = ""

        enriched.append({**chunk, "headline": headline, "summary": summary})

    return enriched


# ── Embedding ──────────────────────────────────────────────────────────────────

def _embed(chunks: List[Dict]) -> List[List[float]]:
    texts = [
        f"{c['headline']}\n\n{c['summary']}\n\n{c['body']}"
        for c in chunks
    ]
    return embed_texts(texts)


# ── Public entry point ─────────────────────────────────────────────────────────

def build_chunks(meeting_id: str) -> int:
    """
    Full chunking pipeline for one meeting. Idempotent — deletes existing
    chunks for this meeting before re-inserting.

    Returns the number of chunks created.
    """
    # Fetch segments and meeting title
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, text, start_sec, end_sec FROM segments "
                "WHERE meeting_id = %s ORDER BY start_sec",
                (meeting_id,),
            )
            segments = [dict(r) for r in cur.fetchall()]

            cur.execute("SELECT title FROM meetings WHERE id = %s", (meeting_id,))
            row = cur.fetchone()
            meeting_title = row["title"] if row else ""

    if not segments:
        return 0

    # Delete old chunks (idempotent re-run)
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM chunks WHERE meeting_id = %s", (meeting_id,))

    # Pipeline: merge → enrich → embed → store
    raw      = _merge_into_chunks(segments)
    enriched = _enrich(raw, meeting_title)
    vectors  = _embed(enriched)

    with get_db() as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for chunk, vec in zip(enriched, vectors):
                embed_text = f"{chunk['headline']}\n\n{chunk['summary']}\n\n{chunk['body']}"
                cur.execute(
                    """INSERT INTO chunks
                       (meeting_id, headline, summary, body, embed_text,
                        start_sec, end_sec, source_segment_ids, embedding)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        meeting_id,
                        chunk["headline"],
                        chunk["summary"],
                        chunk["body"],
                        embed_text,
                        chunk["start_sec"],
                        chunk["end_sec"],
                        json.dumps(chunk["source_segment_ids"]),
                        vec,
                    ),
                )

    return len(enriched)
