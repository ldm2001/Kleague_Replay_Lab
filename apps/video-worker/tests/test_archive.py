import gzip
import hashlib
import importlib
import json
from pathlib import Path
import pytest
from replay_video.domain.models import Evidence, Shot
from fixtures.interaction import frame

# 시험 환경 구성
def setup(tmp_path):
    # 원시 관측 자료를 시험용 기준 경로에서 구성
    raw = tmp_path / "perception.jsonl.gz"
    # 기록 행 목록을 비교에 사용할 고정 시험 자료로 구성
    rows = [{"kind": "HEADER", "sourceSha256": "a" * 64}, frame(), frame(100, shift=10)]
    # 원시 관측 자료에 시험 내용을 기록
    raw.write_bytes(gzip.compress("".join(json.dumps(r) + "\n" for r in rows).encode()))
    # 비공개 산출물을 비교에 사용할 고정 시험 자료로 구성
    artifact = {
        "path": raw.name,
        "contentType": "application/gzip",
        "contentSha256": hashlib.sha256(raw.read_bytes()).hexdigest(),
        "sizeBytes": raw.stat().st_size,
    }
    # 증거 클립을 시험용 기준 경로에서 구성
    clip = tmp_path / "clip.mp4"
    # 증거 클립에 시험 내용을 기록
    clip.write_bytes(b"actual extracted clip")
    # 비공개 산출물 · 후보 번호와 파일 경로가 연결된 시험 증거 결과 · 원시 관측 자료를 호출자에게 반환
    return artifact, (Evidence(0, "CLIP", clip, 0, 0, 200),), raw

# 관측 확장 모형
def enrich(tmp_path, artifact, evidence):
    # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장 결과 반환
    return importlib.import_module('replay_video.infrastructure.interactions').enrichment(
        tmp_path, artifact, "a" * 64, (Shot(0, 0, 1000),), evidence
    )

# 검증된 실제 증거와 측정값 저장 및 입력 보존 확인
def test_persists_measurements_with_verified_actual_evidence_and_preserves_input(tmp_path):
    # 원본 지문과 연결된 압축 관측 및 증거 클립 준비
    artifact, evidence, raw = setup(tmp_path)
    # 원시 관측 자료에 저장된 내용 읽음
    before = raw.read_bytes()
    # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
    result = enrich(tmp_path, artifact, evidence)
    # 원시 관측 자료의 내용이 변경 전 값과 일치하는지 확인
    assert raw.read_bytes() == before
    # 확장 결과가 가리키는 실제 산출물 경로 계산
    output = tmp_path / result["path"]
    # 파일 내용 지문이 예상 계약과 일치하는지 확인
    assert result["contentSha256"] == hashlib.sha256(output.read_bytes()).hexdigest()
    # 압축 산출물의 각 줄을 관측 기록으로 해석
    rows = [json.loads(line) for line in gzip.decompress(output.read_bytes()).splitlines()]
    # 헤더와 다른 기록을 제외하고 상호작용 관측만 선택
    observations = [r for r in rows if r["kind"] == "INTERACTION_OBSERVATION"]
    # 관측 결과 목록의 개수가 2과 일치하는지 확인
    assert len(observations) == 2
    # 파일 내용 지문이 예상 계약과 일치하는지 확인
    assert (
        observations[1]["evidence"][0]["contentSha256"]
        == hashlib.sha256(evidence[0].path.read_bytes()).hexdigest()
    )
    # 측정 구간 포함 여부가 참인지 확인
    assert observations[1]["evidence"][0]["coversMeasurementWindow"] is True
    # 산출물 지문이 파일 내용 지문과 일치하는지 확인
    assert observations[1]["upstream"]["artifactSha256"] == artifact["contentSha256"]
    # 종류가 예상 계약과 일치하는지 확인
    assert rows[-1]["kind"] == "INTERACTION_OBSERVATION_SUMMARY"
    # 변화 후보 수가 1과 일치하는지 확인
    assert rows[-1]["candidateCount"] == 1
    # 소유자 이외의 사용자에게 산출물 접근 권한이 없는지 확인
    assert output.stat().st_mode & 0o077 == 0

# 근거와 결합되지 않은 파일 거부 확인
@pytest.mark.parametrize("failure", ["hash", "source", "outside", "missing-media"])
def test_rejects_unbound_files(tmp_path, failure):
    # 각 변조 시험에 사용할 정상 관측과 증거 준비
    artifact, evidence, raw = setup(tmp_path)
    # 내용 지문 불일치 사례 선택
    if failure == "hash":
        # 파일 내용과 다른 지문으로 바꾸어 무결성 오류 재현
        artifact["contentSha256"] = "b" * 64
    # 원본 영상 귀속 불일치 사례 선택
    if failure == "source":
        # 원시 관측 자료에 시험 내용을 기록
        raw.write_bytes(gzip.compress(b'{"kind":"HEADER","sourceSha256":"wrong"}\n'))
        # 비공개 산출물에 입력을 반영하여 상태 갱신
        artifact.update(
            contentSha256=hashlib.sha256(raw.read_bytes()).hexdigest(), sizeBytes=raw.stat().st_size
        )
    # 허용 디렉터리 밖 경로 사례 선택
    if failure == "outside":
        # 파일 경로를 시험 조건에 맞춰 고정
        artifact["path"] = "../elsewhere.jsonl.gz"
    # 실제 증거 클립이 사라진 사례 선택
    if failure == "missing-media":
        # 파일 경로를 제거하여 누락 상황 재현
        evidence[0].path.unlink()
    # 근거와 결합되지 않은 파일 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError): enrich(tmp_path, artifact, evidence)

# 미디어 부재 시 유효 측정값 보존 확인
def test_absent_media_does_not_erase_valid_measurements(tmp_path):
    # 증거 미디어 없이 원시 관측만 있는 입력 준비
    artifact, _, _ = setup(tmp_path)
    # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
    result = enrich(tmp_path, artifact, ())
    # 확장 산출물의 압축을 풀어 기록 행 읽음
    rows = [
        json.loads(line)
        for line in gzip.decompress((tmp_path / result["path"]).read_bytes()).splitlines()
    ]
    # 측정값 보존 여부를 확인할 상호작용 관측 선택
    row = next(r for r in rows if r["kind"] == "INTERACTION_OBSERVATION")
    # 상태가 예상 계약과 일치하는지 확인
    assert row["measurements"]["centerDistance"]["state"] == "MEASURED"
    # 증거 묶음이 빈 값으로 유지되는지 확인
    assert row["evidence"] == []
    # 증거 선택 사유 목록이 예상 계약과 일치하는지 확인
    assert row["evidenceReasons"] == ["MEDIA_EVIDENCE_NOT_LINKED"]

# 기존 출력 덮어쓰기 방지 확인
def test_output_is_not_overwritten(tmp_path):
    # 기존 출력 덮어쓰기 시험에 사용할 정상 자료 준비
    artifact, evidence, _ = setup(tmp_path)
    # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
    first = enrich(tmp_path, artifact, evidence)
    # 재실행 전 기존 산출물의 바이트 보관
    before = (tmp_path / first["path"]).read_bytes()
    # 기존 출력 덮어쓰기 방지을 위한 예상 예외 확인
    with pytest.raises(FileExistsError): enrich(tmp_path, artifact, evidence)
    # 재실행 거부 후에도 기존 산출물 내용이 그대로인지 확인
    assert (tmp_path / first["path"]).read_bytes() == before

# 확장 산출물의 기존 비공개 업로드 경로 사용 확인
def test_extended_artifact_uses_existing_private_upload_path(tmp_path):
    from replay_video.runner import perceptionArtifact
    from test_transport import TransportApi, CLAIM, ANALYSIS_ID, JOB_ID, JOB_REVISION
    import base64
    # 기존 업로드 경로와 연결할 관측 및 증거 준비
    artifact, evidence, _ = setup(tmp_path)
    # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
    extended = enrich(tmp_path, artifact, evidence)
    # 파일 내용 지문을 후속 비교에 사용할 값으로 보관
    sha = extended["contentSha256"]
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 서버가 발급할 업로드 권한 목록을 비교에 사용할 고정 시험 자료로 구성
    api.grants = [
        {
            "kind": "GRANTED",
            "items": [
                {
                    "name": Path(extended["path"]).name,
                    "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{sha}.jsonl.gz",
                    "uploadUrl": "http://private-artifact",
                    "headers": {
                        "x-amz-checksum-sha256": base64.b64encode(bytes.fromhex(sha)).decode(),
                        "if-none-match": "*",
                    },
                }
            ],
        }
    ]
    # 시험 값을 비교에 사용할 고정 시험 자료로 구성
    value = {
        "schemaVersion": "perception-run-v1",
        "sourceSha256": "a" * 64,
        "processingStatus": "COMPLETE",
        "coverage": {},
        "models": [],
        "summary": {},
        "incidents": [],
        "artifact": extended,
    }
    # 비공개 인식 산출물을 검증하고 저장소 경로로 교체
    uploaded = perceptionArtifact(api, CLAIM, tmp_path, value)
    # 업로드 객체가 비공개 인식 네임스페이스를 사용하는지 확인
    assert uploaded["artifact"]["objectKey"].startswith("perception/")
    # 업로드 후 관측 정보에 측정값 목록이 포함되지 않는지 확인
    assert "measurements" not in json.dumps(uploaded)
    # 업로드 이력의 선택 항목의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.uploads[0][1] == tmp_path / extended["path"]

# 취소 시 부분 산출물 미게시 확인
def test_cancel_does_not_publish_partial_artifact(tmp_path):
    # 처리 취소를 주입할 정상 관측 자료 준비
    artifact, _, _ = setup(tmp_path)
    from replay_video.infrastructure.interactions import enrichment

    # 작업 취소
    def cancel():
        # 작업 취소 경로를 재현하는 예외 발생
        raise RuntimeError("cancelled")

    # 취소 시 부분 산출물 미게시을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="cancelled"):
        # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
        enrichment(tmp_path, artifact, "a" * 64, (), (), check_cancelled=cancel)
    # 압축 관측 파일의 존재 여부가 거짓이거나 비어 있는지 확인
    assert not (tmp_path / "interaction-observations.jsonl.gz").exists()
    # 취소 후 게시용 임시 파일도 남지 않는지 확인
    assert list(tmp_path.glob(".interaction-*")) == []

# 게시 전 원시 크기 상한 검사 확인
def test_raw_size_limit_is_checked_without_publishing(tmp_path, monkeypatch):
    # 압축 해제 크기 상한 시험에 사용할 정상 자료 준비
    artifact, _, _ = setup(tmp_path)
    # 시험에서 크기 상한을 교체할 관측 확장 모듈 읽음
    module = importlib.import_module('replay_video.infrastructure.interactions')
    # 작은 관측 파일로도 상한 초과가 발생하도록 원시 크기 제한 축소
    monkeypatch.setattr(module, "MAX_RAW_BYTES", 32)
    # 게시 전 원시 크기 상한 검사을 위한 예상 예외 확인
    with pytest.raises(ValueError, match="OBSERVATION_INPUT_LIMIT"):
        # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
        enrich(tmp_path, artifact, ())
    # 압축 관측 파일의 존재 여부가 거짓이거나 비어 있는지 확인
    assert not (tmp_path / "interaction-observations.jsonl.gz").exists()

# 조립기의 비공개 관측 포트 활성화 확인
def test_factory_enables_private_observation_port():
    from replay_video.infrastructure.ports import operating
    # 비공개 관측 포트가 존재하는지 확인
    assert operating().private_observations is not None
