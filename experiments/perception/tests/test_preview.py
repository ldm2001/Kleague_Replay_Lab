# 형식 주석의 지연 해석 사용
from __future__ import annotations
# 기록 직렬화와 읽기 도구 읽음
import json
# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 영상 변환과 그림 표시 도구 읽음
import cv2
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.media import VideoSample
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.preview import preview
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.report import ReportWriter

# 표본 생성
def sample(index: int, *, width: int = 2000, height: int = 1000) -> VideoSample:
    # 관측 조건을 주입할 영 배열 생성
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    # 원본 표시 시각과 픽셀을 가진 표본 반환
    return VideoSample(
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

# 메타데이터 생성
def metadata(source):
    # 메타데이터 결과 반환
    return {
        # 원본 입력의 시험값 지정
        "source": {"path": str(source), "sha256": "1" * 64, "sizeBytes": 5},
        # 모의 모델의 시험값 지정
        "model": {"id": "PekingU/rtdetr_r18vd"},
        # 시간축 추적기의 시험값 지정
        "tracker": {"name": "ByteTrackTracker"},
        # 실행 설정의 시험값 지정
        "settings": {"intervalMs": 500},
    }

# 선언된 배율·원본 주석을 갖춘 실제 이미지 출력 확인
def test_renderer_outputs_real_jpeg_with_declared_scaling_and_source_annotations():
    # 원본 시간축을 가진 표본 생성
    frame = sample(0)
    # 상자와 점수를 가진 원시 검출 생성
    detection = Detection(0, "sports ball", (1000, 400, 1500, 800), 0.88, "0:sports ball:2")

    # 시험 관측을 그린 미리보기 생성
    jpeg, record = preview(frame, (detection,), max_width=1280)
    # 압축에서 복원한 미리보기 영상 생성
    raster = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)

    # 압축 미리보기 바이트의 선택 항목의 기대 자료 일치 확인
    assert jpeg[:2] == b"\xff\xd8"
    # 배열 차원 값이 640 · 1280 · 3인지 확인
    assert raster.shape == (640, 1280, 3)
    # 직렬화 기록의 기대 자료 일치 확인
    assert record == {
        # 디코딩 프레임 순번의 10 시험값 지정
        "decodedIndex": 10,
        # 영상 스트림 순번의 기대값 지정
        "streamIndex": 1,
        # 원본 표시 시각의 3000 시험값 지정
        "pts": 3000,
        # 원본 시간 단위의 시험값 지정
        "timeBase": {"numerator": 1, "denominator": 1000},
        # 원본 시작 표시 시각의 3000 시험값 지정
        "originPts": 3000,
        # 시간 분수의 분모의 기대값 지정
        "originTimeBase": {"numerator": 1, "denominator": 1000},
        # 밀리초 원본 시각의 0 시험값 지정
        "timestampMs": 0,
        # 원본 시각 산출 근거의 기대값 지정
        "timestampSource": "DECODER_PTS",
        # 원본 영상 너비의 2000 시험값 지정
        "sourceWidth": 2000,
        # 원본 영상 높이의 1000 시험값 지정
        "sourceHeight": 1000,
        # 출력 영상 너비의 1280 시험값 지정
        "outputWidth": 1280,
        # 출력 영상 높이의 640 시험값 지정
        "outputHeight": 640,
        # 출력 영상 배율의 시험값 지정
        "outputScale": {"x": 0.64, "y": 0.64},
        # 주석 좌표 기준의 시험값 지정
        "annotationCoordinateSpace": "SOURCE_XYXY_PIXELS",
    }
    # 주석 크기 조정 후 원본 가로 좌표 1000의 상자 경계를 640 부근에 배치
    edge_patch = raster[250:520, 636:645]
    # 상자 가장자리 영역에 밝은 표시선이 그려졌는지 확인
    assert int(edge_patch.max()) > 100

# 미추적 주석의 프레임별 검출 식별자 포함 확인
def test_untracked_annotation_includes_frame_local_detection_id(monkeypatch):
    # 허용 분류명 목록의 빈 누적 공간 생성
    labels = []
    # 교체 전 글자 그리기 함수 준비
    original_put_text = cv2.putText

    # 출력 문자 기록
    def capture_text(image, text, *args, **kwargs):
        # 허용 분류명 목록에 현재 관측 추가
        labels.append(text)
        # 기존 함수로 그린 시험 문자열 반환
        return original_put_text(image, text, *args, **kwargs)

    # 미추적 주석의 프레임별 검출 식별자 포함 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "putText", capture_text)
    # 상자와 점수를 가진 원시 검출 생성
    detection = Detection(17, "sports ball", (40, 40, 80, 80), 0.88)

    # 시험 관측을 그린 미리보기 실행
    preview(sample(0, width=160, height=90), (detection,))

    # 허용 분류명 목록에 지정한 항목 포함 확인
    assert "d17 sports ball 0.88" in labels

# 오른쪽 경계 주석의 전체 라벨 원본 프레임 내부 이동 확인
def test_right_edge_annotation_shifts_full_label_inside_source_frame(monkeypatch):
    # 글자 배치 위치의 빈 누적 공간 생성
    placements = []
    # 교체 전 글자 그리기 함수 준비
    original_put_text = cv2.putText

    # 주석 배치 기록
    def capture_placement(
        image, text, origin, font_face, font_scale, color, thickness, *args, **kwargs
    ):
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

    # 오른쪽 경계 주석의 전체 라벨 원본 프레임 내부 이동 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "putText", capture_placement)
    # 상자와 점수를 가진 원시 검출 생성
    detection = Detection(17, "sports ball", (620, 100, 638, 130), 0.88, "0:sports ball:137")

    # 시험 관측을 그린 미리보기 실행
    preview(sample(0, width=640, height=360), (detection,))

    # 조건에 맞는 다음 항목 생성
    text, origin, font_face, font_scale, thickness = next(
        placement for placement in placements if placement[0].startswith("d17 ")
    )
    # 화면 글자 크기와 기준선 생성
    (text_width, _), _ = cv2.getTextSize(text, font_face, font_scale, thickness)
    # 글자 시작 가로 좌표가 화면 왼쪽 밖으로 벗어나지 않음 확인
    assert origin[0] >= 0
    # 글자 오른쪽 끝이 영상 너비 640 이내인지 확인
    assert origin[0] + text_width <= 640

# 개수 제한과 첫·마지막 프레임을 포함한 미리보기 선택 확인
def test_preview_selection_is_bounded_and_spans_first_to_last_frame(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
    with ReportWriter(output, **metadata(source), max_previews=4) as writer:
        # 반복할 순번 범위의 항목별 순회
        for index in range(101):
            # 보고서 기록기에 현재 관측 추가
            writer.append(
                sample(index, width=160, height=90), (), continuity_id=0, inference_seconds=0.001
            )
        # 종료 시점까지 정리한 관측 결과 생성
        summary = writer.finish(
            # 원본 표본 수의 101 시험값 지정
            "COMPLETE", video={"sampleCount": 101}, timings={"totalSeconds": 1.0}
        )

    # 미리보기 목록 준비
    previews = summary["previews"]
    # 미리보기 개수가 설정한 최대 4개 이내인지 확인
    assert len(previews) <= 4
    # 밀리초 원본 시각 값이 0인지 확인
    assert previews[0]["timestampMs"] == 0
    # 밀리초 원본 시각 값이 100000인지 확인
    assert previews[-1]["timestampMs"] == 100_000
    # 처음과 마지막 사이의 중간 시각 미리보기 존재 확인
    assert any(0 < preview["timestampMs"] < 100_000 for preview in previews)
    # 미리보기 목록의 항목별 순회
    for preview in previews:
        # 시험 파일 경로 생성
        relative = Path(preview["path"])
        # 미리보기 경로가 절대 경로가 아닌 상대 경로임을 확인
        assert not relative.is_absolute()
        # 미리보기 상대 경로의 첫 구성요소가 프레임 저장 폴더인지 확인
        assert relative.parts[0] == "frames"
        # 그림 배열 준비
        raster = cv2.imread(str(output / relative))
        # 그림 배열 존재 확인
        assert raster is not None
        # 배열 차원의 선택 항목의 기대 자료 일치 확인
        assert raster.shape[1] == preview["outputWidth"]
        # 배열 차원의 첫 항목의 기대 자료 일치 확인
        assert raster.shape[0] == preview["outputHeight"]
    # 조건에 맞는 출력 파일 목록의 비교 자료 생성
    disk_previews = list((output / "frames").glob("*.jpg"))
    # 디스크에 기록한 미리보기의 개수의 기대 자료 일치 확인
    assert len(disk_previews) == len(previews)
    # 미리보기 목록의 기대 자료 일치 확인
    assert json.loads((output / "summary.json").read_text(encoding="utf-8"))["previews"] == previews

# 동시 생성 미리보기의 덮어쓰기 방지 확인
def test_concurrently_created_preview_is_not_overwritten(tmp_path):
    # 원본 입력 준비
    source = tmp_path / "source.mp4"
    # 원본 입력에 시험 바이트 기록
    source.write_bytes(b"video")
    # 출력 자료 준비
    output = tmp_path / "run"

    # 원본 검출을 보존할 보고서 기록기의 사용 구간 시작
    with ReportWriter(output, **metadata(source), max_previews=2) as writer:
        # 보고서 기록기에 현재 관측 추가
        writer.append(sample(0, width=160, height=90), (), continuity_id=0, inference_seconds=0.001)
        # 기존 파일 충돌 경로 준비
        collision = output / "frames" / "preview-0000-frame-00000000.jpg"
        # 기존 파일 충돌 경로에 시험 바이트 기록
        collision.write_bytes(b"existing-child")
        # 동시 생성 미리보기의 덮어쓰기 방지의 실패 가능 구간 처리
        try:
            # 보고서 기록기의 종료 상태 기록
            writer.finish("COMPLETE", video={}, timings={})
        except FileExistsError:
            # 추가 동작 없는 모의 구현 유지
            pass
        else:
            # 동시 생성 미리보기의 덮어쓰기 방지의 예외 상황 재현
            raise AssertionError("exclusive preview creation was not enforced")

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert collision.read_bytes() == b"existing-child"
