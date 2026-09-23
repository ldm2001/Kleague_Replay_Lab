import json
import pytest
from replay_video.application.pipeline import pipeline
from replay_video.application.ports import PipelinePorts
from replay_video.domain.models import Candidate, Evidence
from replay_video.infrastructure.sounds import observations
from test_sounds import scan
from test_perception import api, local_report, setup

# 시험용 영상·음향 보고서 반환
def av_report(source, root):
    # 관측 배열 없이 음향 연결을 시험할 로컬 인식 보고서 생성
    raw = local_report(source, root, observations=[])
    # 원시 관측 자료에 입력을 반영하여 상태 갱신
    raw.update(
        schemaVersion="perception-run-v2",
        pipelineVersion="video-local-observers-av-v1",
        audio=observations(source, duration_ms=10000, scan=lambda *a, **kw: scan())["observations"],
    )
    # 원시 관측 자료를 호출자에게 반환
    return raw

# 시각 관측 전 원본 전체 음향 관측 확인
def test_adapter_observes_whole_source_audio_before_visual_observers(tmp_path):
    # 음향·영상 관측 실행 순서를 확인할 입력 준비
    source, metadata, shots = setup(tmp_path)
    # 호출 이력을 누적할 빈 자료 구조 준비
    calls = []
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"

    # 시험용 음향 반환
    def audio(source, **kwargs):
        # 호출 이력에 이번 항목 추가
        calls.append(("audio", kwargs["duration_ms"]))
        # 영상 원본 지문과 결합한 음향 관측 정보 결과 반환
        return observations(source, scan=lambda *a, **kw: scan(), **kwargs)

    # 시각 관측 모형
    def visual(source, output, **kwargs):
        # 호출 이력에 이번 항목 추가
        calls.append(("visual", kwargs["audio_input"]["observations"]["sourceSha256"]))
        # 원본 지문에 결합한 영상·음향 보고서 대역 반환
        return av_report(source, root)
    # 모델 관측을 규정 입력 계약으로 옮기는 어댑터 생성
    adapter = api().PerceptionAdapter(observe=visual, audio_enabled=True, observe_audio=audio)
    # 음향과 영상 관측을 결합하는 인식 어댑터 실행
    result = adapter(source, root, metadata, (), shots)
    # 영상 관측보다 음향 관측이 먼저 실행되는지 확인
    assert [call[0] for call in calls] == ["audio", "visual"]
    # 음향 관측이 원본 영상 전체 길이를 전달받는지 확인
    assert calls[0][1] == metadata.duration_ms
    # 변화 후보 목록이 빈 값으로 유지되는지 확인
    assert result.candidates == ()  # 소리만으로 판정 후보 생성 금지
    # 음향 단서 수가 1과 일치하는지 확인
    assert result.perception["audio"]["cueCount"] == 1
    # 파이프라인 판본이 예상 계약과 일치하는지 확인
    assert adapter.pipeline_version == "video-local-observers-av-v1"

# 후보 보존과 증거 생성 후 음향 연결 확인
def test_av_pipeline_preserves_candidates_and_binds_audio_after_evidence(tmp_path):
    # 영상·음향 전송 계약을 확인할 원본과 샷 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    candidate = Candidate(7, "OTHER", 1000, 2000, 1400, .1, "LOW", (), (0,))

    # 인식 모형
    def perception(source, output, meta, candidates, shots):
        # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환 결과 반환
        return api().adaptation(av_report(source, root), root, meta, candidates, shots)
    # 시험에 필요한 파이프라인 단계별 대역 묶음 생성
    ports = PipelinePorts(
        probe=lambda _: metadata,
        shots=lambda *a: shots,
        candidates=lambda *a: (candidate,),
        perception=perception,
        evidence=lambda *a: (
            Evidence(7, "CLIP", root / "clip.mp4", 1400, 1000, 2000, audio_status="PRESERVED"),
        ),
    )
    # 시험 입력으로 전체 영상 처리 단계 실행
    result = pipeline(source, root, ports=ports, pipeline_version="video-local-observers-av-v1")
    # 저장된 문자열을 구조화된 자료로 읽음
    payload = json.loads(result.report_path.read_text())
    # 파이프라인 판본이 예상 계약과 일치하는지 확인
    assert result.pipeline_version == "video-local-observers-av-v1"
    # 변화 후보 목록의 개수가 1과 일치하는지 확인
    assert len(result.candidates) == 1
    # 보강 뒤에도 기존 후보의 시작 시각이 보존되는지 확인
    assert result.candidates[0].start_ms == candidate.start_ms
    # 보강 뒤에도 기존 후보 신뢰도가 바뀌지 않는지 확인
    assert result.candidates[0].confidence == candidate.confidence
    # 증거 연결 번호 목록이 예상 계약과 일치하는지 확인
    assert payload["perception"]["audio"]["associations"][0]["evidenceIndices"] == [0]
    # 음향 보존과 별개로 발화 해석은 수행하지 않았다는 한계 확인
    assert "speech_not_analyzed" in payload["limitations"]

# 영상·음향 파이프라인의 구형 관측 거부 확인
def test_av_pipeline_cannot_silently_accept_legacy_observations(tmp_path):
    # 음향 필수 판본에서 구형 관측의 거부를 확인할 입력 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 시험에 필요한 파이프라인 단계별 대역 묶음 생성
    ports = PipelinePorts(
        probe=lambda _: metadata,
        shots=lambda *a: shots,
        candidates=lambda *a: (),
        evidence=lambda *a: (),
        perception=lambda *a: api().adaptation(
            local_report(source, root), root, metadata, (), shots
        ),
    )
    # 영상·음향 파이프라인의 구형 관측 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError, match="PERCEPTION_AUDIO_REQUIRED"):
        # 시험 입력으로 전체 영상 처리 단계 실행
        pipeline(source, root, ports=ports, pipeline_version="video-local-observers-av-v1")

# 다른 원본의 음향 관측 거부 확인
def test_av_adapter_rejects_different_source_audio_from_observer(tmp_path):
    # 음향 출처 불일치 시험용 정상 입력 준비
    source, metadata, shots = setup(tmp_path)
    # 출력 기준 경로를 시험용 기준 경로에서 구성
    root = tmp_path / "out"
    # 원본 지문에 결합된 정상 영상·음향 보고서 생성
    raw = av_report(source, root)
    # 음향 지문만 바꾸어 영상과 다른 원본 귀속 재현
    raw["audio"]["sourceSha256"] = "0" * 64
    # 다른 원본의 음향 관측 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError, match="PERCEPTION_AUDIO_SOURCE_MISMATCH"):
        # 모델 관측을 미검증 상태의 규정 입력 계약으로 변환
        api().adaptation(raw, root, metadata, (), shots)

# 운영 조립기의 영상·음향 선택과 구형 진단 버전 보존 확인
def test_operating_factory_selects_av_but_legacy_diagnostic_adapter_stays_v1():
    from replay_video.infrastructure.ports import operating
    # 파이프라인 판본이 예상 계약과 일치하는지 확인
    assert operating().perception.pipeline_version == "video-local-observers-av-v1"
    # 파이프라인 판본이 예상 계약과 일치하는지 확인
    assert api().PerceptionAdapter().pipeline_version == "video-local-observers-v1"

# 업로드 전 영상·음향 관측 누락 거부 확인
def test_runner_rejects_missing_av_observations_before_upload(tmp_path):
    from replay_video.runner import report
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(
        json.dumps(
            {
                "pipeline_version": "video-local-observers-av-v1",
                "shots": [],
                "candidates": [],
                "evidence": [],
                "limitations": [],
            }
        )
    )
    # 업로드 전 영상·음향 관측 누락 거부를 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="perception-required"):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(None, {}, path)
