"""
Speaker diarization using pyannote.audio.

Runs after Whisper transcription and assigns speaker labels to segments
by finding the maximum-overlap speaker for each segment's time range.

Requires:
  - HF_TOKEN env var with access to pyannote/speaker-diarization-3.1
  - Accept model terms at huggingface.co/pyannote/speaker-diarization-3.1
"""

import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        from pyannote.audio import Pipeline
        import torch

        hf_token = os.environ.get("HF_TOKEN")
        if not hf_token:
            raise ValueError("HF_TOKEN is required for speaker diarization")

        device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        _pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
        _pipeline.to(device)
        log.info("[Diarization] Pipeline loaded on %s", device)

    return _pipeline


def diarize(audio_path: str) -> list[dict]:
    """Return [{start, end, speaker}] from pyannote diarization."""
    pipeline = _get_pipeline()
    result = pipeline(audio_path)
    return [
        {"start": turn.start, "end": turn.end, "speaker": label}
        for turn, _, label in result.itertracks(yield_label=True)
    ]


def assign_speakers(
    whisper_segments: list[dict],
    diarization: list[dict],
) -> list[dict]:
    """
    For each Whisper segment, find the diarization speaker with the most
    overlapping time. Returns the segment list with a 'speaker' key added.
    """
    # Build readable speaker labels: SPEAKER_00 → Speaker 1
    speaker_ids: dict[str, int] = {}

    def _label(raw: str) -> str:
        if raw not in speaker_ids:
            speaker_ids[raw] = len(speaker_ids) + 1
        return f"Speaker {speaker_ids[raw]}"

    result = []
    for seg in whisper_segments:
        best_speaker: Optional[str] = None
        best_overlap = 0.0

        for d in diarization:
            overlap = max(
                0.0,
                min(seg["end"], d["end"]) - max(seg["start"], d["start"]),
            )
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = _label(d["speaker"])

        result.append({**seg, "speaker": best_speaker})

    return result
