"""화면 측정이며 접촉·행동 분류·인과 사실 아님"""
from fractions import Fraction
from hashlib import sha256
import json
from math import acos, degrees, hypot, isfinite
import re

# 화면 좌표 측정 방법의 판본 식별자 정의
METHOD = "interaction-image-measurements-v1"
# 이전 표본을 연결할 수 있는 최대 시간 간격 정의
MAX_GAP_MS = 250
KEYPOINT_SCORE = 0.3  # 측정 자격 기준이며 사실 승인 점수 아님

# 정규화된 자료에서 관측 식별용 해시 생성
def digest(value):
    # 키 순서와 표현을 고정한 관측 자료에서 안정적인 내용 해시 반환
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()

# 측정할 수 없는 이유를 미확인 상태와 함께 반환
def unknown(reason):
    # 사실 부정 대신 값 미확인과 측정 불가 사유를 함께 반환
    return {"state": "UNKNOWN", "value": None, "reasons": [reason]}

# 입력이 불리언이 아닌 유한 수치인지 확인
def number(value):
    # 불리언을 제외한 유한 정수 또는 실수 여부 반환
    return type(value) in (int, float) and isfinite(value)

# 불리언이 아닌 정수 입력인지 확인
def integer(value):
    # 불리언을 제외한 영 이상 정수 여부 반환
    return type(value) is int and value >= 0

# 관측 입력 검사
def validation(row):
    """규정 사실 승인 없는 측정 생성기 출력 검증"""
    # 자료 판본과 참여자 정렬 및 관측 구간의 원본 시각 일치 확인
    if (
        row["schemaVersion"] != "interaction-observation-v1"
        or row["participantA"]["trackId"] >= row["participantB"]["trackId"]
        or not integer(row["startMs"])
        or not integer(row["endMs"])
        or row["startMs"] > row["endMs"]
        or row["endMs"] != row["frame"]["timestampMs"]
    ):
        # 순서·시간 범위가 잘못된 관측 기록 거부
        raise ValueError("OBSERVATION_RECORD_INVALID")
    # 현재 방법으로 확정할 수 없는 행동·접촉·팀 관계 항목 순회
    for key in ("actionType", "direction", "contact", "movementImpeded", "teamRelation"):
        # 확정할 수 없는 사실이 미확인 상태와 누락 사유를 유지하는지 확인
        if (
            row[key]["state"] != "UNKNOWN"
            or row[key]["value"] is not None
            or not row[key]["reasons"]
        ):
            # 미검증 관측이 확정 사실로 변환된 기록 거부
            raise ValueError("OBSERVATION_CLAIM_INVALID")
    # 각 측정값의 시간 범위와 단위 및 값 검사
    for name, value in row["measurements"].items():
        # 측정 구간이 관측 범위에 포함되며 지원 단위를 사용하는지 확인
        if (
            not integer(value["startMs"])
            or not integer(value["endMs"])
            or not row["startMs"] <= value["startMs"] <= value["endMs"] == row["endMs"]
            or value["unit"] not in ("px", "px_per_s", "deg")
        ):
            # 유효하지 않은 측정 기록 거부
            raise ValueError("OBSERVATION_MEASUREMENT_INVALID")
        # 측정 불가 상태를 측정값 영과 구분
        if value["state"] == "UNKNOWN":
            # 미확인 값에는 수치 대신 누락 사유가 있는지 확인
            valid = value["value"] is None and bool(value["reasons"])
        else:
            # 실측 상태의 유한 수치와 거리·각도의 허용 범위 확인
            valid = (
                value["state"] == "MEASURED"
                and number(value["value"])
                and not value["reasons"]
                and (name == "centerDistanceChange" or value["value"] >= 0)
                and (value["unit"] != "deg" or value["value"] <= 180)
            )
        # 상태와 수치가 일관되지 않은 측정인지 확인
        if not valid:
            # 유효하지 않은 측정 기록 거부
            raise ValueError("OBSERVATION_MEASUREMENT_INVALID")

# 점수가 유효한 관절을 원본 화면의 픽셀 좌표로 변환
def point(pose, name, width, height):
    # 자세 관측 자체가 없는 경우 확인
    if pose is None:
        # 자세 누락을 거리 영이 아닌 측정 불가로 반환
        return None, "POSE_NOT_AVAILABLE"
    # 요청한 신체 관절 이름에 해당하는 관측만 추출
    points = [p for p in pose["keypoints"] if p["name"] == name]
    # 요청한 관절 관측이 없는지 확인
    if not points:
        # 해당 관절 누락 사유 반환
        return None, "KEYPOINT_NOT_AVAILABLE"
    # 동일 관절의 중복 관측으로 값이 모호한지 확인
    if len(points) != 1:
        # 중복된 관절 이름 거부
        raise ValueError("KEYPOINT_ID_DUPLICATE")
    # 유일하게 대응된 관절 관측 읽음
    item = points[0]
    # 관절 좌표와 점수가 유한한 수치인지 확인
    if not all(number(item.get(key)) for key in ("x", "y", "score")):
        # 잘못된 관절 좌표 또는 점수 거부
        raise ValueError("KEYPOINT_INVALID")
    # 좌표 측정에 사용할 최소 관절 점수 충족 여부 확인
    if item["score"] < KEYPOINT_SCORE:
        # 낮은 점수의 관절을 사실 부정 없이 측정 불가로 반환
        return None, "KEYPOINT_SCORE_INSUFFICIENT"
    # 관절 좌표가 원본 화면 경계를 벗어나는지 확인
    if not 0 <= item["x"] <= width or not 0 <= item["y"] <= height:
        # 화면 밖 관절의 측정 불가 사유 반환
        return None, "KEYPOINT_OUTSIDE_IMAGE"
    # 유효한 원본 픽셀 좌표와 오류 없음 반환
    return (item["x"], item["y"]), None


class InteractionObservations:

    # 초기 상태·입력 계약 구성
    def __init__(self, source_sha256):
        # 서로 다른 원본을 섞지 않도록 원본 해시 형식 확인
        if not isinstance(source_sha256, str) or not re.fullmatch("[a-f0-9]{64}", source_sha256):
            # 유효하지 않은 원본 식별 해시 거부
            raise ValueError("SOURCE_HASH_INVALID")
        # 후속 관측의 원본 일치 검사 기준 보존
        self.source = source_sha256
        # 직전 표본의 참여자 쌍별 측정 이력 초기화
        self.previous = {}
        # 아직 읽은 표본 시각이 없음을 기록
        self.last_ms = None
        # 연속 구간과 화면 좌표계의 연결 기준 초기화
        self.scope = None

    # 이전 연속 구간의 추적 이력을 초기화
    def reset(self):
        # 직전 표본의 참여자 쌍별 측정 이력 초기화
        self.previous = {}
        # 연속 구간과 화면 좌표계의 연결 기준 초기화
        self.scope = None

    # 같은 추적 쌍의 근접 관측을 연결하고 중립적인 화면 좌표 측정을 생성
    def update(self, row, shot_id):
        # 새 표본이 현재 분석 원본에서 나왔는지 확인
        if row.get("sourceSha256") != self.source:
            # 다른 영상의 관측 혼입 거부
            raise ValueError("OBSERVATION_SOURCE_MISMATCH")
        # 원본 시각과 크기가 담긴 프레임 정보 읽음
        frame = row["frame"]
        # 표본 시각과 화면 연속 구간 식별자 읽음
        ms, continuity = frame["timestampMs"], row["continuityId"]
        # 픽셀 좌표 검사용 원본 화면 크기 읽음
        width, height = frame["width"], frame["height"]
        # 시각·구간·해상도가 유효한 정수이며 화면 크기 상한 안인지 확인
        if (
            not all(integer(v) for v in (ms, continuity, width, height))
            or not width
            or not height
            or width * height > 4096 * 2160
        ):
            # 잘못된 시각·화면 크기 또는 과도한 해상도 거부
            raise ValueError("OBSERVATION_FRAME_INVALID")
        # 현재 프레임과 영상 시작점의 시간 단위 읽음
        base, origin = frame["timeBase"], frame["originTimeBase"]
        # 원본 타임스탬프를 유리수 시간축으로 검증
        try:
            # 프레임 타임스탬프 한 단위의 초 길이 계산
            time_base = Fraction(base["numerator"], base["denominator"])
            # 영상 시작 타임스탬프 한 단위의 초 길이 계산
            origin_base = Fraction(origin["numerator"], origin["denominator"])
            # 시간 단위가 양수인지 확인
            if time_base <= 0 or origin_base <= 0:
                # 해석할 수 없는 시간 단위 거부
                raise ValueError("OBSERVATION_TIMEBASE_INVALID")
            # 원본 시작점 기준 상대 시간을 밀리초로 계산
            timestamp = round((frame["pts"] * time_base - frame["originPts"] * origin_base) * 1000)
        # 분모 영 또는 누락·형식 오류를 시간축 계약 오류로 통합
        except (ZeroDivisionError, TypeError, KeyError) as error:
            # 원래 오류를 보존하며 잘못된 시간축 입력 거부
            raise ValueError("OBSERVATION_TIMEBASE_INVALID") from error
        # 변환 시각 불일치와 시간 역행·중복 여부 확인
        if timestamp != ms or (self.last_ms is not None and ms <= self.last_ms):
            # 서로 비교할 수 없는 시간 순서의 표본 거부
            raise ValueError("OBSERVATION_TIMELINE_INVALID")
        # 연속 구간·샷·해상도·스트림·시간 원점을 묶은 비교 범위 생성
        scope = (
            continuity,
            shot_id,
            width,
            height,
            frame["streamIndex"],
            frame["originPts"],
            origin_base,
        )
        # 좌표계가 같고 간격이 짧은 경우에만 이전 표본 이력 재사용
        previous = (
            self.previous
            # 같은 비교 범위에서 허용 시간 간격 안의 이전 표본인지 확인
            if (
                scope == self.scope and self.last_ms is not None and ms - self.last_ms <= MAX_GAP_MS
            )
            else {}
        )
        # 사람 추적 조회표와 검출 중복 검사 집합 생성
        tracks, detection_ids = {}, set()
        # 현재 프레임의 검출 결과를 추적별로 검사
        for item in row["detections"]:
            # 같은 검출 식별자가 두 번 등장하는지 확인
            if item["detectionId"] in detection_ids:
                # 중복 검출 식별자 거부
                raise ValueError("DETECTION_ID_DUPLICATE")
            # 자세 연결 검사용 검출 식별자 보존
            detection_ids.add(item["detectionId"])
            # 검출에 연결된 추적 조각 식별자 읽음
            track = item["trackId"]
            # 추적 없는 검출과 사람이 아닌 검출 제외 조건 확인
            if track is None or item["label"] != "person":
                # 현재 측정 대상이 아닌 검출 건너뜀
                continue
            # 사람 검출 사각형의 원본 화면 좌표 읽음
            box = item["box"]
            # 추적 식별자의 유일성과 사각형 좌표의 화면 범위 확인
            if (
                not isinstance(track, str)
                or not track
                or len(track) > 128
                or track in tracks
                or len(box) != 4
                or not all(number(v) for v in box)
                or not 0 <= box[0] < box[2] <= width
                or not 0 <= box[1] < box[3] <= height
            ):
                # 중복 추적 또는 화면 범위를 벗어난 사각형 거부
                raise ValueError("TRACK_BOX_INVALID")
            # 추적 식별자로 사람 검출을 찾는 조회표 갱신
            tracks[track] = item
        # 검출 식별자별 자세 관측 조회표 생성
        poses = {}
        # 현재 프레임의 자세 관측 순회
        for pose in row.get("poses", []):
            # 자세 중복과 대응 검출 누락 여부 확인
            if pose["detectionId"] in poses or pose["detectionId"] not in detection_ids:
                # 검출과 연결할 수 없는 자세 관측 거부
                raise ValueError("POSE_ASSOCIATION_INVALID")
            # 검출 식별자에 대응하는 자세 관측 보존
            poses[pose["detectionId"]] = pose
        # 동일 참여자 쌍의 상류 근접 관측을 모으는 조회표 생성
        pairs = {}
        # 화면 근접 관측에서 측정 대상 참여자 쌍 읽음
        for item in row.get("interactions", []):
            # 근접 관측의 두 참여자 추적 식별자 읽음
            pair = item["actorTrackIds"]
            # 서로 다른 두 사람이 모두 현재 프레임에 존재하는지 확인
            if len(pair) != 2 or len(set(pair)) != 2 or any(t not in tracks for t in pair):
                # 유효한 두 사람으로 구성되지 않은 측정 대상 거부
                raise ValueError("INTERACTION_PAIR_INVALID")
            # 근접 관측의 마지막 시각과 현재 프레임 시각 일치 확인
            if item["endMs"] != ms:
                # 다른 시각의 근접 관측 혼입 거부
                raise ValueError("INTERACTION_TIME_INVALID")
            # 행동 방향과 무관한 식별자 정렬 순서로 같은 쌍 묶음
            pairs.setdefault(tuple(sorted(pair)), []).append(item["id"])
        # 한 프레임에서 허용한 참여자 쌍 상한 확인
        if len(pairs) > 128:
            # 과도한 쌍 비교로 처리량이 늘어나지 않도록 중단
            raise ValueError("INTERACTION_PAIR_LIMIT")
        # 새 관측 목록과 다음 표본에 전달할 측정 이력 생성
        result, current = [], {}
        # 일관된 쌍 순서로 각 화면 측정 생성
        for pair, upstream_ids in sorted(pairs.items()):
            # 같은 연속 범위에 있는 직전 참여자 쌍 측정 읽음
            old = previous.get(pair)
            # 연결 이력이 있으면 첫 관측 시각 유지
            start = old["start"] if old else ms
            # 원본·좌표계·참여자 쌍·시작 시각으로 중립 후보 식별자 생성
            candidate_id = "candidate-" + digest(
                [self.source, scope[:-1], str(origin_base), pair, start]
            )
            # 두 참여자의 검출 사각형 읽음
            boxes = [tracks[t]["box"] for t in pair]
            # 실제 신체 중심이 아닌 화면 검출 사각형 중심 계산
            centers = [((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in boxes]
            # 두 검출 중심 사이의 픽셀 거리 계산
            distance = hypot(centers[0][0] - centers[1][0], centers[0][1] - centers[1][1])
            # 거리·변위·속도·각도 측정값 저장소 생성
            measurements = {}

            # 값과 단위를 원본 시각의 측정 근거로 기록
            def measurement(name, value, unit="px", reason=None, temporal=False):
                # 측정 가능 여부와 단위 및 적용 시간 범위를 함께 기록
                measurements[name] = {
                    **(
                        unknown(reason)
                        if value is None
                        else {"state": "MEASURED", "value": value, "reasons": []}
                    ),
                    "unit": unit,
                    "startMs": old["ms"] if temporal and old else ms,
                    "endMs": ms,
                }

            # 화면 중심 거리를 기록하며 실제 접촉 거리로 해석하지 않음
            measurement("centerDistance", distance)
            # 두 검출 사각형 사이 화면 간격을 기록하며 겹침을 접촉 확정으로 사용하지 않음
            measurement(
                # 두 검출 사각형의 최소 화면 간격 측정
                "boxGap",
                hypot(
                    max(boxes[0][0] - boxes[1][2], boxes[1][0] - boxes[0][2], 0),
                    max(boxes[0][1] - boxes[1][3], boxes[1][1] - boxes[0][3], 0),
                ),
            )
            # 같은 연속 구간의 직전 표본이 있을 때 중심 거리 변화 기록
            measurement(
                # 직전 표본 대비 화면 중심 거리 변화 측정
                "centerDistanceChange",
                distance - old["distance"] if old else None,
                reason="PREVIOUS_SAMPLE_UNAVAILABLE",
                temporal=True,
            )
            # 식별자 정렬로 나뉜 두 참여자를 차례로 측정
            for index, label in enumerate(("A", "B")):
                # 직전 표본이 있을 때만 화면 중심 이동 거리 계산
                displacement = (
                    hypot(
                        centers[index][0] - old["centers"][index][0],
                        centers[index][1] - old["centers"][index][1],
                    )
                    if old
                    else None
                )
                # 참여자별 이전 표본 대비 화면 변위 또는 근거 누락 기록
                measurement(
                    # 현재 참여자의 화면 변위 기록
                    f"participant{label}Displacement",
                    displacement,
                    reason="PREVIOUS_SAMPLE_UNAVAILABLE",
                    temporal=True,
                )
                # 실제 경기장 속도가 아닌 시간당 픽셀 이동 속도 기록
                measurement(
                    # 현재 참여자의 픽셀 이동 속도 기록
                    f"participant{label}Speed",
                    displacement * 1000 / (ms - old["ms"]) if old else None,
                    "px_per_s",
                    "PREVIOUS_SAMPLE_UNAVAILABLE",
                    temporal=True,
                )
                # 현재 참여자의 검출에 연결된 자세 읽음
                own_pose = poses.get(tracks[pair[index]]["detectionId"])
                # 상대 참여자의 검출에 연결된 자세 읽음
                other_pose = poses.get(tracks[pair[1-index]]["detectionId"])
                # 두 참여자의 자세와 검출 사각형 대응 검사
                for pose, box in ((own_pose, boxes[index]), (other_pose, boxes[1-index])):
                    # 자세 입력 영역이 현재 사람 검출 영역과 다른지 확인
                    if pose is not None and pose["sourceBox"] != box:
                        # 다른 영역에서 추정한 관절의 잘못된 연결 거부
                        raise ValueError("POSE_BOX_MISMATCH")
                # 상대 몸통 중심 근사에 사용할 양어깨와 양엉덩이 좌표 읽음
                torso = [
                    point(other_pose, name, width, height)
                    for name in ("L_Shoulder", "R_Shoulder", "L_Hip", "R_Hip")
                ]
                # 양쪽 손목 거리와 팔꿈치 각도를 각각 측정
                for side, side_name in (("L", "Left"), ("R", "Right")):
                    # 현재 참여자의 손목 좌표와 측정 불가 사유 읽음
                    wrist, reason = point(own_pose, side + "_Wrist", width, height)
                    # 손목 또는 상대 몸통 관절 중 첫 측정 불가 사유 보존
                    reason = reason or next((r for _, r in torso if r), None)
                    # 네 몸통 관절이 모두 유효할 때 상대 화면 중심 근사 계산
                    center = (
                        tuple(sum(p[axis] for p, _ in torso) / 4 for axis in (0, 1))
                        if not reason
                        else None
                    )
                    # 자기 손목과 상대 몸통 근사 중심의 화면상 거리 기록
                    measurement(
                        f"{label.lower()}{side_name}WristTo{'B' if index == 0 else 'A'}Torso",
                        hypot(wrist[0] - center[0], wrist[1] - center[1]) if center else None,
                        reason=reason,
                    )
                    # 팔꿈치 각도 계산에 필요한 어깨·팔꿈치·손목 좌표 읽음
                    joints = [
                        point(own_pose, side + "_" + name, width, height)
                        for name in ("Shoulder", "Elbow", "Wrist")
                    ]
                    # 각도 계산에 필요한 관절 중 누락된 첫 사유 읽음
                    reason = next((r for _, r in joints if r), None)
                    # 관절 부족 또는 퇴화 형태에서는 각도를 미확인으로 유지
                    angle = None
                    # 세 관절 좌표가 모두 사용 가능한 경우에만 각도 계산
                    if not reason:
                        # 어깨와 팔꿈치 및 손목의 화면 좌표 분리
                        s, e, w = [p for p, _ in joints]
                        # 팔꿈치를 원점으로 위팔과 아래팔 화면 벡터 생성
                        u, v = (s[0]-e[0], s[1]-e[1]), (w[0]-e[0], w[1]-e[1])
                        # 각도 정규화에 필요한 두 벡터 길이의 곱 계산
                        norm = hypot(*u) * hypot(*v)
                        # 겹친 관절 때문에 벡터 길이가 영이 되는 경우 제외
                        if norm:
                            # 반올림 오차를 제한한 내적으로 화면 투영 각도 계산
                            angle = degrees(acos(max(-1, min(1, (u[0]*v[0]+u[1]*v[1])/norm))))
                        else:
                            # 겹친 관절로 각도를 정의할 수 없는 사유 기록
                            reason = "DEGENERATE_JOINT_GEOMETRY"
                    # 팔꿈치 화면 각도 또는 측정 불가 사유 기록
                    measurement(f"{label.lower()}{side_name}ElbowAngle", angle, "deg", reason)
            # 실제 선수 신원 대신 구간 내 추적 조각으로 참여자 표시
            participant = lambda track: {
                "trackId": track,
                "continuityId": continuity,
                "segmentId": shot_id,
                "identityState": "TRACK_FRAGMENT_ONLY",
            }
            # 중립 측정과 미확인 사실 상태를 분리한 관측 기록 추가
            result.append(
                {
                    "kind": "INTERACTION_OBSERVATION",
                    "schemaVersion": "interaction-observation-v1",
                    "candidateId": candidate_id,
                    "observationId": "observation-" + digest([candidate_id, ms]),
                    "sourceSha256": self.source,
                    "startMs": start,
                    "endMs": ms,
                    "participantA": participant(pair[0]),
                    "participantB": participant(pair[1]),
                    "pairOrder": "LEXICAL_NOT_DIRECTIONAL",
                    # 카메라 움직임이 보정되지 않은 원본 픽셀 좌표계 명시
                    "coordinateSpace": "SOURCE_IMAGE_PIXELS_UNCOMPENSATED",
                    "frame": frame,
                    "measurements": measurements,
                    "actionType": unknown("ACTION_TYPE_METHOD_UNAVAILABLE"),
                    "direction": unknown("ACTION_DIRECTION_METHOD_UNAVAILABLE"),
                    "teamRelation": unknown("TEAM_RELATION_UNVERIFIED"),
                    # 화면 근접만으로 실제 접촉을 확정하지 않고 미확인 보존
                    "contact": unknown("CONTACT_METHOD_UNVALIDATED"),
                    # 움직임 변화의 원인을 상대 행동으로 확정하지 않음
                    "movementImpeded": unknown("CAUSAL_METHOD_UNAVAILABLE"),
                    "method": {
                        "id": METHOD,
                        "keypointScoreMinimum": KEYPOINT_SCORE,
                        "maxGapMs": MAX_GAP_MS,
                    },
                    "upstreamInteractionIds": sorted(set(upstream_ids)),
                    "evidence": [],
                    "evidenceReasons": ["MEDIA_EVIDENCE_NOT_LINKED"],
                    "recordLinks": [],
                }
            )
            # 다음 표본과 비교할 참여자 쌍의 현재 측정 이력 보존
            current[pair] = {"start": start, "ms": ms, "centers": centers, "distance": distance}
        # 다음 프레임의 시간 연속성 검사와 변위 계산 기준 갱신
        self.previous, self.scope, self.last_ms = current, scope, ms
        # 외부로 반환하기 전 각 관측의 중립 계약 검사
        for observation in result:
            # 측정값과 미확인 사실 상태의 출력 계약 확인
            validation(observation)
        # 검증된 중립 관측 목록 반환
        return result
