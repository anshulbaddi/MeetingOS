import json
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

from db import get_db

VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}

# Cosine similarity below this threshold = slide changed.
# ResNet features: 1.0 = identical frames, lower = more different.
CHANGE_THRESHOLD = 0.90

# Minimum seconds between detected transitions (debounce).
MIN_TRANSITION_GAP = 1.5

# ImageNet normalisation — required for pretrained ResNet weights.
_TRANSFORM = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

_model: Optional[nn.Module] = None
_device: Optional[torch.device] = None


def _get_model() -> tuple[nn.Module, torch.device]:
    """Lazy-load ResNet-50 once per process, stripped of its classifier head."""
    global _model, _device
    if _model is None:
        if torch.backends.mps.is_available():
            device = torch.device("mps")       # Apple Silicon GPU
        elif torch.cuda.is_available():
            device = torch.device("cuda")
        else:
            device = torch.device("cpu")

        # Load pretrained ResNet-50 and drop the final FC layer so we get
        # 2048-dim feature vectors instead of 1000-class logits.
        base = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V2)
        model = nn.Sequential(*list(base.children())[:-1])
        model = model.to(device)
        model.eval()

        _model = model
        _device = device

    return _model, _device


def _extract_features(frame: np.ndarray) -> np.ndarray:
    """Run a single BGR frame through ResNet-50 → return (2048,) feature vector."""
    model, device = _get_model()

    # OpenCV uses BGR; PIL and torchvision expect RGB.
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    tensor = _TRANSFORM(Image.fromarray(rgb)).unsqueeze(0).to(device)

    with torch.no_grad():
        features = model(tensor)           # (1, 2048, 1, 1)

    return features.squeeze().cpu().numpy()   # (2048,)


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


def detect_slide_transitions(file_path: str) -> list[dict]:
    """
    Samples one frame per second, extracts ResNet-50 features, and returns
    a list of {start_sec: float} dicts for each detected slide transition.
    """
    cap = cv2.VideoCapture(file_path)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    sample_interval = int(fps)

    transitions: list[dict] = []
    prev_features: Optional[np.ndarray] = None
    last_transition_sec = -MIN_TRANSITION_GAP
    frame_index = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_index % sample_interval == 0:
            timestamp = frame_index / fps
            features = _extract_features(frame)

            if prev_features is not None:
                similarity = _cosine_similarity(prev_features, features)
                if (
                    similarity < CHANGE_THRESHOLD
                    and (timestamp - last_transition_sec) >= MIN_TRANSITION_GAP
                ):
                    transitions.append({"start_sec": round(timestamp, 2)})
                    last_transition_sec = timestamp

            prev_features = features

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
