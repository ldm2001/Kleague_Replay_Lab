"""영상 시간축의 원본 음향 보존을 확인하는 실제 미디어 시험"""

import json
import subprocess
from pathlib import Path
import numpy as np
import pytest
from replay_video.infrastructure.evidence import clip
from replay_video.infrastructure.streams import ClipStreams, clipStreams
from replay_video.domain.models import Candidate, VideoMetadata


# 음향 표본률을 시험 조건에 맞춰 고정
SAMPLE_RATE = 48_000

# 미디어 명령 모형
def ffmpeg(*args: str) -> None:
    # 시험 미디어 명령을 실행하고 종료 상태와 출력을 수집
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    # 외부 명령 종료 코드가 0과 일치하는지 확인
    assert result.returncode == 0, result.stderr

# 시험용 스트림 조회 반환
def streams(path: Path) -> list[dict]:
    # 시험 미디어 명령을 실행하고 종료 상태와 출력을 수집
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    # 미디어 스트림 목록을 호출자에게 반환
    return json.loads(result.stdout)["streams"]

# 시험용 파형 반환
def waveform(path: Path, channel: int = 0) -> np.ndarray:
    # 시험 미디어 명령을 실행하고 종료 상태와 출력을 수집
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-af",
            "aresample=48000:async=1:first_pts=0",
            "-ar",
            "48000",
            "-c:a",
            "pcm_f32le",
            "-f",
            "f32le",
            "pipe:1",
        ],
        capture_output=True,
        timeout=15,
        check=True,
    )
    # 선택한 음향 스트림의 실제 채널 수 조회
    channels = next(s["channels"] for s in streams(path) if s["codec_type"] == "audio")
    # 디코딩한 실수 표본을 채널별로 나눈 뒤 요청 채널 반환
    return np.frombuffer(result.stdout, dtype="<f4").reshape(-1, channels)[:, channel]

# 최초 음향 시작 밀리초 반환
def first_tone_onset_ms(samples: np.ndarray) -> int:
    # 압축 음향 초기 지연과 코덱 잔향에 견고한 20밀리초 실효값 구간 사용
    window = SAMPLE_RATE // 50
    # 20밀리초 구간별 실효 진폭 계산
    levels = [
        np.sqrt(np.mean(samples[i : i + window] ** 2))
        for i in range(0, len(samples) - window + 1, window)
    ]
    # 진폭 임계값을 처음 넘은 구간의 밀리초 시각 반환
    return next(index * 20 for index, level in enumerate(levels) if level > 0.025)

# 시험용 미디어 반환
def media(
    path: Path,
    *,
    video_origin: float,
    audio_origin: float,
    pulse_local: float,
    stereo_antiphase: bool = False,
    duration: float = 1.5,
) -> None:
    # 정해진 짧은 구간에서만 들리는 천 헤르츠 신호식 생성
    expression = f"0.35*sin(2*PI*1000*t)*between(t\\,{pulse_local}\\,{pulse_local + 0.14})"
    # 스테레오 역위상 시험 여부에 따라 채널 구성 분기
    if stereo_antiphase:
        # 두 번째 채널에 부호가 반대인 동일 신호 배치
        expression = f"{expression}|-({expression})"
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-itsoffset",
        str(video_origin),
        "-f",
        "lavfi",
        "-i",
        f"color=c=black:s=64x64:r=20:d={duration}",
        "-itsoffset",
        str(audio_origin),
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expression}:s={SAMPLE_RATE}:d={duration}",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(path),
    )

# 영상 상대 시간축의 음향 보존 확인
@pytest.mark.parametrize(
    ("video_origin", "audio_origin", "pulse_local", "start_ms", "end_ms", "expected_ms"),
    [
        (0, 0.3, 0.1, 0, 1000, 400),
        (0, -0.2, 0.4, 0, 1000, 200),
        (5, 5.3, 0.1, 0, 1000, 400),
        (5, 4.8, 0.4, 0, 1000, 200),
        (5, 5.3, 0.8, 500, 1200, 600),
    ],
)
def test_clip_preserves_audio_on_video_relative_timeline(
    tmp_path,
    video_origin,
    audio_origin,
    pulse_local,
    start_ms,
    end_ms,
    expected_ms,
):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    # 영상과 음향의 서로 다른 원점을 가진 시험 파일 생성
    media(source, video_origin=video_origin, audio_origin=audio_origin, pulse_local=pulse_local)

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    audio_result = clip(source, output, start_ms, end_ms)

    # 미디어 파일에 저장된 영상과 음향 스트림 조회
    tracks = streams(output)
    # 증거 클립에 영상 스트림이 하나 보존되는지 확인
    assert len([s for s in tracks if s["codec_type"] == "video"]) == 1
    # 증거 클립에 음향 스트림도 하나 보존되는지 확인
    assert len([s for s in tracks if s["codec_type"] == "audio"]) == 1
    # 처리 상태 · 사유가 예상 계약과 일치하는지 확인
    assert (audio_result.status, audio_result.reason) == ("PRESERVED", None)
    # 진폭이 임계값을 처음 넘는 구간의 시각 계산
    output_onset = first_tone_onset_ms(waveform(output))
    # 출력 음향 시작 시각이 예상 계약과 일치하는지 확인
    assert output_onset == pytest.approx(expected_ms, abs=50)
    # 미디어 파일에 저장된 영상과 음향 스트림 조회
    source_tracks = streams(source)
    # 원본 영상 스트림의 실제 시작 시각 조회
    video_start = float(next(s["start_time"] for s in source_tracks if s["codec_type"] == "video"))
    # 원본 음향 스트림의 실제 시작 시각 조회
    audio_start = float(next(s["start_time"] for s in source_tracks if s["codec_type"] == "audio"))
    # 진폭이 임계값을 처음 넘는 구간의 시각 계산
    source_onset = first_tone_onset_ms(waveform(source))
    # 클립 시작을 더한 음향 시각이 원본 시간축과 맞는지 확인
    assert output_onset + start_ms == pytest.approx(
        source_onset + round((min(video_start, audio_start) - video_start) * 1000), abs=50,
    )
    # 출력 음향 스트림의 시작 시각이 클립 원점에 정렬되는지 확인
    assert float(
        next(s["duration"] for s in tracks if s["codec_type"] == "video")
    ) == pytest.approx(
        (end_ms - start_ms) / 1000,
        abs=0.06,
    )

# 역위상 스테레오 채널 분리 보존 확인
def test_clip_keeps_antiphase_stereo_channels_separate(tmp_path):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "stereo.mkv", tmp_path / "clip.mp4"
    # 서로 상쇄될 수 있는 역위상 스테레오 시험 영상 생성
    media(source, video_origin=0, audio_origin=0, pulse_local=0.2, stereo_antiphase=True)

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, output, 0, 1000)

    # 역위상 입력의 두 음향 채널이 그대로 보존되는지 확인
    assert next(s["channels"] for s in streams(output) if s["codec_type"] == "audio") == 2
    # 출력의 왼쪽과 오른쪽 채널 파형을 따로 디코딩
    left, right = waveform(output, 0), waveform(output, 1)
    # 왼쪽 채널 에너지가 상쇄되지 않고 남는지 확인
    assert np.sqrt(np.mean(left ** 2)) > 0.05
    # 오른쪽 채널 에너지도 상쇄되지 않고 남는지 확인
    assert np.sqrt(np.mean(right ** 2)) > 0.05
    # 두 출력 채널이 원본처럼 반대 위상을 유지하는지 확인
    assert np.corrcoef(left, right)[0, 1] < -0.9

# 영상 전용 원본의 음향 생성 금지 확인
def test_clip_does_not_invent_audio_for_video_only_source(tmp_path):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "video.mkv", tmp_path / "clip.mp4"
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1", "-an", "-c:v", "ffv1", str(source)
    )

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    audio_result = clip(source, output, 0, 800)

    # 미디어 종류 목록이 예상 계약과 일치하는지 확인
    assert [s["codec_type"] for s in streams(output)] == ["video"]
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert audio_result.status == "ABSENT"

# 해당 구간에 표본 없는 음향의 보존 성공 오인 방지 확인
def test_clip_does_not_claim_preserved_audio_when_source_track_has_no_samples_in_interval(tmp_path):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "late-audio.mkv", tmp_path / "clip.mp4"
    # 요청 클립 바깥에서야 음향이 시작되는 영상 생성
    media(source, video_origin=0, audio_origin=2, pulse_local=0.1)

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    audio_result = clip(source, output, 0, 800)

    # 미디어 종류 목록이 예상 계약과 일치하는지 확인
    assert [s["codec_type"] for s in streams(output)] == ["video"]
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert audio_result.status == "OMITTED_DECODE_FAILED"
    # 빈 출력 음향 또는 영상 단독 재시도 성공 사유를 명시하는지 확인
    assert audio_result.reason in ("AUDIO_OUTPUT_EMPTY", "AV_ENCODE_FAILED_VIDEO_RETRY_SUCCEEDED")

# 기존 무음 트랙 보존 확인
def test_clip_preserves_an_existing_silent_audio_track(tmp_path):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "silent.mkv", tmp_path / "clip.mp4"
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=20:d=1",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=mono:d=1",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(source),
    )

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, output, 0, 800)

    # 미디어 종류 목록이 예상 계약과 일치하는지 확인
    assert [s["codec_type"] for s in streams(output)] == ["video", "audio"]
    # 무음 트랙에 인위적 음향이 추가되지 않는지 확인
    assert np.max(np.abs(waveform(output))) < 1e-4

# 음향 패킷 시각 간격 보존 확인
def test_clip_preserves_audio_packet_timestamp_gap(tmp_path):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "gap.mkv", tmp_path / "clip.mp4"
    # 합성 신호 생성식을 시험 조건에 맞춰 고정
    expression = "0.3*sin(2*PI*1000*t)"
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=20:d=1.2",
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expression}:s=48000:n=4800:d=0.4",
        "-filter_complex",
        "[1:a]asetpts=PTS+gte(N\\,9600)*0.5/TB[a]",
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(source),
    )

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, output, 0, 1000)

    # 클립 시간축의 실제 출력 음향 파형 읽음
    audio = waveform(output)
    # 패킷 공백 이전 구간에 음향 에너지가 남는지 확인
    assert np.sqrt(np.mean(audio[int(.02*SAMPLE_RATE):int(.15*SAMPLE_RATE)] ** 2)) > 0.05
    # 패킷 사이 빈 시각 구간이 무음으로 보충되는지 확인
    assert np.sqrt(np.mean(audio[int(.35*SAMPLE_RATE):int(.55*SAMPLE_RATE)] ** 2)) < 0.005
    # 패킷 공백 이후 음향이 원래 시각에 복원되는지 확인
    assert np.sqrt(np.mean(audio[int(.72*SAMPLE_RATE):int(.85*SAMPLE_RATE)] ** 2)) > 0.05

# 첫 실제 영상과 첫 음향 스트림 선택 확인
def test_clip_selects_first_real_video_and_first_audio_stream(tmp_path, monkeypatch):
    # 표지 이미지와 실제 영상이 함께 있는 미디어 조회 응답 주입
    monkeypatch.setattr(
        'replay_video.infrastructure.streams.mediaStreams',
        lambda _source: [
            {
                "index": 0,
                "codec_type": "video",
                "start_time": "0",
                "disposition": {"attached_pic": 1},
            },
            {"index": 1, "codec_type": "audio", "channels": 1, "start_time": "5.3"},
            {
                "index": 2,
                "codec_type": "video",
                "start_time": "5",
                "disposition": {"attached_pic": 0},
            },
            {"index": 3, "codec_type": "audio", "channels": 2, "start_time": "5"},
        ],
    )
    # 다중 스트림 중 증거로 쓸 영상과 음향 선택
    selected = clipStreams(tmp_path / "mock.media")
    # 표지 이미지가 아닌 실제 영상 번호와 원점 및 음향 번호 확인
    assert (selected.video_index, selected.video_origin_seconds, selected.audio_index) == (2, 5, 1)

# 뒤쪽 구간 탐색 시 원본 시각 보존 확인
def test_clip_seeks_near_a_late_selected_interval_without_shifting_pts(tmp_path, monkeypatch):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    # 늦은 원점과 뒤쪽 음향 펄스를 가진 긴 시험 영상 생성
    media(source, video_origin=5, audio_origin=5.3, pulse_local=3.0, duration=4.5)
    from replay_video.infrastructure import evidence
    # 명령 인자를 기록한 뒤 실제 인코딩을 이어갈 원래 함수 보관
    original = evidence.subprocess.run
    # 미디어 명령 실행 이력을 누적할 빈 자료 구조 준비
    commands = []

    # 기록 반환
    def record(command, **kwargs):
        # 미디어 명령 실행 이력에 이번 항목 추가
        commands.append(command)
        # 기록한 명령으로 실제 미디어 처리를 수행한 결과 반환
        return original(command, **kwargs)
    # 명령 순서만 기록하고 실제 미디어 실행은 유지하는 대역 연결
    monkeypatch.setattr(evidence.subprocess, "run", record)

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, output, 3000, 4000)

    # 여러 조회 호출 중 실제 인코더 명령만 선택
    command = next(item for item in commands if item[0] == "ffmpeg")
    # 긴 원본 탐색을 위한 입력 탐색 옵션 존재 확인
    assert "-ss" in command
    # 탐색이 입력 읽기 전에 적용되어 앞부분 전체 디코딩을 피하는지 확인
    assert command.index("-ss") < command.index("-i")
    # 진폭이 임계값을 처음 넘는 구간의 시각 계산 결과이 예상 계약과 일치하는지 확인
    assert first_tone_onset_ms(waveform(output)) == pytest.approx(300, abs=50)

# 다채널 배치의 혼합 없는 보존 확인
def test_clip_preserves_multichannel_layout_without_downmix(tmp_path):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "surround.mkv", tmp_path / "clip.mp4"
    # 특정 시간 구간에만 존재하는 시험 음향 신호식 준비
    tone = "0.3*sin(2*PI*1000*t)*between(t\\,0.2\\,0.4)"
    # 두 역위상 채널과 네 무음 채널로 여섯 채널 입력 구성
    expression = "|".join([tone, f"-({tone})", "0", "0", "0", "0"])
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=20:d=1",
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expression}:s=48000:d=1:c=5.1",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(source),
    )

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    clip(source, output, 0, 800)

    # 여섯 채널 입력이 출력에서도 여섯 채널로 유지되는지 확인
    assert next(s["channels"] for s in streams(output) if s["codec_type"] == "audio") == 6
    # 첫 번째 유효 채널의 음향 에너지가 보존되는지 확인
    assert np.sqrt(np.mean(waveform(output, 0) ** 2)) > 0.05
    # 두 번째 유효 채널의 음향 에너지가 보존되는지 확인
    assert np.sqrt(np.mean(waveform(output, 1) ** 2)) > 0.05

# 미지원 음향 제외와 유효 영상 보존 확인
def test_clip_omits_unsupported_audio_but_keeps_valid_video(tmp_path, monkeypatch):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "video.mkv", tmp_path / "clip.mp4"
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1", "-an", "-c:v", "ffv1", str(source)
    )
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        'replay_video.infrastructure.evidence.clipStreams',
        lambda _source: ClipStreams(0, 0.0, 0.0, None, None, "CHANNEL_COUNT_UNSUPPORTED"),
    )

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    audio_result = clip(source, output, 0, 800)

    # 처리 상태 · 사유가 예상 계약과 일치하는지 확인
    assert (audio_result.status, audio_result.reason) == (
        "OMITTED_UNSUPPORTED",
        "CHANNEL_COUNT_UNSUPPORTED",
    )
    # 미디어 종류 목록이 예상 계약과 일치하는지 확인
    assert [s["codec_type"] for s in streams(output)] == ["video"]

# 영상·음향 인코딩 실패 후 영상 재시도와 음향 누락 보고 확인
def test_clip_retries_video_only_after_av_encode_failure_and_reports_omission(
    tmp_path, monkeypatch
):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    # 음향 인코딩 실패 뒤 영상 재시도를 시험할 원본 생성
    media(source, video_origin=0, audio_origin=0, pulse_local=0.2)
    from replay_video.infrastructure import evidence
    # 재시도에서는 실제 인코더를 사용할 원래 실행 함수 보관
    original = evidence.subprocess.run
    # 미디어 명령 실행 이력을 누적할 빈 자료 구조 준비
    commands = []

    # 최초 영상·음향 인코딩 실패 모형
    def fail_first_av(command, **kwargs):
        # 미디어 명령 실행 이력에 이번 항목 추가
        commands.append(command)
        # 음향 필터 출력이 연결된 첫 인코딩 시도에만 실패 주입
        if "[a]" in command:
            # 외부 명령을 실행하지 않고 조회 결과를 담은 응답 결과 반환
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="audio encode failed")
        # 음향 없는 재시도는 실제 인코더로 실행
        return original(command, **kwargs)
    # 첫 영상·음향 인코딩에만 실패하는 대역 연결
    monkeypatch.setattr(evidence.subprocess, "run", fail_first_av)

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    audio_result = clip(source, output, 0, 800)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert audio_result.status == "OMITTED_DECODE_FAILED"
    # 사유가 예상 계약과 일치하는지 확인
    assert audio_result.reason == "AV_ENCODE_FAILED_VIDEO_RETRY_SUCCEEDED"
    # 음향 결합 시도와 영상 단독 재시도가 한 번씩 실행되는지 확인
    assert len([c for c in commands if c[0] == "ffmpeg"]) == 2
    # 미디어 종류 목록이 예상 계약과 일치하는지 확인
    assert [s["codec_type"] for s in streams(output)] == ["video"]

# 영상 실패의 음향 실패 오분류 방지 확인
def test_clip_does_not_mislabel_video_failure_as_audio_failure(tmp_path, monkeypatch):
    # 입력 영상 · 출력 경로를 비교에 사용할 고정 시험 자료로 구성
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    # 모든 인코딩 실패 경로를 시험할 정상 원본 생성
    media(source, video_origin=0, audio_origin=0, pulse_local=0.2)
    from replay_video.infrastructure import evidence
    # 메타데이터 조회는 유지할 원래 미디어 실행 함수 보관
    original = evidence.subprocess.run

    # 인코더 실패 모형
    def fail_encoder(command, **kwargs):
        # 조회가 아닌 실제 인코더 명령일 때만 오류 발생
        if command[0] == "ffmpeg":
            # 외부 명령을 실행하지 않고 조회 결과를 담은 응답 결과 반환
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="video failed")
        # 인코더 외의 미디어 조회는 원래 함수로 처리
        return original(command, **kwargs)
    # 영상 단독 재시도까지 실패하는 인코더 대역 연결
    monkeypatch.setattr(evidence.subprocess, "run", fail_encoder)

    # 영상 실패의 음향 실패 오분류 방지을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="clip-write-failed"):
        # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
        clip(source, output, 0, 800)

# 손상된 음향 패킷의 보존 성공 오인 방지 확인
def test_clip_does_not_claim_preserved_audio_for_damaged_aac_packets(tmp_path):
    # 정상 원본과 손상 복사본 및 출력 클립의 경로 구성
    clean, damaged, output = (tmp_path / name for name in ("clean.mkv", "damaged.mkv", "clip.mp4"))
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=20:d=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=48000:duration=3",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "ffv1",
        "-c:a",
        "aac",
        str(clean),
    )
    # 합성 영상과 음향을 외부 미디어 도구로 인코딩
    ffmpeg(
        "-i",
        str(clean),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c",
        "copy",
        "-bsf:a",
        "noise=amount='if(between(n,40,50),1,0)'",
        str(damaged),
    )
    # 손상 원본을 엄격하게 디코딩하여 실제 오류 재현 확인
    source_decode = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(damaged), "-map", "0:a:0", "-f", "null", "-"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    # 외부 명령 종료 코드가 0과 일치하는지 확인
    assert source_decode.returncode == 0
    # 표준 오류 출력이 참이거나 비어 있지 않은지 확인
    assert source_decode.stderr, "fixture must expose FFmpeg decoder errors despite exit code 0"

    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    audio_result = clip(damaged, output, 0, 2800)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert audio_result.status == "OMITTED_DECODE_FAILED"
    # 미디어 종류 목록이 예상 계약과 일치하는지 확인
    assert [s["codec_type"] for s in streams(output)] == ["video"]
    # 재생 길이가 예상 계약과 일치하는지 확인
    assert float(streams(output)[0]["duration"]) == pytest.approx(2.8, abs=0.06)

# 클립에만 음향 누락 상태 연결 확인
def test_evidence_attaches_audio_omission_status_to_clip_only(tmp_path, monkeypatch):
    from replay_video.infrastructure import evidence as module
    from replay_video.infrastructure.streams import ClipAudioResult
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"test stub")
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 1000, 64, 64, 20, 20, "h264")
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    candidate = Candidate(1, "OTHER", 0, 800, 400, 0.9, "UNKNOWN", (), ())
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(module, "frame", lambda _source, target, _ms: target.write_bytes(b"jpeg"))
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        module,
        "clip",
        lambda _source, target, _start, _end: (
            target.write_bytes(b"mp4"),
            ClipAudioResult("OMITTED_UNSUPPORTED", "CHANNEL_COUNT_UNSUPPORTED"),
        )[1],
    )

    # 변화 후보의 프레임과 클립 증거 생성
    entries = module.evidence(source, tmp_path / "output", metadata, (candidate,))

    # 프레임과 클립별 음향 상태 및 누락 사유가 정확히 남는지 확인
    assert [(entry.kind, entry.audio_status, entry.audio_reason) for entry in entries] == [
        ("FRAME", None, None),
        ("CLIP", "OMITTED_UNSUPPORTED", "CHANNEL_COUNT_UNSUPPORTED"),
    ]
