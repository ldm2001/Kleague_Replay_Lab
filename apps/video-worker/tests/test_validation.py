import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import pytest
from replay_video.validation import FACTS, JOIN, evaluate

FACT = "observations.pulling"


# 검증 모듈의 구현 존재 확인
def test_module():
    assert importlib.util.find_spec("replay_video.validation") is not None


# 합성 계약 시험용 정답 사례 생성
def sample():
    return {
        "id": "case-1", "sourceSha256": "a" * 64,
        "matchId": "match-1", "eventId": "event-1", "split": "EVALUATION",
        "actorId": "player-1", "targetId": "player-2", "startMs": 0, "endMs": 1000,
        "factKey": FACT, "expected": "CONFIRMED",
        "provenance": {
            "origin": "DEVELOPMENT_REVIEW", "reviewer": "test-only",
            "evidenceSha256": "b" * 64,
        },
    }


# 정답 사례에 결합되는 예측 항목 생성
def pick(case, state):
    return {**{key: case[key] for key in JOIN}, "predicted": state}


# 방법과 무관한 정답 전용 입력 생성
def labels(cases=None):
    return {
        "schemaVersion": "holding-labels-v1",
        "cases": [] if cases is None else cases,
    }


# 단일 방법의 예측 전용 입력 생성
def guess(entries=None, version="1"):
    return {
        "schemaVersion": "holding-predictions-v1",
        "producer": {"id": "synthetic-test-only", "version": version},
        "predictions": [] if entries is None else entries,
    }


# 검증 실행 함수 연결
def report(label, prediction=None):
    return evaluate(label, guess() if prediction is None else prediction)


# 빈 평가와 개발 전용 라벨의 사용 불가 확인
@pytest.mark.parametrize("cases", [[], [{**sample(), "split": "DEVELOPMENT"}]])
def test_unavailable(cases):
    result = report(labels(cases))
    assert result["status"] == "UNAVAILABLE"
    assert result["reasons"] == ["NO_SCORABLE_EVALUATION_LABELS"]
    assert result["semanticValidation"] == "NOT_APPROVED"
    assert "approved" not in result


# 미확인 정답과 예측의 독립 집계 확인
def test_metrics():
    pairs = [
        ("CONFIRMED", "CONFIRMED"), ("REFUTED", "CONFIRMED"),
        ("CONFIRMED", "REFUTED"), ("REFUTED", "REFUTED"),
        ("CONFIRMED", "UNKNOWN"), ("REFUTED", "UNKNOWN"),
        ("UNKNOWN", "CONFIRMED"), ("UNKNOWN", "UNKNOWN"),
    ]
    cases = [{**sample(), "id": str(i), "startMs": i * 1000, "endMs": (i + 1) * 1000,
              "expected": truth}
             for i, (truth, _) in enumerate(pairs)]
    entries = [pick(case, pair[1]) for case, pair in zip(cases, pairs)]
    result = report(labels(cases), guess(entries))
    stat = result["facts"][FACT]
    assert result["status"] == "MEASURED"
    assert [stat[k] for k in ("tp", "fp", "fn", "tn")] == [1, 1, 2, 1]
    assert stat["unknownPredictionCount"] == 3
    assert stat["unknownTruthCount"] == 2
    assert stat["precision"] == 0.5
    assert stat["recall"] == 1 / 3
    assert stat["coverage"] == 4 / 6
    assert stat["abstention"] == 2 / 6
    assert result["counts"] == {"total": 8, "development": 0, "evaluation": 8,
                               "scorable": 6, "missingPrediction": 0}
    assert result["facts"]["observations.directionObserved"]["precision"] is None


# 같은 정답에 두 방법을 결합한 보고서의 정답 해시 동일 확인
def test_label_hash():
    label = labels([sample()])
    first = report(label, guess([pick(sample(), "CONFIRMED")], version="1"))
    second = report(label, guess([pick(sample(), "REFUTED")], version="2"))
    assert first["labelSha256"] == second["labelSha256"]
    assert first["predictionSha256"] != second["predictionSha256"]
    assert first["method"] != second["method"]
    assert first["facts"][FACT]["tp"] == 1
    assert second["facts"][FACT]["fn"] == 1


# 정답 해시와 예측 해시의 분리 계산 및 결합 해시 폐지 확인
def test_hash_scope():
    label = labels([sample()])
    prediction = guess([pick(sample(), "CONFIRMED")])
    result = report(label, prediction)
    for key, data in (("labelSha256", label), ("predictionSha256", prediction)):
        canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        assert result[key] == hashlib.sha256(canonical.encode()).hexdigest()
    assert result["schemaVersion"] == "holding-validation-report-v2"
    assert result["method"] == prediction["producer"]
    assert "datasetSha256" not in result


# 개발 분할 예측의 허용과 사실 지표 제외 확인
def test_scope():
    development = {**sample(), "id": "dev", "split": "DEVELOPMENT",
                   "sourceSha256": "c" * 64, "matchId": "other", "eventId": "other"}
    entries = [pick(sample(), "CONFIRMED"), pick(development, "REFUTED")]
    result = report(labels([sample(), development]), guess(entries))
    assert result["counts"]["development"] == 1
    assert result["counts"]["missingPrediction"] == 0
    assert result["facts"][FACT]["count"] == 1
    assert result["facts"][FACT]["tp"] == 1


# 예측 없는 정답의 기권 집계와 보존 확인
def test_missing_prediction():
    later = {**sample(), "id": "later", "startMs": 1000, "endMs": 2000}
    result = report(labels([sample(), later]), guess([pick(sample(), "CONFIRMED")]))
    stat = result["facts"][FACT]
    assert result["counts"]["missingPrediction"] == 1
    assert result["counts"]["scorable"] == 2
    assert stat["scorableCount"] == 2
    assert [stat["tp"], stat["fn"]] == [1, 1]
    assert stat["unknownPredictionCount"] == 1
    assert stat["coverage"] == 0.5


# 정답에 없는 예측의 거부 확인
def test_unmatched_prediction():
    outside = pick({**sample(), "startMs": 5000, "endMs": 6000}, "CONFIRMED")
    mismatched = [
        (labels([sample()]), [outside]),
        (labels(), [pick(sample(), "UNKNOWN")]),
    ]
    for label, entries in mismatched:
        with pytest.raises(ValueError, match="unmatched prediction"):
            report(label, guess(entries))


# 동일 명제의 반복 예측 거부 확인
def test_duplicate_prediction():
    entry = pick(sample(), "CONFIRMED")
    with pytest.raises(ValueError, match="duplicate prediction"):
        report(labels([sample()]), guess([entry, {**entry, "predicted": "REFUTED"}]))


# 잘못된 사실과 출처 및 시간의 정답 거부 확인
@pytest.mark.parametrize("key,value", [
    ("id", ""), ("sourceSha256", "bad"), ("factKey", "force"),
    ("factKey", "pulling"), ("factKey", "direction"), ("factKey", "actionType"),
    ("factKey", "context.ballInPlay"), ("factKey", "observations.actionType"),
    ("startMs", -1), ("startMs", True), ("endMs", float("nan")),
    ("endMs", 0), ("expected", False), ("expected", "HYPOTHESIS"),
    ("actorId", "player-2"), ("targetId", ""), ("split", "TEST"),
    ("provenance", {}), ("matchId", []), ("eventId", ""),
])
def test_invalid_case(key, value):
    case = sample()
    case[key] = value
    with pytest.raises(ValueError):
        report(labels([case]))


# 잘못된 상태와 결합 키의 예측 거부 확인
@pytest.mark.parametrize("key,value", [
    ("predicted", "HYPOTHESIS"), ("predicted", False), ("predicted", None),
    ("sourceSha256", "bad"), ("factKey", "pulling"), ("eventId", ""),
    ("actorId", "player-2"), ("startMs", True), ("startMs", 0.0), ("endMs", 0),
])
def test_invalid_prediction(key, value):
    entry = pick(sample(), "CONFIRMED")
    entry[key] = value
    with pytest.raises(ValueError):
        report(labels([sample()]), guess([entry]))


# 누락 필드와 중복 사례 및 두 판본 교차의 거부 확인
def test_invalid_document():
    for label in [None, {}, {**labels(), "cases": {}},
                  {**labels(), "schemaVersion": "holding-validation-v1"},
                  {**labels(), "producer": {"id": "x", "version": "1"}},
                  guess(), labels([sample(), sample()])]:
        with pytest.raises(ValueError):
            report(label)
    for prediction in [None, {}, {**guess(), "predictions": {}},
                       {**guess(), "schemaVersion": "holding-labels-v1"},
                       {**guess(), "producer": {"id": "x", "version": ""}},
                       {"schemaVersion": "holding-predictions-v1", "predictions": []},
                       labels([sample()])]:
        with pytest.raises(ValueError):
            evaluate(labels([sample()]), prediction)
    for key in sample():
        case = sample()
        del case[key]
        with pytest.raises(ValueError):
            report(labels([case]))
    for key in pick(sample(), "CONFIRMED"):
        entry = pick(sample(), "CONFIRMED")
        del entry[key]
        with pytest.raises(ValueError):
            report(labels([sample()]), guess([entry]))


# 원본과 경기와 사건별 독립 분할 누수 거부 확인
@pytest.mark.parametrize("key", ["sourceSha256", "matchId", "eventId"])
def test_leakage(key):
    other = {**sample(), "id": "other", "sourceSha256": "c" * 64,
             "matchId": "different", "eventId": "different", "split": "DEVELOPMENT"}
    other[key] = sample()[key]
    with pytest.raises(ValueError, match="split leakage"):
        report(labels([sample(), other]))


# 미확인 정답만 있는 평가의 사용 불가 확인
def test_unknown_only():
    case = {**sample(), "expected": "UNKNOWN"}
    result = report(labels([case]), guess([pick(case, "CONFIRMED")]))
    assert result["status"] == "UNAVAILABLE"
    assert result["facts"][FACT]["fp"] == 0
    assert result["facts"][FACT]["coverage"] is None


# 다른 사례 ID로 반복된 동일 명제의 거부 확인
def test_duplicate_observation():
    with pytest.raises(ValueError, match="duplicate observation"):
        report(labels([sample(), {**sample(), "id": "renamed"}]))


# 다른 원본 구간의 독립 명제 집계 확인
def test_distinct_observation():
    later = {**sample(), "id": "later", "startMs": 1000, "endMs": 2000}
    entries = [pick(sample(), "CONFIRMED"), pick(later, "CONFIRMED")]
    assert report(labels([sample(), later]), guess(entries))["facts"][FACT]["tp"] == 2


# 두 입력 스키마의 공통 경계와 사실 어휘 계약 확인
@pytest.mark.parametrize("name", ["holding-labels", "holding-predictions"])
def test_schema_boundaries(name):
    path = Path(__file__).resolve().parents[3] / f"datasets/labeled-cases/{name}.schema.json"
    schema = json.loads(path.read_text())
    assert schema["$defs"]["hash"]["minLength"] == 64
    assert schema["$defs"]["hash"]["maxLength"] == 64
    assert schema["$defs"]["identifier"]["not"] == {"pattern": r"\s$"}
    assert schema["$defs"]["fact"]["enum"] == list(FACTS)


# JSON 스키마가 막지 못하는 개행과 실수 토큰의 실행 거부 확인
@pytest.mark.parametrize("key,value", [
    ("sourceSha256", "a" * 64 + "\n"), ("id", "name\n"), ("startMs", 0.0),
])
def test_boundary_runtime(key, value):
    with pytest.raises(ValueError):
        report(labels([{**sample(), key: value}]))


# 보고서 사실 키가 승인 어휘 전체 키와 같음을 확인
def test_fact_keys():
    result = report(labels([sample()]))
    assert list(result["facts"]) == list(FACTS)
    assert all(key.startswith("observations.") for key in FACTS)
    assert FACT in FACTS
    assert len(set(FACTS)) == len(FACTS)
    assert set(JOIN) < set(sample())


# 명령행 JSON 출력과 두 입력 보존 확인
def test_cli(tmp_path):
    raw = {
        "labels.json": json.dumps(labels([sample()])),
        "guesses.json": json.dumps(guess([pick(sample(), "CONFIRMED")])),
    }
    for name, text in raw.items():
        (tmp_path / name).write_text(text)
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    result = subprocess.run(
        [sys.executable, "-m", "replay_video.validation",
         str(tmp_path / "labels.json"), str(tmp_path / "guesses.json")],
        capture_output=True, text=True, check=False, env=environment,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["semanticValidation"] == "NOT_APPROVED"
    for name, text in raw.items():
        assert (tmp_path / name).read_text() == text
