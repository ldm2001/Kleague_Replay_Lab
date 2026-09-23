from dataclasses import replace
import hashlib
import importlib
import subprocess
import pytest
from replay_video.domain.models import Candidate, Evidence
from replay_video.infrastructure.audio import AudioCue, AudioScan, AudioScanStatus, audioCues

# 시험용 호출 규약 반환
def api():
    # 원본 결합 음향 관측 구현을 지연 로드하여 반환
    return importlib.import_module('replay_video.infrastructure.sounds')

# 탐색 모형
def scan(status=AudioScanStatus.COMPLETE):
    # 정해진 시간 범위와 단서를 가진 음향 탐색 대역 반환
    return AudioScan(
        status,
        None,
        (AudioCue(1300, 1600, (3700.0, 4100.0), 3),),
        48000,
        2,
        5.0,
        300,
        300,
        10000,
        97,
    )

# 원본 결합 음향의 시각 차이 중복 적용 방지 확인
def test_source_bound_audio_keeps_original_offset_without_applying_it_twice(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")
    # 영상 원본 지문과 결합한 음향 관측 정보 생성
    result = api().observations(source, duration_ms=10000, scan=lambda *a, **kw: scan())
    # 관측 결과 목록을 후속 비교에 사용할 값으로 보관
    audio = result["observations"]
    # 원본 파일 지문이 예상 계약과 일치하는지 확인
    assert audio["sourceSha256"] == hashlib.sha256(b"source").hexdigest()
    # 영상 대비 음향 시각 차이가 300과 일치하는지 확인
    assert audio["timeline"]["audioOffsetMs"] == 300
    # 영상 원점 시각이 예상 계약과 일치하는지 확인
    assert audio["timeline"]["videoOriginSeconds"] == 5.
    # 시작 시각이 1300과 일치하는지 확인
    assert audio["cues"][0]["startMs"] == 1300
    # 발화 처리 상태가 예상 계약과 일치하는지 확인
    assert audio["speechStatus"] == "NOT_ANALYZED"
    # 관측 방법이 예상 계약과 일치하는지 확인
    assert audio["method"] == "spectral-multitone-v1"
    # 기존 음향 관측 구현의 소스 지문이 기록되는지 확인
    assert "audio.py" in result["implementation"]["sourceFilesSha256"]
    # 원본 결합 관측 구현의 소스 지문도 기록되는지 확인
    assert "audio_observations.py" in result["implementation"]["sourceFilesSha256"]
    # 음향과 증거의 시간 연결 목록이 빈 값으로 유지되는지 확인
    assert audio["associations"] == []

# 음향 탐색 중 원본 변경 시 시각 연결 차단 확인
def test_audio_scan_source_mutation_cannot_be_linked_to_visual_scan(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")

    # 원본 변경 모형
    def changed(*args, **kwargs):
        # 입력 영상에 시험 내용을 기록
        source.write_bytes(b"different")
        # 원본 변경 이후의 고정 음향 탐색 결과 반환
        return scan()
    # 음향 탐색 중 원본 변경 시 시각 연결 차단을 위한 예상 예외 확인
    with pytest.raises(ValueError, match="AUDIO_SOURCE_CHANGED"):
        # 영상 원본 지문과 결합한 음향 관측 정보 생성
        api().observations(source, duration_ms=10000, scan=changed)

# 완전 무음과 음향 부재 구분 확인
def test_complete_silence_and_missing_audio_remain_different(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")
    # 소리 트랙은 있지만 단서가 없는 완료 관측 생성
    silent = api().observations(
        source, duration_ms=10000, scan=lambda *a, **kw: replace(scan(), cues=())
    )["observations"]
    # 소리 트랙 자체가 없는 탐색 대역 생성
    absent = AudioScan(
        AudioScanStatus.ABSENT, "AUDIO_STREAM_ABSENT", (), None, None, None, None, None, None, 0
    )
    # 음향 부재 상태의 관측 결과만 추출
    missing = api().observations(source, duration_ms=10000, scan=lambda *a, **kw: absent)[
        "observations"
    ]
    # 무음 트랙은 단서가 영 개인 정상 완료로 남는지 확인
    assert silent["status"] == "COMPLETE" and silent["cueCount"] == 0
    # 음향 부재는 단서 개수와 별개로 부재 상태를 보존하는지 확인
    assert missing["status"] == "ABSENT" and missing["cueCount"] == 0
    # 음향 탐색 종료 시각이 비어 있는지 확인
    assert missing["timeline"]["scannedEndMs"] is None

# 진단 기록 전 원시 음향 탐색 보존 확인
def test_audio_raw_scan_is_not_truncated_before_diagnostic_writer(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")
    # 고정 개수보다 많은 단서를 만들어 전체 구간 보존 시험
    many = tuple(AudioCue(i * 300, i * 300 + 200, (3700., 4100.), 2) for i in range(300))
    # 관측 결과 목록을 후속 비교에 사용할 값으로 보관
    result = api().observations(
        source, duration_ms=100000, scan=lambda *a, **kw: replace(scan(), cues=many)
    )["observations"]
    # 음향 단서 수가 관측 단서 목록의 개수와 일치하는지 확인
    assert result["cueCount"] == len(result["cues"]) == 300
    # 모든 음향 단서가 서로 다른 식별자를 갖는지 확인
    assert len({item["id"] for item in result["cues"]}) == 300
    # 수집 상한 초과 여부가 거짓인지 확인
    assert result["truncated"] is False

# 동일 후보를 덮는 클립과 시간만으로 연결 확인
def test_association_is_pure_temporal_and_requires_same_candidate_covering_clip(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")
    # 관측 결과 목록을 후속 비교에 사용할 값으로 보관
    audio = api().observations(source, duration_ms=10000, scan=lambda *a, **kw: scan())[
        "observations"
    ]
    # 변화 후보 목록을 비교에 사용할 고정 시험 자료로 구성
    candidates = (Candidate(7, "OTHER", 1000, 2000, 1400, .1, "LOW", (), ()),)
    # 증거 묶음을 비교에 사용할 고정 시험 자료로 구성
    evidence = (
        Evidence(7, "FRAME", tmp_path / "a.jpg", 1300, 1000, 2000),
        Evidence(9, "CLIP", tmp_path / "b.mp4", 1300, 1000, 2000),
        Evidence(7, "CLIP", tmp_path / "c.mp4", 1400, 1400, 1700),
        Evidence(7, "CLIP", tmp_path / "d.mp4", 1300, 1000, 2000, audio_status="PRESERVED"),
    )
    # 후보와 소리 포함 증거의 겹치는 시간 구간 연결
    linked = api().association(audio, candidates, evidence)
    # 음향과 증거의 시간 연결 목록이 예상 계약과 일치하는지 확인
    assert linked["associations"] == [{"cueId": audio["cues"][0]["id"], "candidateIndex": 7,
                                      "evidenceIndices": [3], "relation": "TEMPORAL_OVERLAP_ONLY"}]
    # 음향과 증거의 시간 연결 목록이 빈 값으로 유지되는지 확인
    assert audio["associations"] == []
    # 후보 범주가 예상 계약과 일치하는지 확인
    assert candidates[0].category == "OTHER"
    # 음향과 증거의 시간 연결 목록이 빈 값으로 유지되는지 확인
    assert api().association(audio, candidates, evidence[:3])["associations"] == []
    # 소리 미보존과 미지원 및 디코딩 실패 상태를 각각 시험
    for status in (None, "ABSENT", "OMITTED_UNSUPPORTED", "OMITTED_DECODE_FAILED"):
        # 음향이 없는 증거 묶음을 비교에 사용할 고정 시험 자료로 구성
        without_audio = (replace(evidence[3], audio_status=status),)
        # 음향과 증거의 시간 연결 목록이 빈 값으로 유지되는지 확인
        assert api().association(audio, candidates, without_audio)["associations"] == []

# 음향 취소의 디코딩 실패 변환 금지 확인
def test_audio_cancellation_is_not_rewritten_as_decode_failure(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")

    # 작업 취소
    def cancel():
        # 작업 취소 경로를 재현하는 예외 발생
        raise RuntimeError("lease-lost")
    # 음향 취소의 디코딩 실패 변환 금지을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="lease-lost"):
        # 원본 시간축으로 음향 단서 탐색
        audioCues(source, duration_ms=1000, check_cancelled=cancel)

# 연결 상한과 입력 불변성 확인
def test_association_caps_and_input_immutability(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")
    # 관측 결과 목록을 후속 비교에 사용할 값으로 보관
    audio = api().observations(source, duration_ms=10000, scan=lambda *a, **kw: scan())[
        "observations"
    ]
    # 관측 단서 목록의 선택 항목 목록을 후속 비교에 사용할 값으로 보관
    audio["cues"] = [dict(audio["cues"][0], id=f"cue-{index}") for index in range(256)]
    # 음향 단서 수를 시험 조건에 맞춰 고정
    audio["cueCount"] = 256
    # 변화 구간과 대표 시각을 가진 시험 후보 결과 목록을 후속 비교에 사용할 값으로 보관
    candidates = tuple(
        Candidate(index, "OTHER", 1000, 2000, 1400, 0.1, "LOW", (), ()) for index in range(3)
    )
    # 후보 번호와 파일 경로가 연결된 시험 증거 결과 목록을 후속 비교에 사용할 값으로 보관
    evidence = tuple(
        Evidence(
            candidate.index,
            "CLIP",
            tmp_path / f"{candidate.index}-{index}.mp4",
            1400,
            1000,
            2000,
            audio_status="PRESERVED",
        )
        for candidate in candidates
        for index in range(17)
    )
    # 후보와 소리 포함 증거의 겹치는 시간 구간 연결
    linked = api().association(audio, candidates, evidence)
    # 음향과 증거의 시간 연결 목록의 개수가 512과 일치하는지 확인
    assert len(linked["associations"]) == 512
    # 각 연결의 증거 번호 목록도 열여섯 개 상한을 지키는지 확인
    assert all(len(item["evidenceIndices"]) == 16 for item in linked["associations"])
    # 수집 상한 초과 여부가 참인지 확인
    assert linked["truncated"] is True
    # 사유 목록에서 지정 값의 출현 횟수이 1과 일치하는지 확인
    assert linked["reasons"].count("AUDIO_ASSOCIATION_LIMIT") == 1
    # 연결 결과의 절단 상태가 원래 음향 입력을 변경하지 않는지 확인
    assert audio["associations"] == [] and audio["truncated"] is False
    # 연결 상한 사유가 원래 음향 입력에 추가되지 않는지 확인
    assert "AUDIO_ASSOCIATION_LIMIT" not in audio["reasons"]

# 원시 음향 디코딩 중 취소 시 디코더 종료 확인
def test_cancellation_during_pcm_decode_terminates_decoder(tmp_path, monkeypatch):
    from test_audio import run_ffmpeg
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mkv"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=20:d=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=48000:duration=3",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(source),
    )
    # 디코더 생성 함수를 교체할 음향 구현 모듈 읽음
    module = importlib.import_module("replay_video.infrastructure.audio")
    # 생성 이력 기록 후 실제 디코더를 실행할 원래 함수 보관
    spawn = subprocess.Popen
    # 생성한 디코더 프로세스 목록을 누적할 빈 자료 구조 준비
    processes = []

    # 기록 모형
    def recording(*args, **kwargs):
        # 실제 디코더 프로세스를 생성하여 종료 여부 추적
        process = spawn(*args, **kwargs)
        # 생성한 디코더 프로세스 목록에 이번 항목 추가
        processes.append(process)
        # 디코더 프로세스를 호출자에게 반환
        return process
    # 디코더 실행을 유지하면서 프로세스 이력만 수집하는 대역 연결
    monkeypatch.setattr(module.subprocess, "Popen", recording)
    # 취소 확인 횟수를 시험 조건에 맞춰 고정
    checks = 0

    # 작업 취소
    def cancel():
        # 바깥 시험의 취소 확인 횟수를 갱신하도록 연결
        nonlocal checks
        # 취소 확인 횟수에 이번 실행분 누적
        checks += 1
        # 일정 횟수의 확인 이후 디코딩 도중 취소 발생
        if checks >= 6:
            # 작업 취소 경로를 재현하는 예외 발생
            raise RuntimeError("lease-lost-during-read")
    # 원시 음향 디코딩 중 취소 시 디코더 종료을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="lease-lost-during-read"):
        # 원본 시간축으로 음향 단서 탐색
        audioCues(source, duration_ms=3000, check_cancelled=cancel)
    # 취소 뒤 생성한 모든 디코더 프로세스가 종료됐는지 확인
    assert processes and all(process.poll() is not None for process in processes)

# 손상 음향 패킷의 탐색 완료 오인 방지 확인
def test_damaged_audio_packets_cannot_be_reported_as_complete_scan(tmp_path):
    from test_audio import run_ffmpeg
    # 입력 영상 · 손상시킨 시험 영상을 비교에 사용할 고정 시험 자료로 구성
    source, damaged = tmp_path / "source.mkv", tmp_path / "damaged.mkv"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=20:d=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=48000:duration=3",
        "-c:v",
        "ffv1",
        "-c:a",
        "aac",
        str(source),
    )
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-i",
        str(source),
        "-map",
        "0",
        "-c",
        "copy",
        "-bsf:a",
        "noise=amount='if(between(n,40,50),1,0)'",
        str(damaged),
    )
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert audioCues(source, duration_ms=3000).status == AudioScanStatus.COMPLETE
    # 원본 시간축으로 음향 단서 탐색
    result = audioCues(damaged, duration_ms=3000)
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert result.status == AudioScanStatus.FAILED
    # 사유가 예상 계약과 일치하는지 확인
    assert result.reason == "DECODE_FAILED"
    # 관측 단서 목록이 빈 값으로 유지되는지 확인
    assert result.cues == ()
