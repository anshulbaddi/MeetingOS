import asyncio
import os
import tempfile
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from openai import OpenAI

from db import get_db
from extraction import extract_meeting_meta
from embeddings import embed_segments
from chunking import build_chunks

_client = None


def _get_openai() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def _transcribe_chunk(
    audio_bytes: bytes,
    meeting_id: str,
    time_offset: float,
) -> tuple[list[dict], float]:
    """
    Writes one audio chunk to disk, sends it to Whisper, inserts the resulting
    segments into the DB with the cumulative time offset applied, and returns
    (segment_list, chunk_duration_seconds).
    """
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    try:
        client = _get_openai()
        with open(tmp_path, "rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        raw = transcript.segments or []
        chunk_duration = raw[-1].end if raw else 0.0
        result = []

        if raw:
            with get_db() as conn:
                with conn.cursor() as cur:
                    for seg in raw:
                        abs_start = time_offset + seg.start
                        abs_end = time_offset + seg.end
                        cur.execute(
                            """INSERT INTO segments (meeting_id, text, start_sec, end_sec)
                               VALUES (%s, %s, %s, %s)""",
                            (meeting_id, seg.text.strip(), abs_start, abs_end),
                        )
                        result.append({
                            "text": seg.text.strip(),
                            "start_sec": abs_start,
                            "end_sec": abs_end,
                        })

        return result, chunk_duration

    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass


def _finalize(meeting_id: str, duration_seconds: float) -> None:
    """Run extraction + embeddings and mark the meeting complete."""
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE meetings SET status = 'processing', duration_seconds = %s
                       WHERE id = %s""",
                    (int(duration_seconds), meeting_id),
                )

        extract_meeting_meta(meeting_id)
        embed_segments(meeting_id)
        build_chunks(meeting_id)

        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE meetings SET status = 'complete' WHERE id = %s",
                    (meeting_id,),
                )
    except Exception:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE meetings SET status = 'failed' WHERE id = %s",
                    (meeting_id,),
                )
        raise


async def handle_live_session(websocket: WebSocket, meeting_id: str) -> None:
    """
    Multi-worker-safe live transcription via Celery + Redis Pub/Sub.

    Protocol:
      Client → Server  binary   one 5-second audio chunk (webm/opus)
      Client → Server  text     "done" — end the session
      Server → Client  JSON     {"type": "segment", "text", "start_sec", "end_sec"}
      Server → Client  JSON     {"type": "error", "message": ...}

    Each chunk is dispatched to a Celery worker (which runs Whisper and publishes
    results to Redis Pub/Sub). This WebSocket handler subscribes to the same channel
    and forwards segments to the browser — decoupled from which worker did the work.
    """
    import json
    import base64
    import redis.asyncio as aioredis

    REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    channel = f"live:{meeting_id}"

    r = aioredis.from_url(REDIS_URL)
    pubsub = r.pubsub()
    await pubsub.subscribe(channel)

    async def ws_reader() -> None:
        """Read audio chunks from the browser and dispatch each to Celery."""
        try:
            from tasks import transcribe_live_chunk_task, finalize_live_meeting_task
            while True:
                message = await websocket.receive()

                if message["type"] == "websocket.disconnect":
                    break
                if message.get("text") == "done":
                    break

                audio_bytes = message.get("bytes")
                if not audio_bytes:
                    continue

                # JSON serializer can't handle raw bytes — encode to base64 first
                transcribe_live_chunk_task.delay(
                    base64.b64encode(audio_bytes).decode(), meeting_id
                )
        except WebSocketDisconnect:
            pass
        finally:
            # 5-second countdown gives the last in-flight chunk task time to finish
            # inserting segments before extraction runs (Whisper on 5s audio takes ~3s)
            from tasks import finalize_live_meeting_task
            finalize_live_meeting_task.apply_async((meeting_id,), countdown=5)

    async def pubsub_forwarder() -> None:
        """Forward segments from Redis Pub/Sub to the browser WebSocket."""
        import sys
        try:
            async for message in pubsub.listen():
                if message["type"] != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                except (json.JSONDecodeError, TypeError):
                    continue

                msg_type = data.get("type")
                if msg_type == "segment":
                    try:
                        await websocket.send_json(data)
                    except Exception:
                        return
                elif msg_type == "error":
                    try:
                        await websocket.send_json(data)
                    except Exception:
                        return
                elif msg_type == "finalized":
                    # finalize_live_meeting_task published this after extraction+embeddings
                    try:
                        await websocket.send_json({"type": "finalized"})
                    except Exception:
                        pass
                    return
        except Exception as exc:
            print(f"[live] pubsub_forwarder error: {type(exc).__name__}: {exc}", file=sys.stderr)

    ws_task = asyncio.create_task(ws_reader())
    pubsub_task = asyncio.create_task(pubsub_forwarder())

    try:
        # asyncio.wait (unlike gather) does not propagate exceptions from individual
        # tasks — if ws_reader fails, pubsub_forwarder keeps running until "finalized"
        done, pending = await asyncio.wait(
            {ws_task, pubsub_task},
            timeout=600,
        )
        # Cancel anything still running (only fires on timeout)
        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        # Surface any unexpected task exceptions to server stderr for debugging
        import sys
        for task in done:
            if not task.cancelled() and task.exception():
                print(f"[live] task error: {task.exception()}", file=sys.stderr)
    finally:
        ws_task.cancel()
        pubsub_task.cancel()
        try:
            await pubsub.unsubscribe(channel)
        except Exception:
            pass
        await r.aclose()
