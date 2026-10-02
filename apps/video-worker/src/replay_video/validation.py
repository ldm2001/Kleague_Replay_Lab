import argparse
import hashlib
import json
import re
from pathlib import Path

FACTS = (
    "observations.actionObserved", "observations.directionObserved",
    "observations.bodyOrEquipmentContact", "observations.gripMaintained",
    "observations.pulling", "observations.movementImpeded",
)
STATES = ("CONFIRMED", "REFUTED", "UNKNOWN")
JOIN = ("sourceSha256", "eventId", "actorId", "targetId", "startMs", "endMs", "factKey")


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


# 정답과 예측이 공유하는 명제 결합 키 확인 및 반환
def proposition(entry):
    digest(entry["sourceSha256"])
    for key in ("eventId", "actorId", "targetId"):
        identifier(entry[key])
    if entry["actorId"] == entry["targetId"]:
        raise ValueError("actor and target must differ")
    if entry["factKey"] not in FACTS:
        raise ValueError("unsupported fact")
    for key in ("startMs", "endMs"):
        if type(entry[key]) is not int or not 0 <= entry[key] <= 2 ** 53 - 1:
            raise ValueError("invalid source timestamp")
    if entry["endMs"] <= entry["startMs"]:
        raise ValueError("invalid source interval")
    return tuple(entry[key] for key in JOIN)


# 사실 단위 정답의 분할과 출처 확인 및 결합 키 반환
def casecheck(case):
    fields(case, (
        "id", "sourceSha256", "matchId", "eventId", "split", "actorId",
        "targetId", "startMs", "endMs", "factKey", "expected", "provenance",
    ))
    for key in ("id", "matchId"):
        identifier(case[key])
    if case["split"] not in ("DEVELOPMENT", "EVALUATION"):
        raise ValueError("invalid split")
    if case["expected"] not in STATES:
        raise ValueError("invalid state")
    provenance = case["provenance"]
    fields(provenance, ("origin", "reviewer", "evidenceSha256"))
    if provenance["origin"] != "DEVELOPMENT_REVIEW":
        raise ValueError("invalid label origin")
    identifier(provenance["reviewer"])
    digest(provenance["evidenceSha256"])
    return proposition(case)


# 예측 항목의 상태 확인 및 결합 키 반환
def guesscheck(entry):
    fields(entry, JOIN + ("predicted",))
    if entry["predicted"] not in STATES:
        raise ValueError("invalid state")
    return proposition(entry)


# 정답 자료 계약과 원본별 경기별 사건별 분할 누수 확인 및 명제 색인 반환
def answers(data):
    fields(data, ("schemaVersion", "cases"))
    if data["schemaVersion"] != "holding-labels-v1":
        raise ValueError("unsupported schema")
    if not isinstance(data["cases"], list):
        raise ValueError("invalid cases")
    ids = set()
    found = {}
    partitions = {key: {} for key in ("sourceSha256", "matchId", "eventId")}
    for case in data["cases"]:
        key = casecheck(case)
        if case["id"] in ids:
            raise ValueError("duplicate case id")
        ids.add(case["id"])
        if key in found:
            raise ValueError("duplicate observation")
        found[key] = case
        for name, seen in partitions.items():
            prior = seen.setdefault(case[name], case["split"])
            if prior != case["split"]:
                raise ValueError(f"split leakage: {name}")
    return found


# 예측 자료 계약과 중복 및 정답 밖 명제 확인 및 상태 색인 반환
def guesses(data, found):
    fields(data, ("schemaVersion", "producer", "predictions"))
    if data["schemaVersion"] != "holding-predictions-v1":
        raise ValueError("unsupported schema")
    fields(data["producer"], ("id", "version"))
    for value in data["producer"].values():
        identifier(value)
    if not isinstance(data["predictions"], list):
        raise ValueError("invalid predictions")
    result = {}
    for entry in data["predictions"]:
        key = guesscheck(entry)
        if key in result:
            raise ValueError("duplicate prediction")
        if key not in found:
            raise ValueError("unmatched prediction")
        result[key] = entry["predicted"]
    return result


# 키 정렬과 공백 없는 정규 JSON의 해시 반환
def canonical(data):
    text = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# 분모가 없는 비율의 미확인 보존
def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


# 평가 분할의 사실별 미확인과 혼동 행렬 집계
def metrics(pairs):
    result = {
        "count": len(pairs), "scorableCount": 0,
        "tp": 0, "fp": 0, "fn": 0, "tn": 0,
        "unknownPredictionCount": 0, "unknownTruthCount": 0,
        "scorableAbstentionCount": 0,
    }
    for truth, prediction in pairs:
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


# 정답과 예측의 분리 결합 수치 반환 및 의미 승인 제외
def evaluate(label, prediction):
    found = answers(label)
    state = guesses(prediction, found)
    cases = [case for case in label["cases"] if case["split"] == "EVALUATION"]
    pairs = {fact: [] for fact in FACTS}
    missing = 0
    for case in cases:
        key = tuple(case[name] for name in JOIN)
        missing += int(key not in state)
        pairs[case["factKey"]].append((case["expected"], state.get(key, "UNKNOWN")))
    scorable = sum(case["expected"] != "UNKNOWN" for case in cases)
    return {
        "schemaVersion": "holding-validation-report-v2",
        "method": dict(prediction["producer"]),
        "labelSha256": canonical(label),
        "predictionSha256": canonical(prediction),
        "status": "MEASURED" if scorable else "UNAVAILABLE",
        "semanticValidation": "NOT_APPROVED",
        "reasons": [] if scorable else ["NO_SCORABLE_EVALUATION_LABELS"],
        "counts": {
            "total": len(label["cases"]), "development": len(label["cases"]) - len(cases),
            "evaluation": len(cases), "scorable": scorable, "missingPrediction": missing,
        },
        "facts": {fact: metrics(pairs[fact]) for fact in FACTS},
    }


# 정답과 예측 파일 읽음 및 승인 없는 보고서 출력
def main():
    parser = argparse.ArgumentParser(description="개발 라벨 기준 사실별 방법 평가")
    parser.add_argument("labels", type=Path)
    parser.add_argument("predictions", type=Path)
    args = parser.parse_args()
    try:
        label = json.loads(args.labels.read_text(encoding="utf-8"))
        prediction = json.loads(args.predictions.read_text(encoding="utf-8"))
        result = evaluate(label, prediction)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
