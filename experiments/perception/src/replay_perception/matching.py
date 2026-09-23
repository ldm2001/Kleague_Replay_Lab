# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection
# 관측 목록 관련 함수와 자료형 읽음
from .observations import RoleDetection, RoleHypothesis


# 역할 연결에 필요한 최소 점수를 0점5 값으로 설정
MIN_ROLE_SCORE = 0.50
# 상자 연결에 필요한 최소 겹침 비율을 0점5 값으로 설정
MIN_IOU = 0.50
# 유일한 대응으로 인정할 최소 겹침 점수 차이를 0점1 값으로 설정
MIN_IOU_MARGIN = 0.10

# 두 검출 상자의 교집합과 합집합 면적 비율을 계산
def iou(first: tuple[float, ...], second: tuple[float, ...]) -> float:
    # 큰 좌표의 면적 곱이 넘치지 않도록 가로 좌표의 공통 축척 계산
    scale_x = max(first[0], first[2], second[0], second[2])
    # 면적 비율을 유지하면서 큰 세로 좌표의 수치 범위 축소 준비
    scale_y = max(first[1], first[3], second[1], second[3])
    # 첫 상자 좌표를 축별 공통 크기로 나누어 큰 수의 면적 곱 방지
    a = tuple(value / (scale_x if index % 2 == 0 else scale_y) for index, value in enumerate(first))
    # 둘째 상자에도 같은 축척을 적용해 상자 사이 면적 비율 유지
    b = tuple(
        value / (scale_x if index % 2 == 0 else scale_y) for index, value in enumerate(second)
    )
    # 서로 겹치지 않는 축 길이를 영으로 제한해 실제 겹친 면적 계산
    intersection = max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(
        0.0, min(a[3], b[3]) - max(a[1], b[1])
    )
    # 첫 상자의 가로 길이와 세로 길이를 곱해 면적 계산
    first_area = (a[2] - a[0]) * (a[3] - a[1])
    # 둘째 상자의 가로 길이와 세로 길이를 곱해 면적 계산
    second_area = (b[2] - b[0]) * (b[3] - b[1])
    # 두 상자 면적의 합에서 중복 계산한 교집합 면적 차감
    union = first_area + second_area - intersection
    # 합집합이 영이면 영을 반환하고 반올림으로 비율이 일을 넘지 않도록 제한
    return min(1., intersection / union) if union > 0 else 0.

# 최고 점수와 차순위 점수를 찾아 매칭의 모호성을 비교
def best(values: list[float]) -> tuple[int, float, float]:
    # 점수가 높은 순서로 정렬하고 동점은 원래 순번으로 안정적으로 구분
    ordered = sorted(enumerate(values), key=lambda pair: (-pair[1], pair[0]))
    # 순번·모델 출력 점수에 정렬 결과의 선택 항목 저장
    index, score = ordered[0]
    # 둘째 후보가 있으면 점수를 읽고 단일 후보이면 비교 점수를 영으로 설정
    runner_up = ordered[1][1] if len(ordered) > 1 else 0.
    # 최고 후보 순번과 점수 및 차순위와의 차이 반환
    return index, score, score - runner_up

# 동일 화면의 검출 상자와 역할 가설을 겹침 정도로 연결
def assignments(
    detections: tuple[Detection, ...], roles: tuple[RoleDetection, ...]
) -> tuple[RoleHypothesis, ...]:
    # 입력 자료형 또는 양방향 최고 후보와 차순위 차이의 연결 조건 확인
    if (
        not isinstance(detections, tuple)
        or not isinstance(roles, tuple)
        or any(not isinstance(item, Detection) for item in detections)
        or any(not isinstance(item, RoleDetection) for item in roles)
    ):
        # 역할 대응 입력 유효하지 않음 오류 알림
        raise ValueError("ROLE_MATCH_INPUT_INVALID")
    # 역할 대응 중복 원본 식별자를 감지해 잘못된 입력의 후속 사용 차단
    if len({item.detection_id for item in detections}) != len(detections):
        # 역할 대응 중복 원본 식별자 오류 알림
        raise ValueError("ROLE_MATCH_DUPLICATE_SOURCE_ID")
    # 역할 대응 중복 역할 식별자를 감지해 잘못된 입력의 후속 사용 차단
    if len({item.role_detection_id for item in roles}) != len(roles):
        # 역할 대응 중복 역할 식별자 오류 알림
        raise ValueError("ROLE_MATCH_DUPLICATE_ROLE_ID")
    # 원본 검출 중 사람만 역할 연결 대상으로 선택
    people = tuple(item for item in detections if item.label == "person")
    # 공 역할을 제외하고 최소 모델 점수를 충족한 역할 검출만 선택
    candidates = tuple(
        item for item in roles if item.role != "ball" and item.score >= MIN_ROLE_SCORE
    )
    # 사람 목록이 비어 있거나 조건을 충족하지 않는지 확인
    if not people:
        # 빈 튜플 반환
        return ()
    # 후보 목록이 비어 있거나 조건을 충족하지 않는지 확인
    if not candidates:
        # 사람 목록의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 반환
        return tuple(RoleHypothesis(person.detection_id, "UNMATCHED") for person in people)

    # 모든 사람 상자와 역할 상자의 조합별 겹침 비율 표 생성
    overlaps = [[iou(person.box, role.box) for role in candidates] for person in people]
    # 역방향 최고 후보도 확인해 여러 사람을 한 역할에 잘못 연결하는 경우 방지
    reverse = [best([row[index] for row in overlaps]) for index in range(len(candidates))]
    # 결과를 모를 빈 자료 생성
    result = []
    # 순번을 붙인 항목 목록에서 원본 순번·사람을 하나씩 읽음
    for source_index, person in enumerate(people):
        # 역할 순번·겹침·점수 차이에 최고 순번과 점수 및 차순위 차이 저장
        role_index, overlap, margin = best(overlaps[source_index])
        # 경계의 부동소수점 오차를 완화하면서 최소 겹침 기준 확인
        if overlap + 1e-12 < MIN_IOU:
            # 결과에 역할 가설 처리 결과 추가
            result.append(RoleHypothesis(person.detection_id, "UNMATCHED"))
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 최고 후보 원본·사용하지 않는 값·역방향 점수 차이에 역방향의 선택 항목 저장
        best_source, _, reverse_margin = reverse[role_index]
        # 입력 자료형 또는 양방향 최고 후보와 차순위 차이의 연결 조건 확인
        if (
            best_source != source_index
            or margin + 1e-12 < MIN_IOU_MARGIN
            or reverse_margin + 1e-12 < MIN_IOU_MARGIN
        ):
            # 결과에 역할 가설 처리 결과 추가
            result.append(RoleHypothesis(person.detection_id, "AMBIGUOUS"))
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 양방향 검사를 통과한 역할 후보를 읽음
        role = candidates[role_index]
        # 결과에 역할 가설 처리 결과 추가
        result.append(
            RoleHypothesis(
                person.detection_id,
                "MATCHED",
                role.role,
                role.score,
                role.role_detection_id,
                overlap,
            )
        )
    # 결과의 순서를 고정한 튜플 변환 결과 반환
    return tuple(result)
