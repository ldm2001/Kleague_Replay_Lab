import ast
from pathlib import Path

# 워커 패키지 뿌리 경로
ROOT = Path(__file__).resolve().parents[1]
# 가져오기 배치를 검사할 원본과 시험 폴더
FOLDERS = ("src", "tests")
# 실행 중 모듈을 불러오는 호출 이름
LOADERS = {"__import__", "import_module"}
# 모델 의존성 적재를 사용 시점으로 미루는 문서화한 함수 안 가져오기 위치
DEFERRED = {
    # 영상 검증과 일반 단위 시험에서 모델 불러오기 분리
    ("src/replay_video/infrastructure/perception.py", "localObservations"),
    # 검증 경로의 OpenCV와 수치 배열 및 운영 관측 포트 적재 차단
    ("src/replay_video/worker.py", "operating"),
}
# 안쪽부터 바깥 순서의 원본 계층
LAYERS = ("domain", "application", "infrastructure")

# 뿌리 기준 경로별 원본과 시험 파일 원문 생성
def sources():
    # 폴더별 파이썬 파일을 경로 순서로 읽음
    return {
        path.relative_to(ROOT).as_posix(): path.read_text(encoding="utf-8")
        for folder in FOLDERS
        for path in sorted((ROOT / folder).rglob("*.py"))
    }

# 실행 중 모듈을 불러오는 호출 대상 여부 확인
def loader(func):
    # 이름 호출은 식별자로 판별
    if isinstance(func, ast.Name):
        return func.id in LOADERS
    # 속성 호출은 마지막 속성 이름으로 판별
    return isinstance(func, ast.Attribute) and func.attr in LOADERS

# 문서 문자열 뒤 선두 묶음에 모듈마다 한 번만 선언하는 가져오기 배치의 위반 항목 목록 생성
def layout(text):
    # 구문 트리
    tree = ast.parse(text)
    # 원문 줄 목록
    lines = text.splitlines()
    # 위반 사유와 줄 번호 및 대상 이름
    found = []
    # 이미 선언한 가져오기 모듈
    seen = set()
    # 최상위 가져오기로 묶은 이름별 모듈 경로
    modules = {}
    # 이름으로 가져온 모듈과 대상 쌍
    named = set()
    # 파일 첫머리 문서 문자열 구간 여부
    prologue = True
    # 가져오기가 아닌 본문 시작 여부
    body = False
    # 직전 가져오기 선언의 끝 줄 번호
    end = 0
    # 최상위 문장 순회
    for statement in tree.body:
        # 첫머리의 연속된 문자열 문장 구간 유지
        prologue = (
            prologue
            and isinstance(statement, ast.Expr)
            and isinstance(statement.value, ast.Constant)
            and isinstance(statement.value.value, str)
        )
        # 문서 문자열은 가져오기 앞에 허용
        if prologue:
            continue
        # 가져오기가 아닌 문장은 본문으로 처리
        if not isinstance(statement, (ast.Import, ast.ImportFrom)):
            body = True
            continue
        # 본문 뒤 가져오기 거부
        if body:
            found.append(("LATE", statement.lineno, ""))
        # 선두 묶음 안에서 빈 줄로 떨어진 가져오기 거부
        elif end and not all(line.strip() for line in lines[end:statement.lineno - 1]):
            found.append(("GAP", statement.lineno, ""))
        # 이름 가져오기의 모듈 경로와 대상 기록
        if isinstance(statement, ast.ImportFrom):
            # 상대 수준을 포함한 모듈 경로
            base = "." * statement.level + (statement.module or "")
            # 형태까지 구분한 중복 판별 열쇠
            keys = [f"from {base}"]
            # 대상 이름 앞에 붙일 모듈 경로
            prefix = f"{base}." if statement.module else base
            # 대상별 묶인 경로와 이름 가져오기 쌍 기록
            for alias in statement.names:
                modules[alias.asname or alias.name] = prefix + alias.name
                named.add((base, alias.name))
        # 모듈 가져오기의 묶인 이름 기록
        else:
            # 모듈 이름을 중복 판별 열쇠로 사용
            keys = [alias.name for alias in statement.names]
            # 별칭 없는 점 경로는 최상위 패키지에 묶임
            for alias in statement.names:
                bound = alias.name if alias.asname else alias.name.split(".")[0]
                modules[alias.asname or bound] = bound
        # 같은 형태로 같은 모듈을 다시 선언한 가져오기 거부
        found += [("DUPLICATE", statement.lineno, key) for key in keys if key in seen]
        # 선언한 모듈 기록
        seen.update(keys)
        # 직전 가져오기 끝 줄 기록
        end = statement.end_lineno

    # 함수와 클래스 이름을 이은 위치 이름으로 하위 노드 방문
    def visit(node, scope):
        # 직계 하위 노드 순회
        for child in ast.iter_child_nodes(node):
            # 모듈 본문 바로 아래가 아닌 가져오기 거부
            if isinstance(child, (ast.Import, ast.ImportFrom)) and node is not tree:
                found.append(("NESTED", child.lineno, scope))
            # 실행 중 모듈을 불러오는 호출 거부
            if isinstance(child, ast.Call) and loader(child.func):
                found.append(("DYNAMIC", child.lineno, scope))
            # 이름으로 가져온 대상을 모듈 별칭으로 다시 참조하는 경로 거부
            if (
                isinstance(child, ast.Attribute)
                and isinstance(child.value, ast.Name)
                and (modules.get(child.value.id), child.attr) in named
            ):
                found.append(("REDUNDANT", child.lineno, f"{child.value.id}.{child.attr}"))
            # 함수와 클래스 안의 위치 이름
            inner = scope
            # 함수와 클래스는 바깥 위치 이름 뒤에 자기 이름을 이어 붙임
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                inner = f"{scope}.{child.name}" if scope else child.name
            # 하위 노드 방문
            visit(child, inner)

    # 파일 전체 방문
    visit(tree, "")
    # 줄 번호 순서의 위반 항목 반환
    return sorted(found, key=lambda item: item[1])

# 계층 파일이 자기보다 바깥 계층이나 명령행 진입 모듈을 가져온 대상 목록 생성
def breaches(name, text):
    # 원본 뿌리 기준 파일이 속한 점 경로 패키지
    package = Path(name).relative_to("src").parent.parts
    # 계층 밖 진입 모듈은 검사 제외
    if len(package) < 2 or package[1] not in LAYERS:
        return []
    # 자기 계층까지의 안쪽 계층
    allowed = LAYERS[: LAYERS.index(package[1]) + 1]
    # 허용 밖 가져오기 대상
    found = []
    # 함수 안 지연 가져오기까지 포함한 전체 노드 순회
    for node in ast.walk(ast.parse(text)):
        # 모듈 가져오기는 이름 그대로 대상 기록
        if isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        # 이름 가져오기는 상대 수준을 패키지 기준 절대 경로로 변환
        elif isinstance(node, ast.ImportFrom):
            # 상대 수준만큼 올라간 기준 패키지
            base = ".".join(package[: len(package) - node.level + 1]) if node.level else ""
            # 모듈 경로가 없으면 가져온 이름을 하위 모듈로 처리
            modules = (
                [".".join(filter(None, (base, node.module)))]
                if node.module
                else [f"{base}.{alias.name}" for alias in node.names]
            )
        # 가져오기가 아닌 노드 건너뜀
        else:
            continue
        # 패키지 안 대상 중 허용 계층 밖 모듈 기록
        found += [
            module
            for module in modules
            if module.split(".")[0] == "replay_video"
            and (module.split(".") + [""])[1] not in allowed
        ]
    # 위반 대상 반환
    return found

# 원본과 시험 파일마다 선두 묶음에 한 번만 선언하는 가져오기 배치 확인
def test_declares_every_import_once_in_the_leading_block():
    # 뿌리 기준 경로별 원문
    texts = sources()
    # 파일별 가져오기 배치 위반 항목
    found = [(name, *item) for name, text in texts.items() for item in layout(text)]
    # 함수 안 가져오기를 둔 파일과 위치
    nested = {(name, scope) for name, reason, _, scope in found if reason == "NESTED"}

    # 원본과 시험 폴더 모두 읽음 확인
    assert {"src/replay_video/worker.py", "tests/test_layout.py"} <= set(texts)
    # 함수 안 가져오기 외 배치 위반 없음 확인
    assert [item for item in found if item[1] != "NESTED"] == []
    # 함수 안 가져오기가 문서화한 모델 의존성 경계와 정확히 일치함 확인
    assert nested == DEFERRED

# 빈 줄과 중복 및 두 경로 참조와 본문 뒤 및 함수 안 가져오기 판별 확인
def test_rejects_spaced_duplicate_redundant_late_nested_and_dynamic_imports():
    # 위반 형태별 원본 문자열
    text = "\n".join(
        [
            '"""시험 모듈"""',
            "from __future__ import annotations",
            "import json",
            "",
            "import os",
            "import json as data",
            "from replay_video import av",
            "from replay_video.av import clip",
            "VALUE = av.clip",
            "import sys",
            "try:",
            "    import resource",
            "except ImportError:",
            "    resource = None",
            "class Probe:",
            "    def load(self):",
            "        import cv2",
            "        return __import__('numpy')",
            "def probe():",
            "    return importlib.import_module('x')",
        ]
    )

    # 문서 문자열을 허용하고 위반 사유와 줄 번호 및 위치 기록 확인
    assert layout(text) == [
        ("GAP", 5, ""),
        ("DUPLICATE", 6, "json"),
        ("REDUNDANT", 9, "av.clip"),
        ("LATE", 10, ""),
        ("NESTED", 12, ""),
        ("NESTED", 17, "Probe.load"),
        ("DYNAMIC", 18, "Probe.load"),
        ("DYNAMIC", 20, "probe"),
    ]

# 가져오기 사이 주석과 패치 대상 모듈 별칭 및 선택 의존성 건너뛰기 허용 확인
def test_accepts_commented_imports_patch_aliases_and_optional_dependency_skips():
    # 허용 형태별 원본 문자열
    text = "\n".join(
        [
            '"""시험 모듈"""',
            "# 예외 기대 도구 읽음",
            "import pytest",
            "# 패치 대상 모듈 읽음",
            "import replay_video.av as evaluator",
            "# 시험 대상 함수 읽음",
            "from replay_video.av import (",
            "    synthetic,",
            ")",
            "# 패치 조회 위치와 비공개 내부 및 선택 의존성 사용",
            "def test_probe(monkeypatch):",
            "    av = pytest.importorskip('av')",
            "    monkeypatch.setattr(evaluator, 'clip', av.open)",
            "    return synthetic(evaluator._root)",
        ]
    )

    # 모듈 별칭과 이름 가져오기의 역할 분리와 건너뛰기 호출 허용 확인
    assert layout(text) == []

# 안쪽 계층이 바깥 계층과 명령행 진입 모듈을 가져오지 않음 확인
def test_layers_import_only_inner_layers():
    # 계층 파일별 허용 밖 가져오기 대상
    found = [
        (name, module)
        for name, text in sources().items()
        if name.startswith("src/")
        for module in breaches(name, text)
    ]

    # 계층 방향 위반 없음 확인
    assert found == []

# 상대·절대·하위 모듈 이름 가져오기의 계층 역전 판별 확인
def test_rejects_relative_absolute_and_module_layer_breaches():
    # 역전 형태와 허용 형태를 섞은 응용 계층 원본 문자열
    text = "\n".join(
        [
            "from ..inspection import inspection",
            "from .. import runner",
            "import replay_video.http",
            "from replay_video.infrastructure.probe import probe",
            "from ..domain.models import Candidate",
            "from .tracker import CandidateTracker",
            "import json",
            "def load():",
            "    from ..infrastructure import ports",
        ]
    )

    # 바깥 계층과 진입 모듈만 거부하고 진입 모듈 자체는 검사 제외 확인
    assert breaches("src/replay_video/application/probe.py", text) == [
        "replay_video.inspection",
        "replay_video.runner",
        "replay_video.http",
        "replay_video.infrastructure.probe",
        "replay_video.infrastructure",
    ]
    assert breaches("src/replay_video/runner.py", text) == []
