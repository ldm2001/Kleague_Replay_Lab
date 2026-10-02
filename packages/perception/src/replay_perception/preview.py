# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 색상과 선분 및 미리보기를 다룰 영상 처리 도구 읽음
import cv2
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 영상 읽기 관련 함수와 자료형 읽음
from .media import VideoSample
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection


# 색상 목록을 다음 항목으로 구성
_COLORS = {
    # 사람 필드 기록
    "person": (45, 220, 255),
    # 경기용 공 필드 기록
    "sports ball": (255, 175, 55),
}

# 미리보기와 원본 사이의 시각·좌표 대응 정보를 기록
def previewRecord(frame: VideoSample, output_width: int, output_height: int) -> dict[str, Any]:
    # 프레임 기록에 저장용 관측 기록 저장
    frame_record = frame.as_record()
    # 원본 너비에 프레임 기록의 너비 저장
    source_width = frame_record["width"]
    # 원본 높이에 프레임 기록의 높이 저장
    source_height = frame_record["height"]
    # 필드별로 묶은 기록 반환
    return {
        # 복호화된 순번 필드 기록
        "decodedIndex": frame_record["decodedIndex"],
        # 스트림 순번 필드 기록
        "streamIndex": frame_record["streamIndex"],
        # 원본 표시 시각 눈금 필드 기록
        "pts": frame_record["pts"],
        # 시간 기준 필드 기록
        "timeBase": frame_record["timeBase"],
        # 시작점 표시 시각 눈금 필드 기록
        "originPts": frame_record["originPts"],
        # 시작점 시간 기준 필드 기록
        "originTimeBase": frame_record["originTimeBase"],
        # 시각 밀리초 필드 기록
        "timestampMs": frame_record["timestampMs"],
        # 시각 원본 필드 기록
        "timestampSource": frame_record["timestampSource"],
        # 원본 너비 필드 기록
        "sourceWidth": source_width,
        # 원본 높이 필드 기록
        "sourceHeight": source_height,
        # 출력 너비 필드 기록
        "outputWidth": output_width,
        # 출력 높이 필드 기록
        "outputHeight": output_height,
        # 출력 배율 필드 기록
        "outputScale": {
            # 가로 좌표 필드 기록
            "x": output_width / source_width,
            # 세로 좌표 필드 기록
            "y": output_height / source_height,
        },
        # 표시 좌표 기준 공간 필드 기록
        "annotationCoordinateSpace": "SOURCE_XYXY_PIXELS",
    }

# 관측 미리보기 생성
def preview(
    frame: VideoSample,
    detections: tuple[Detection, ...],
    *,
    max_width: int = 1280,
) -> tuple[bytes, dict[str, Any]]:
    """축구 의미 주장 없는 모델 관측 표시"""
    # 미리보기 최댓값 너비의 자료 형식과 허용 조건 확인
    if type(max_width) is not int or max_width <= 0:
        # 미리보기 최댓값 너비 유효하지 않음 오류 알림
        raise ValueError("PREVIEW_MAX_WIDTH_INVALID")
    # 미리보기 삼원색 영상의 자료 형식과 허용 조건 확인
    if (
        not isinstance(frame.rgb, np.ndarray)
        or frame.rgb.dtype != np.uint8
        or frame.rgb.ndim != 3
        or frame.rgb.shape[2] != 3
    ):
        # 미리보기 삼원색 영상 유효하지 않음 오류 알림
        raise ValueError("PREVIEW_RGB_INVALID")
    # 높이·너비에 삼원색 영상의 배열 크기의 선택 항목 저장
    height, width = frame.rgb.shape[:2]
    # 미리보기 삼원색 영상의 자료 형식과 허용 조건 확인
    if width <= 0 or height <= 0:
        # 미리보기 삼원색 영상 유효하지 않음 오류 알림
        raise ValueError("PREVIEW_RGB_INVALID")

    # 표시를 덧붙인 영상에 원본을 건드리지 않을 사본 저장
    annotated = frame.rgb.copy()
    # 상단 안내 높이에 높이의 최솟값 저장
    banner_height = min(height, 36)
    # 미리보기 영상에 검출 상자 또는 안내 배경 표시
    cv2.rectangle(annotated, (0, 0), (width - 1, banner_height - 1), (15, 15, 15), thickness=-1)
    # 상단 안내에 현재 값을 포함한 문자열 저장
    banner = f"MODEL DETECTIONS | t={frame.timestamp_ms}ms | ROLE UNPROVEN"
    # 미리보기 영상에 관측값과 상태 안내 표시
    cv2.putText(
        annotated,
        banner,
        (8, min(25, banner_height - 6)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        (245, 245, 245),
        1,
        cv2.LINE_AA,
    )

    # 검출 목록에서 검출을 하나씩 읽음
    for detection in detections:
        # 미리보기 검출의 자료 형식과 허용 조건 확인
        if not isinstance(detection, Detection):
            # 미리보기 검출 유효하지 않음 오류 알림
            raise TypeError("PREVIEW_DETECTION_INVALID")
        # 여러 값을 순서대로 모은 자료에 검출의 원본 화면의 시작점과 끝점 상자 좌표의 항목별 변환 결과 저장
        x1, y1, x2, y2 = (round(value) for value in detection.box)
        # 색상에 색상 목록의 선택 항목 저장
        color = _COLORS[detection.label]
        # 미리보기 영상에 검출 상자 또는 안내 배경 표시
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, thickness=3)
        # 레이블에 현재 값을 포함한 문자열 저장
        label = f"d{detection.detection_id} {detection.label} {detection.score:.2f}"
        # 검출의 구간 안에서만 유효한 추적 식별자가 있는지 확인
        if detection.track_id is not None:
            # 레이블에 현재 값을 포함한 문자열을 더해 누적
            label += f" | track={detection.track_id}"
        # 문자열 세로에 상단 안내 높이 및 16의 합의 최댓값 저장
        text_y = max(banner_height + 16, y1 - 7)
        # 글꼴 글꼴 종류에 영상 처리 도구의 글꼴 기본 벡터 글꼴 기본 서체 저장
        font_face = cv2.FONT_HERSHEY_SIMPLEX
        # 글꼴 배율을 0점52 값으로 설정
        font_scale = 0.52
        # 선 두께를 1 값으로 설정
        thickness = 1
        # 사용 가능한 너비에 1의 최댓값 저장
        available_width = max(1, width - 8)
        # 문자열 너비·사용하지 않는 값·사용하지 않는 값에 글자를 그릴 너비와 높이 및 기준선 저장
        (text_width, _), _ = cv2.getTextSize(label, font_face, font_scale, thickness)
        # 문자열 너비 및 사용 가능한 너비의 초과 조건 확인
        if text_width > available_width:
            # 글꼴 배율에 사용 가능한 너비 및 문자열 너비의 비율을 배로 조정
            font_scale *= available_width / text_width
            # 문자열 너비·사용하지 않는 값·사용하지 않는 값에 글자를 그릴 너비와 높이 및 기준선 저장
            (text_width, _), _ = cv2.getTextSize(label, font_face, font_scale, thickness)
        # 문자열 가로에 4의 최댓값의 최솟값 저장
        text_x = min(max(4, x1), max(0, width - text_width - 4))
        # 미리보기 영상에 관측값과 상태 안내 표시
        cv2.putText(
            annotated,
            label,
            (text_x, min(height - 4, text_y)),
            font_face,
            font_scale,
            color,
            thickness,
            cv2.LINE_AA,
        )

    # 너비 및 최댓값 너비의 초과 조건 확인
    if width > max_width:
        # 출력 너비에 최댓값 너비 저장
        output_width = max_width
        # 출력 높이에 1의 최댓값 저장
        output_height = max(1, round(height * max_width / width))
        # 표시를 덧붙인 영상에 지정 크기로 조정한 영상 저장
        annotated = cv2.resize(
            annotated, (output_width, output_height), interpolation=cv2.INTER_AREA
        )
    # 앞선 분기에 해당하지 않는 경우 처리
    else:
        # 출력 너비·출력 높이를 다음 항목으로 구성
        output_width, output_height = width, height

    # 역순 삼원색 영상에 색상 표현을 변환한 영상 저장
    bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    # 인코딩 성공 여부·메모리 버퍼에 이미지 압축 성공 여부와 결과 바이트 저장
    encoded, buffer = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    # 인코딩 성공 여부가 비어 있거나 조건을 충족하지 않는지 확인
    if not encoded:
        # 미리보기 압축 이미지 인코딩 실패 오류 알림
        raise ValueError("PREVIEW_JPEG_ENCODE_FAILED")
    # 바이트 자료·미리보기 기록 처리 결과 반환
    return buffer.tobytes(), previewRecord(frame, output_width, output_height)
