import json
import os

from celery_app import celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


@celery.task(name="tasks.transcribe_meeting", bind=True)
def transcribe_meeting_task(self, meeting_id: str, object_key: str) -> None:
    """
    Full upload pipeline: Whisper → segments → extraction →
    slide detection → embeddings → contradiction detection.
    """
    from transcription import transcribe_meeting
    transcribe_meeting(meeting_id, object_key)


@celery.task(name="tasks.transcribe_live_chunk", bind=True)
def transcribe_live_chunk_task(self, audio_b64: str, meeting_id: str) -> None:
    """
    Transcribes one 5-second audio chunk from a live session.

    Accepts base64-encoded audio (Celery's JSON serializer can't handle raw bytes).
    Reads the cumulative time offset from Redis (atomic INCRBYFLOAT),
    calls Whisper, inserts segments, then publishes each segment to the
    Redis Pub/Sub channel `live:{meeting_id}` so that any FastAPI worker
    holding the WebSocket can forward it to the browser.
    """
    import base64
    import redis as _redis
    from live_transcription import _transcribe_chunk

    audio_bytes = base64.b64decode(audio_b64)
    r = _redis.from_url(REDIS_URL)
    offset_key = f"live:{meeting_id}:offset"
    channel    = f"live:{meeting_id}"

    offset = float(r.get(offset_key) or 0)

    segments, chunk_duration = _transcribe_chunk(audio_bytes, meeting_id, offset)

    # Advance the offset for the next chunk
    r.incrbyfloat(offset_key, chunk_duration)
    r.expire(offset_key, 7200)  # auto-clean after 2h of inactivity

    # Publish each segment to the channel the WebSocket handler is subscribed to
    for seg in segments:
        r.publish(channel, json.dumps({"type": "segment", **seg}))

    # Signal that this chunk is fully processed
    r.publish(channel, json.dumps({"type": "chunk_done", "chunk_duration": chunk_duration}))


@celery.task(name="tasks.finalize_live_meeting", bind=True)
def finalize_live_meeting_task(self, meeting_id: str) -> None:
    """
    Post-recording pipeline for live sessions.
    Reads final duration from Redis, then runs extraction + embeddings.
    """
    import redis as _redis
    from live_transcription import _finalize

    r = _redis.from_url(REDIS_URL)
    duration = float(r.get(f"live:{meeting_id}:offset") or 0)

    # Clean up Redis keys for this session
    r.delete(f"live:{meeting_id}:offset")

    _finalize(meeting_id, duration)

    # Signal any WebSocket handler subscribed to this channel that finalization
    # is complete so it can close the connection.
    r.publish(f"live:{meeting_id}", json.dumps({"type": "finalized"}))
