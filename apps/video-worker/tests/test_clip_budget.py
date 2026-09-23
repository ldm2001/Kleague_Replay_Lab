import importlib
from pathlib import Path
from types import SimpleNamespace
import pytest

# 시험용 호출 규약 반환
def api():
    # 클립 생성 구현을 지연 로드하여 시험 대역 교체 지점 반환
    return importlib.import_module("replay_video.infrastructure.evidence")

# 영상 절단 없는 길이별 비트 전송률 할당 확인
def test_clip_uses_duration_based_rate_budget_without_truncating_video(tmp_path, monkeypatch):
    # 미디어 명령 실행 이력을 누적할 빈 자료 구조 준비
    commands = []
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        api(),
        'clipStreams',
        lambda _source: SimpleNamespace(
            video_index=0,
            video_origin_seconds=0.0,
            media_origin_seconds=0.0,
            audio_index=1,
            audio_channels=2,
            audio_issue=None,
        ),
    )
    # 120초 길이와 음향 포함 상태로 출력 검증 결과 고정
    monkeypatch.setattr(api(), 'outputStreams', lambda _destination: (120.0, True))
    # 전송률 시험에서는 실제 미디어 검증을 별도 의존성으로 고정
    monkeypatch.setattr(api(), 'audioOutput', lambda _destination, _timeout: True)

    # 인코딩 모형
    def encode(command, **kwargs):
        # 미디어 명령 실행 이력에 이번 항목 추가
        commands.append(command)
        # 시험에 사용할 파일 경로 구성 결과에 시험 내용을 기록
        Path(command[-1]).write_bytes(b"encoded-video")
        # 필요한 속성만 제공하는 대역 객체 결과 반환
        return SimpleNamespace(returncode=0, stdout="", stderr="")
    # 실제 인코딩 대신 실행 명령을 기록하는 대역 연결
    monkeypatch.setattr(api().subprocess, "run", encode)
    # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
    api().clip(tmp_path / "source.mp4", tmp_path / "clip.mp4", 0, 120_000)
    # 미디어 명령 실행 이력의 선택 항목을 후속 비교에 사용할 값으로 보관
    command = commands[0]
    # 파일 크기 예산을 제어할 최대 비트율과 버퍼 인자가 있는지 확인
    assert "-maxrate" in command and "-bufsize" in command
    # 인코더 명령에서 실제 최대 영상 비트율 읽음
    rate = int(command[command.index("-maxrate") + 1])
    # 실행 명령을 후속 비교에 사용할 값으로 보관
    buffer = int(command[command.index("-bufsize") + 1])
    # 음향 비트율과 버퍼까지 합산해도 증거 크기 예산 안인지 확인
    assert (rate + 128_000) * 120 + buffer <= 44 * 1024 * 1024 * 8
    # 크기 제한에 도달하면 영상을 절단하는 옵션이 없는지 확인
    assert "-fs" not in command
    # 짧은 음향 길이에 맞춰 영상이 잘리는 옵션이 없는지 확인
    assert "-shortest" not in command
    # 원본 시간축에 정렬된 음향 필터 출력이 연결되는지 확인
    assert "[a]" in command
    # 실행 명령이 예상 계약과 일치하는지 확인
    assert command[command.index("-t") + 1] == "120.000"

# 크기 초과 클립의 성공 보고 차단 확인
def test_encoder_cannot_report_success_with_an_oversized_clip(tmp_path, monkeypatch):
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        api(),
        'clipStreams',
        lambda _source: SimpleNamespace(
            video_index=0,
            video_origin_seconds=0.0,
            media_origin_seconds=0.0,
            audio_index=1,
            audio_channels=2,
            audio_issue=None,
        ),
    )

    # 인코딩 모형
    def encode(command, **kwargs):
        # 시험에 사용할 파일 경로 구성 결과을 닫힘이 보장되는 범위에서 열기
        with Path(command[-1]).open("wb") as stream:
            # 실제 데이터를 대량 생성하지 않고 허용 크기 끝으로 이동
            stream.seek(50 * 1024 * 1024)
            # 허용 상한을 넘는 한 바이트를 기록
            stream.write(b"x")
        # 필요한 속성만 제공하는 대역 객체 결과 반환
        return SimpleNamespace(returncode=0, stdout="", stderr="")
    # 인코더가 크기 상한 초과 파일을 만드는 상황 주입
    monkeypatch.setattr(api().subprocess, "run", encode)
    # 크기 초과 클립의 성공 보고 차단을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="clip-size-limit"):
        # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
        api().clip(tmp_path / "source.mp4", tmp_path / "clip.mp4", 0, 33_000)

# 명시 구간보다 짧은 클립 거부 확인
def test_encoder_rejects_a_clip_shorter_than_its_claimed_interval(tmp_path, monkeypatch):
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        api(),
        'clipStreams',
        lambda _source: SimpleNamespace(
            video_index=0,
            video_origin_seconds=0.0,
            media_origin_seconds=0.0,
            audio_index=None,
            audio_channels=None,
            audio_issue=None,
        ),
    )
    # 요청보다 짧고 음향도 없는 출력 조회 결과 주입
    monkeypatch.setattr(api(), 'outputStreams', lambda _destination: (0.2, False))

    # 인코딩 모형
    def encode(command, **kwargs):
        # 시험에 사용할 파일 경로 구성 결과에 시험 내용을 기록
        Path(command[-1]).write_bytes(b"short-video")
        # 필요한 속성만 제공하는 대역 객체 결과 반환
        return SimpleNamespace(returncode=0, stdout="", stderr="")
    # 인코딩 성공처럼 보이지만 잘린 결과를 만드는 대역 연결
    monkeypatch.setattr(api().subprocess, "run", encode)

    # 명시 구간보다 짧은 클립 거부를 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="clip-duration-short"):
        # 지정 시간 구간의 영상과 가용 음향을 증거 클립으로 추출
        api().clip(tmp_path / "source.mp4", tmp_path / "clip.mp4", 0, 1000)
