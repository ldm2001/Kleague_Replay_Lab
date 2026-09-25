import argparse
import hashlib
import json
import re
from pathlib import Path

FACTS = (
    "actionType", "direction", "bodyOrEquipmentContact",
    "gripMaintained", "pulling", "movementImpeded",
)
STATES = ("CONFIRMED", "REFUTED", "UNKNOWN")


# 정확한 객체 필드 계약 확인
def fields(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError("invalid object fields")


# 비어 있지 않은 식별 문자열 확인
def identifier(value):
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ValueError("invalid identifier")


# 소문자 원본 및 근거 해시 확인
def digest(value):
    if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        raise ValueError("invalid SHA256")


# 사실 단위 라벨과 원본 시간 및 출처 확인
def casecheck(case):
    fields(case, (
        "id", "sourceSha256", "matchId", "eventId", "split", "actorId",
        "targetId", "startMs", "endMs", "factKey", "expected", "predicted", "provenance",
    ))
    for key in ("id", "matchId", "eventId", "actorId", "targetId"):
        identifier(case[key])
    digest(case["sourceSha256"])
    if case["actorId"] == case["targetId"]:
        raise ValueError("actor and target must differ")
    if case["split"] not in ("DEVELOPMENT", "EVALUATION"):
        raise ValueError("invalid split")
    if case["factKey"] not in FACTS:
        raise ValueError("unsupported fact")
    if case["expected"] not in STATES or case["predicted"] not in STATES:
        raise ValueError("invalid state")
    for key in ("startMs", "endMs"):
        if type(case[key]) is not int or not 0 <= case[key] <= 2 ** 53 - 1:
            raise ValueError("invalid source timestamp")
    if case["endMs"] <= case["startMs"]:
        raise ValueError("invalid source interval")
    provenance = case["provenance"]
    fields(provenance, ("origin", "reviewer", "evidenceSha256"))
    if provenance["origin"] != "DEVELOPMENT_REVIEW":
        raise ValueError("invalid label origin")
    identifier(provenance["reviewer"])
    digest(provenance["evidenceSha256"])


# 자료 계약과 원본별 경기별 사건별 분할 누수 확인
def validate(data):
    fields(data, ("schemaVersion", "producer", "cases"))
    if data["schemaVersion"] != "holding-validation-v1":
        raise ValueError("unsupported schema")
    fields(data["producer"], ("id", "version"))
    for value in data["producer"].values():
        identifier(value)
    if not isinstance(data["cases"], list):
        raise ValueError("invalid cases")
    ids = set()
    observations = set()
    partitions = {key: {} for key in ("sourceSha256", "matchId", "eventId")}
    for case in data["cases"]:
        casecheck(case)
        if case["id"] in ids:
            raise ValueError("duplicate case id")
        ids.add(case["id"])
        observation = tuple(case[key] for key in (
            "sourceSha256", "eventId", "actorId", "targetId", "startMs", "endMs", "factKey",
        ))
        if observation in observations:
            raise ValueError("duplicate observation")
        observations.add(observation)
        for key, seen in partitions.items():
            prior = seen.setdefault(case[key], case["split"])
            if prior != case["split"]:
                raise ValueError(f"split leakage: {key}")


# 분모가 없는 비율의 미확인 보존
def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


# 평가 분할의 사실별 미확인과 혼동 행렬 집계
def metrics(cases):
    result = {
        "count": len(cases), "scorableCount": 0,
        "tp": 0, "fp": 0, "fn": 0, "tn": 0,
        "unknownPredictionCount": 0, "unknownTruthCount": 0,
        "scorableAbstentionCount": 0,
    }
    for case in cases:
        truth, prediction = case["expected"], case["predicted"]
        result["unknownPredictionCount"] += int(prediction == "UNKNOWN")
        result["unknownTruthCount"] += int(truth == "UNKNOWN")
        if truth == "UNKNOWN":
            continue
        result["scorableCount"] += 1
        result["scorableAbstentionCount"] += int(prediction == "UNKNOWN")
        if truth == "CONFIRMED":
            result["tp" if prediction == "CONFIRMED" else "fn"] += 1
        elif prediction == "CONFIRMED":
            result["fp"] += 1
        elif prediction == "REFUTED":
            result["tn"] += 1
    count = result["scorableCount"]
    abstained = result["scorableAbstentionCount"]
    result["precision"] = ratio(result["tp"], result["tp"] + result["fp"])
    result["recall"] = ratio(result["tp"], result["tp"] + result["fn"])
    result["coverage"] = ratio(count - abstained, count)
    result["abstention"] = ratio(abstained, count)
    return result


# 개발 라벨 기준 수치 반환 및 의미 승인 제외
def evaluate(data):
    validate(data)
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    cases = [case for case in data["cases"] if case["split"] == "EVALUATION"]
    scorable = sum(case["expected"] != "UNKNOWN" for case in cases)
    return {
        "schemaVersion": "holding-validation-report-v1",
        "method": dict(data["producer"]),
        "datasetSha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "status": "MEASURED" if scorable else "UNAVAILABLE",
        "semanticValidation": "NOT_APPROVED",
        "reasons": [] if scorable else ["NO_SCORABLE_EVALUATION_LABELS"],
        "counts": {
            "total": len(data["cases"]), "development": len(data["cases"]) - len(cases),
            "evaluation": len(cases), "scorable": scorable,
        },
        "facts": {
            fact: metrics([case for case in cases if case["factKey"] == fact])
            for fact in FACTS
        },
    }


# 입력 자료 읽음 및 승인 없는 보고서 출력
def main():
    parser = argparse.ArgumentParser(description="개발 라벨 기준 사실별 방법 평가")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(args.path.read_text(encoding="utf-8"))
        result = evaluate(data)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
