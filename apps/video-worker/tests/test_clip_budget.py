import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest


def api():
    return importlib.import_module("replay_video.infrastructure.evidence")


def test_clip_uses_duration_based_rate_budget_without_truncating_video(tmp_path, monkeypatch):
    commands = []
    def encode(command, **kwargs):
        commands.append(command)
        Path(command[-1]).write_bytes(b"encoded-video")
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(api().subprocess, "run", encode)
    api().clip(tmp_path / "source.mp4", tmp_path / "clip.mp4", 0, 120_000)
    command = commands[0]
    assert "-maxrate" in command and "-bufsize" in command
    rate = int(command[command.index("-maxrate") + 1])
    buffer = int(command[command.index("-bufsize") + 1])
    assert rate * 120 + buffer <= 45 * 1024 * 1024 * 8
    assert "-fs" not in command
    assert command[command.index("-t") + 1] == "120.000"


def test_encoder_cannot_report_success_with_an_oversized_clip(tmp_path, monkeypatch):
    def encode(command, **kwargs):
        with Path(command[-1]).open("wb") as stream:
            stream.seek(50 * 1024 * 1024)
            stream.write(b"x")
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(api().subprocess, "run", encode)
    with pytest.raises(RuntimeError, match="clip-size-limit"):
        api().clip(tmp_path / "source.mp4", tmp_path / "clip.mp4", 0, 33_000)
