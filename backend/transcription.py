from openai import OpenAI
from db import get_db
from extraction import extract_meeting_meta
from slide_detection import run_slide_detection
from embeddings import embed_segments
from chunking import build_chunks
from storage import download_fileobj, download_tempfile

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def transcribe_meeting(meeting_id: str, object_key: str) -> None:
    """
    Background task: downloads the file from object storage, sends audio to
    OpenAI Whisper API, writes segments to DB, then runs extraction,
    slide detection, and embedding.
    """
    try:
        client = get_client()

        # Whisper API accepts a file-like object with a .name attribute
        fileobj = download_fileobj(object_key)
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=fileobj,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

        segments = transcript.segments or []

        with get_db() as conn:
            with conn.cursor() as cur:
                for seg in segments:
                    cur.execute(
                        """INSERT INTO segments (meeting_id, text, start_sec, end_sec)
                           VALUES (%s, %s, %s, %s)""",
                        (meeting_id, seg.text.strip(), seg.start, seg.end),
                    )

                duration = int(segments[-1].end) if segments else 0
                cur.execute(
                    """UPDATE meetings
                       SET status = 'complete', duration_seconds = %s
                       WHERE id = %s""",
                    (duration, meeting_id),
                )

        extract_meeting_meta(meeting_id)

        # Slide detection needs a real filesystem path, so use a temp file
        with download_tempfile(object_key) as tmp_path:
            run_slide_detection(meeting_id, tmp_path)

        embed_segments(meeting_id)
        build_chunks(meeting_id)

    except Exception:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE meetings SET status = 'failed' WHERE id = %s",
                    (meeting_id,),
                )
        raise
