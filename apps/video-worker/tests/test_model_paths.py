from pathlib import Path
from types import ModuleType
import json
import sys
from replay_video.infrastructure.perception import localObservations

# 검출 모델과 심판 관측 모델의 경로 분리 확인
def test_distinct_model_directories(tmp_path, monkeypatch):
    # 호출 이력을 누적할 빈 자료 구조 준비
    calls = []

    # 모델 초기화 인자 기록
    def model(kind):
        # 모델 종류와 경로 및 장치 기록
        def instance(path, *, device):
            # 호출 이력에 이번 항목 추가
            calls.append((kind, path, device))
            # 종류를 호출자에게 반환
            return kind
        # 모델 종류를 기억하는 생성 함수를 반환
        return instance

    # 관측 모델 전용 경로 반환
    def observer(key):
        # 역할과 자세 각각의 키로 전용 모델 경로 반환
        return tmp_path / key

    # 모델 실행 없이 관측 호출 인자 확인
    def observations(source, output, models, **kwargs):
        # 검출과 역할 및 자세 모델이 정해진 순서로 전달되는지 확인
        assert models == ("detector", "role", "pose")
        # 영상 길이 천 밀리초가 관측 함수에 전달되는지 확인
        assert kwargs["duration_ms"] == 1000
        # 실제 추론 없이 호출 성공을 구별할 고정 상태 반환
        return {"status": "fixture"}

    # 검출 전용 경로와 역할·자세 전용 경로 제공자를 각각 분리한 모듈 구성
    modules = {
        "replay_perception.detector": {"RtdetrDetector": model("detector")},
        "replay_perception.assets": {"directory": lambda: tmp_path / "detector"},
        "replay_perception.weights": {"directory": observer},
        "replay_perception.operational": {
            "ObserverModels": lambda *items: items,
            "observations": observations,
        },
        "replay_perception.pose": {"VitPoseEstimator": model("pose")},
        "replay_perception.roles": {"YoloRoleDetector": model("role")},
    }
    # 공유 자료의 지정 항목을 시험 대역으로 교체
    monkeypatch.setitem(sys.modules, "replay_perception", ModuleType("replay_perception"))
    # 가짜 패키지에 필요한 각 하위 모듈 순회
    for name, exports in modules.items():
        # 실제 모델 로드 대신 사용할 가짜 모듈 생성
        module = ModuleType(name)
        # 각 모델 생성자와 경로 제공 함수를 가짜 모듈에 등록
        module.__dict__.update(exports)
        # 공유 자료의 지정 항목을 시험 대역으로 교체
        monkeypatch.setitem(sys.modules, name, module)
    # 실행 환경 변수를 고정하여 주변 환경 영향 차단
    monkeypatch.setenv("WORKER_PERCEPTION_DEVICE", "cpu")

    # 검출과 역할 및 자세 모델의 분리 경로로 관측 실행
    result = localObservations(Path("source.mp4"), tmp_path, duration_ms=1000)

    # 모의 관측 함수가 반환한 상태가 그대로 전달되는지 확인
    assert result == {"status": "fixture"}
    # 각 모델 초기화가 자기 경로 제공자의 디렉터리와 지정 장치를 사용하는지 확인
    assert calls == [
        ("detector", tmp_path / "detector", "cpu"),
        ("role", tmp_path / "role", "cpu"),
        ("pose", tmp_path / "pose", "cpu"),
    ]

# 편집기의 두 소스 경로와 전용 실행 환경 설정 확인
def test_editor_source_paths():
    # 시험 파일 위치에서 저장소 최상위 경로 계산
    root = Path(__file__).resolve().parents[3]
    # 저장된 문자열을 구조화된 자료로 읽음
    settings = json.loads((root / ".vscode/settings.json").read_text())

    # 작업자 소스가 편집기 모듈 탐색 경로에 포함되는지 확인
    assert "${workspaceFolder}/apps/video-worker/src" in settings["python.analysis.extraPaths"]
    # 격리 인식 소스도 편집기 모듈 탐색 경로에 포함되는지 확인
    assert "${workspaceFolder}/experiments/perception/src" in settings["python.analysis.extraPaths"]
    # 편집기 전용 실행 환경 경로가 예상 계약과 일치하는지 확인
    assert settings["python.defaultInterpreterPath"] == (
        "${workspaceFolder}/experiments/perception/.venv-referee/bin/python"
    )
