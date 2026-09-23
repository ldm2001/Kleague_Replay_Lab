import cv2
import numpy as np
from replay_video.infrastructure.corners import CornerRecognizer, geometry

# 시험용 경기장 반환
def field(ball=None, pole=True):
    # 시험 이미지를 지정 크기와 자료형의 시험 배열로 생성
    image = np.full((540, 960, 3), (45, 35, 35), dtype=np.uint8)
    # 두 경계선이 만나는 삼각형 잔디 영역 배치
    cv2.fillConvexPoly(image, np.array([(20, 170), (850, 350), (20, 530)]), (35, 115, 45))
    # 코너로 이어지는 첫 번째 흰 경계선 배치
    cv2.line(image, (20, 170), (850, 350), (230, 230, 230), 3)
    # 코너로 이어지는 두 번째 흰 경계선 배치
    cv2.line(image, (20, 530), (850, 350), (230, 230, 230), 3)
    # 깃대 유무 시험 조건에 따라 그리기 분기
    if pole:
        # 경계선 교점 바로 옆에 색이 있는 깃대 배치
        cv2.line(image, (854, 317), (854, 350), (20, 240, 200), 3)
    # 공 관측이 있는 경우에만 다음 단계 실행
    if ball:
        # 지정 좌표에 공 크기의 밝은 원 배치
        cv2.circle(image, ball, 4, (240, 240, 240), -1)
    # 시험 이미지를 호출자에게 반환
    return image

# 경계선과 깃대를 요구하는 코너 기하 확인
def test_geometry_requires_boundary_and_pole():
    # 합성 경기장 경계와 깃대에서 코너 위치 추정
    observed = geometry(field())
    # 관측 결과가 존재하는지 확인
    assert observed is not None
    # 추정한 코너 수평 좌표가 실제 교점 근처인지 확인
    assert abs(observed.x - 850) < 12
    # 깃대 근거가 없으면 코너 기하를 인정하지 않는지 확인
    assert geometry(field(pole=False)) is None

# 경계 교점 밖 노란 사람의 코너 깃대 오인 방지 확인
def test_yellow_person_away_from_boundary_intersection_is_not_corner_pole():
    # 잘못된 위치의 깃대를 넣기 위한 화면 생성
    image = field(pole=False)
    # 실제 코너 교점과 떨어진 위치에 가짜 깃대 배치
    cv2.line(image, (820, 325), (820, 355), (20, 240, 200), 3)
    # 교점과 맞지 않는 깃대는 코너 근거에서 제외하는지 확인
    assert geometry(image) is None

# 급경사 골대의 경기장 경계 오인 방지 확인
def test_steep_goal_frame_is_not_a_pair_of_supported_pitch_boundaries():
    # 시험 이미지를 지정 크기와 자료형의 시험 배열로 생성
    image = np.full((540, 960, 3), (45, 35, 35), dtype=np.uint8)
    # 화면 한쪽에 별도의 큰 잔디 영역 배치
    cv2.rectangle(image, (0, 350), (550, 539), (35, 115, 45), -1)
    # 주 경기장과 분리된 삼각형 잔디 영역 배치
    cv2.fillConvexPoly(image, np.array([(684, 319), (950, 362), (750, 503)]), (35, 115, 45))
    # 분리된 영역에 가짜 첫 경계선 배치
    cv2.line(image, (684, 319), (950, 362), (230, 230, 230), 3)
    # 분리된 영역에 가짜 두 번째 경계선 배치
    cv2.line(image, (684, 319), (750, 503), (230, 230, 230), 3)
    # 분리 영역의 교점 옆에 가짜 깃대 배치
    cv2.line(image, (680, 286), (680, 319), (20, 240, 200), 3)
    # 주 경기장과 떨어진 가짜 코너 모양을 제외하는지 확인
    assert geometry(image) is None

# 정지된 예비 공의 코너 사건 생성 방지 확인
def test_stationary_spare_ball_does_not_create_a_corner_event():
    # 코너 기하와 공 출발 경로를 누적할 인식기 생성
    detector = CornerRecognizer()
    # 움직이지 않는 공을 여러 프레임에 걸쳐 관측
    for frame in range(12):
        # 코너 근처 정지 공만으로 재개 단서를 만들지 않는지 확인
        assert detector.update(field((800, 340)), frame * 67, 0) is None

# 코너 출발과 실제 상태 전이 연결 확인
def test_corner_departure_connects_real_state_machine():
    # 코너 기하와 공 출발 경로를 누적할 인식기 생성
    detector = CornerRecognizer()
    # 발생 이력을 누적할 빈 자료 구조 준비
    events = []
    # 정지 뒤 출발하는 공의 짧은 관측 구간 구성
    for frame in range(12):
        # 처음 다섯 프레임은 정지시키고 이후 공을 경기장 안쪽으로 이동
        ball = (820, 337) if frame < 5 else (820 - (frame - 4) * 35, 337 - (frame - 4) * 8)
        # 단서 검출기에 입력을 반영하여 상태 갱신
        event = detector.update(field(ball), frame * 67, 0)
        # 시험 사건이 있는 경우에만 다음 단계 실행
        if event:
            # 발생 이력에 이번 항목 추가
            events.append(event)
    # 발생 이력의 개수가 1과 일치하는지 확인
    assert len(events) == 1
    # 종류가 예상 계약과 일치하는지 확인
    assert events[0]["kind"] == "CORNER_KICK"
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert events[0]["status"] == "OBSERVED"
    # 시작 시각이 허용 경계 조건을 만족하는지 확인
    assert events[0]["startMs"] < events[0]["restartMs"] < events[0]["endMs"]

# 긴 연속 준비 구간의 관측 공백 오인 방지 확인
def test_long_continuous_preparation_does_not_become_an_observation_gap():
    # 코너 기하와 공 출발 경로를 누적할 인식기 생성
    detector = CornerRecognizer()
    # 발생 이력을 누적할 빈 자료 구조 준비
    events = []
    # 긴 정지 구간 뒤 공이 출발하는 장면 구성
    for frame in range(82):
        # 긴 대기 이후의 짧은 출발 경로 계산
        ball = (820, 337) if frame < 75 else (820 - (frame - 74) * 35, 337 - (frame - 74) * 8)
        # 단서 검출기에 입력을 반영하여 상태 갱신
        event = detector.update(field(ball), frame * 67, 0)
        # 시험 사건이 있는 경우에만 다음 단계 실행
        if event:
            # 발생 이력에 이번 항목 추가
            events.append(event)
    # 발생 이력의 개수가 1과 일치하는지 확인
    assert len(events) == 1
    # 시작 시각이 0과 일치하는지 확인
    assert events[0]["startMs"] == 0
    # 재개 시각이 5000보다 큰지 확인
    assert events[0]["restartMs"] > 5000

# 코너 기하 없는 공 이동의 사건 제외 확인
def test_moving_ball_without_corner_geometry_has_no_event():
    # 코너 기하와 공 출발 경로를 누적할 인식기 생성
    detector = CornerRecognizer()
    # 깃대 없는 화면에서 공 이동을 반복하는 구간 구성
    for frame in range(12):
        # 공이 움직여도 코너 기하 근거가 없으면 사건으로 만들지 않는지 확인
        assert (
            detector.update(field((800 - frame * 35, 330 - frame * 8), pole=False), frame * 67, 0)
            is None
        )

# 정지 코너의 카메라 이동을 킥으로 오인하지 않음 확인
def test_camera_pan_of_static_corner_is_not_a_kick():
    # 코너 기하와 공 출발 경로를 누적할 인식기 생성
    detector = CornerRecognizer()
    # 정지 공이 있는 코너 화면을 카메라 이동 기준으로 준비
    image = field((800, 340))
    # 화면 전체가 움직이는 열두 프레임 구성
    for frame in range(12):
        # 공 자체 이동 없이 화면 전체를 일정 폭만큼 이동
        moved = cv2.warpAffine(image, np.float32([[1, 0, frame * 2], [0, 1, 0]]), (960, 540))
        # 카메라 이동만으로 코너 재개 단서를 만들지 않는지 확인
        assert detector.update(moved, frame * 67, 0) is None

# 화면 전환 뒤 무관한 이동과 준비 구간의 연결 차단 확인
def test_cut_does_not_connect_preparation_to_unrelated_flight():
    # 코너 기하와 공 출발 경로를 누적할 인식기 생성
    detector = CornerRecognizer()
    # 화면 전환 전 정지 공의 관측 이력 누적
    for frame in range(5):
        # 전환 이전 정지 관측만으로 단서가 생기지 않는지 확인
        assert detector.update(field((820, 337)), frame * 67, 0) is None
    # 화면 전환 이후의 공 이동 관측 구성
    for frame in range(5, 9):
        # 서로 다른 연속 구간을 이어 재개로 판정하지 않는지 확인
        assert (
            detector.update(field((820 - (frame - 4) * 35, 337 - (frame - 4) * 8)), frame * 67, 1)
            is None
        )
