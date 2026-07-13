"""
End-to-end test for the live transcription pipeline.

Flow:
  1. POST /meetings/live  — create meeting with status='live'
  2. Open WebSocket       — authenticate via ?token= JWT
  3. Send audio chunk     — dispatched to Celery → Whisper → Redis Pub/Sub
  4. Send "done"          — triggers finalize task
  5. Collect messages     — segments forwarded via Pub/Sub → WebSocket → this test
  6. Assert "finalized"   — finalize task published it after extraction+embeddings
  7. GET /meetings/:id    — confirm status='complete'
"""

import asyncio
import json
import os
import time
from pathlib import Path

import httpx
import jwt as pyjwt
import websockets

API = "http://localhost:8000"
WS  = "ws://localhost:8000"

SECRET  = os.environ.get("NEXTAUTH_SECRET", "CShpSHmN5kEjI/lC7Bzdd7Dta/bavHUtwdFfj/B2oJQt")
CHUNK   = Path("/tmp/test_speech.webm").read_bytes()
TIMEOUT = 180  # seconds — Whisper + extraction + embeddings can take a while


def make_jwt(user_id: str = "test-user") -> str:
    return pyjwt.encode(
        {"sub": user_id, "exp": int(time.time()) + 300},
        SECRET,
        algorithm="HS256",
    )


async def run():
    token = make_jwt()
    headers = {"Authorization": f"Bearer {token}"}

    # ── 1. Create live meeting ────────────────────────────────────────────────
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{API}/meetings/live", headers=headers)
        assert r.status_code == 200, f"POST /meetings/live failed: {r.status_code} {r.text}"
        meeting = r.json()

    meeting_id = meeting["id"]
    print(f"[1] Created live meeting: {meeting_id}  status={meeting['status']}")
    assert meeting["status"] == "live"

    # ── 2–5. Open WebSocket, send chunk, collect messages ────────────────────
    ws_url = f"{WS}/ws/meetings/{meeting_id}/live?token={token}"
    messages: list[dict] = []
    t_start = time.time()

    print(f"[2] Connecting to {ws_url}")
    async with websockets.connect(ws_url) as ws:
        print(f"[3] Sending {len(CHUNK):,} byte audio chunk")
        await ws.send(CHUNK)

        print("[4] Sending 'done'")
        await ws.send("done")

        print(f"[5] Waiting for segments + finalized (timeout={TIMEOUT}s)...")
        deadline = asyncio.get_event_loop().time() + TIMEOUT
        ws_closed = False
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(raw)
                messages.append(data)
                mtype = data.get("type")
                if mtype == "segment":
                    print(f"    segment: [{data['start_sec']:.1f}–{data['end_sec']:.1f}s] {data['text']!r}")
                elif mtype == "finalized":
                    print("    finalized signal received")
                    break
                elif mtype == "error":
                    print(f"    ERROR from server: {data.get('message')}")
            except asyncio.TimeoutError:
                elapsed = time.time() - t_start
                print(f"    ... still waiting ({elapsed:.0f}s elapsed)")
            except websockets.exceptions.ConnectionClosed:
                print("    WebSocket closed by server (finalize task still running in background)")
                ws_closed = True
                break

    elapsed = time.time() - t_start
    print(f"\n[6] Pipeline took {elapsed:.1f}s")

    # ── 6. Assert messages ────────────────────────────────────────────────────
    types = [m["type"] for m in messages]
    print(f"    Message types received: {types}")

    finalized = any(m["type"] == "finalized" for m in messages)
    segments  = [m for m in messages if m["type"] == "segment"]

    if not finalized:
        print("FAIL: never received 'finalized' signal")
    else:
        print(f"PASS: received 'finalized' (with {len(segments)} segment(s))")

    # ── 7. Verify DB status (with retry — finalize task may still be running) ──
    print("[7] Polling DB for status='complete' (up to 120s)...")
    deadline = time.time() + 120
    final_meeting = None
    async with httpx.AsyncClient() as client:
        while time.time() < deadline:
            r = await client.get(f"{API}/meetings/{meeting_id}", headers=headers)
            assert r.status_code == 200
            final_meeting = r.json()
            status = final_meeting["status"]
            if status in ("complete", "failed"):
                break
            await asyncio.sleep(3)
            print(f"    ... status={status}, still waiting")

    print(f"    Final DB status: {final_meeting['status']}")
    assert final_meeting["status"] == "complete", (
        f"Expected status='complete', got '{final_meeting['status']}'"
    )

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "─" * 50)
    print(f"  Segments received : {len(segments)}")
    print(f"  Finalized signal  : {'YES' if finalized else 'NO'}")
    print(f"  Final DB status   : {final_meeting['status']}")
    print(f"  Decisions         : {len(final_meeting.get('decisions', []))}")
    print(f"  Conflicts         : {len(final_meeting.get('conflicts', []))}")
    print(f"  Time              : {elapsed:.1f}s")
    print("─" * 50)
    if finalized and final_meeting["status"] == "complete":
        print("ALL CHECKS PASSED")
    else:
        print("SOME CHECKS FAILED")
        raise SystemExit(1)


asyncio.run(run())
