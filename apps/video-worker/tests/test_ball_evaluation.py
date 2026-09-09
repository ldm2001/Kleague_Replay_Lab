import json

import pytest

from replay_video.evaluate_ball import evaluate_ball


def files(tmp_path, predictions, labels):
    # 지표 산식 검증용 값이며 실영상 성능 자료가 아니다
    source_hash = "a" * 64
    summary = tmp_path / "context-summary.json"
    summary.write_text(json.dumps({"source_sha256": source_hash, "extractor_version": "test"}))
    (tmp_path / "context.jsonl").write_text("\n".join(json.dumps({
        "frame_index": index, "width": 100, "height": 100,
        "ball_track": {"candidate": point},
    }) for index, point in enumerate(predictions)))
    label_path = tmp_path / "labels.json"
    label_path.write_text(json.dumps({"source_sha256": source_hash, "frames": labels}))
    return summary, label_path


def test_counts_false_positives_misses_and_wrong_locations(tmp_path):
    summary, labels = files(tmp_path, [{"x": 50, "y": 50}, None, {"x": 10, "y": 10}, {"x": 50, "y": 50}, None], [
        {"frame_index": 0, "visibility": "VISIBLE", "ball": {"x": 0.5, "y": 0.5}},
        {"frame_index": 1, "visibility": "VISIBLE", "ball": {"x": 0.5, "y": 0.5}},
        {"frame_index": 2, "visibility": "VISIBLE", "ball": {"x": 0.5, "y": 0.5}},
        {"frame_index": 3, "visibility": "ABSENT"},
        {"frame_index": 4, "visibility": "ABSENT"},
    ])
    result = evaluate_ball(summary, labels)
    assert (result["true_positive"], result["false_positive"], result["false_negative"], result["true_negative"]) == (1, 2, 2, 1)
    assert result["precision"] == pytest.approx(1 / 3)
    assert result["recall"] == pytest.approx(1 / 3)


def test_unlabelled_and_unobservable_are_not_true_negatives(tmp_path):
    summary, labels = files(tmp_path, [{"x": 50, "y": 50}, None], [{"frame_index": 0, "visibility": "UNOBSERVABLE"}])
    result = evaluate_ball(summary, labels)
    assert result["unobservable_with_prediction"] == 1
    assert result["unlabelled_samples"] == 1
    assert result["true_negative"] == 0
    assert result["precision"] is None
    assert result["recall"] is None


@pytest.mark.parametrize("bad", [
    {"frame_index": 5, "visibility": "ABSENT"},
    {"frame_index": 0, "visibility": "VISIBLE", "ball": {"x": -1, "y": 0}},
    {"frame_index": 0, "visibility": "VISIBLE", "ball": {"x": True, "y": 0}},
    {"frame_index": 0, "visibility": "ABSENT", "ball": {"x": 0, "y": 0}},
])
def test_invalid_labels_are_rejected(tmp_path, bad):
    summary, labels = files(tmp_path, [None], [bad])
    with pytest.raises(ValueError):
        evaluate_ball(summary, labels)


def test_wrong_video_and_duplicate_labels_are_rejected(tmp_path):
    summary, labels = files(tmp_path, [None], [{"frame_index": 0, "visibility": "ABSENT"}] * 2)
    with pytest.raises(ValueError, match="invalid-label-frame"):
        evaluate_ball(summary, labels)
    labels.write_text(json.dumps({"source_sha256": "b" * 64, "frames": []}))
    with pytest.raises(ValueError, match="evaluation-source-mismatch"):
        evaluate_ball(summary, labels)
