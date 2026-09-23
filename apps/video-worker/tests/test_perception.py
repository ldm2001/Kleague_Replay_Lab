from dataclasses import replace
import gzip
import hashlib
import importlib
import json
from pathlib import Path
import pytest
from replay_video.application.pipeline import pipeline
from replay_video.application.ports import PipelinePorts
from replay_video.domain.models import Candidate, Evidence, Shot, VideoMetadata
from replay_video.infrastructure.evidence import evidence

# 시험용 호출 규약 반환
def api():
    # 시험 중 구현을 교체할 인식 연결 모듈을 지연 로드하여 반환
    return importlib.import_module("replay_video.infrastructure.perception")

# 시험용 관측 반환
def observation(identifier="official-one", start=3000, end=3500):
    # 시각과 역할 가설 및 미채택 상태를 가진 모델 관측 대역 반환
    return {
        "id": identifier,
        "startMs": start,
        "endMs": end,
        "continuityId": 0,
        "officialRole": "UNKNOWN",
        "signalKind": "RAISED_ARM",
        "supportFrameCount": 4,
        "contact": "UNVERIFIED",
        "originalDecision": "UNKNOWN",
        "restart": "UNVERIFIED",
        "reasons": ["SIGNAL_MEANING_UNVALIDATED"],
    }

# 시험용 로컬 보고서 반환
def local_report(source, root, *, observations=None):
    # 파일 경로를 시험용 기준 경로에서 구성
    path = root / "perception" / "perception.jsonl.gz"
    # 파일 경로의 상위 디렉터리를 시험용으로 생성
    path.parent.mkdir(parents=True, exist_ok=True)
    # 파일 경로에 시험 내용을 기록
    path.write_bytes(
        gzip.compress(
            (
                json.dumps(
                    {
                        "kind": "HEADER",
                        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    }
                )
                + "\n"
            ).encode()
        )
    )
    # 관측 범위와 원본 지문 및 비공개 산출물 정보가 있는 보고서 반환
    return {
        "schemaVersion": "perception-run-v1",
        "pipelineVersion": "video-local-observers-v1",
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "processingStatus": "COMPLETE",
        "coverage": {
            "startMs": 0,
            "endMs": 10000,
            "sampleIntervalMs": 100,
            "expectedSamples": 100,
            "processedSamples": 100,
            "failedSamples": 0,
        },
        "models": [],
        "artifact": {
            "path": str(path),
            "contentType": "application/gzip",
            "contentSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sizeBytes": path.stat().st_size,
        },
        "summary": {
            "roleObservationCount": 100,
            "poseObservationCount": 100,
            "officialCueCount": 1,
            "interactionCount": 0,
            "linkCount": 0,
            "truncated": False,
            "reasons": ["CONTACT_METHOD_UNVALIDATED"],
        },
        "observations": [observation()] if observations is None else observations,
        "interactions": [],
        "links": [],
    }

# 시험 환경 구성
def setup(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 10000, 320, 180, 10., 100, "test")
    # 샷 구간 목록을 비교에 사용할 고정 시험 자료로 구성
    shots = (Shot(0, 0, 5000), Shot(1, 5001, 10000))
    # 입력 영상 · 영상 메타데이터 · 샷 구간 목록을 호출자에게 반환
    return source, metadata, shots

# 사실 생성 없는 제한된 기타 관측 후보 확인
def test_observer_episode_creates_bounded_other_candidate_without_facts(tmp_path):
    # 새 사건 후보 생성 시험용 원본과 시간축 및 샷 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 로컬 비공개 산출물과 연결된 인식 보고서 생성
    raw = local_report(source, root)
    # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환
    result = api().adaptation(raw, root, metadata, (), shots)
    # 변화 후보 목록의 선택 항목을 후속 비교에 사용할 값으로 보관
    candidate = result.candidates[0]
    # 후보 범주가 예상 계약과 일치하는지 확인
    assert candidate.category == "OTHER"
    # 시작 시각 · 종료 시각이 예상 계약과 일치하는지 확인
    assert (candidate.start_ms, candidate.end_ms) == (1500, 6500)
    # 연결된 샷 번호 목록이 예상 계약과 일치하는지 확인
    assert candidate.shot_indices == (0, 1)
    # 화면 관측 충분성이 예상 계약과 일치하는지 확인
    assert candidate.camera_sufficiency == "LOW"
    # 후보 신뢰도가 0과 일치하는지 확인
    assert candidate.confidence == 0
    # 모델 관측만으로 사실 채택하지 않도록 추가 근거 요구 사유 확인
    assert "LOCAL_OBSERVER_EVIDENCE_REQUIRED" in candidate.reasons
    # 새 후보에 연결된 사건 요약 선택
    incident = result.perception["incidents"][0]
    # 변화 후보 번호가 항목 순번과 일치하는지 확인
    assert incident["candidateIndex"] == candidate.index
    # 접촉 관측이 예상 계약과 일치하는지 확인
    assert incident["contact"] == "UNVERIFIED"
    # 원심 관측이 예상 계약과 일치하는지 확인
    assert incident["originalDecision"] == "UNKNOWN"
    # 재개 관측이 예상 계약과 일치하는지 확인
    assert incident["restart"] == "UNVERIFIED"
    # 파일 경로가 예상 계약과 일치하는지 확인
    assert result.perception["artifact"]["path"] == "perception/perception.jsonl.gz"
    # 모델 관측 정보에 관측 결과 목록이 포함되지 않는지 확인
    assert "observations" not in result.perception

# 겹친 기존 후보와 구형 메타데이터 보존 확인
def test_overlapping_existing_candidate_and_legacy_metadata_are_preserved(tmp_path):
    # 기존 후보 보강 시험용 원본과 샷 구간 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    existing = Candidate(
        4, "OTHER", 2000, 4000, 2500, 0.8, "MEDIUM", ("motion",), (0,), tracking={"sampleCount": 5}
    )
    # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환
    result = api().adaptation(local_report(source, root), root, metadata, (existing,), shots)
    # 변화 후보 목록의 개수가 1과 일치하는지 확인
    assert len(result.candidates) == 1
    # 변화 후보 목록의 선택 항목을 후속 비교에 사용할 값으로 보관
    candidate = result.candidates[0]
    # 기존 후보 번호와 추적 정보가 보강 뒤에도 유지되는지 확인
    assert candidate.index == 4 and candidate.tracking == existing.tracking
    # 기존 대표 시각과 원시 변화 사유가 보존되는지 확인
    assert candidate.anchor_ms == existing.anchor_ms and "motion" in candidate.reasons
    # 보강된 구간이 사건 관측의 앞뒤 시각을 모두 포함하는지 확인
    assert candidate.start_ms <= 1500 and candidate.end_ms >= 6500

# 후보 한도 초과 요약의 명시적 절단 확인
def test_summaries_beyond_candidate_budget_are_explicitly_truncated(tmp_path, monkeypatch):
    # 새 후보 개수 상한을 시험할 원본과 시간축 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 새 사건이 여러 개 있는 로컬 인식 보고서 생성
    raw = local_report(
        source, root, observations=[observation("a", 100, 200), observation("b", 8000, 8500)]
    )
    # 소수 관측으로 상한 초과를 재현하도록 신규 후보 한도 축소
    monkeypatch.setattr(api(), "MAX_NEW_CANDIDATES", 1)
    # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환
    result = api().adaptation(raw, root, metadata, (), shots)
    # 변화 후보 목록의 개수가 1과 일치하는지 확인
    assert len(result.candidates) == 1
    # 수집 상한 초과 여부가 참인지 확인
    assert result.perception["summary"]["truncated"] is True
    # 추가 후보 제한 사유가 인식 요약에 남는지 확인
    assert "INCIDENT_SUMMARY_LIMIT" in result.perception["summary"]["reasons"]

# 진단 산출물의 작업 경로 외 참조 차단 확인
def test_diagnostic_artifact_cannot_reference_a_file_outside_job_root(tmp_path):
    # 잘못된 보고서 검증용 정상 원본과 샷 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 변조할 필드 이외는 정상인 로컬 인식 보고서 생성
    raw = local_report(source, root)
    # 입력 영상을 후속 비교에 사용할 값으로 보관
    raw["artifact"]["path"] = str(source)
    # 진단 산출물의 작업 경로 외 참조 차단을 위한 예상 예외 확인
    with pytest.raises(ValueError, match="PERCEPTION_ARTIFACT_PATH_INVALID"):
        # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환
        api().adaptation(raw, root, metadata, (), shots)

# 기존 용량 초과에도 관측 후보의 시간 클립 확보 확인
def test_observation_candidates_always_receive_temporal_clip_even_over_legacy_budget(
    tmp_path, monkeypatch
):
    # 샷 메타데이터 누락 시험에 사용할 원본과 시간축 준비
    source, metadata, _ = setup(tmp_path)
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    candidate = Candidate(
        0, "OTHER", 1000, 2000, 1500, 0.0, "LOW", ("LOCAL_OBSERVER_EVIDENCE_REQUIRED",), (0,)
    )
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        "replay_video.infrastructure.evidence.frame",
        lambda source, path, ms: path.write_bytes(b"frame"),
    )

    # 저장된 클립 반환
    def saved_clip(source, path, start, end):
        # 파일 경로에 시험 내용을 기록
        path.write_bytes(b"clip")
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.evidence.clip", saved_clip)
    # 변화 후보의 프레임과 클립 증거 생성
    result = evidence(source, tmp_path / "out", metadata, (candidate,), max_clips=0)
    # 종류 목록이 예상 계약과 일치하는지 확인
    assert [item.kind for item in result] == ["FRAME", "CLIP"]

# 증거 생성 전 관측과 실제 시간 클립만 연결 확인
def test_pipeline_observes_before_evidence_and_binds_only_actual_temporal_clips(tmp_path):
    from replay_video.infrastructure.interactions import enrichment
    # 운영 파이프라인 연결 시험용 원본과 메타데이터 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 호출 이력을 누적할 빈 자료 구조 준비
    calls = []

    # 관측 모형
    def observe(source, target, meta, candidates, actual_shots):
        # 호출 이력에 이번 항목 추가
        calls.append("perception")
        # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환 결과 반환
        return api().adaptation(
            local_report(source, target), target, meta, candidates, actual_shots
        )

    # 증거 포트 모형
    def evidence_port(source, target, meta, candidates):
        # 호출 이력에 이번 항목 추가
        calls.append("evidence")
        # 변화 후보 목록의 선택 항목을 후속 비교에 사용할 값으로 보관
        candidate = candidates[0]
        # 증거 이미지 파일에 시험 내용을 기록
        (target / "frame.jpg").write_bytes(b"frame")
        # 시험 영상 파일에 시험 내용을 기록
        (target / "clip.mp4").write_bytes(b"clip")
        # 후보 번호와 파일 경로가 연결된 시험 증거 결과 · 후보 번호와 파일 경로가 연결된 시험 증거 결과을 호출자에게 반환
        return (
            Evidence(
                candidate.index,
                "FRAME",
                target / "frame.jpg",
                3000,
                candidate.start_ms,
                candidate.end_ms,
            ),
            Evidence(
                candidate.index,
                "CLIP",
                target / "clip.mp4",
                3000,
                candidate.start_ms,
                candidate.end_ms,
            ),
        )
    # 시험에 필요한 파이프라인 단계별 대역 묶음 생성
    ports = PipelinePorts(
        probe=lambda value: metadata,
        shots=lambda source, meta: shots,
        candidates=lambda source, meta, shots: (),
        evidence=evidence_port,
        perception=observe,
        private_observations=enrichment,
    )
    # 시험 입력으로 전체 영상 처리 단계 실행
    result = pipeline(source, root, ports=ports, pipeline_version="video-local-observers-v1")
    # 저장된 문자열을 구조화된 자료로 읽음
    payload = json.loads(result.report_path.read_text())
    # 호출 이력이 예상 계약과 일치하는지 확인
    assert calls == ["perception", "evidence"]
    # 증거 연결 번호 목록이 예상 계약과 일치하는지 확인
    assert payload["perception"]["incidents"][0]["evidenceIndices"] == [1]
    # 자세 관측이 연결되면 기존 미지원 문구가 제거되는지 확인
    assert "pose_tracking_pending" not in payload["limitations"]
    # 자세 관측과 별개로 접촉 사실 추출은 미검증으로 남는지 확인
    assert "contact_fact_extraction_unverified" in payload["limitations"]
    # 보고서가 가리키는 비공개 관측 산출물의 실제 경로 계산
    artifact_path = root / payload["perception"]["artifact"]["path"]
    # 압축 산출물을 풀고 각 줄의 기록 읽음
    rows = [json.loads(line) for line in gzip.decompress(artifact_path.read_bytes()).splitlines()]
    # 종류가 예상 계약과 일치하는지 확인
    assert rows[-1]["kind"] == "INTERACTION_OBSERVATION_SUMMARY"
    # 비공개 인식 산출물이 실제 파일로 생성되는지 확인
    assert (root / "perception/perception.jsonl.gz").is_file()

# 관측 포트 없는 새 파이프라인 실행 차단 확인
def test_new_pipeline_version_cannot_silently_run_without_observer_port(tmp_path):
    # 불완전 인식 범위를 보존할 시험 원본과 샷 준비
    source, metadata, shots = setup(tmp_path)
    # 시험에 필요한 파이프라인 단계별 대역 묶음 생성
    ports = PipelinePorts(
        probe=lambda source: metadata,
        shots=lambda source, meta: shots,
        candidates=lambda source, meta, shots: (),
        evidence=lambda *args: (),
    )
    # 관측 포트 없는 새 파이프라인 실행 차단을 위한 예상 예외 확인
    with pytest.raises(ValueError, match="PERCEPTION_PORT_REQUIRED"):
        # 시험 입력으로 전체 영상 처리 단계 실행
        pipeline(source, tmp_path / "out", ports=ports, pipeline_version="video-local-observers-v1")

# 기본 분석의 운영 포트 선택과 검증 단계 모델 미사용 확인
def test_default_analyze_job_selects_operating_ports_but_validation_never_loads_models(
    tmp_path, monkeypatch
):
    from replay_video.worker import job
    # 작업자 기본 운영 포트 연결 시험용 원본과 시간축 준비
    source, metadata, shots = setup(tmp_path)
    # 해시 계산 호출 여부를 누적할 빈 자료 구조 준비
    called = []

    # 관측 결과 반환
    def observed(source, target, meta, candidates, shots):
        from replay_video.infrastructure.audio import AudioScan, AudioScanStatus
        from replay_video.infrastructure.sounds import observations
        # 관측 배열이 비어 있는 정상 인식 보고서 생성
        raw = local_report(source, target, observations=[])
        # 음향 부재를 정상 탐색 완료와 구별하는 탐색 대역 생성
        absent = AudioScan(
            AudioScanStatus.ABSENT, "AUDIO_STREAM_ABSENT", (), None, None, None, None, None, None, 0
        )
        # 원시 관측 자료에 입력을 반영하여 상태 갱신
        raw.update(
            schemaVersion="perception-run-v2",
            pipelineVersion="video-local-observers-av-v1",
            audio=observations(source, duration_ms=meta.duration_ms, scan=lambda *a, **kw: absent)[
                "observations"
            ],
        )
        # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환 결과 반환
        return api().adaptation(raw, target, meta, candidates, shots)

    # 운영 포트 모형
    def operating(**kwargs):
        # 해시 계산 호출 여부에 이번 항목 추가
        called.append(kwargs)
        # 시험에 필요한 파이프라인 단계별 대역 묶음 결과 반환
        return PipelinePorts(
            probe=lambda value: metadata,
            shots=lambda source, meta: shots,
            candidates=lambda source, meta, shots: (),
            evidence=lambda *args: (),
            perception=observed,
        )
    # 실제 모델 로드 대신 시험용 운영 포트 구성 함수 연결
    monkeypatch.setattr("replay_video.worker.operating", operating)
    # 실제 영상 조회 대신 준비한 메타데이터 공급
    monkeypatch.setattr("replay_video.worker.probe", lambda source: metadata)
    # 시험 값을 비교에 사용할 고정 시험 자료로 구성
    value = {"job_id": "one", "job_type": "VALIDATE_VIDEO", "source_path": str(source)}
    # 종류가 예상 계약과 일치하는지 확인
    assert job(value).payload["kind"] == "VALIDATED"
    # 해시 계산 호출 여부가 빈 값으로 유지되는지 확인
    assert called == []
    # 시험 영상 작업 실행
    result = job({**value, "job_type": "ANALYZE_VIDEO", "output_path": str(tmp_path / "out")})
    # 해시 계산 호출 여부의 개수가 1과 일치하는지 확인
    assert len(called) == 1
    # 파이프라인 판본이 예상 계약과 일치하는지 확인
    assert (
        json.loads(Path(result.payload["report_path"]).read_text())["pipeline_version"]
        == "video-local-observers-av-v1"
    )

# 운영 포트 상실 후 기본 경로 대체 금지 확인
def test_default_operating_factory_cannot_fall_back_to_baseline_after_losing_its_port(
    tmp_path, monkeypatch
):
    from replay_video.worker import job
    # 모델 호출 전 계약 검증용 원본과 샷 준비
    source, metadata, shots = setup(tmp_path)
    # 운영 관측 호출에 시험용 결과를 제공하는 대역 연결
    monkeypatch.setattr(
        "replay_video.worker.operating",
        lambda **kwargs: PipelinePorts(
            probe=lambda value: metadata,
            shots=lambda source, meta: shots,
            candidates=lambda *args: (),
            evidence=lambda *args: (),
        ),
    )
    # 운영 포트 상실 후 기본 경로 대체 금지을 위한 예상 예외 확인
    with pytest.raises(ValueError, match="PERCEPTION_PORT_REQUIRED"):
        # 시험 영상 작업 실행
        job(
            {
                "job_id": "one",
                "job_type": "ANALYZE_VIDEO",
                "source_path": str(source),
                "output_path": str(tmp_path / "out"),
            }
        )

# 확장 후보의 원본 전체 탐색 기반 추적 재집계 확인
def test_expanded_candidate_tracking_is_recounted_from_original_full_scan(tmp_path):
    # 상호작용 관측 보강용 원본과 시간축 및 샷 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 상호작용 기록을 넣을 로컬 인식 보고서 생성
    raw = local_report(source, root)
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    previous = Candidate(
        4,
        "OTHER",
        2000,
        4000,
        2500,
        0.8,
        "MEDIUM",
        ("motion",),
        (0,),
        tracking={
            "version": "ball-path-v1",
            "coverage": "COMPLETE",
            "sampleCount": 1,
            "selectedCount": 1,
            "cameraCount": 1,
            "motionOnsetsMs": [],
        },
    )
    # 추적 정보를 시험용 기준 경로에서 구성
    tracking = root / "tracking"
    # 추적 정보를 시험용으로 생성
    tracking.mkdir()
    # 시험 보고서 파일에 시험 내용을 기록
    (tracking / "context-summary.json").write_text(
        json.dumps({"source_sha256": raw["sourceSha256"], "coverage_status": "MATCHES_METADATA"})
    )
    # 참여자 이동이 이어지는 프레임별 관측 자료 구성
    samples = [
        {
            "timestamp_ms": ms,
            "ball_track": {
                "candidate": {},
                "compensated_displacement_px": 1,
                "motion_onset_ms": None,
            },
        }
        for ms in (2500, 4500)
    ]
    # 관측 기록 파일에 시험 내용을 기록
    (tracking / "context.jsonl").write_text("\n".join(json.dumps(item) for item in samples) + "\n")
    # 모델 관측을 규정 입력 계약으로 옮기는 어댑터 생성
    adapter = api().PerceptionAdapter(observe=lambda *args, **kwargs: raw)
    # 기존 후보를 보존하며 상호작용 모델 관측 연결 실행
    observed = adapter(source, root, metadata, (previous,), shots)
    # 표본 수가 2과 일치하는지 확인
    assert observed.candidates[0].tracking["sampleCount"] == 2
    # 선택한 후보 수가 2과 일치하는지 확인
    assert observed.candidates[0].tracking["selectedCount"] == 2
    # 표본 수가 1과 일치하는지 확인
    assert previous.tracking["sampleCount"] == 1

# 추적 갱신의 다른 원본 탐색 거부 확인
def test_tracking_refresh_rejects_another_source_scan(tmp_path):
    # 관측 취소 경로를 시험할 원본과 샷 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 취소 직전 사용할 정상 인식 보고서 생성
    raw = local_report(source, root)
    # 추적 정보를 시험용 기준 경로에서 구성
    tracking = root / "tracking"
    # 추적 정보를 시험용으로 생성
    tracking.mkdir()
    # 시험 보고서 파일에 시험 내용을 기록
    (tracking / "context-summary.json").write_text(
        json.dumps({"source_sha256": "0" * 64, "coverage_status": "MATCHES_METADATA"})
    )
    # 관측 기록 파일에 시험 내용을 기록
    (tracking / "context.jsonl").write_text("")
    # 모델 관측을 규정 입력 계약으로 옮기는 어댑터 생성
    adapter = api().PerceptionAdapter(observe=lambda *args, **kwargs: raw)
    # 추적 갱신의 다른 원본 탐색 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError, match="TRACKING_SOURCE_MISMATCH"):
        # 취소 콜백이 연결된 인식 어댑터 실행
        adapter(source, root, metadata, (), shots)
