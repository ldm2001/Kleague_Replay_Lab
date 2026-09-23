# 형식 주석의 지연 해석 사용
from __future__ import annotations
# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 영상 변환과 그림 표시 도구 읽음
import cv2
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.media import VideoSample
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.overlay import preview
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import KEYPOINT_NAMES, Keypoint, PoseObservation, RoleHypothesis
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.frames import RecordedFrame

# 프레임 생성
def _frame(index: int = 0, *, width: int = 200, height: int = 120) -> RecordedFrame:
    # 관측 조건을 주입할 영 배열 생성
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    # 원본 표시 시각과 픽셀을 가진 표본 생성
    sample = VideoSample(
        decoded_index=10 + index,
        stream_index=1,
        # 원본 표시 시각의 호출 조건 지정
        pts=3000 + index * 1000,
        # 원본 시간 단위의 호출 조건 지정
        time_base=Fraction(1, 1000),
        # 원본 시작 시각의 호출 조건 지정
        origin_pts=3000,
        origin_time_base=Fraction(1, 1000),
        # 밀리초 원본 시각의 호출 조건 지정
        timestamp_ms=index * 1000,
        # 색상 영상 배열의 호출 조건 지정
        rgb=rgb,
    )
    # 원본 표본과 검출을 묶은 기록 프레임 반환
    return RecordedFrame(
        sample,
        (Detection(7, "person", (40, 45, 185, 116), 0.9, "0:person:long-fragment"),),
        # 화면 연속성 식별자의 호출 조건 지정
        continuity_id=2,
        record_index=20 + index,
    )

# 자세 관측 생성
def _pose() -> PoseObservation:
    # 좌표 배열의 조건별 항목 수집
    coordinates = {index: (80.0 + index, 75.0 + index) for index in range(17)}
    # 좌표 배열에 현재 입력 반영
    coordinates.update({5: (65.0, 75.0), 6: (175.0, 105.0), 7: (65.0, 60.0), 9: (65.0, 47.0)})
    # 좌표와 점수를 가진 단일 관절 목록의 비교 자료 생성
    points = tuple(
        Keypoint(index, name, *coordinates[index], 0.1 if index == 6 else 0.9)
        for index, name in enumerate(KEYPOINT_NAMES)
    )
    # 원본 상자와 관절 좌표를 가진 자세 관측 반환
    return PoseObservation(7, (40, 45, 185, 116), points, ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)))

# 정확한 원본 시각·배율·좌표 주석을 갖춘 실제 이미지 출력 확인
def test_renderer_outputs_real_jpeg_with_exact_pts_scale_and_source_space_overlay():
    # 시험 시각의 프레임 생성
    frame = _frame(width=2000, height=1000)
    # 변경 전 상태를 보존한 복사본 생성
    original = frame.sample.rgb.copy()
    # 원시 검출과 분리된 역할 가설 생성
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)

    # 시험 관측을 그린 미리보기 생성
    jpeg, record = preview(
        frame,
        (),
        (role,),
        (),
        ({"detectionId": 7, "side": "LEFT", "state": "ARM_RAISED"},),
        max_width=1280,
    )
    # 압축에서 복원한 미리보기 영상 생성
    raster = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)

    # 압축 미리보기 바이트의 선택 항목의 기대 자료 일치 확인
    assert jpeg[:2] == b"\xff\xd8"
    # 배열 차원 값이 640 · 1280 · 3인지 확인
    assert raster.shape == (640, 1280, 3)
    # 원본 표시 시각 값이 3000인지 확인
    assert record["pts"] == 3000
    # 원본 시간 단위의 기대 자료 일치 확인
    assert record["timeBase"] == {"numerator": 1, "denominator": 1000}
    # 원본 시작 표시 시각 값이 3000인지 확인
    assert record["originPts"] == 3000
    # 상위 실행의 기록 순번 값이 20인지 확인
    assert record["upstreamRecordIndex"] == 20
    # 원본 영상 너비 값이 2000인지 확인
    assert record["sourceWidth"] == 2000
    # 원본 영상 높이 값이 1000인지 확인
    assert record["sourceHeight"] == 1000
    # 출력 영상 너비 값이 1280인지 확인
    assert record["outputWidth"] == 1280
    # 출력 영상 높이 값이 640인지 확인
    assert record["outputHeight"] == 640
    # 출력 영상 배율의 기대 자료 일치 확인
    assert record["outputScale"] == {"x": 0.64, "y": 0.64}
    # 주석 좌표 기준의 기대 자료 일치 확인
    assert record["annotationCoordinateSpace"] == "SOURCE_XYXY_PIXELS"
    # 배열 요소 완전 일치 여부의 조건 충족 확인
    assert np.array_equal(frame.sample.rgb, original)
    # 크기 조정 전 원본 가로 좌표 40에 그린 주석을 26 부근에 배치
    assert int(raster[25:90, 23:30].max()) > 50

# 배너의 역할·추적 조각·원시 팔 상태 명시 확인
def test_banner_role_label_track_fragment_and_raw_arm_state_are_explicit(monkeypatch):
    # 표시 문자열 목록의 빈 누적 공간 생성
    texts = []
    # 교체 전 글자 그리기 함수 준비
    original_put_text = cv2.putText

    # 호출 내용 기록
    def capture(image, text, *args, **kwargs):
        # 표시 문자열 목록에 현재 관측 추가
        texts.append(text)
        # 기존 함수로 그린 시험 문자열 반환
        return original_put_text(image, text, *args, **kwargs)

    # 배너의 역할·추적 조각·원시 팔 상태 명시 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "putText", capture)
    # 원시 검출과 분리된 역할 가설 생성
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)
    # 시험 관측을 그린 미리보기 실행
    preview(
        _frame(),
        (),
        (role,),
        (_pose(),),
        ({"detectionId": 7, "side": "LEFT", "state": "ARM_RAISED"},),
    )

    # 미리보기에 관측 가설의 미채택 안내가 표시됐는지 확인
    assert any(text.startswith("NOT ADMITTED | ROLE/POSE HYPOTHESES") for text in texts)
    # 검출 식별자와 심판 역할 가설 및 추적 조각 정보의 동시 표시 확인
    assert any(
        "d7" in text and "hyp:referee" in text and "track-fragment=" in text for text in texts
    )
    # 가설임을 숨긴 단독 심판 역할 문구의 미표시 확인
    assert not any(text.strip() == "referee" for text in texts)
    # 원시 왼팔 들기 관측 문구의 표시 확인
    assert any("raw-arm LEFT=ARM_RAISED" in text for text in texts)

# 관절 주석의 원본 좌표 사용과 저점수 점 억제 확인
def test_joint_overlay_uses_source_coordinates_and_suppresses_low_score_points():
    # 시험 시각의 프레임 생성
    frame = _frame()
    # 변경 전 상태를 보존한 복사본 생성
    original = frame.sample.rgb.copy()
    # 시험 관측을 그린 미리보기 생성
    jpeg, _ = preview(frame, (), (), (_pose(),), ())
    # 압축에서 복원한 미리보기 영상 생성
    raster = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)

    # 원본 가로 65 세로 75의 고점수 왼쪽 어깨 표시
    assert int(raster[70:81, 60:71].max()) > 50
    # 원본 가로 175 세로 105의 저점수 오른쪽 어깨는 이미지 대신 행 메타데이터에만 보존
    assert int(raster[101:110, 171:180].max()) < 50
    # 배열 요소 완전 일치 여부의 조건 충족 확인
    assert np.array_equal(frame.sample.rgb, original)

# 유한한 화면 밖 관절점의 실패 대신 메타데이터 보존 확인
def test_finite_out_of_image_keypoints_remain_metadata_not_preview_failures():
    # 시험용 자세 관측 생성
    pose = _pose()
    # 관절 좌표와 점수의 비교 자료 생성
    points = list(pose.keypoints)
    # 좌표와 점수를 가진 단일 관절 생성
    points[5] = Keypoint(5, KEYPOINT_NAMES[5], 1e300, -1e300, 0.9)
    # 원본 상자와 관절 좌표를 가진 자세 관측 생성
    outside = PoseObservation(
        pose.detection_id,
        pose.source_box,
        tuple(points),
        pose.source_to_input,
    )

    # 시험 관측을 그린 미리보기 생성
    jpeg, _ = preview(_frame(), (), (), (outside,), ())

    # 압축 미리보기 바이트의 선택 항목의 기대 자료 일치 확인
    assert jpeg[:2] == b"\xff\xd8"
    # 가로 좌표 값이 1의 지수 +300인지 확인
    assert outside.as_record()["keypoints"][5]["x"] == 1e300

# 오른쪽 경계 역할 라벨의 측정·제한 확인
def test_right_edge_role_label_is_measured_and_clamped(monkeypatch):
    # 글자 배치 위치의 빈 누적 공간 생성
    placements = []
    # 교체 전 글자 그리기 함수 준비
    original_put_text = cv2.putText

    # 호출 내용 기록
    def capture(image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs):
        # 글자 배치 위치에 현재 관측 추가
        placements.append((text, origin, font_face, font_scale, thickness))
        # 기존 함수로 그린 시험 문자열 반환
        return original_put_text(
            image,
            text,
            origin,
            font_face,
            font_scale,
            color,
            thickness,
            *args,
            **kwargs,
        )

    # 오른쪽 경계 역할 라벨의 측정·제한 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "putText", capture)
    # 시험 시각의 프레임 생성
    frame = _frame(width=200, height=120)
    # 원시 검출과 분리된 역할 가설 생성
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)
    # 시험 관측을 그린 미리보기 실행
    preview(frame, (), (role,), (), ())

    # 조건에 맞는 다음 항목 생성
    text, origin, face, scale, thickness = next(
        item for item in placements if item[0].startswith("d7 ")
    )
    # 화면 글자 크기와 기준선 생성
    (text_width, _), _ = cv2.getTextSize(text, face, scale, thickness)
    # 글자 시작 가로 좌표가 화면 왼쪽 밖으로 벗어나지 않음 확인
    assert origin[0] >= 0
    # 글자 오른쪽 끝이 영상 너비 200 이내인지 확인
    assert origin[0] + text_width <= 200

# 작은 프레임 문자의 높이·기준선 맞춤 또는 생략 확인
def test_tiny_frame_text_is_fitted_with_glyph_height_and_baseline_or_skipped(monkeypatch):
    # 글자 배치 위치의 빈 누적 공간 생성
    placements = []
    # 교체 전 글자 그리기 함수 준비
    original_put_text = cv2.putText

    # 호출 내용 기록
    def capture(image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs):
        # 글자 배치 위치에 현재 관측 추가
        placements.append((text, origin, font_face, font_scale, thickness, image.shape[:2]))
        # 기존 함수로 그린 시험 문자열 반환
        return original_put_text(
            image,
            text,
            origin,
            font_face,
            font_scale,
            color,
            thickness,
            *args,
            **kwargs,
        )

    # 작은 프레임 문자의 높이·기준선 맞춤 또는 생략 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "putText", capture)
    # 시험 시각의 프레임 생성
    base = _frame(width=400, height=12)
    # 원본 표본과 검출을 묶은 기록 프레임 생성
    tiny = RecordedFrame(
        base.sample,
        (Detection(7, "person", (300, 1, 399, 11), 0.9, "0:person:tiny"),),
        base.continuity_id,
        base.record_index,
    )
    # 원시 검출과 분리된 역할 가설 생성
    role = RoleHypothesis(7, "MATCHED", "referee", 0.8, 2, 0.85)

    # 시험 관측을 그린 미리보기 실행
    preview(tiny, (), (role,), (), ())

    # 글자 배치 위치의 조건 충족 확인
    assert placements
    # 글자 배치 위치의 항목별 순회
    for text, (x, y), face, scale, thickness, (height, width) in placements:
        # 화면 글자 크기와 기준선 생성
        (text_width, text_height), baseline = cv2.getTextSize(text, face, scale, thickness)
        # 글자의 왼쪽과 오른쪽 끝이 영상 가로 범위 안인지 확인
        assert 0 <= x and x + text_width <= width
        # 글자 위쪽 끝이 영상 상단 밖으로 벗어나지 않음 확인
        assert 0 <= y - text_height
        # 글자 기준선 아래 여백까지 영상 높이 이내인지 확인
        assert y + baseline <= height

# 팔 미상승 잡음 생략과 유의미한 원시 팔 상태 보존 확인
def test_preview_omits_not_raised_clutter_but_keeps_actionable_raw_arm_states(monkeypatch):
    # 표시 문자열 목록의 빈 누적 공간 생성
    texts = []
    # 교체 전 글자 그리기 함수 준비
    original_put_text = cv2.putText

    # 호출 내용 기록
    def capture(image, text, *args, **kwargs):
        # 표시 문자열 목록에 현재 관측 추가
        texts.append(text)
        # 기존 함수로 그린 시험 문자열 반환
        return original_put_text(image, text, *args, **kwargs)

    # 팔 미상승 잡음 생략과 유의미한 원시 팔 상태 보존 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "putText", capture)
    # 시험 시각의 프레임 생성
    base = _frame()
    # 검출 목록 준비
    detections = base.detections + (
        # 사람 후보의 상자와 점수 지정
        Detection(9, "person", (5, 45, 35, 116), 0.8, "0:person:other"),
    )
    # 원본 표본과 검출을 묶은 기록 프레임 생성
    frame = RecordedFrame(base.sample, detections, base.continuity_id, base.record_index)
    # 팔 동작 관측의 시험 항목 구성
    arms = (
        {"detectionId": 7, "side": "LEFT", "state": "NOT_RAISED"},
        {"detectionId": 7, "side": "RIGHT", "state": "ARM_RAISED"},
        {"detectionId": 9, "side": "LEFT", "state": "UNOBSERVABLE"},
    )

    # 시험 관측을 그린 미리보기 실행
    preview(frame, (), (), (), arms)

    # 관측 불가인 팔을 들지 않은 상태로 잘못 표시하지 않음 확인
    assert not any("NOT_RAISED" in text for text in texts)
    # 오른팔 들기 관측 문구의 표시 확인
    assert any("RIGHT=ARM_RAISED" in text for text in texts)
    # 왼팔 관측 불가 문구의 표시 확인
    assert any("LEFT=UNOBSERVABLE" in text for text in texts)

# 24개 상한 내 첫·중간·마지막 미리보기 선택 확인
def test_preview_selection_is_bounded_at_24_and_spans_first_interior_last(tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.journal import ObservationReport

    # 원본 입력 준비
    source = tmp_path / "source"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"source")
    # 모델 메타데이터의 시험 항목 구성
    metadata = {
        # 원본 입력의 시험값 지정
        "source": {"path": str(source), "sha256": "a" * 64},
        # 상위 실행 기록의 시험값 지정
        "upstream": {"summarySha256": "b" * 64, "framesJsonlSha256": "c" * 64},
        # 모델 목록의 시험값 지정
        "models": {"role": {"id": "role"}, "pose": {"id": "pose"}},
        # 실행 설정의 시험값 지정
        "settings": {"fixture": True},
    }
    # 출력 자료 준비
    output = tmp_path / "previews"
    # 역할과 자세 관측을 저장할 보고서의 사용 구간 시작
    with ObservationReport(output, **metadata, max_previews=24) as report:
        # 반복할 순번 범위의 항목별 순회
        for index in range(101):
            # 관측 보고서에 현재 관측 추가
            report.append(_frame(index), (), (), (), (), (), {})
        # 종료 시점까지 정리한 관측 결과 생성
        summary = report.finish("COMPLETE", replay={"replayedFrameCount": 101}, timings={})

    # 미리보기 목록 준비
    previews = summary["previews"]
    # 미리보기 개수가 최대 24개 이내인지 확인
    assert len(previews) <= 24
    # 밀리초 원본 시각 값이 0인지 확인
    assert previews[0]["timestampMs"] == 0
    # 밀리초 원본 시각 값이 100000인지 확인
    assert previews[-1]["timestampMs"] == 100_000
    # 처음과 마지막 사이의 중간 시각 미리보기 존재 확인
    assert any(0 < item["timestampMs"] < 100_000 for item in previews)
    # 조건에 맞는 출력 파일 목록의 비교 자료의 개수의 기대 자료 일치 확인
    assert len(list((output / "frames").glob("*.jpg"))) == len(previews)
