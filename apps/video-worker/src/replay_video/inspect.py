from __future__ import annotations

import argparse
import json
import math
import hashlib
from dataclasses import asdict
from pathlib import Path

import cv2

from .infrastructure.context import frame_context
from .infrastructure.probe import probe
from .infrastructure.signals import histogram
from .application.track import CandidateTracker
from .infrastructure.ball import ball_candidates
from .infrastructure.corners import CornerRecognizer
from .infrastructure.broadcast import BroadcastCueRecognizer

# 원시 신호와 추적 진단을 기록하며 Worker는 이 결과의 구간별 요약만 서버로 전달
def inspect_video(source: Path | str, output: Path | str) -> Path:
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

    # 빠른 팬과 공 이동이 긴 샘플 간격에서 끊기지 않도록 약 15Hz로 측정한다
    stride = max(1, round(metadata.fps / 15.0))
    index = 0
    count = 0
    registered = 0
    continuity_id = 0
    previous = None
    previous_histogram = None
    last_time = -1
    last_source_index = None
    nominal_times = 0
    tracker = CandidateTracker()
    ball_tracked_samples = 0
    motion_onsets: list[dict[str, object]] = []
    corners = CornerRecognizer()
    scene_events: list[dict[str, object]] = []
    broadcast = BroadcastCueRecognizer()
    broadcast_cues: list[dict[str, object]] = []
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
                # 후보 추적은 진단용이며 실제 경기 중단과 킥 의미는 아직 부여하지 않는다
                candidates = ball_candidates(image)
                selection, motion = tracker.update(
                    timestamp_ms, continuity_id, context.width, context.height, candidates,
                    context.camera_affine if time_source == "DECODER" else None,
                )
                scene_event = corners.update(image, timestamp_ms, continuity_id)
                if scene_event is not None:
                    scene_events.append(scene_event)
                broadcast_cue = broadcast.update(image, timestamp_ms, continuity_id)
                if broadcast_cue is not None:
                    broadcast_cues.append(broadcast_cue)
                if motion.candidate is not None:
                    ball_tracked_samples += 1
                if motion.motion_onset_ms is not None:
                    motion_onsets.append({
                        "timestamp_ms": motion.motion_onset_ms, "confirmed_at_ms": timestamp_ms,
                        "track_id": motion.track_id, "continuity_id": continuity_id,
                        "meaning": "CANDIDATE_STILL_TO_MOVING",
                    })
                sample = {
                    "frame_index": frame_index, "timestamp_ms": timestamp_ms,
                    "time_source": time_source, "previous_frame_index": last_source_index,
                    "continuity_id": continuity_id, "cut_candidate": bool(cut),
                    **asdict(context),
                    "ball_candidates": [asdict(candidate) for candidate in candidates],
                    "ball_track": asdict(motion),
                    "path_selection": asdict(selection),
                    "scene_event": scene_event,
                    "broadcast_cue": broadcast_cue,
                    "corner_departure_path": corners.last_departure if scene_event is not None else None,
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
    with metadata.source.open("rb") as source_file:
        source_sha256 = hashlib.file_digest(source_file, "sha256").hexdigest()
    # 프레임 수 메타데이터와 읽은 프레임 수가 다르면 전체 검사 완료라고 주장하지 않는다
    summary = {
        "schema_version": 1, "extractor_version": "broadcast-corner-context-v1",
        "source_name": metadata.source.name, "duration_ms": metadata.duration_ms,
        "source_sha256": source_sha256,
        "decoded_frames": index, "expected_frames": metadata.frame_count,
        "coverage_status": "MATCHES_METADATA" if index == metadata.frame_count else "UNVERIFIED",
        "sample_stride": stride, "sample_count": count, "registered_pairs": registered,
        "nominal_timestamp_count": nominal_times,
        "ball_tracked_samples": ball_tracked_samples,
        "candidate_motion_onsets": motion_onsets,
        "set_piece_status": "OBSERVED" if scene_events else "UNKNOWN",
        "scene_events": scene_events,
        "broadcast_cues": broadcast_cues,
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
