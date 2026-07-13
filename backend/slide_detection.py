import json
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from db import get_db

VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}

# Histogram correlation below this threshold = slide changed.
# 1.0 = identical frames, 0.0 = completely different.
CHANGE_THRESHOLD = 0.92

# Minimum seconds between detected transitions (debounce).
MIN_TRANSITION_GAP = 1.5


def _frame_histogram(frame: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
    cv2.normalize(hist, hist)
    return hist


def detect_slide_transitions(file_path: str) -> list[dict]:
    """
    Opens a video file, samples one frame per second, and returns a list of
    dicts {start_sec: float} for each detected slide transition.
    """
    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    sample_interval = int(fps)  # one frame per second

    transitions: list[dict] = []
    prev_hist: Optional[np.ndarray] = None
    last_transition_sec = -MIN_TRANSITION_GAP
    frame_index = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_index % sample_interval == 0:
            timestamp = frame_index / fps
            hist = _frame_histogram(frame)

            if prev_hist is not None:
                correlation = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)
                if (
                    correlation < CHANGE_THRESHOLD
                    and (timestamp - last_transition_sec) >= MIN_TRANSITION_GAP
                ):
                    transitions.append({"start_sec": round(timestamp, 2)})
                    last_transition_sec = timestamp

            prev_hist = hist

        frame_index += 1

    cap.release()
    return transitions


def run_slide_detection(meeting_id: str, file_path: str) -> None:
    """
    Runs slide detection if the file is a video format, then writes the
    transitions list into meeting_meta.slide_transitions.
    Does nothing silently if the file is audio-only.
    """
    ext = Path(file_path).suffix.lower()
    if ext not in VIDEO_EXTENSIONS:
        return

    transitions = detect_slide_transitions(file_path)

    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE meeting_meta
                   SET slide_transitions = %s
                   WHERE meeting_id = %s""",
                (json.dumps(transitions), meeting_id),
            )
