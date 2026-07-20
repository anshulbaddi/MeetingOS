import json
import os
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import pytesseract

from db import get_db

# Allow overriding the tesseract binary path via env var.
# On macOS with Homebrew, set TESSERACT_CMD=/opt/homebrew/bin/tesseract in .env.
# In Docker (Linux), the apt-installed binary is on PATH — no override needed.
_tess_cmd = os.environ.get("TESSERACT_CMD")
if _tess_cmd:
    pytesseract.pytesseract.tesseract_cmd = _tess_cmd

VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}

# Jaccard word-set similarity below this threshold = slide changed.
# 0.0 = nothing in common, 1.0 = identical word sets.
CHANGE_THRESHOLD = 0.35

# Minimum seconds between detected transitions (debounce).
MIN_TRANSITION_GAP = 1.5

# Tesseract page-segmentation mode 6: "assume a single uniform block of text"
# Works well for slides which are dominated by a few text blocks.
_TESS_CONFIG = "--psm 6"


def _extract_text(frame: np.ndarray) -> str:
    """
    OCR a single BGR frame and return cleaned lowercase text.

    Steps:
    1. Upscale to at least 1280 px wide — Tesseract accuracy degrades on
       small images; presentation recordings are often 720p or lower.
    2. Convert to greyscale.
    3. Otsu threshold → binary image. Removes colour noise and makes text
       crisp, which is exactly what Tesseract expects.
    """
    h, w = frame.shape[:2]
    if w < 1280:
        scale = 1280 / w
        frame = cv2.resize(
            frame,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_LANCZOS4,
        )

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    return pytesseract.image_to_string(binary, config=_TESS_CONFIG).strip().lower()


def _jaccard(a: str, b: str) -> float:
    """
    Word-set Jaccard similarity: |A ∩ B| / |A ∪ B|.
    Returns 1.0 when both strings are empty (same blank slide).
    """
    set_a = set(a.split())
    set_b = set(b.split())
    if not set_a and not set_b:
        return 1.0
    union = set_a | set_b
    return len(set_a & set_b) / len(union)


def detect_slide_transitions(file_path: str) -> list[dict]:
    """
    Samples one frame per second, OCRs each frame, and returns a list of
    {start_sec: float} dicts for each detected slide transition.

    A transition is recorded when the Jaccard similarity of consecutive
    frames' word sets drops below CHANGE_THRESHOLD, subject to a minimum
    gap of MIN_TRANSITION_GAP seconds between transitions.
    """
    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    sample_interval = int(fps)

    transitions: list[dict] = []
    prev_text: Optional[str] = None
    last_transition_sec = -MIN_TRANSITION_GAP
    frame_index = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_index % sample_interval == 0:
            timestamp = frame_index / fps
            text = _extract_text(frame)

            if prev_text is not None:
                similarity = _jaccard(prev_text, text)
                if (
                    similarity < CHANGE_THRESHOLD
                    and (timestamp - last_transition_sec) >= MIN_TRANSITION_GAP
                ):
                    transitions.append({"start_sec": round(timestamp, 2)})
                    last_transition_sec = timestamp

            prev_text = text

        frame_index += 1

    cap.release()
    return transitions


def run_slide_detection(meeting_id: str, file_path: str) -> None:
    """
    Entry point called by the transcription pipeline. Runs slide detection
    on video files and writes results to meeting_meta.slide_transitions.
    Audio-only files are skipped silently.
    """
    if Path(file_path).suffix.lower() not in VIDEO_EXTENSIONS:
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
