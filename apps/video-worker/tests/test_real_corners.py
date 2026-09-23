import hashlib
import json
import os
from pathlib import Path
import cv2
import pytest
from replay_video.infrastructure.corners import CornerRecognizer


# 원본 지문과 코너 구간이 담긴 개발 라벨 읽음
LABELS = json.loads(
    (Path(__file__).resolve().parents[3] / "datasets/labeled-cases/코너개발.json").read_text()
)

# 실제 시험 영상 반환
@pytest.fixture(scope="module")
def real_video():
    # 저장소 밖 선택적 코너 회귀 영상 경로 읽음
    source = os.environ.get("REPLAY_CORNER_VIDEO")
    # 사용 가능한 실제 원본이 없는 경우 분기
    if not source:
        # 영상 미제공 상태에서는 선택적 개발 회귀 시험 건너뜀
        pytest.skip("REPLAY_CORNER_VIDEO not provided for optional development regression")
    # 시험에 사용할 파일 경로 구성
    path = Path(source)
    # 파일 경로를 닫힘이 보장되는 범위에서 열기
    with path.open("rb") as stream:
        # 실제 영상 지문이 라벨의 원본 지문과 일치하는지 확인
        assert hashlib.file_digest(stream, "sha256").hexdigest() == LABELS["source_sha256"]
    # 파일 경로를 호출자에게 반환
    return path

# 검토된 개발 코너 구간 확인
@pytest.mark.parametrize("case", LABELS["cases"], ids=lambda case: case["id"])
def test_reviewed_development_corner_sequences(real_video, case):
    # 실제 코너 장면의 프레임을 읽을 디코더 생성
    capture = cv2.VideoCapture(str(real_video))
    # 제공한 실제 영상 파일을 열 수 있는지 확인
    assert capture.isOpened()
    # 발생 이력을 누적할 빈 자료 구조 준비
    events = []
    # 코너 기하와 공 출발 경로를 누적할 인식기 생성
    detector = CornerRecognizer()
    # 구간 인식 이후 디코더 해제를 보장하는 범위 시작
    try:
        # 관측 간격을 정할 원본 프레임 속도 조회
        fps = capture.get(cv2.CAP_PROP_FPS)
        # 초당 약 열다섯 장에 해당하는 표본 간격 계산
        stride = max(1, round(fps / 15))
        # 영상 디코더를 켜서 대기 중인 실행 진행
        capture.set(cv2.CAP_PROP_POS_MSEC, case["start_ms"])
        # 라벨 시작부터 끝까지 원본 프레임 순회
        for index in range(round((case["end_ms"] - case["start_ms"]) * fps / 1000)):
            # 이번 시각의 실제 코너 영상 프레임 디코딩
            ok, image = capture.read()
            # 인식에 사용할 실제 프레임을 읽었는지 확인
            assert ok
            # 이번 프레임이 인식 표본 간격 사이에 있는지 분기
            if index % stride:
                # 표본이 아닌 프레임의 인식 연산 생략
                continue
            # 단서 검출기에 입력을 반영하여 상태 갱신
            event = detector.update(image, round(capture.get(cv2.CAP_PROP_POS_MSEC)), 0)
            # 시간적으로 누적되어 생성된 코너 단서만 수집
            if event is not None:
                # 발생 이력에 이번 항목 추가
                events.append(event)
    finally:
        # 영상 디코더가 점유한 자원 해제
        capture.release()
    # 발생 이력의 개수가 예상 항목 수와 일치하는지 확인
    assert len(events) == case["expected_count"]
    # 발생 이력의 각 항목을 순서대로 처리
    for event in events:
        # 종류가 예상 계약과 일치하는지 확인
        assert event["kind"] == "CORNER_KICK"
        # 재개 시간 범위의 선택 항목이 허용 경계 조건을 만족하는지 확인
        assert case["restart_range_ms"][0] <= event["restartMs"] <= case["restart_range_ms"][1]
