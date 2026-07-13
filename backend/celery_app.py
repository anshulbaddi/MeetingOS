import sys
import os
from pathlib import Path

# Ensure the backend directory is on the path regardless of where the worker is started from
sys.path.insert(0, str(Path(__file__).parent))

# Load .env from the backend directory explicitly
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

celery = Celery(
    "meetingos",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    # One task at a time per worker process — prevents CPU/memory spikes
    # from concurrent Whisper calls. Increase as you add more workers.
    worker_prefetch_multiplier=1,
    task_acks_late=True,  # Only ack after task completes — safe to retry on worker crash
)
