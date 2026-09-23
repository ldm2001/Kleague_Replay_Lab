from pathlib import Path
from threading import Event, Thread
import os
import subprocess
import sys
import pytest
from replay_video import runner

# 새 검증 프로세스의 운영 모델 모듈 미적재 확인
def test_validation_imports():
    source = """
import sys
from types import SimpleNamespace
from replay_video import worker
assert 'replay_video.infrastructure.ports' not in sys.modules
assert 'replay_video.infrastructure.perception' not in sys.modules
worker.probe = lambda path: SimpleNamespace(duration_ms=1000, width=320, height=180, fps=25, frame_count=25, codec='h264')
result = worker.job({'job_id': 'validation', 'job_type': 'VALIDATE_VIDEO', 'source_path': '/unused'})
assert result.payload['kind'] == 'VALIDATED'
assert 'replay_video.infrastructure.ports' not in sys.modules
assert 'torch' not in sys.modules
assert 'ultralytics' not in sys.modules
"""
    environment = {**os.environ, "PYTHONPATH": str(Path(runner.__file__).parents[1])}
    result = subprocess.run(
        [sys.executable, "-c", source], env=environment,
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0, result.stderr

# 설정별 작업 종류 선택 확인
@pytest.mark.parametrize("value,expected", [
    (None, ("VALIDATE_VIDEO", "ANALYZE_VIDEO")),
    (" VALIDATE_VIDEO ", ("VALIDATE_VIDEO",)),
    ("ANALYZE_VIDEO", ("ANALYZE_VIDEO",)),
])
def test_kinds(value, expected):
    assert runner.kinds(value) == expected

# 잘못된 명시 설정의 조기 거부 확인
@pytest.mark.parametrize("value", ["", " ", "PURGE_VIDEO", "DELETE_VIDEO", "validate_video", "VALIDATE_VIDEO,ANALYZE_VIDEO"])
def test_invalid(value, monkeypatch):
    monkeypatch.setenv("WORKER_JOB_TYPE", value)
    with pytest.raises(ValueError, match="WORKER_JOB_TYPE"):
        runner.main()

# 빈 작업 목록과 잘못된 반복 입력 거부 확인
@pytest.mark.parametrize("selected", [(), ("PURGE_VIDEO",), "VALIDATE_VIDEO", ("VALIDATE_VIDEO", "VALIDATE_VIDEO")])
def test_loop_invalid(selected, tmp_path):
    with pytest.raises(ValueError):
        runner.loop(None, tmp_path, 0.1, selected)

# 역할별 선점과 실패 후 지연 재시도 확인
@pytest.mark.parametrize("selected", [("VALIDATE_VIDEO",), ("ANALYZE_VIDEO",), ("VALIDATE_VIDEO", "ANALYZE_VIDEO")])
def test_claims(selected, tmp_path, monkeypatch):
    calls = []
    delays = []

    # 실제 작업 경계에 선점 실패 통신 대역 제공
    class Api:

        # 첫 순회 실패와 다음 순회 종료 재현
        def claim(self, kind):
            calls.append(kind)
            if len(calls) > len(selected):
                raise KeyboardInterrupt()
            raise RuntimeError("claim-failure")

    monkeypatch.setattr(runner.time, "sleep", delays.append)
    with pytest.raises(KeyboardInterrupt):
        runner.loop(Api(), tmp_path, 0.25, selected)
    assert calls == [*selected, selected[0]]
    assert delays == [0.25]

# 분석 대기 중 독립 검증 반복의 진행 확인
def test_independent(tmp_path, monkeypatch):
    entered, release, validated = Event(), Event(), Event()
    errors = []

    # 분석만 대기시키는 작업 경계 모형
    def cycle(api, kind, root):
        if kind == "ANALYZE_VIDEO":
            entered.set()
            if not release.wait(3):
                errors.append("release-timeout")
        else:
            validated.set()
        raise KeyboardInterrupt()

    # 시험용 반복 종료 신호 처리
    def run(kind):
        try:
            runner.loop(None, tmp_path / kind, 0.1, (kind,))
        except KeyboardInterrupt:
            pass
        except Exception as error:
            errors.append(error)

    monkeypatch.setattr(runner, "cycle", cycle)
    analysis = Thread(target=run, args=("ANALYZE_VIDEO",))
    validation = Thread(target=run, args=("VALIDATE_VIDEO",))
    analysis.start()
    try:
        assert entered.wait(2)
        validation.start()
        assert validated.wait(2)
        assert analysis.is_alive()
    finally:
        release.set()
        analysis.join(3)
        if validation.ident is not None:
            validation.join(3)
    assert not errors
