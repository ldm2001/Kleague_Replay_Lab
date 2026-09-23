import json
import pytest
from replay_video.accuracy import accuracy

# 시험용 파일 반환
def files(tmp_path, predictions, labels):
    # 지표 산식 검증용 값이며 실영상 성능 자료가 아님
    source_hash = "a" * 64
    # 요약 정보를 시험용 기준 경로에서 구성
    summary = tmp_path / "context-summary.json"
    # 요약 정보에 시험 내용을 기록
    summary.write_text(json.dumps({"source_sha256": source_hash, "extractor_version": "test"}))
    # 관측 기록 파일에 시험 내용을 기록
    (tmp_path / "context.jsonl").write_text(
        "\n".join(
            json.dumps(
                {
                    "frame_index": index,
                    "width": 100,
                    "height": 100,
                    "ball_track": {"candidate": point},
                }
            )
            for index, point in enumerate(predictions)
        )
    )
    # 개발 라벨 파일을 둘 임시 경로 구성
    label_path = tmp_path / "labels.json"
    # 원본 지문과 프레임별 정답 라벨을 파일로 저장
    label_path.write_text(json.dumps({"source_sha256": source_hash, "frames": labels}))
    # 비교할 진단 요약과 정답 라벨 경로를 함께 반환
    return summary, label_path

# 오탐·누락·좌표 오류 집계 확인
def test_counts_false_positives_misses_and_wrong_locations(tmp_path):
    # 정탐과 미탐 및 정상 제외가 섞인 평가 입력 준비
    summary, labels = files(
        tmp_path,
        [{"x": 50, "y": 50}, None, {"x": 10, "y": 10}, {"x": 50, "y": 50}, None],
        [
            {"frame_index": 0, "visibility": "VISIBLE", "ball": {"x": 0.5, "y": 0.5}},
            {"frame_index": 1, "visibility": "VISIBLE", "ball": {"x": 0.5, "y": 0.5}},
            {"frame_index": 2, "visibility": "VISIBLE", "ball": {"x": 0.5, "y": 0.5}},
            {"frame_index": 3, "visibility": "ABSENT"},
            {"frame_index": 4, "visibility": "ABSENT"},
        ],
    )
    # 진단 후보를 동일 원본의 정답 라벨과 비교
    result = accuracy(summary, labels)
    # 정탐·오탐·미탐·정상 제외 집계가 예상과 일치하는지 확인
    assert (
        result["true_positive"],
        result["false_positive"],
        result["false_negative"],
        result["true_negative"],
    ) == (1, 2, 2, 1)
    # 정밀도가 예상 계약과 일치하는지 확인
    assert result["precision"] == pytest.approx(1 / 3)
    # 재현율이 예상 계약과 일치하는지 확인
    assert result["recall"] == pytest.approx(1 / 3)

# 미라벨·관측 불가의 참음성 오인 방지 확인
def test_unlabelled_and_unobservable_are_not_true_negatives(tmp_path):
    # 관측 불가 표본과 예측 좌표가 함께 있는 평가 입력 준비
    summary, labels = files(
        tmp_path, [{"x": 50, "y": 50}, None], [{"frame_index": 0, "visibility": "UNOBSERVABLE"}]
    )
    # 관측 가시성에 따른 평가 대상 포함 여부 계산
    result = accuracy(summary, labels)
    # 관측 불가 상태의 예측 여부가 1과 일치하는지 확인
    assert result["unobservable_with_prediction"] == 1
    # 라벨 없는 표본 수가 1과 일치하는지 확인
    assert result["unlabelled_samples"] == 1
    # 정상 제외 수가 0과 일치하는지 확인
    assert result["true_negative"] == 0
    # 정밀도가 비어 있는지 확인
    assert result["precision"] is None
    # 재현율이 비어 있는지 확인
    assert result["recall"] is None

# 잘못된 라벨 거부 확인
@pytest.mark.parametrize("bad", [
    {"frame_index": 5, "visibility": "ABSENT"},
    {"frame_index": 0, "visibility": "VISIBLE", "ball": {"x": -1, "y": 0}},
    {"frame_index": 0, "visibility": "VISIBLE", "ball": {"x": True, "y": 0}},
    {"frame_index": 0, "visibility": "ABSENT", "ball": {"x": 0, "y": 0}},
])
def test_invalid_labels_are_rejected(tmp_path, bad):
    # 잘못된 개발 라벨 한 개를 넣어 검증 실패 입력 구성
    summary, labels = files(tmp_path, [None], [bad])
    # 잘못된 라벨 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError):
        # 잘못된 라벨의 좌표나 자료형을 평가 전에 거부하는지 실행
        accuracy(summary, labels)

# 다른 영상과 중복 라벨 거부 확인
def test_wrong_video_and_duplicate_labels_are_rejected(tmp_path):
    # 동일 프레임 라벨을 중복 기록하여 중복 거부 상황 재현
    summary, labels = files(tmp_path, [None], [{"frame_index": 0, "visibility": "ABSENT"}] * 2)
    # 다른 영상과 중복 라벨 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError, match="invalid-label-frame"):
        # 중복 프레임 라벨을 평가 전에 검증
        accuracy(summary, labels)
    # 원본과 다른 지문을 저장하여 라벨 귀속 불일치 재현
    labels.write_text(json.dumps({"source_sha256": "b" * 64, "frames": []}))
    # 다른 영상과 중복 라벨 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError, match="evaluation-source-mismatch"):
        # 다른 원본에 속한 라벨을 평가 전에 검증
        accuracy(summary, labels)
