from __future__ import annotations

import hashlib
from pathlib import Path

from ..domain.audio import associate_audio
from .audio import FRAME_DURATION_MS, audio_cues


def _sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def observe_audio(source: Path, *, duration_ms: int, check_cancelled=None, scan=None) -> dict:
    """Source-bound DSP observations; no speech decoding or semantic fact inference."""
    source = Path(source).resolve()
    if check_cancelled is not None:
        check_cancelled()
    source_sha = _sha256(source)
    measured = (scan or audio_cues)(source, duration_ms=duration_ms, check_cancelled=check_cancelled)
    if check_cancelled is not None:
        check_cancelled()
    if _sha256(source) != source_sha:
        raise ValueError("AUDIO_SOURCE_CHANGED")
    cues = []
    for index, cue in enumerate(measured.cues):
        if not 0 <= cue.start_ms < cue.end_ms <= duration_ms:
            raise ValueError("AUDIO_CUE_INTERVAL_INVALID")
        identity = f"{source_sha}:{index}:{cue.start_ms}:{cue.end_ms}"
        cues.append({"id": "audio-" + hashlib.sha256(identity.encode()).hexdigest(),
                     "startMs": cue.start_ms, "endMs": cue.end_ms,
                     "peakFrequenciesHz": list(cue.peak_frequencies_hz), "frameCount": cue.frame_count})
    reasons = ["AUDIO_CUE_METHOD_NOT_VERIFIED", "SPEECH_NOT_ANALYZED", "AUDIO_GAPS_PADDED_NOT_OBSERVED"]
    if measured.reason:
        reasons.append(measured.reason)
    observations = {
        "version": "audio-observations-v1", "sourceSha256": source_sha,
        "status": measured.status.value, "method": "spectral-multitone-v1", "speechStatus": "NOT_ANALYZED",
        "sourceSampleRateHz": measured.source_audio_sample_rate_hz, "sourceChannels": measured.source_audio_channels,
        "timeline": {"videoOriginSeconds": measured.video_origin_seconds, "audioOffsetMs": measured.audio_offset_ms,
                     "scannedStartMs": measured.scanned_start_ms, "scannedEndMs": measured.scanned_end_ms,
                     "decodedFrameCount": measured.decoded_frame_count, "frameDurationMs": FRAME_DURATION_MS,
                     "gapPolicy": "PRESERVED_WITH_SYNTHETIC_SILENCE"},
        "cueCount": len(cues), "cues": cues, "associations": [], "truncated": False, "reasons": reasons,
    }
    directory = Path(__file__).parent
    return {"observations": observations,
            "implementation": {"sourceFilesSha256": {name: _sha256(directory / name)
                                                      for name in ("audio.py", "audio_observations.py")}}}

