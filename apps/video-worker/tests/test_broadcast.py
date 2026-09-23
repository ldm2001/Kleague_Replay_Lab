import cv2
import numpy as np
import pytest
from replay_video.infrastructure.broadcast import BroadcastCueRecognizer, graphic

# 시험용 방송 화면 반환
def broadcast(text="GOAL", scale=1.0, band=True, origin=(88, 46), font=cv2.FONT_HERSHEY_DUPLEX):
    # 시험 이미지를 지정 크기와 자료형의 시험 배열로 생성
    image = np.full((540, 960, 3), (45, 112, 48), dtype=np.uint8)
    # 방송 배경 띠를 포함하는 시험 조건일 때만 배치
    if band:
        # 방송 점수 표시의 위쪽 배경 띠 배치
        cv2.rectangle(image, (29, 22), (260, 50), (125, 53, 9), -1)
        # 점수 영역을 구분하는 강조색 상자 배치
        cv2.rectangle(image, (190, 22), (260, 50), (20, 12, 175), -1)
        # 득점 안내 아래쪽 배경 띠 배치
        cv2.rectangle(image, (29, 51), (260, 68), (83, 20, 18), -1)
    # 시험할 방송 글자를 지정 위치와 글꼴로 그리기
    cv2.putText(image, text, origin, font, 0.9, (250, 250, 250), 2, cv2.LINE_AA)
    # 서로 다른 방송 해상도를 재현하도록 전체 화면 배율 적용 후 반환
    return cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

# 지원 점수판의 득점 글자 해상도 정규화 확인
@pytest.mark.parametrize("scale", [1.0, 2.0, 1280 / 960])
@pytest.mark.parametrize("font", [cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_SIMPLEX])
def test_goal_letters_on_supported_scorebug_are_resolution_normalized(scale, font):
    # 글꼴과 크기가 달라도 유효 득점 표시를 인식하는지 확인
    assert graphic(broadcast(scale=scale, font=font))

# 색상과 유사 단어의 득점 단서 오인 방지 확인
@pytest.mark.parametrize(
    "text", ["", "2 2", "FOUL", "GOAT", "COAL", "6001", "GOALS", "GQAL", "G0AL", "GO4L", "GAOL"]
)
@pytest.mark.parametrize("font", [cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_SIMPLEX])
def test_colour_and_similar_words_are_not_goal_cues(text, font):
    # 비슷한 숫자나 다른 글자를 득점 표시로 오인하지 않는지 확인
    assert not graphic(broadcast(text, font=font))

# 방송 띠 없는 득점 문구의 단서 제외 확인
def test_goal_text_without_broadcast_band_is_not_a_supported_cue():
    # 방송 배경 띠가 없으면 글자만으로 단서를 만들지 않는지 확인
    assert not graphic(broadcast(band=False))

# 점수판 밖 득점 광고의 단서 제외 확인
def test_goal_advertisement_outside_scorebug_is_not_a_supported_cue():
    # 예상 방송 영역 밖의 글자를 득점 표시로 인정하지 않는지 확인
    assert not graphic(broadcast(origin=(100, 410)))

# 붙은 굵은 글자의 임의 문구 오인 방지 확인
def test_neighbouring_bold_glyphs_can_touch_without_becoming_arbitrary_text():
    # 글자 간격을 직접 조절할 빈 방송 표시 생성
    image = broadcast("")
    # 득점 글자의 각 문자를 순서대로 배치
    for index, letter in enumerate("GOAL"):
        # 굵은 글자 사이가 닿도록 좁은 간격으로 그리기
        cv2.putText(
            image,
            letter,
            (88 + index * 17, 46),
            cv2.FONT_HERSHEY_DUPLEX,
            0.9,
            (250, 250, 250),
            2,
            cv2.LINE_AA,
        )
    # 서로 닿는 굵은 글자도 득점 글리프로 인식하는지 확인
    assert graphic(image)

# 득점 글자의 남색 시계 띠 요구 확인
def test_goal_letters_need_the_navy_clock_strip_not_only_red_and_blue():
    # 배경 띠 변조 전 정상 방송 표시 생성
    image = broadcast()
    # 아래쪽 방송 띠를 잔디색으로 바꾸어 형태 조건 제거
    cv2.rectangle(image, (29, 51), (260, 68), (45, 112, 48), -1)
    # 방송 띠 조건이 깨진 화면을 득점 표시로 인정하지 않는지 확인
    assert not graphic(image)

# 미지원 프레임 기하의 득점 표시 오인 방지 확인
@pytest.mark.parametrize(
    "frame",
    [
        np.zeros((10, 10, 3), np.uint8),
        np.zeros((540, 960), np.uint8),
        np.zeros((960, 540, 3), np.uint8),
    ],
)
def test_unsupported_frame_geometry_is_not_a_goal_graphic(frame):
    # 지원하지 않는 해상도와 채널 형태를 득점 표시에서 제외하는지 확인
    assert not graphic(frame)

# 단일 프레임 섬광의 단서 확정 방지 확인
def test_single_frame_flash_does_not_confirm_a_cue():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 첫 양성 프레임만으로 득점 단서를 확정하지 않는지 확인
    assert detector.update(broadcast(), 1000, 0) is None
    # 다음 프레임이 점수판이면 양성 지속이 끊기는지 확인
    assert detector.update(broadcast("2 2"), 1500, 0) is None
    # 점수판 지속만으로 득점 단서가 생기지 않는지 확인
    assert detector.update(broadcast("2 2"), 3500, 0) is None
    # 짧은 단발 양성 구간이 마감 때도 단서가 되지 않는지 확인
    assert detector.finish() is None

# 득점·비디오 판독 주장 없는 반복 글자 관측의 단일 출력 확인
def test_repeated_glyph_observations_emit_once_without_claiming_a_goal_or_var():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 시간이 이어지는 양성 프레임을 전달하고 단계별 반환값 수집
    events = [detector.update(broadcast(), timestamp, 0) for timestamp in [1000, 1500, 2000, 3000]]
    # 시험 사건 목록을 후속 비교에 사용할 값으로 보관
    events = [event for event in events if event is not None]
    # 발생 이력이 예상 계약과 일치하는지 확인
    assert events == [{
        "kind": "GOAL_GRAPHIC",
        "method": "broadcast-goal-glyphs-v1",
        "startMs": 1000,
        "endMs": 1500,
        "evidenceTimestampsMs": [1000, 1500],
    }]
    # 이미 반환한 득점 단서를 마감 때 중복 생성하지 않는지 확인
    assert detector.finish() is None

# 중복·근접 시각의 시간적 확인 근거 제외 확인
def test_duplicate_or_nearby_timestamps_do_not_supply_temporal_confirmation():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 중복 시각과 지나치게 가까운 시각을 순서대로 전달
    for timestamp in [1000, 1000, 1001, 1067]:
        # 최소 지속 시간을 채우지 못한 프레임 묶음의 단서 승격 차단 확인
        assert detector.update(broadcast(), timestamp, 0) is None

# 샷 전환 전후 미확인 단일 관측 연결 방지 확인
def test_shot_cut_does_not_join_single_unconfirmed_observations():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 화면 전환 전 첫 양성 프레임의 보류 확인
    assert detector.update(broadcast(), 1000, 0) is None
    # 화면 전환 뒤 첫 프레임부터 지속 시간 재집계 확인
    assert detector.update(broadcast(), 1500, 1) is None
    # 새 연속 구간에서 충분히 유지된 득점 단서 생성 확인
    assert detector.update(broadcast(), 2000, 1) is not None

# 샷 전환 뒤 유지된 확인 표시의 중복 방지 확인
def test_confirmed_overlay_surviving_shot_cut_is_not_duplicated():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 단서 검출기에 입력을 반영하여 상태 갱신
    detector.update(broadcast(), 1000, 0)
    # 전환 전 양성이 충분히 유지되면 단서 생성 확인
    assert detector.update(broadcast(), 1500, 0) is not None
    # 화면 전환 직후 동일 표시의 즉시 중복 생성 방지 확인
    assert detector.update(broadcast(), 2000, 1) is None
    # 동일 득점 표시를 다음 화면에서 다시 보고하지 않는지 확인
    assert detector.update(broadcast(), 2500, 1) is None

# 짧은 가림의 중복 방지와 2초 부재 후 재활성화 확인
def test_brief_occlusion_does_not_rearm_but_two_seconds_absence_does():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 단서 검출기에 입력을 반영하여 상태 갱신
    detector.update(broadcast(), 1000, 0)
    # 최초 지속 양성에서 득점 단서 생성 확인
    assert detector.update(broadcast(), 1500, 0) is not None
    # 표시가 잠깐 사라진 프레임에서 추가 단서가 없는지 확인
    assert detector.update(broadcast("2 2"), 2000, 0) is None
    # 짧게 재등장한 동일 표시의 중복 생성 방지 확인
    assert detector.update(broadcast(), 2500, 0) is None
    # 다시 사라진 표시에서 추가 단서가 없는지 확인
    assert detector.update(broadcast("2 2"), 3000, 0) is None
    # 표시 부재가 충분히 이어지는 상태에서 추가 단서가 없는지 확인
    assert detector.update(broadcast("2 2"), 5000, 0) is None
    # 충분한 부재 뒤 재등장한 첫 프레임의 지속 시간 보류 확인
    assert detector.update(broadcast(), 5500, 0) is None
    # 새로 지속된 재등장 표시의 별도 단서 생성 확인
    assert detector.update(broadcast(), 6000, 0) is not None

# 긴 미표본 구간의 관측 확인 오인 방지 확인
def test_long_unsampled_gap_does_not_confirm_an_unobserved_interval():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 첫 양성 프레임의 단서 보류 확인
    assert detector.update(broadcast(), 1000, 0) is None
    # 긴 관측 공백을 양성 지속 시간으로 합치지 않는지 확인
    assert detector.update(broadcast(), 5000, 0) is None

# 이동 문구의 고정 방송 표시 오인 방지 확인
def test_moving_text_cannot_confirm_a_stable_broadcast_overlay():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 위치 변화 전 첫 양성 프레임의 보류 확인
    assert detector.update(broadcast(), 1000, 0) is None
    # 표시 위치가 달라지면 같은 양성 구간으로 합치지 않는지 확인
    assert detector.update(broadcast(origin=(135, 46)), 1500, 0) is None

# 해상도 변경 시 정규화된 글자 위치 보존 확인
def test_resolution_change_preserves_normalized_stable_glyph_positions():
    # 방송 표시가 시간적으로 유지되는지 확인할 인식기 생성
    detector = BroadcastCueRecognizer()
    # 해상도 변경 전 첫 양성 프레임의 보류 확인
    assert detector.update(broadcast(), 1000, 0) is None
    # 해상도만 달라진 동일 표시의 지속 관측 연결 확인
    assert detector.update(broadcast(scale=2), 1500, 0) is not None
