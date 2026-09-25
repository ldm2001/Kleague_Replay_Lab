import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
import pytest


# 검증 모듈의 구현 존재 확인
def test_module():
    assert importlib.util.find_spec("replay_video.validation") is not None


# 합성 계약 시험용 사례 생성
def sample():
    return {
        "id": "case-1", "sourceSha256": "a" * 64,
        "matchId": "match-1", "eventId": "event-1", "split": "EVALUATION",
        "actorId": "player-1", "targetId": "player-2", "startMs": 0, "endMs": 1000,
        "factKey": "pulling", "expected": "CONFIRMED", "predicted": "CONFIRMED",
        "provenance": {
            "origin": "DEVELOPMENT_REVIEW", "reviewer": "test-only",
            "evidenceSha256": "b" * 64,
        },
    }


# 단일 방법의 계약 입력 생성
def dataset(cases=None):
    return {
        "schemaVersion": "holding-validation-v1",
        "producer": {"id": "synthetic-test-only", "version": "1"},
        "cases": [] if cases is None else cases,
    }


# 검증 실행 함수 연결
def report(data):
    from replay_video.validation import evaluate
    return evaluate(data)


# 빈 평가와 개발 전용 라벨의 사용 불가 확인
@pytest.mark.parametrize("cases", [[], [{**sample(), "split": "DEVELOPMENT"}]])
def test_unavailable(cases):
    result = report(dataset(cases))
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
              "expected": a, "predicted": b}
             for i, (a, b) in enumerate(pairs)]
    result = report(dataset(cases))
    stat = result["facts"]["pulling"]
    assert result["status"] == "MEASURED"
    assert [stat[k] for k in ("tp", "fp", "fn", "tn")] == [1, 1, 2, 1]
    assert stat["unknownPredictionCount"] == 3
    assert stat["unknownTruthCount"] == 2
    assert stat["precision"] == 0.5
    assert stat["recall"] == 1 / 3
    assert stat["coverage"] == 4 / 6
    assert stat["abstention"] == 2 / 6
    assert result["counts"] == {"total": 8, "development": 0, "evaluation": 8, "scorable": 6}
    assert result["facts"]["direction"]["precision"] is None


# 평가 대상 분할과 방법 및 자료 해시 결합 확인
def test_binding():
    data = dataset([sample()])
    result = report(data)
    assert result["method"] == data["producer"]
    assert result["schemaVersion"] == "holding-validation-report-v1"
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert result["datasetSha256"] == hashlib.sha256(canonical.encode()).hexdigest()
    data["producer"]["version"] = "2"
    assert report(data)["datasetSha256"] != result["datasetSha256"]
    development = {**sample(), "id": "dev", "split": "DEVELOPMENT",
                   "sourceSha256": "c" * 64, "matchId": "other", "eventId": "other"}
    scoped = report(dataset([sample(), development]))
    assert scoped["counts"]["development"] == 1
    assert scoped["facts"]["pulling"]["tp"] == 1


# 잘못된 사실과 출처 및 시간의 거부 확인
@pytest.mark.parametrize("key,value", [
    ("id", ""), ("sourceSha256", "bad"), ("factKey", "force"),
    ("startMs", -1), ("startMs", True), ("endMs", float("nan")),
    ("endMs", 0), ("expected", False), ("predicted", "HYPOTHESIS"),
    ("actorId", "player-2"), ("targetId", ""), ("split", "TEST"),
    ("provenance", {}), ("matchId", []), ("eventId", ""),
])
def test_invalid_case(key, value):
    case = sample()
    case[key] = value
    with pytest.raises(ValueError):
        report(dataset([case]))


# 누락 필드와 중복 사례 및 방법 계약의 거부 확인
def test_invalid_document():
    for data in [None, {}, {**dataset(), "cases": {}},
                 {**dataset(), "producer": {"id": "x", "version": ""}},
                 {**dataset(), "schemaVersion": "wrong"}, dataset([sample(), sample()])]:
        with pytest.raises(ValueError):
            report(data)
    for key in sample():
        case = sample()
        del case[key]
        with pytest.raises(ValueError):
            report(dataset([case]))


# 원본과 경기와 사건별 독립 분할 누수 거부 확인
@pytest.mark.parametrize("key", ["sourceSha256", "matchId", "eventId"])
def test_leakage(key):
    other = {**sample(), "id": "other", "sourceSha256": "c" * 64,
             "matchId": "different", "eventId": "different", "split": "DEVELOPMENT"}
    other[key] = sample()[key]
    with pytest.raises(ValueError, match="split leakage"):
        report(dataset([sample(), other]))


# 미확인 정답만 있는 평가의 사용 불가 확인
def test_unknown_only():
    result = report(dataset([{**sample(), "expected": "UNKNOWN"}]))
    assert result["status"] == "UNAVAILABLE"
    assert result["facts"]["pulling"]["fp"] == 0
    assert result["facts"]["pulling"]["coverage"] is None


# 다른 사례 ID로 반복된 동일 명제의 거부 확인
def test_duplicate_observation():
    with pytest.raises(ValueError, match="duplicate observation"):
        report(dataset([sample(), {**sample(), "id": "renamed"}]))


# 다른 원본 구간의 독립 명제 집계 확인
def test_distinct_observation():
    other = {**sample(), "id": "later", "startMs": 1000, "endMs": 2000}
    assert report(dataset([sample(), other]))["facts"]["pulling"]["tp"] == 2


# JSON 스키마 문자열의 개행 우회 방지 계약 확인
def test_schema_boundaries():
    path = Path(__file__).resolve().parents[3] / "datasets/labeled-cases/holding.schema.json"
    schema = json.loads(path.read_text())
    assert schema["$defs"]["hash"]["minLength"] == 64
    assert schema["$defs"]["hash"]["maxLength"] == 64
    assert schema["$defs"]["identifier"]["not"] == {"pattern": r"\s$"}
    for key, value in [("sourceSha256", "a" * 64 + "\n"), ("id", "name\n"), ("startMs", 0.0)]:
        with pytest.raises(ValueError):
            report(dataset([{**sample(), key: value}]))


# 명령행 JSON 출력과 입력 보존 확인
def test_cli(tmp_path):
    path = tmp_path / "labels.json"
    raw = json.dumps(dataset([sample()]))
    path.write_text(raw)
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    result = subprocess.run(
        [sys.executable, "-m", "replay_video.validation", str(path)],
        capture_output=True, text=True, check=False, env=environment,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["semanticValidation"] == "NOT_APPROVED"
    assert path.read_text() == raw
