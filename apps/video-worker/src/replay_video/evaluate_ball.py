from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def evaluate_ball(summary_path: Path, labels_path: Path) -> dict[str, Any]:
    """개발용 정답 좌표와 선택된 공 후보를 비교하며 미라벨 프레임을 정답 없음으로 간주하지 않는다"""
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    labels = json.loads(labels_path.read_text(encoding="utf-8"))
    source_hash = summary.get("source_sha256")
    if not isinstance(source_hash, str) or len(source_hash) != 64 or source_hash != labels.get("source_sha256"):
        raise ValueError("evaluation-source-mismatch")
    # 라벨 파일은 평가 대상 영상의 해시를 명시해야 하며 파일명만으로 연결하지 않는다
    sample_path = summary_path.parent / "context.jsonl"
    samples = {}
    for line in sample_path.read_text(encoding="utf-8").splitlines():
        sample = json.loads(line)
        index = sample["frame_index"]
        if index in samples:
            raise ValueError("duplicate-sample-frame")
        samples[index] = sample
    frames = labels.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ValueError("evaluation-labels-required")
    tp = fp = fn = tn = unobservable = unobservable_predictions = wrong_location = 0
    errors: list[float] = []
    used = set()
    tolerance = 0.02
    for label in frames:
        index = label["frame_index"]
        if type(index) is not int or index not in samples or index in used:
            raise ValueError("invalid-label-frame")
        used.add(index)
        sample = samples[index]
        predicted = sample["ball_track"]["candidate"]
        visibility = label.get("visibility")
        if visibility == "UNOBSERVABLE":
            unobservable += 1
            unobservable_predictions += predicted is not None
            continue
        if visibility == "ABSENT":
            if label.get("ball") is not None:
                raise ValueError("contradictory-ball-label")
            fp += predicted is not None
            tn += predicted is None
            continue
        if visibility != "VISIBLE":
            raise ValueError("invalid-visibility-label")
        ball = label.get("ball")
        if not isinstance(ball, dict) or any(
            type(ball.get(axis)) not in (int, float) or not math.isfinite(ball[axis]) or not 0 <= ball[axis] <= 1
            for axis in ("x", "y")
        ):
            raise ValueError("invalid-ball-label")
        if predicted is None:
            fn += 1
            continue
        width, height = sample["width"], sample["height"]
        distance = math.hypot(predicted["x"] - ball["x"] * width, predicted["y"] - ball["y"] * height) / math.hypot(width, height)
        errors.append(distance)
        if distance <= tolerance:
            tp += 1
        else:
            # 엉뚱한 물체를 잡으면 공 누락과 잘못된 후보 선택을 모두 기록한다
            fp += 1
            fn += 1
            wrong_location += 1
    return {
        "source_sha256": source_hash, "extractor_version": summary["extractor_version"],
        "labelled_frames": len(used), "unlabelled_samples": len(samples) - len(used),
        "evaluated_frames": len(used) - unobservable,
        "true_positive": tp, "false_positive": fp, "false_negative": fn, "true_negative": tn,
        "wrong_location": wrong_location,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "mean_error_diagonal": sum(errors) / len(errors) if errors else None,
        "match_tolerance_diagonal": tolerance,
        "unobservable_frames": unobservable, "unobservable_with_prediction": unobservable_predictions,
        "scope": "SELECTED_BALL_CANDIDATE_ONLY",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="개발용 공 후보 좌표 평가")
    parser.add_argument("summary", type=Path)
    parser.add_argument("labels", type=Path)
    args = parser.parse_args()
    print(json.dumps(evaluate_ball(args.summary, args.labels), ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
