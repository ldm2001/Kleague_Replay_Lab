import json
from pathlib import Path
import cv2
import numpy as np
import pytest
from replay_video.infrastructure.context import frameContext
from replay_video.inspection import inspection

# 시험용 경기장 반환
def pitch():
    # 질감·선분 합성 경기장의 전역 이동 정답 제어
    rng = np.random.default_rng(17)
    # 시험 이미지를 지정 크기와 자료형의 시험 배열로 생성
    image = np.full((180, 320, 3), (35, 110, 35), dtype=np.uint8)
    # 카메라 이동을 추정할 특징점을 만들기 위한 약한 잡음 생성
    noise = rng.integers(0, 45, (180, 320), dtype=np.uint8)
    # 시험 이미지에 이번 실행분 누적
    image[:, :, 1] += noise
    # 경기장 수평선에 해당하는 밝은 선 배치
    cv2.line(image, (20, 120), (300, 120), (240, 240, 240), 3)
    # 경기장 수직선에 해당하는 밝은 선 배치
    cv2.line(image, (160, 20), (160, 160), (240, 240, 240), 3)
    # 시험 이미지를 호출자에게 반환
    return image

# 색상·선 측정의 화면 좌표 확인
def test_color_and_line_measurements_have_image_coordinates():
    # 화면의 경기장과 방송 배치 특성 측정
    result = frameContext(pitch())
    # 잔디가 화면 대부분을 차지하는지 확인
    assert result.grass_ratio > 0.8
    # 경기장 흰 선이 선분으로 검출되는지 확인
    assert result.line_segments
    # 카메라 수평 이동량이 비어 있는지 확인
    assert result.camera_dx is None
    # 이전 프레임이 없어 이동 비교를 못 했다는 사유 확인
    assert result.quality_reason == "NO_PREVIOUS_FRAME"
    # 영상 너비 · 영상 높이가 예상 계약과 일치하는지 확인
    assert (result.width, result.height) == (320, 180)

# 카메라 이동과 프레임 차이 분리 확인
def test_camera_pan_is_separated_from_frame_difference():
    # 카메라 이동 전 경기장 시험 화면 생성
    before = pitch()
    # 화면 전체를 오른쪽 여섯 화소와 아래쪽 세 화소 이동
    after = cv2.warpAffine(before, np.float32([[1, 0, 6], [0, 1, 3]]), (320, 180))
    # 화면의 경기장과 방송 배치 특성 측정
    result = frameContext(after, before)
    # 충분한 특징점으로 이동 보정 품질이 유효한지 확인
    assert result.quality_reason is None
    # 카메라 수평 이동량이 예상 계약과 일치하는지 확인
    assert result.camera_dx == pytest.approx(6, abs=0.7)
    # 추정 수직 이동량이 주입한 세 화소에 가까운지 확인
    assert result.camera_dy == pytest.approx(3, abs=0.7)
    # 카메라 이동 제거 뒤 남은 움직임이 작은지 확인
    assert result.residual_motion < 0.02

# 카메라 정렬 뒤 국소 변화 유지 확인
def test_local_change_remains_after_camera_alignment():
    # 물체 이동과 카메라 이동을 구별할 기준 화면 생성
    before = pitch()
    # 원본을 보존한 채 물체를 추가할 화면 복사
    after = before.copy()
    # 화면 일부에 밝은 사각형을 추가하여 국소 움직임 재현
    cv2.rectangle(after, (180, 20), (235, 80), (230, 230, 230), -1)
    # 화면의 경기장과 방송 배치 특성 측정
    result = frameContext(after, before)
    # 국소 변화가 있어도 카메라 추정 품질은 유효한지 확인
    assert result.quality_reason is None
    # 전체 이동 보정 뒤에도 국소 변화가 잔차로 남는지 확인
    assert result.residual_motion > 0.02

# 특징 없는·비경기장 화면의 움직임 없음 대신 미확인 처리 확인
def test_textureless_and_nonfield_images_are_unknown_not_zero_motion():
    # 추적 특징점이 없는 단색 잔디 화면 생성
    flat = np.full((180, 320, 3), (35, 110, 35), dtype=np.uint8)
    # 화면의 경기장과 방송 배치 특성 측정
    result = frameContext(flat, flat)
    # 카메라 수평 이동량이 비어 있는지 확인
    assert result.camera_dx is None
    # 특징점이 부족할 때 잔차 움직임도 미확인으로 남는지 확인
    assert result.residual_motion is None
    # 특징점 부족을 실패 사유로 구분하는지 확인
    assert result.quality_reason == "INSUFFICIENT_FEATURES"
    # 잔디가 전혀 없는 어두운 비교 화면 생성
    dark = np.zeros_like(flat)
    # 잔디 부족 상태를 별도 사유로 구별하는지 확인
    assert frameContext(dark, flat).quality_reason == "LOW_GRASS_COVERAGE"

# 일관된 크기 조정과 잘못된 프레임 거부 확인
def test_resizes_consistently_and_rejects_invalid_frames():
    # 원본 크기가 큰 영상의 내부 축소 경로를 시험할 화면 생성
    large = cv2.resize(pitch(), (1280, 720))
    # 영상 너비가 640과 일치하는지 확인
    assert frameContext(large).width == 640
    # 일관된 크기 조정과 잘못된 프레임 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError, match="invalid-context-frame"):
        # 화면의 경기장과 방송 배치 특성 측정
        frameContext(np.zeros((10, 10), dtype=np.uint8))

# 의미 추정 없는 원시 영상 신호 기록 확인
def test_diagnostic_video_records_raw_signals_without_semantic_invention(tmp_path: Path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "fixture.mp4"
    # 샷 전환을 포함한 합성 영상 인코더 생성
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (320, 180))
    # 시험 영상 인코더를 사용할 수 있는지 확인
    assert writer.isOpened()
    # 프레임 작성 후 인코더 해제를 보장하는 범위 시작
    try:
        # 첫 장면의 경기장 화면을 열 프레임 유지
        for _ in range(10):
            # 잔디와 선이 있는 화면을 영상에 기록
            writer.write(pitch())
        # 두 번째 장면의 다른 배경을 열 프레임 유지
        for _ in range(10):
            # 뚜렷한 화면 전환을 만들 단색 프레임 기록
            writer.write(np.full((180, 320, 3), (180, 40, 40), dtype=np.uint8))
    finally:
        # 시험 영상 인코더가 점유한 자원 해제
        writer.release()
    # 실제 영상 디코딩으로 화면 진단 보고서 생성
    report = inspection(source, tmp_path / "output")
    # 저장된 문자열을 구조화된 자료로 읽음
    summary = json.loads(report.read_text())
    # 보고서와 함께 저장한 프레임 관측 기록 읽음
    samples = [
        json.loads(line) for line in (report.parent / "context.jsonl").read_text().splitlines()
    ]
    # 표본 수가 20과 일치하는지 확인
    assert summary["sample_count"] == 20
    # 세트피스 관측 상태가 예상 계약과 일치하는지 확인
    assert summary["set_piece_status"] == "UNKNOWN"
    # 처리 범위 상태가 예상 계약과 일치하는지 확인
    assert summary["coverage_status"] == "MATCHES_METADATA"
    # 배경 전환 위치에서 화면 전환 후보가 생기는지 확인
    assert any(sample["cut_candidate"] for sample in samples)
    # 화면 품질과 원본 시각에 관한 진단 필드가 보존되는지 확인
    assert all(
        sample["dead_ball"] is None and sample["ball_position"] is None for sample in samples
    )
    # 화면 전환 경계를 카메라 이동량으로 해석하지 않는지 확인
    assert all(sample["camera_dx"] is None for sample in samples if sample["cut_candidate"])
    # 원본 시각 목록이 예상 계약과 일치하는지 확인
    assert [sample["timestamp_ms"] for sample in samples] == sorted(
        set(sample["timestamp_ms"] for sample in samples)
    )
    # 의미 추정 없는 원시 영상 신호 기록을 위한 예상 예외 확인
    with pytest.raises(FileExistsError):
        # 기존 출력이 있는 디렉터리로 진단을 재실행하여 덮어쓰기 거부 확인
        inspection(source, report.parent)

# 디코딩 프레임의 방송 단서 진단 추출 확인
def test_diagnostic_extracts_broadcast_cue_from_decoded_frames(tmp_path: Path):
    # 시험 이미지를 지정 크기와 자료형의 시험 배열로 생성
    image = np.full((540, 960, 3), (45, 112, 48), dtype=np.uint8)
    # 방송 득점 표시의 주 배경 띠 생성
    cv2.rectangle(image, (29, 22), (260, 50), (125, 53, 9), -1)
    # 점수 영역의 강조색 상자 생성
    cv2.rectangle(image, (190, 22), (260, 50), (20, 12, 175), -1)
    # 득점 표시의 아래쪽 보조 띠 생성
    cv2.rectangle(image, (29, 51), (260, 68), (83, 20, 18), -1)
    # 고정 글리프와 비교할 득점 글자 배치
    cv2.putText(
        image, "GOAL", (88, 46), cv2.FONT_HERSHEY_DUPLEX, 0.9, (250, 250, 250), 2, cv2.LINE_AA
    )
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "goal.mp4"
    # 방송 표시가 지속되는 시험 영상 인코더 생성
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 15.0, (960, 540))
    # 방송 시험용 영상 인코더가 열리는지 확인
    assert writer.isOpened()
    # 방송 시험 프레임 작성 후 인코더 해제를 보장하는 범위 시작
    try:
        # 방송 표시를 스무 프레임 연속 유지
        for _ in range(20):
            # 득점 표시 화면을 영상에 기록
            writer.write(image)
    finally:
        # 시험 영상 인코더가 점유한 자원 해제
        writer.release()
    # 합성 방송 영상에서 시간적으로 지속되는 표시 진단
    report = inspection(source, tmp_path / "output")
    # 저장된 문자열을 구조화된 자료로 읽음
    summary = json.loads(report.read_text())
    # 방송 표시 단서 목록의 개수가 1과 일치하는지 확인
    assert len(summary.get("broadcast_cues", [])) == 1
    # 종류가 예상 계약과 일치하는지 확인
    assert summary["broadcast_cues"][0]["kind"] == "GOAL_GRAPHIC"
    # 득점 단서가 최소 300밀리초 이상 지속되는지 확인
    assert summary["broadcast_cues"][0]["endMs"] - summary["broadcast_cues"][0]["startMs"] >= 300
    # 방송 진단의 프레임별 관측 기록 읽음
    samples = [
        json.loads(line) for line in (report.parent / "context.jsonl").read_text().splitlines()
    ]
    # 방송 단서가 확정 득점 판정으로 승격되지 않는지 확인
    assert all(
        sample["dead_ball"] is None and sample["ball_restarted"] is None for sample in samples
    )
