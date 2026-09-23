# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest

# 연속성 처리기 생성
def continuity():
    # 연속성 처리기의 실패 가능 구간 처리
    try:
        # 화면 외형 변화 추적기 반환
        return importlib.import_module("replay_perception.continuity").AppearanceContinuity()
    except ModuleNotFoundError:
        # 연속성 처리기의 금지 경로 실행 실패 처리
        pytest.fail("The sampled appearance boundary is not implemented")

# 유사 화면의 맥락 유지와 큰 변화의 초기화 확인
def test_same_appearance_keeps_context_but_a_large_change_resets_it():
    # 화면 연속성 판단 결과 생성
    value = continuity()
    # 관측 조건을 주입할 영 배열 생성
    black = np.zeros((48, 64, 3), dtype=np.uint8)
    # 원본 크기로 채운 시험 배열 생성
    white = np.full_like(black, 255)
    # 현재 입력을 반영한 누적 관측 값이 0인지 확인
    assert value.update(black) == 0
    # 현재 입력을 반영한 누적 관측 값이 0인지 확인
    assert value.update(black) == 0
    # 현재 입력을 반영한 누적 관측 값이 1인지 확인
    assert value.update(white) == 1
    # 현재 입력을 반영한 누적 관측 값이 1인지 확인
    assert value.update(white) == 1
    # 큰 화면 변화로 기록한 연속성 경계가 하나인지 확인
    assert value.boundary_count == 1
    # 관측 방법의 기대 자료 일치 확인
    assert value.provenance["method"] == "sampled-appearance-delta-v1"

# 작은 밝기 변화의 화면 전환 오인 방지 확인
def test_small_brightness_change_does_not_claim_a_cut():
    # 화면 연속성 판단 결과 생성
    value = continuity()
    # 현재 입력을 반영한 누적 관측 값이 0인지 확인
    assert value.update(np.full((48, 64, 3), 100, dtype=np.uint8)) == 0
    # 현재 입력을 반영한 누적 관측 값이 0인지 확인
    assert value.update(np.full((48, 64, 3), 110, dtype=np.uint8)) == 0

# 색상 일치 시에도 원본 해상도 변경의 추적 초기화 확인
def test_source_resolution_change_resets_pixel_tracks_even_if_colours_match():
    # 화면 연속성 판단 결과 생성
    value = continuity()
    # 현재 입력을 반영한 누적 관측 값이 0인지 확인
    assert value.update(np.zeros((48, 64, 3), dtype=np.uint8)) == 0
    # 현재 입력을 반영한 누적 관측 값이 1인지 확인
    assert value.update(np.zeros((96, 128, 3), dtype=np.uint8)) == 1

# 잘못된 프레임의 맥락 변경 방지 확인
@pytest.mark.parametrize(
    "bad",
    [
        np.zeros((1, 1)),
        np.zeros((0, 5, 3), dtype=np.uint8),
        np.zeros((5, 5, 4), dtype=np.uint8),
        np.zeros((5, 5, 3), dtype=np.float32),
        None,
    ],
)
def test_invalid_frame_does_not_mutate_context(bad):
    # 화면 연속성 판단 결과 생성
    value = continuity()
    # 관측 조건을 주입할 영 배열 생성
    frame = np.zeros((48, 64, 3), dtype=np.uint8)
    # 현재 입력을 반영한 누적 관측 값이 0인지 확인
    assert value.update(frame) == 0
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="FRAME_INVALID"):
        # 검사 대상 자료에 현재 입력 반영
        value.update(bad)
    # 현재 입력을 반영한 누적 관측 값이 0인지 확인
    assert value.update(frame) == 0
