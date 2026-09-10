from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from .infrastructure.audio import (
    FRAME_DURATION_MS,
    MAX_DECODED_SPAN_MS,
    MAX_NORMALIZED_SPECTRAL_ENTROPY,
    MIN_BAND_FREQUENCY_HZ,
    MIN_BAND_POWER_RATIO,
    MIN_CUE_FRAMES,
    MIN_PEAK_RELATIVE_POWER,
    MIN_PEAK_SEPARATION_HZ,
    MIN_RMS,
    MAX_BAND_FREQUENCY_HZ,
    AudioScan,
    audio_cues,
)


def audio_report(scan: AudioScan) -> dict[str, Any]:
    return {
        "status": scan.status.value,
        "reason": scan.reason,
        "cueCount": len(scan.cues),
        "cues": [
            {
                "startMs": cue.start_ms,
                "endMs": cue.end_ms,
                "peakFrequenciesHz": list(cue.peak_frequencies_hz),
                "frameCount": cue.frame_count,
                "kind": cue.kind,
                "method": cue.method,
            }
            for cue in scan.cues
        ],
        "sourceAudio": {
            "sampleRateHz": scan.source_audio_sample_rate_hz,
            "channels": scan.source_audio_channels,
        },
        "timeline": {
            "videoOriginSeconds": scan.video_origin_seconds,
            "audioOffsetMs": scan.audio_offset_ms,
            "scannedStartMs": scan.scanned_start_ms,
            "scannedEndMs": scan.scanned_end_ms,
            "decodedFrameCount": scan.decoded_frame_count,
        },
        "method": {
            "name": "spectral-multitone-v1",
            "frameDurationMs": FRAME_DURATION_MS,
            "bandHz": [MIN_BAND_FREQUENCY_HZ, MAX_BAND_FREQUENCY_HZ],
            "minimumRms": MIN_RMS,
            "minimumBandToNonDcPower": MIN_BAND_POWER_RATIO,
            "maximumNormalizedSpectralEntropy": MAX_NORMALIZED_SPECTRAL_ENTROPY,
            "minimumPeakRelativePower": MIN_PEAK_RELATIVE_POWER,
            "minimumPeakSeparationHz": MIN_PEAK_SEPARATION_HZ,
            "acceptedPeakCounts": [2, 3],
            "minimumContiguousFrames": MIN_CUE_FRAMES,
            "maximumDecodedSpanMs": MAX_DECODED_SPAN_MS,
            "timelineNormalization": "FIRST_AUDIO_PTS_TO_ZERO_GAPS_FILLED_WITH_SILENCE",
        },
        "scope": "OBSERVED_AUDIO_CUE_ONLY",
        "notAssessed": ["SOURCE_IDENTITY", "REFEREE_DECISION", "RESTART_TYPE"],
        "limitations": [
            "A whistle-like cue can also be produced by supporters, music, or other multitone audio.",
            "Silence inserted to preserve packet timestamp gaps is not observed source audio.",
            "Timestamp gaps shorter than one 100 ms frame can share a frame with observed audio.",
            "Local-peak detection uses interior 10 Hz band bins; tones exactly at the band edges may be missed.",
            "No source identity, referee action, foul, restart, or rules decision is inferred.",
        ],
    }


def _write_new_json(path: Path, payload: dict[str, Any]) -> None:
    destination = path.expanduser().resolve()
    if not destination.parent.is_dir():
        raise ValueError("report-parent-missing")
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary = Path(output.name)
            json.dump(payload, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.write("\n")
        try:
            os.link(temporary, destination)
        except FileExistsError:
            raise FileExistsError("report-already-exists")
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="고정 DSP 휘슬 유사 음향 단서 진단")
    parser.add_argument("source", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    scan = audio_cues(args.source)
    report_path = args.report.expanduser().resolve()
    _write_new_json(report_path, audio_report(scan))
    print(f"status={scan.status.value} cues={len(scan.cues)} report={report_path}")


if __name__ == "__main__":
    main()
