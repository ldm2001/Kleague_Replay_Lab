# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 입출력 자료형과 호출 규약 읽음
from typing import Any
# 색상과 선분 및 미리보기를 다룰 영상 처리 도구 읽음
import cv2
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 관측 목록 관련 함수와 자료형 읽음
from .observations import PoseObservation, RoleDetection, RoleHypothesis


# 원본 색상 목록을 다음 항목으로 구성
_SOURCE_COLORS = {
    # 사람 필드 기록
    "person": (45, 220, 255),
    # 경기용 공 필드 기록
    "sports ball": (255, 175, 55),
}
# 자세 색상을 다음 항목으로 구성
_POSE_COLOR = (100, 255, 120)
# 팔 색상을 다음 항목으로 구성
_ARM_COLOR = (255, 120, 220)
# 관절점 임계값을 0점5 값으로 설정
_KEYPOINT_THRESHOLD = 0.5
# 골격 연결을 다음 항목으로 구성
_BONES = (
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (6, 12),
    (11, 12),
)

# 미리보기와 원본 사이의 시각·좌표 대응 정보를 기록
def previewRecord(frame: Any, output_width: int, output_height: int) -> dict[str, Any]:
    # 표본에 저장용 관측 기록 저장
    sample = frame.sample.as_record()
    # 원본 너비에 표본의 너비 저장
    source_width = sample["width"]
    # 원본 높이에 표본의 높이 저장
    source_height = sample["height"]
    # 필드별로 묶은 기록 반환
    return {
        # 상위 단계 기록 순번 필드 기록
        "upstreamRecordIndex": frame.record_index,
        # 복호화된 순번 필드 기록
        "decodedIndex": sample["decodedIndex"],
        # 스트림 순번 필드 기록
        "streamIndex": sample["streamIndex"],
        # 원본 표시 시각 눈금 필드 기록
        "pts": sample["pts"],
        # 시간 기준 필드 기록
        "timeBase": sample["timeBase"],
        # 시작점 표시 시각 눈금 필드 기록
        "originPts": sample["originPts"],
        # 시작점 시간 기준 필드 기록
        "originTimeBase": sample["originTimeBase"],
        # 시각 밀리초 필드 기록
        "timestampMs": sample["timestampMs"],
        # 시각 원본 필드 기록
        "timestampSource": sample["timestampSource"],
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

# 글자가 영상 경계를 벗어나지 않도록 위치를 보정해 표시
def clampedText(
    image: np.ndarray,
    text: str,
    x: int,
    y: int,
    color: tuple[int, int, int],
    *,
    font_scale: float = 0.48,
    thickness: int = 1,
) -> None:
    # 높이·너비에 영상의 배열 크기의 선택 항목 저장
    height, width = image.shape[:2]
    # 글꼴 종류에 영상 처리 도구의 글꼴 기본 벡터 글꼴 기본 서체 저장
    face = cv2.FONT_HERSHEY_SIMPLEX
    # 사용 가능한 너비에 너비 및 4의 차이 저장
    available_width = width - 4
    # 사용 가능한 높이에 높이 및 2의 차이 저장
    available_height = height - 2
    # 사용 가능한 너비 및 0의 이하 조건 또는 사용 가능한 높이 및 0의 이하 조건 확인
    if available_width <= 0 or available_height <= 0:
        # 현재 함수의 처리 종료
        return
    # 문자열 너비·문자열 높이·글자 기준선에 글자를 그릴 너비와 높이 및 기준선 저장
    (text_width, text_height), baseline = cv2.getTextSize(text, face, font_scale, thickness)
    # 필요한 높이에 문자열 높이 및 글자 기준선의 합 저장
    required_height = text_height + baseline
    # 문자열 너비 및 0의 이하 조건 또는 필요한 높이 및 0의 이하 조건 확인
    if text_width <= 0 or required_height <= 0:
        # 현재 함수의 처리 종료
        return
    # 문자열 너비 및 사용 가능한 너비의 초과 조건 또는 필요한 높이 및 사용 가능한 높이의 초과 조건 확인
    if text_width > available_width or required_height > available_height:
        # 하한 배율을 0점05 값으로 설정
        minimum_scale = 0.05
        # 하한 너비·하한 높이·하한 글자 기준선에 글자를 그릴 너비와 높이 및 기준선 저장
        (minimum_width, minimum_height), minimum_baseline = cv2.getTextSize(
            text, face, minimum_scale, thickness
        )
        # 하한 너비 및 사용 가능한 너비의 초과 조건 또는 수치 연산 결과 및 사용 가능한 높이의 초과 조건 확인
        if minimum_width > available_width or minimum_height + minimum_baseline > available_height:
            # 현재 함수의 처리 종료
            return
        # 하한·상한을 다음 항목으로 구성
        low, high = minimum_scale, font_scale
        # 반복할 순번 범위에서 사용하지 않는 값을 하나씩 읽음
        for _ in range(24):
            # 후보에 하한 및 상한의 합 및 2의 비율 저장
            candidate = (low + high) / 2
            # 후보 너비·후보 높이·후보 글자 기준선에 글자를 그릴 너비와 높이 및 기준선 저장
            (candidate_width, candidate_height), candidate_baseline = cv2.getTextSize(
                text, face, candidate, thickness
            )
            # 후보 너비 및 사용 가능한 너비의 이하 조건 및 수치 연산 결과 및 사용 가능한 높이의 이하 조건 확인
            if (
                candidate_width <= available_width
                and candidate_height + candidate_baseline <= available_height
            ):
                # 하한에 후보 저장
                low = candidate
            # 앞선 분기에 해당하지 않는 경우 처리
            else:
                # 상한에 후보 저장
                high = candidate
        # 글꼴 배율에 하한 저장
        font_scale = low
        # 문자열 너비·문자열 높이·글자 기준선에 글자를 그릴 너비와 높이 및 기준선 저장
        (text_width, text_height), baseline = cv2.getTextSize(text, face, font_scale, thickness)
    # 문자열 가로에 2의 최댓값의 최솟값 저장
    text_x = min(max(2, x), width - text_width - 2)
    # 하한 글자 기준선 세로에 문자열 높이 저장
    minimum_baseline_y = text_height
    # 상한 글자 기준선 세로에 높이 및 글자 기준선의 차이 및 1의 차이 저장
    maximum_baseline_y = height - baseline - 1
    # 문자열 가로 및 0의 미만 조건 또는 하한 글자 기준선 세로 및 상한 글자 기준선 세로의 초과 조건 확인
    if text_x < 0 or minimum_baseline_y > maximum_baseline_y:
        # 현재 함수의 처리 종료
        return
    # 문자열 세로에 하한 글자 기준선 세로의 최댓값의 최솟값 저장
    text_y = min(max(minimum_baseline_y, y), maximum_baseline_y)
    # 미리보기 영상에 관측값과 상태 안내 표시
    cv2.putText(image, text, (text_x, text_y), face, font_scale, color, thickness, cv2.LINE_AA)

# 미리보기 영상에 유효한 관절과 골격 연결을 표시
def poseOverlay(image: np.ndarray, pose: PoseObservation) -> None:
    # 높이·너비에 영상의 배열 크기의 선택 항목 저장
    height, width = image.shape[:2]
    # 점 목록에 자세의 관절점 목록의 항목별 변환 결과 저장
    points = {point.index: point for point in pose.keypoints}
    # 사용 가능한에 키와 값의 쌍 목록에서 조건에 맞는 항목을 모은 값 저장
    usable = {
        index: point
        for index, point in points.items()
        if (point.score >= _KEYPOINT_THRESHOLD and 0 <= point.x < width and 0 <= point.y < height)
    }
    # 골격 연결에서 첫 번째·두 번째를 하나씩 읽음
    for first, second in _BONES:
        # 첫 번째 및 사용 가능한의 미포함 조건 또는 두 번째 및 사용 가능한의 미포함 조건 확인
        if first not in usable or second not in usable:
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 시작을 다음 항목으로 구성
        start = (round(usable[first].x), round(usable[first].y))
        # 종료를 다음 항목으로 구성
        end = (round(usable[second].x), round(usable[second].y))
        # 연결할 두 관절 또는 저장 기록을 지정 형식으로 반영
        cv2.line(image, start, end, _POSE_COLOR, thickness=2, lineType=cv2.LINE_AA)
    # 저장된 값 목록에서 점을 하나씩 읽음
    for point in usable.values():
        # 미리보기 영상에 관절 위치 표시
        cv2.circle(
            image,
            (round(point.x), round(point.y)),
            3,
            _POSE_COLOR,
            thickness=-1,
            lineType=cv2.LINE_AA,
        )

# 관측 미리보기 생성
def preview(
    frame: Any,
    roles_raw: tuple[RoleDetection, ...],
    roles_matched: tuple[RoleHypothesis, ...],
    poses: tuple[PoseObservation, ...],
    arms: tuple[dict[str, Any], ...],
    *,
    max_width: int = 1280,
) -> tuple[bytes, dict[str, Any]]:
    """축구 판정으로 바꾸지 않는 원본 좌표 가설 표시"""
    # 미리보기 최댓값 너비의 자료 형식과 허용 조건 확인
    if type(max_width) is not int or max_width <= 0:
        # 미리보기 최댓값 너비 유효하지 않음 오류 알림
        raise ValueError("PREVIEW_MAX_WIDTH_INVALID")
    # 미리보기 역할 검출 목록의 자료 형식과 허용 조건 확인
    if not isinstance(roles_raw, tuple) or any(
        not isinstance(item, RoleDetection) for item in roles_raw
    ):
        # 미리보기 역할 검출 목록 유효하지 않음 오류 알림
        raise TypeError("PREVIEW_ROLE_DETECTIONS_INVALID")
    # 미리보기 역할 가설 목록의 자료 형식과 허용 조건 확인
    if not isinstance(roles_matched, tuple) or any(
        not isinstance(item, RoleHypothesis) for item in roles_matched
    ):
        # 미리보기 역할 가설 목록 유효하지 않음 오류 알림
        raise TypeError("PREVIEW_ROLE_HYPOTHESES_INVALID")
    # 미리보기 자세 목록의 자료 형식과 허용 조건 확인
    if not isinstance(poses, tuple) or any(not isinstance(item, PoseObservation) for item in poses):
        # 미리보기 자세 목록 유효하지 않음 오류 알림
        raise TypeError("PREVIEW_POSES_INVALID")
    # 미리보기 팔 목록의 자료 형식과 허용 조건 확인
    if not isinstance(arms, tuple) or any(not isinstance(item, dict) for item in arms):
        # 미리보기 팔 목록 유효하지 않음 오류 알림
        raise TypeError("PREVIEW_ARMS_INVALID")

    # 표본에 프레임의 속성 또는 기본값 저장
    sample = getattr(frame, "sample", None)
    # 삼원색 영상에 표본의 속성 또는 기본값 저장
    rgb = getattr(sample, "rgb", None)
    # 미리보기 삼원색 영상의 자료 형식과 허용 조건 확인
    if (
        not isinstance(rgb, np.ndarray)
        or rgb.dtype != np.uint8
        or rgb.ndim != 3
        or rgb.shape[2] != 3
        or min(rgb.shape[:2]) <= 0
    ):
        # 미리보기 삼원색 영상 유효하지 않음 오류 알림
        raise ValueError("PREVIEW_RGB_INVALID")
    # 검출 목록에 프레임의 속성 또는 기본값 저장
    detections = getattr(frame, "detections", None)
    # 미리보기 원본 검출 목록의 자료 형식과 허용 조건 확인
    if not isinstance(detections, tuple):
        # 미리보기 원본 검출 목록 유효하지 않음 오류 알림
        raise TypeError("PREVIEW_SOURCE_DETECTIONS_INVALID")

    # 높이·너비에 삼원색 영상의 배열 크기의 선택 항목 저장
    height, width = rgb.shape[:2]
    # 표시를 덧붙인 영상에 원본을 건드리지 않을 사본 저장
    annotated = rgb.copy()
    # 상단 안내 높이에 높이의 최솟값 저장
    banner_height = min(height, 38)
    # 미리보기 영상에 검출 상자 또는 안내 배경 표시
    cv2.rectangle(annotated, (0, 0), (width - 1, banner_height - 1), (15, 15, 15), thickness=-1)
    # 기준에 표본의 눈금당 초 단위 시간 저장
    base = sample.time_base
    # 시작점 기준에 표본의 시작점 눈금당 초 단위 시간 저장
    origin_base = sample.origin_time_base
    # 상단 안내에 현재 값을 포함한 문자열 저장
    banner = (
        "NOT ADMITTED | ROLE/POSE HYPOTHESES"
        f" | t={sample.timestamp_ms}ms | pts={sample.pts}@{base.numerator}/{base.denominator}"
        f" | origin={sample.origin_pts}@{origin_base.numerator}/{origin_base.denominator}"
    )
    # 경계에 맞춘 문자열에 필요한 입력을 전달해 처리
    clampedText(annotated, banner, 8, min(26, banner_height - 5), (245, 245, 245), font_scale=0.55)

    # 가설 목록에 역할 목록 연결된의 항목별 변환 결과 저장
    hypotheses = {item.detection_id: item for item in roles_matched}
    # 팔 목록 기준 검출을 모를 빈 자료 생성
    arms_by_detection: dict[int, list[dict[str, Any]]] = {}
    # 팔 목록에서 팔을 하나씩 읽음
    for arm in arms:
        # 상태의 키에 해당하는 값 및 아닌 팔 올림 조건 충족의 일치 조건 확인
        if arm.get("state") == "NOT_RAISED":
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 검출 식별자에 검출 식별자의 키에 해당하는 값 저장
        detection_id = arm.get("detectionId")
        # 검출 식별자의 정확한 자료형 및 정수의 동일 객체 조건 확인
        if type(detection_id) is int:
            # 기본값을 채운 항목 처리 결과에 팔 추가
            arms_by_detection.setdefault(detection_id, []).append(arm)

    # 검출 목록에서 검출을 하나씩 읽음
    for detection in detections:
        # 여러 값을 순서대로 모은 자료에 검출의 원본 화면의 시작점과 끝점 상자 좌표의 항목별 변환 결과 저장
        x1, y1, x2, y2 = (round(value) for value in detection.box)
        # 색상에 원본 색상 목록의 선택 항목 저장
        color = _SOURCE_COLORS[detection.label]
        # 미리보기 영상에 검출 상자 또는 안내 배경 표시
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, thickness=3)
        # 레이블에 현재 값을 포함한 문자열 저장
        label = f"d{detection.detection_id} {detection.label}"
        # 가설에 검출의 검출 식별자의 키에 해당하는 값 저장
        hypothesis = hypotheses.get(detection.detection_id)
        # 가설이 있는지 확인
        if hypothesis is not None:
            # 가설의 상태 및 연결된의 일치 조건 확인
            if hypothesis.status == "MATCHED":
                # 레이블에 현재 값을 포함한 문자열을 더해 누적
                label += f" | hyp:{hypothesis.role} {hypothesis.score:.2f}"
            # 앞선 분기에 해당하지 않는 경우 처리
            else:
                # 레이블에 현재 값을 포함한 문자열을 더해 누적
                label += f" | hyp:{hypothesis.status}"
        # 검출의 구간 안에서만 유효한 추적 식별자가 있는지 확인
        if detection.track_id is not None:
            # 레이블에 현재 값을 포함한 문자열을 더해 누적
            label += f" | track-fragment={detection.track_id}"
        # 경계에 맞춘 문자열에 필요한 입력을 전달해 처리
        clampedText(annotated, label, x1, max(banner_height + 16, y1 - 7), color)
        # 순번을 붙인 항목 목록에서 이동량·팔을 하나씩 읽음
        for offset, arm in enumerate(arms_by_detection.get(detection.detection_id, ())):
            # 방향에 방향의 키에 해당하는 값 저장
            side = arm.get("side", "UNKNOWN")
            # 상태에 상태의 키에 해당하는 값 저장
            state = arm.get("state", "UNKNOWN")
            # 팔 문자열에 현재 값을 포함한 문자열 저장
            arm_text = f"d{detection.detection_id} raw-arm {side}={state}"
            # 경계에 맞춘 문자열에 필요한 입력을 전달해 처리
            clampedText(annotated, arm_text, x1, min(height - 5, y2 - 6 - offset * 16), _ARM_COLOR)

    # 자세 목록에서 자세를 하나씩 읽음
    for pose in poses:
        # 자세에 필요한 입력을 전달해 처리
        poseOverlay(annotated, pose)

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
