"""원본 해시 결합의 선택적 개발 회귀 시험과 영상 동봉 금지

방송 그래픽 검증용 영상 환경 변수는 검토한 케이리그 하이라이트 원본 경로 요구
라벨은 보이는 득점 방송 표시만 의미하며 득점 인정·비디오 판독 사용 아님
고정 품질 확인 시각은 운영 검출기에서 제외"""

import hashlib
import os
from pathlib import Path
import cv2
import pytest
from replay_video.infrastructure.broadcast import BroadcastCueRecognizer, graphic

# 시험용 방송 영상 반환
@pytest.fixture(scope="module")
def broadcast_video():
    # 사용자가 로컬에 둔 선택적 회귀 영상 경로를 환경에서 읽음
    source = os.environ.get("REPLAY_BROADCAST_VIDEO")
    # 실제 원본 영상이 제공되지 않은 경우 분기
    if not source:
        # 저장소에 영상을 포함하지 않으므로 선택적 실영상 시험 건너뜀
        pytest.skip("REPLAY_BROADCAST_VIDEO not provided for optional development regression")
    # 시험에 사용할 파일 경로 구성
    path = Path(source)
    # 파일 경로를 닫힘이 보장되는 범위에서 열기
    with path.open("rb") as stream:
        # 제공 영상의 내용 지문이 개발 라벨의 원본과 같은지 확인
        assert (
            hashlib.file_digest(stream, "sha256").hexdigest()
            == "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857"
        )
    # 파일 경로를 호출자에게 반환
    return path

# 애니메이션으로 붙은 득점 글자 관측 확인
@pytest.mark.parametrize("timestamp", [533500, 533600, 533700, 533800, 702000, 702500])
def test_visible_goal_glyphs_include_joined_animation_letters(broadcast_video, timestamp):
    # 득점 표시 양성 구간을 읽을 실제 영상 디코더 생성
    capture = cv2.VideoCapture(str(broadcast_video))
    # 프레임 검사 뒤 디코더 해제를 보장하는 범위 시작
    try:
        # 영상 디코더를 켜서 대기 중인 실행 진행
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp)
        # 지정 시각의 실제 방송 프레임 읽음
        ok, frame = capture.read()
        # 요청한 실영상 프레임이 디코딩됐는지 확인
        assert ok
        # 라벨된 득점 표시가 프레임에서 인식되는지 확인
        assert graphic(frame)
    finally:
        # 영상 디코더가 점유한 자원 해제
        capture.release()

# 일반 점수판·최종 점수의 득점 글자 오인 방지 확인
@pytest.mark.parametrize("timestamp", [60000, 240000, 400000, 535000, 687000, 731000])
def test_regular_scorebugs_and_final_score_are_not_goal_glyphs(broadcast_video, timestamp):
    # 오인 가능 구간을 읽을 실제 영상 디코더 생성
    capture = cv2.VideoCapture(str(broadcast_video))
    # 음성 사례 검사 뒤 디코더 해제를 보장하는 범위 시작
    try:
        # 영상 디코더를 켜서 대기 중인 실행 진행
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp)
        # 점수나 유사 글자가 있는 실제 프레임 읽음
        ok, frame = capture.read()
        # 음성 사례 프레임을 실제로 디코딩했는지 확인
        assert ok
        # 득점 표시가 아닌 구간을 양성으로 오인하지 않는지 확인
        assert not graphic(frame)
    finally:
        # 영상 디코더가 점유한 자원 해제
        capture.release()

# 검토된 득점 표시 구간의 단일 단서 출력 확인
@pytest.mark.parametrize(
    "start,end",
    [(260000, 264000), (381000, 385000), (532000, 536000), (642000, 646000), (701000, 705000)],
)
def test_reviewed_goal_graphic_sequence_emits_one_cue(broadcast_video, start, end):
    # 방송 표시 지속 시간 시험용 실제 디코더 생성
    capture = cv2.VideoCapture(str(broadcast_video))
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 발생 이력을 누적할 빈 자료 구조 준비
    events = []
    # 구간 반복 종료 후 디코더 해제를 보장하는 범위 시작
    try:
        # 영상 디코더를 켜서 대기 중인 실행 진행
        capture.set(cv2.CAP_PROP_POS_MSEC, start)
        # 원본의 초당 프레임 수 조회
        fps = capture.get(cv2.CAP_PROP_FPS)
        # 초당 약 열다섯 장만 관측할 프레임 간격 계산
        stride = max(1, round(fps / 15))
        # 라벨된 구간의 원본 프레임을 순서대로 읽음
        for index in range(round((end - start) * fps / 1000)):
            # 현재 순번의 영상 프레임 디코딩
            ok, frame = capture.read()
            # 분석 구간의 각 프레임 읽기가 성공하는지 확인
            assert ok
            # 표본 간격 사이에 끼인 프레임인지 분기
            if index % stride:
                # 디코딩은 유지하되 이번 프레임의 인식 연산 생략
                continue
            # 단서 검출기에 입력을 반영하여 상태 갱신
            event = detector.update(frame, round(capture.get(cv2.CAP_PROP_POS_MSEC)), 0)
            # 지속 조건을 만족한 방송 단서만 결과에 수집
            if event is not None:
                # 발생 이력에 이번 항목 추가
                events.append(event)
    finally:
        # 영상 디코더가 점유한 자원 해제
        capture.release()
    # 발생 이력의 개수가 1과 일치하는지 확인
    assert len(events) == 1
    # 시작 지점이 허용 경계 조건을 만족하는지 확인
    assert start <= events[0]["startMs"] < events[0]["endMs"] <= end
    # 증거 프레임 시각 목록의 개수가 2 이상인지 확인
    assert len(set(events[0]["evidenceTimestampsMs"])) >= 2
