from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict
from pathlib import Path

import cv2

from .infrastructure.context import frame_context
from .infrastructure.probe import probe
from .infrastructure.signals import histogram


def inspect_video(source: Path | str, output: Path | str) -> Path:
    """개발 평가용 원시 신호를 기록하며 서비스 분석 결과에는 아직 반영하지 않는다"""
    metadata = probe(source)
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    samples_path = root / "context.jsonl"
    summary_path = root / "context-summary.json"
    # 이전 측정 결과를 덮어쓰지 않아 서로 다른 설정의 평가 기록을 보존한다
    if samples_path.exists() or summary_path.exists():
        raise FileExistsError("context-output-already-exists")
    capture = cv2.VideoCapture(str(metadata.source))
    if not capture.isOpened():
        capture.release()
        raise RuntimeError("video-open-failed")

    stride = max(1, round(metadata.fps / 5.0))
    index = 0
    count = 0
    registered = 0
    continuity_id = 0
    previous = None
    previous_histogram = None
    last_time = -1
    last_source_index = None
    nominal_times = 0
    try:
        with samples_path.open("x", encoding="utf-8") as stream:
            while capture.grab():
                frame_index = index
                index += 1
                if frame_index % stride:
                    continue
                ok, image = capture.retrieve()
                if not ok:
                    raise RuntimeError("context-frame-read-failed")
                decoder_time = capture.get(cv2.CAP_PROP_POS_MSEC)
                time_source = "DECODER"
                if not math.isfinite(decoder_time) or decoder_time < 0 or round(decoder_time) <= last_time:
                    timestamp_ms = max(last_time + 1, round(frame_index * 1000 / metadata.fps))
                    time_source = "NOMINAL_FPS"
                    nominal_times += 1
                else:
                    timestamp_ms = round(decoder_time)

                # 색상 분포가 크게 바뀌면 같은 카메라의 연속 움직임으로 연결하지 않는다
                current_histogram = histogram(image)
                cut = previous_histogram is not None and cv2.compareHist(
                    previous_histogram, current_histogram, cv2.HISTCMP_BHATTACHARYYA,
                ) >= 0.45
                if cut:
                    continuity_id += 1
                    previous = None
                    last_source_index = None
                context = frame_context(image, previous)
                if context.camera_dx is not None:
                    registered += 1
                sample = {
                    "frame_index": frame_index, "timestamp_ms": timestamp_ms,
                    "time_source": time_source, "previous_frame_index": last_source_index,
                    "continuity_id": continuity_id, "cut_candidate": bool(cut),
                    **asdict(context),
                    # 아래 의미 정보는 원시 영상 차이로 대체하지 않는다
                    "ball_position": None, "player_positions": None,
                    "dead_ball": None, "ball_restarted": None, "is_replay": None,
                    "restart_candidates": [],
                }
                stream.write(json.dumps(sample, ensure_ascii=False, allow_nan=False) + "\n")
                count += 1
                last_time = timestamp_ms
                last_source_index = frame_index
                previous = image
                previous_histogram = current_histogram
    finally:
        capture.release()

    if count == 0:
        raise RuntimeError("context-no-frames")
    # 프레임 수 메타데이터와 읽은 프레임 수가 다르면 전체 검사 완료라고 주장하지 않는다
    summary = {
        "schema_version": 1, "extractor_version": "context-baseline-v1",
        "source_name": metadata.source.name, "duration_ms": metadata.duration_ms,
        "decoded_frames": index, "expected_frames": metadata.frame_count,
        "coverage_status": "MATCHES_METADATA" if index == metadata.frame_count else "UNVERIFIED",
        "sample_stride": stride, "sample_count": count, "registered_pairs": registered,
        "nominal_timestamp_count": nominal_times,
        "set_piece_status": "UNKNOWN",
        "missing_inputs": ["ball_position", "player_positions", "dead_ball", "ball_restarted", "is_replay", "restart_candidates"],
        "samples_file": samples_path.name,
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    return summary_path


def main() -> None:
    parser = argparse.ArgumentParser(description="모델 없는 영상 원시 신호 진단")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(inspect_video(args.source, args.output))


if __name__ == "__main__":
    main()
