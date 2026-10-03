import base64
import gzip
import hashlib
import json
from dataclasses import replace
from pathlib import Path
import pytest
from replay_video.domain.models import Evidence, Shot
from replay_video.infrastructure import interactions
from replay_video.infrastructure.ports import operating
from replay_video.runner import perceptionArtifact
from fixtures.interaction import frame
from test_transport import TransportApi, CLAIM, ANALYSIS_ID, JOB_ID, JOB_REVISION

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
    return interactions.enrichment(
        tmp_path, artifact, "a" * 64, (Shot(0, 0, 1000),), evidence
    )

# 신규 프레임은 실측 점 시각과 같은 관측에만 연결됨 확인
def test_measured_frame_time_matches_observation(tmp_path):
    # 관측 두 시각 중 뒤 시각의 실제 프레임 생성
    artifact, _, _ = setup(tmp_path)
    image = tmp_path / "frame.jpg"
    image.write_bytes(b"measured frame")
    result = enrich(tmp_path, artifact, (Evidence(0, "FRAME", image, 100, 100, 100),))
    rows = published(tmp_path, result)
    observations = [row for row in rows if row["kind"] == "INTERACTION_OBSERVATION"]
    # 다른 시각에는 연결하지 않고 점 시각만 보존함 확인
    assert observations[0]["evidence"] == []
    reference = observations[1]["evidence"][0]
    assert reference["timestampMs"] == reference["startMs"] == reference["endMs"] == 100
    assert reference["coversMeasurementWindow"] is False

# 신규 프레임의 구간형 시각이나 시각 불일치 확장 거부 확인
@pytest.mark.parametrize("change", [
    {"timestamp_ms": None},
    {"timestamp_ms": True},
    {"timestamp_ms": "100"},
    {"timestamp_ms": -1},
    {"start_ms": 0, "end_ms": 200},
    {"start_ms": 0, "end_ms": 0},
    {"start_ms": 100.0},
    {"end_ms": True},
])
def test_invalid_frame_time_is_rejected_before_enrichment(tmp_path, change):
    # 한 필드만 바꾼 프레임과 정상 원시 관측 준비
    artifact, _, _ = setup(tmp_path)
    image = tmp_path / "frame.jpg"
    image.write_bytes(b"measured frame")
    value = replace(Evidence(0, "FRAME", image, 100, 100, 100), **change)
    # 잘못된 시각으로 확장 산출물을 게시하지 않음 확인
    with pytest.raises(ValueError, match="OBSERVATION_MEDIA_INVALID"):
        enrich(tmp_path, artifact, (value,))
    assert not (tmp_path / "interaction-observations.jsonl.gz").exists()

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

    # 작업 취소
    def cancel():
        # 작업 취소 경로를 재현하는 예외 발생
        raise RuntimeError("cancelled")

    # 취소 시 부분 산출물 미게시을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="cancelled"):
        # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
        interactions.enrichment(tmp_path, artifact, "a" * 64, (), (), check_cancelled=cancel)
    # 압축 관측 파일의 존재 여부가 거짓이거나 비어 있는지 확인
    assert not (tmp_path / "interaction-observations.jsonl.gz").exists()
    # 취소 후 게시용 임시 파일도 남지 않는지 확인
    assert list(tmp_path.glob(".interaction-*")) == []

# 게시 전 원시 크기 상한 검사 확인
def test_raw_size_limit_is_checked_without_publishing(tmp_path, monkeypatch):
    # 압축 해제 크기 상한 시험에 사용할 정상 자료 준비
    artifact, _, _ = setup(tmp_path)
    # 작은 관측 파일로도 상한 초과가 발생하도록 원시 크기 제한 축소
    monkeypatch.setattr(interactions, "MAX_RAW_BYTES", 32)
    # 게시 전 원시 크기 상한 검사을 위한 예상 예외 확인
    with pytest.raises(ValueError, match="OBSERVATION_INPUT_LIMIT"):
        # 원시 관측과 실제 증거를 검증하여 비공개 측정 기록 확장
        enrich(tmp_path, artifact, ())
    # 압축 관측 파일의 존재 여부가 거짓이거나 비어 있는지 확인
    assert not (tmp_path / "interaction-observations.jsonl.gz").exists()

# 확장 산출물의 압축을 풀어 기록 행 목록 읽음
def published(tmp_path, result):
    # 게시된 확장 산출물의 각 줄을 기록 행으로 해석한 목록 반환
    return [
        json.loads(line)
        for line in gzip.decompress((tmp_path / result["path"]).read_bytes()).splitlines()
    ]

# 관측 예산 초과 시 오류 대신 앞쪽 관측만 기록하고 생략 표시 확인
def test_budget_keeps_prefix_and_marks_omitted_observations(tmp_path, monkeypatch):
    # 관측 예산 시험에 사용할 정상 자료 준비
    artifact, evidence, _ = setup(tmp_path)
    # 두 관측 중 첫 관측만 기록되도록 행 예산 축소
    monkeypatch.setattr(interactions, "BUDGET_ROWS", 1)
    # 예산을 넘은 확장도 실패 없이 게시된 기록 행 읽음
    rows = published(tmp_path, enrich(tmp_path, artifact, evidence))
    # 기록된 상호작용 관측 선택
    observations = [r for r in rows if r["kind"] == "INTERACTION_OBSERVATION"]
    # 첫 프레임 행에서 생성한 관측 한 건만 남았는지 확인
    assert [r["upstream"]["lineNumber"] for r in observations] == [2]
    # 요약 행의 기록 관측 수와 생략 표시 및 생략 수 확인
    assert (
        rows[-1]["observationCount"], rows[-1]["truncated"], rows[-1]["omittedObservationCount"]
    ) == (1, True, 1)

# 서버 색인의 관측 한 행 상한을 넘는 관측은 실패 대신 생략 표시 확인
def test_oversized_observation_is_omitted_with_marker(tmp_path, monkeypatch):
    # 거대 관측 행 시험에 사용할 정상 자료 준비
    artifact, evidence, _ = setup(tmp_path)
    # 모든 관측 행이 상한을 넘도록 관측 행 바이트 상한 축소
    monkeypatch.setattr(interactions, "MAX_OBSERVATION_BYTES", 16)
    # 거대 관측 행이 있어도 실패 없이 게시된 기록 행 읽음
    rows = published(tmp_path, enrich(tmp_path, artifact, evidence))
    # 상호작용 관측이 하나도 기록되지 않았는지 확인
    assert not [r for r in rows if r["kind"] == "INTERACTION_OBSERVATION"]
    # 요약 행이 생략된 두 관측을 표시하는지 확인
    assert (
        rows[-1]["observationCount"], rows[-1]["truncated"], rows[-1]["omittedObservationCount"]
    ) == (0, True, 2)

# 기본 관측 예산의 서버 색인 상한 미만 유지와 작은 입력의 무손실 기록 확인
def test_default_budget_stays_below_server_index_limits(tmp_path):
    # 서버 공유 비공개 색인 행 수 상한 10000보다 행 예산이 낮은지 확인
    assert interactions.BUDGET_ROWS < 10_000
    # 서버 공유 비공개 색인 바이트 상한 32MiB보다 바이트 예산이 낮은지 확인
    assert interactions.BUDGET_BYTES < 32 * 1024 * 1024
    # 서버 수신기의 관측 한 행 상한 65536 이하인지 확인
    assert interactions.MAX_OBSERVATION_BYTES <= 65_536
    # 기본 예산으로 작은 입력을 확장한 기록 행 읽음
    rows = published(tmp_path, enrich(tmp_path, *setup(tmp_path)[:2]))
    # 생략 없이 모든 관측을 기록했다는 요약 표시 확인
    assert (rows[-1]["truncated"], rows[-1]["omittedObservationCount"]) == (False, 0)

# 조립기의 비공개 관측 포트 활성화 확인
def test_factory_enables_private_observation_port():
    # 비공개 관측 포트가 존재하는지 확인
    assert operating().private_observations is not None
