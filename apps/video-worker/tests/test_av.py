"""알려진 신호의 영상·음향 비교이며 실제 심판 판정 평가 아님"""

import json
import subprocess
from pathlib import Path
import pytest
from replay_video.av import (
    audioComparison,
    visualComparison,
    fixture,
    cueScores,
)
from replay_video.infrastructure.evidence import clip

# 시험용 시각 보고서 반환
def visual_report():
    # 시각 비교의 기준이 되는 고정 보고서 계약 반환
    return {
        "schema_version": 2,
        "pipeline_version": "video-local-observers-v1",
        "video": {
            "source_name": "fixture.mkv",
            "duration_ms": 1500,
            "width": 64,
            "height": 64,
            "fps": 20,
            "frame_count": 30,
            "codec": "ffv1",
        },
        "shots": [{"index": 1}],
        "candidates": [{"index": 1, "reasons": ["CHANGE"]}],
        "evidence": [{"kind": "CLIP", "path": "old.mp4"}],
        "limitations": ["contact_fact_extraction_unverified"],
        "perception": {
            "sourceSha256": "a" * 64,
            "schemaVersion": "perception-run-v1",
            "pipelineVersion": "video-local-observers-v1",
            "processingStatus": "COMPLETE",
            "coverage": {
                "startMs": 0,
                "endMs": 1500,
                "sampleIntervalMs": 500,
                "expectedSamples": 4,
                "processedSamples": 4,
                "failedSamples": 0,
            },
            "summary": {
                "roleObservationCount": 2,
                "poseObservationCount": 0,
                "officialCueCount": 0,
                "interactionCount": 0,
                "linkCount": 0,
                "reasons": ["OFFICIAL_METHOD_UNVALIDATED"],
            },
            "observations": [{"id": "official-1"}],
            "incidents": [{"id": "incident-1"}],
        },
    }

# 정답 기반 단서 연결과 누락·초과 집계 확인
def test_cue_matching_uses_fixture_truth_and_counts_misses_and_extras():
    # 정답 단서 하나에 정탐과 오탐이 섞인 예측을 대응
    result = cueScores([(400, 800)], [(390, 790), (1000, 1250)])

    # 정탐 수가 1과 일치하는지 확인
    assert result["truePositive"] == 1
    # 오탐 수가 1과 일치하는지 확인
    assert result["falsePositive"] == 1
    # 미탐 수가 0과 일치하는지 확인
    assert result["falseNegative"] == 0
    # 정밀도가 예상 계약과 일치하는지 확인
    assert result["precision"] == 0.5
    # 재현율이 예상 계약과 일치하는지 확인
    assert result["recall"] == 1.0
    # 신호 시작 시각 평균 절대 오차가 10과 일치하는지 확인
    assert result["meanAbsoluteOnsetErrorMs"] == 10

# 예측 부재의 완벽한 정밀도 오인 방지 확인
def test_cue_matching_does_not_claim_perfect_precision_for_no_predictions():
    # 정답은 있지만 예측이 없는 미탐 상황 평가
    result = cueScores([(400, 800)], [])

    # 정탐 수가 0과 일치하는지 확인
    assert result["truePositive"] == 0
    # 미탐 수가 1과 일치하는지 확인
    assert result["falseNegative"] == 1
    # 재현율이 0과 일치하는지 확인
    assert result["recall"] == 0
    # 정밀도가 비어 있는지 확인
    assert result["precision"] is None

# 음향·산출물 필드만 제외하는 시각 비교 확인
def test_visual_comparator_ignores_only_audio_and_artifact_fields():
    # 음향 추가 전 기준 시각 보고서 준비
    baseline = visual_report()
    # 비교 기준 결과에 입력을 반영하여 상태 갱신
    baseline.update({"audioObservations": None, "reportVersion": "old", "artifactRoot": "/one"})
    # 원본을 보존하도록 시각 보고서를 깊게 복사
    av = json.loads(json.dumps(baseline))
    # 영상 값은 유지하고 음향 포함 보고서의 추가 필드 구성
    av.update(
        {"audioObservations": {"cueCount": 1}, "reportVersion": "new", "artifactRoot": "/two"}
    )
    # 영상 프레임 동일성이 참인지 확인
    assert visualComparison(baseline, av)["exactVisualUnchanged"] is True

    # 변화 후보 목록을 비교에 사용할 고정 시험 자료로 구성
    av["candidates"] = [{"id": 2}]
    # 영상 프레임 동일성이 거짓인지 확인
    assert visualComparison(baseline, av)["exactVisualUnchanged"] is False

    # 원본과 다른 인식 지문을 넣어 귀속 불일치 재현
    av["perception"]["sourceSha256"] = "b" * 64
    # 비교 가능 여부가 거짓인지 확인
    assert visualComparison(baseline, av)["comparable"] is False

# 실제 보고서 구조의 시각 변화 보존 비교 확인
def test_visual_comparator_handles_actual_report_shape_without_masking_visual_changes():
    # 완료된 기준 시각 보고서 준비
    baseline = visual_report()
    # 기준과 독립적으로 변경할 음향 결합 보고서 복사
    av = json.loads(json.dumps(baseline))
    # 자료 형식 판본을 시험 조건에 맞춰 고정
    av["schema_version"] = 3
    # 파이프라인 판본을 시험 조건에 맞춰 고정
    av["pipeline_version"] = "video-local-observers-av-v1"
    # 분석 한계 목록에 이번 항목 추가
    av["limitations"].append("speech_not_analyzed")
    # 파일 경로를 시험 조건에 맞춰 고정
    av["evidence"][0]["path"] = "new.mp4"
    # 음향 상태를 시험 조건에 맞춰 고정
    av["evidence"][0]["audio_status"] = "PRESERVED"
    # 자료 형식 판본을 시험 조건에 맞춰 고정
    av["perception"]["schemaVersion"] = "perception-run-v2"
    # 파이프라인 판본을 시험 조건에 맞춰 고정
    av["perception"]["pipelineVersion"] = "video-local-observers-av-v1"
    # 음향 관측 정보를 비교에 사용할 고정 시험 자료로 구성
    av["perception"]["audio"] = {"cueCount": 1}
    # 영상 프레임 동일성이 참인지 확인
    assert visualComparison(baseline, av)["exactVisualUnchanged"] is True
    # 처리한 표본 수를 시험 조건에 맞춰 고정
    av["perception"]["coverage"]["processedSamples"] = 3
    # 영상 프레임 동일성이 거짓인지 확인
    assert visualComparison(baseline, av)["exactVisualUnchanged"] is False

# 해시만 있거나 구조가 빈 보고서의 시각 비교 거부 확인
def test_visual_comparator_rejects_hash_only_or_structurally_empty_reports():
    # 비교 가능 여부가 거짓인지 확인
    assert visualComparison(None, None)["comparable"] is False
    # 원본 지문만 있고 시각 자료가 빠진 불완전 보고서 준비
    hash_only = {"sourceSha256": "a" * 64}
    # 비교 가능 여부가 거짓인지 확인
    assert visualComparison(hash_only, hash_only)["comparable"] is False
    # 영상 프레임 동일성이 거짓인지 확인
    assert visualComparison(hash_only, hash_only)["exactVisualUnchanged"] is False

    # 필수 필드를 제거할 보고서 준비
    incomplete = visual_report()
    # 처리 범위를 누적할 빈 자료 구조 준비
    incomplete["perception"]["coverage"] = {}
    # 비교 가능 여부가 거짓인지 확인
    assert visualComparison(incomplete, incomplete)["comparable"] is False

    # 내부 출처 정보와 충돌하는 최상위 지문을 넣을 보고서 준비
    contradictory_source = visual_report()
    # 최상위 원본 지문을 바꾸어 중첩 출처와 모순 재현
    contradictory_source["sourceSha256"] = "b" * 64
    # 비교 가능 여부가 거짓인지 확인
    assert visualComparison(contradictory_source, contradictory_source)["comparable"] is False

    # 원본 파일 이름이 누락된 보고서를 만들 기준 준비
    missing_source_name = visual_report()
    # 출처 확인에 필요한 원본 이름 제거
    missing_source_name["video"].pop("source_name")
    # 비교 가능 여부가 거짓인지 확인
    assert visualComparison(missing_source_name, missing_source_name)["comparable"] is False

# 음향만 부분 완료인 이유와 미지원 상태 거부 확인
def test_visual_comparator_explains_audio_only_partial_but_rejects_unsupported_status():
    # 영상 차이 검출용 기준 보고서 준비
    baseline = visual_report()
    # 시각 필드를 독립적으로 바꿀 깊은 복사본 준비
    av = json.loads(json.dumps(baseline))
    # 처리 완료 상태를 시험 조건에 맞춰 고정
    av["perception"]["processingStatus"] = "PARTIAL"
    # 음향 관측 정보를 비교에 사용할 고정 시험 자료로 구성
    av["perception"]["audio"] = {"status": "FAILED"}
    # 기준 영상과 음향 결합 영상의 프레임 및 길이 비교
    result = visualComparison(baseline, av)
    # 비교 가능 여부가 참인지 확인
    assert result["comparable"] is True
    # 영상 프레임 동일성이 참인지 확인
    assert result["exactVisualUnchanged"] is True
    # 음향 상태만 달라졌는지 여부가 참인지 확인
    assert result["audioOnlyProcessingStatusDifference"] is True

    # 처리 완료 상태를 시험 조건에 맞춰 고정
    av["perception"]["processingStatus"] = "FAILED"
    # 영상 프레임 동일성이 거짓인지 확인
    assert visualComparison(baseline, av)["exactVisualUnchanged"] is False

    # 처리 완료 상태를 시험 조건에 맞춰 고정
    av["perception"]["processingStatus"] = "PARTIAL"
    # 음향 관측 정보를 비교에 사용할 고정 시험 자료로 구성
    av["perception"]["audio"] = {"status": "COMPLETE"}
    # 영상 프레임 동일성이 거짓인지 확인
    assert visualComparison(baseline, av)["exactVisualUnchanged"] is False

# 영상·음향 출력 누락과 정렬 오류의 측정 실패 확인
def test_audio_measurement_fails_on_missing_and_misaligned_av_output(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mkv"
    # 원점과 음향 상태를 지정한 합성 시험 영상 생성
    fixture(source, video_origin=0, audio_origin=0.3, pulse_local=0.1, kind="multitone")
    # 알려진 합성 신호의 정답 시작 시각 지정
    expected_onset_ms = 400
    # 비교 기준 결과를 시험용 기준 경로에서 구성
    baseline = tmp_path / "baseline.mp4"
    # 비교 기준 결과에 시험 내용을 기록
    baseline.write_bytes(b"not-a-video")
    # 정렬이 올바른 비교 클립 경로 구성
    correct = tmp_path / "correct.mp4"
    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, correct, 0, 1000)

    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    missing = audioComparison(
        source, baseline, tmp_path / "missing.mp4", 0, 1000, expected_onset_ms=expected_onset_ms
    )
    # 음향 보존 여부가 거짓인지 확인
    assert missing["audioRetained"] is False
    # 시간 정렬 통과 여부가 거짓인지 확인
    assert missing["alignmentPass"] is False

    # 시작 시각이 틀린 비교 클립 경로 구성
    wrong = tmp_path / "wrong.mp4"
    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, wrong, 300, 1300)
    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    misaligned = audioComparison(
        source, baseline, wrong, 0, 1000, expected_onset_ms=expected_onset_ms
    )
    # 시간 정렬 통과 여부가 거짓인지 확인
    assert misaligned["alignmentPass"] is False
    # 잘못 정렬한 클립의 시작 오차가 허용치를 넘는지 확인
    assert abs(misaligned["onsetErrorMs"]) > 50

# 음향 없는 원본의 유효 영상과 길이 요구 확인
def test_no_audio_source_still_requires_valid_av_video_and_duration(tmp_path):
    from replay_video.av import baselineClip
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mkv"
    # 원점과 음향 상태를 지정한 합성 시험 영상 생성
    fixture(source, video_origin=0, audio_origin=None, pulse_local=None, kind="no_audio")
    # 비교 기준 결과를 시험용 기준 경로에서 구성
    baseline = tmp_path / "baseline.mp4"
    # 음향을 제외한 비교 기준 클립 생성
    baselineClip(source, baseline, 0, 1000)

    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    missing = audioComparison(
        source, baseline, tmp_path / "missing.mp4", 0, 1000, expected_onset_ms=None
    )
    # 음향 결합 영상 유효성이 거짓인지 확인
    assert missing["avValidVideo"] is False
    # 음향 결합 영상의 소리 존재 여부가 비어 있는지 확인
    assert missing["avHasAudio"] is None

    # 디코딩할 수 없는 비교 파일 경로 구성
    corrupt = tmp_path / "corrupt.mp4"
    # 영상 헤더가 아닌 바이트를 써서 손상 파일 재현
    corrupt.write_bytes(b"invalid mp4")
    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    measured = audioComparison(source, baseline, corrupt, 0, 1000, expected_onset_ms=None)
    # 음향 결합 영상 유효성이 거짓인지 확인
    assert measured["avValidVideo"] is False
    # 음향 결합 영상의 소리 존재 여부가 비어 있는지 확인
    assert measured["avHasAudio"] is None

    # 요청 길이보다 짧은 비교 클립 경로 구성
    short = tmp_path / "short.mp4"
    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, short, 0, 300)
    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    measured = audioComparison(source, baseline, short, 0, 1000, expected_onset_ms=None)
    # 음향 결합 영상 유효성이 거짓인지 확인
    assert measured["avValidVideo"] is False

# 메타데이터만으로 디코딩 불가 출력의 승인 방지 확인
def test_video_metadata_alone_cannot_validate_undecodable_output(tmp_path, monkeypatch):
    import replay_video.av as evaluator
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mkv"
    # 원점과 음향 상태를 지정한 합성 시험 영상 생성
    evaluator.fixture(source, video_origin=0, audio_origin=None, pulse_local=None, kind="no_audio")
    # 비교 기준 결과를 시험용 기준 경로에서 구성
    baseline = tmp_path / "baseline.mp4"
    # 정상 디코딩되는 기준 영상 클립 생성
    evaluator.baselineClip(source, baseline, 0, 1000)
    # 메타데이터는 정상처럼 보일 손상 클립 경로 구성
    broken = tmp_path / "broken.mp4"
    # 디코딩 실패를 일으킬 가짜 영상 내용 기록
    broken.write_bytes(b"not decodable")
    # 손상 파일 외에는 정상 조회할 원래 스트림 함수 보관
    real_tracks = evaluator.tracks

    # 잘못된 스트림 정보 모형
    def misleading_tracks(path):
        # 손상 클립에 대해서만 정상 메타데이터로 위장
        if path == broken:
            # 길이가 정상인 영상 스트림 메타데이터를 가짜로 반환
            return {"codec_type": "video", "index": 0, "duration": "1.000"}, None
        # 다른 파일은 실제 스트림 조회 결과 반환
        return real_tracks(path)

    # 미디어 스트림 목록을 시험용 값으로 교체
    monkeypatch.setattr(evaluator, 'tracks', misleading_tracks)
    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    measured = evaluator.audioComparison(source, baseline, broken, 0, 1000, expected_onset_ms=None)
    # 음향 결합 영상 유효성이 거짓인지 확인
    assert measured["avValidVideo"] is False
    # 음향 결합 영상의 소리 존재 여부가 비어 있는지 확인
    assert measured["avHasAudio"] is None

# 헤더·첫 프레임 정상이어도 꼬리 손상 영상 거부 확인
def test_no_audio_output_with_valid_header_and_first_frame_but_corrupt_tail_is_invalid(tmp_path):
    from replay_video.av import baselineClip
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mkv"
    # 원점과 음향 상태를 지정한 합성 시험 영상 생성
    fixture(source, video_origin=0, audio_origin=None, pulse_local=None, kind="no_audio")
    # 비교 기준 결과를 시험용 기준 경로에서 구성
    baseline = tmp_path / "baseline.mp4"
    # 음향이 없는 기준 영상 클립 생성
    baselineClip(source, baseline, 0, 1000)
    # 음향을 보존한 비교 클립 경로 구성
    av = tmp_path / "av.mp4"
    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, av, 0, 1000)
    # 미디어 패킷 목록을 후속 비교에 사용할 값으로 보관
    packets = json.loads(
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_packets",
                "-show_entries",
                "packet=pos,size",
                "-of",
                "json",
                str(av),
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        ).stdout
    )["packets"]
    # 미디어 패킷 목록의 개수가 20과 일치하는지 확인
    assert len(packets) == 20
    # 출력 파일의 특정 패킷을 손상시킬 수정 가능한 바이트 배열 생성
    data = bytearray(av.read_bytes())
    # 미디어 패킷 목록의 각 항목을 순서대로 처리
    for packet in packets[-15:]:
        # 패킷 위치를 후속 비교에 사용할 값으로 보관
        start = int(packet["pos"])
        # 조회한 패킷 크기로 덮어쓸 바이트 범위 끝 계산
        end = start + int(packet["size"])
        # 선택한 미디어 패킷 내용을 영 바이트로 손상
        data[start:end] = bytes(end - start)
    # 손상된 패킷을 비교 클립에 다시 기록
    av.write_bytes(data)
    # 손상 이후에도 컨테이너 길이 조회가 성공하는지 실행
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(av)],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    # 컨테이너의 길이만 보면 정상처럼 보이는지 확인
    assert float(next(stream["duration"] for stream in json.loads(probe.stdout)["streams"]
                      if stream["codec_type"] == "video")) == pytest.approx(1.0)
    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    measured = audioComparison(source, baseline, av, 0, 1000, expected_onset_ms=None)
    # 음향 결합 영상 길이 통과 여부가 참인지 확인
    assert measured["avDurationPass"] is True
    # 음향 결합 영상 디코딩 범위 통과 여부가 거짓인지 확인
    assert measured["avDecodedCoveragePass"] is False
    # 음향 결합 영상 유효성이 거짓인지 확인
    assert measured["avValidVideo"] is False
    # 음향 결합 영상의 소리 존재 여부가 비어 있는지 확인
    assert measured["avHasAudio"] is None

# 정상 종료와 전체 진행 기록이 있어도 디코딩 오류가 있으면 거부
def test_decoding_error_with_complete_progress_is_invalid(tmp_path, monkeypatch):
    import replay_video.av as evaluator
    # 전체 길이를 처리한 것처럼 보이는 진행 기록과 오류를 함께 주입
    monkeypatch.setattr(evaluator, "process", lambda *args, **kwargs: subprocess.CompletedProcess(
        [], 0, stdout=b"frame=20\nout_time_us=1000000\nprogress=end\n",
        stderr=b"decoder reported damaged data",
    ))
    # 오류가 있는 출력을 유효한 전체 디코딩으로 채택하지 않음 확인
    assert evaluator.decoding(tmp_path / "clip.mp4", {"index": 0}, 1000) is None

# 인코더 출력 없는 합성 무음 영상의 실패 확인
def test_synthetic_no_audio_case_fails_if_encoder_returns_without_output(tmp_path, monkeypatch):
    import replay_video.av as evaluator
    from replay_video.infrastructure.streams import ClipAudioResult
    # 특정 실패 사례 이외에는 실제 클립을 만들 원래 함수 보관
    real_clip = evaluator.clip

    # 음향 없는 출력 누락 모형
    def omit_no_audio(source, destination, start_ms, end_ms):
        # 음향 없는 사례의 클립 생성만 생략하는 경로 선택
        if destination.parent.name == "no_audio":
            # 파일이 없어도 음향 부재 상태만 반환하는 잘못된 대역 재현
            return ClipAudioResult("ABSENT", "SOURCE_AUDIO_ABSENT")
        # 나머지 사례는 실제 클립 생성 결과 반환
        return real_clip(source, destination, start_ms, end_ms)

    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(evaluator, "clip", omit_no_audio)
    # 잘못된 음향 부재 처리 대역을 포함해 합성 비교 실행
    report = evaluator.synthetic(tmp_path / "benchmark")
    # 합성 신호 검사 통과 여부가 거짓인지 확인
    assert report["syntheticChecksPass"] is False
    # 음향 결합 영상 유효성이 거짓인지 확인
    assert report["cases"][6]["clipAudioMetrics"]["avValidVideo"] is False

# 합성 무음 트랙에 음 삽입 시 실패 확인
def test_synthetic_silent_track_fails_if_av_output_contains_injected_tone(tmp_path, monkeypatch):
    import replay_video.av as evaluator
    # 일부 입력 교체 이외에는 실제 클립을 만들 원래 함수 보관
    real_clip = evaluator.clip

    # 무음 출력의 음 삽입 모형
    def inject_tone_into_silent_output(source, destination, start_ms, end_ms):
        # 무음 트랙 사례에만 다른 소리를 끼워 넣는 경로 선택
        if destination.parent.name == "silent_tracked":
            # 무음 대신 소리 있는 역위상 시험 원본 선택
            injected_source = destination.parent.parent / "stereo_antiphase" / "source.mkv"
            # 다른 원본 음향이 섞인 클립을 실제로 생성
            return real_clip(injected_source, destination, start_ms, end_ms)
        # 나머지 비교 사례는 정상 원본으로 클립 생성
        return real_clip(source, destination, start_ms, end_ms)

    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(evaluator, "clip", inject_tone_into_silent_output)
    # 무음 오염을 주입한 상태로 전체 합성 비교 실행
    report = evaluator.synthetic(tmp_path / "benchmark")
    # 전체 결과에서 무음 보존 사례만 선택
    silent = next(case for case in report["cases"] if case["name"] == "silent_tracked")
    # 원본에서 읽은 신호 시작 시각이 비어 있는지 확인
    assert silent["clipAudioMetrics"]["sourceDecodedOnsetMs"] is None
    # 음향 결합 영상에서 읽은 신호 시작 시각이 200과 일치하는지 확인
    assert silent["clipAudioMetrics"]["avDecodedOnsetMs"] == 200
    # 합성 신호 검사 통과 여부가 거짓인지 확인
    assert report["syntheticChecksPass"] is False

# 실제 인코딩 클립과 독립 원시 음향 시작 시각의 음향 측정 확인
def test_audio_measurement_accepts_real_encoded_clip_and_independent_pcm_onset(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mkv"
    # 원점과 음향 상태를 지정한 합성 시험 영상 생성
    fixture(source, video_origin=5, audio_origin=5.3, pulse_local=0.1, kind="multitone")
    # 비교 기준 결과를 시험용 기준 경로에서 구성
    baseline = tmp_path / "baseline.mp4"
    from replay_video.av import baselineClip
    # 음향 없는 기준 클립 생성
    baselineClip(source, baseline, 0, 1000)
    # 원본 음향을 포함할 비교 클립 경로 구성
    av = tmp_path / "av.mp4"
    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, av, 0, 1000)

    # 원본과 증거 클립의 음향 보존 및 시간 정렬 비교
    measured = audioComparison(source, baseline, av, 0, 1000, expected_onset_ms=400)

    # 비교 기준 영상의 소리 존재 여부가 거짓인지 확인
    assert measured["baselineHasAudio"] is False
    # 음향 결합 영상의 소리 존재 여부가 참인지 확인
    assert measured["avHasAudio"] is True
    # 음향 보존 여부가 참인지 확인
    assert measured["audioRetained"] is True
    # 시간 정렬 통과 여부가 참인지 확인
    assert measured["alignmentPass"] is True
    # 출력 음향 시작 시각의 절대 오차가 50밀리초 이내인지 확인
    assert abs(measured["onsetErrorMs"]) <= 50
    # 원본 음향 시작 시각도 합성 정답의 50밀리초 이내인지 확인
    assert abs(measured["sourceOnsetErrorMs"]) <= 50

# 합성 실행의 배타성과 의미 정확도 미검증 표시 확인
def test_synthetic_run_is_exclusive_and_marks_semantic_accuracy_unproven(tmp_path):
    from replay_video.av import synthetic
    # 출력 경로를 시험용 기준 경로에서 구성
    output = tmp_path / "benchmark"
    # 알려진 영상·음향 신호로 전체 합성 비교 보고서 생성
    report = synthetic(output)
    # 디스크에 기록된 지표 보고서를 다시 읽음
    persisted = json.loads((output / "metrics.json").read_text())
    # 저장한 보고서가 반환한 보고서와 같은지 확인
    assert persisted == report
    # 의미 해석 정확도 개선 여부가 예상 계약과 일치하는지 확인
    assert report["semanticAccuracyImprovement"] == "NOT_ESTABLISHED"
    # 정답 라벨 적용 범위가 예상 계약과 일치하는지 확인
    assert report["groundTruthScope"] == "KNOWN_SYNTHETIC_MULTITONE_SIGNALS"
    # 비교 사례 목록의 개수가 9 이상인지 확인
    assert len(report["cases"]) >= 9
    # 합성 신호 검사 통과 여부가 참인지 확인
    assert report["syntheticChecksPass"] is True
    # 음향이 영상보다 먼저 시작한 비교 사례 선택
    negative = next(case for case in report["cases"] if case["name"] == "negative_offset")
    # 비교 기준 영상 유효성이 참인지 확인
    assert negative["clipAudioMetrics"]["baselineValidVideo"] is True
    # 기존 방식의 실패를 고정하지 않고 실제 측정 길이와 불일치 집계 대조
    mismatches = []
    for case in report["cases"]:
        metrics = case["clipAudioMetrics"]
        # 실제 기준 파일에서 독립적으로 길이를 다시 읽어 보고서와 대조
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=duration", "-of", "json",
            str(output / case["name"] / "baseline.mp4"),
        ], capture_output=True, text=True, check=True, timeout=10)
        duration = float(json.loads(probe.stdout)["streams"][0]["duration"]) * 1000
        assert metrics["baselineDurationMs"] == pytest.approx(duration)
        passed = (
            abs(duration - metrics["expectedClipDurationMs"]) <= 100
        )
        assert metrics["baselineDurationPass"] is passed
        if not passed:
            mismatches.append(case["name"])
    assert report["baselineVisualDurationMismatchCases"] == mismatches
    # 평가 대상 클립들의 시간 정렬 조건이 모두 통과하는지 확인
    assert all(case["clipAudioMetrics"]["alignmentPass"] for case in report["cases"]
               if case["clipAudioMetrics"]["expectedOnsetMs"] is not None)
    # 정답 단서가 있는 사례의 미탐 수를 합산하여 누락 확인
    assert sum(case["cueMetrics"]["falseNegative"] for case in report["cases"]
               if case["expectedCueIntervalsMs"]) == 0
    # 합성 실행의 배타성과 의미 정확도 미검증 표시을 위한 예상 예외 확인
    with pytest.raises(FileExistsError):
        # 기존 결과 디렉터리 재사용 시 덮어쓰기 거부 경로 실행
        synthetic(output)
