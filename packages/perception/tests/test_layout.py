# 구문 트리 분석 도구 읽음
import ast
# 시험 파일 경로 도구 읽음
from pathlib import Path

# 인식 실증 패키지 뿌리 경로
ROOT = Path(__file__).resolve().parents[1]
# 가져오기 배치를 검사할 원본과 시험 폴더
FOLDERS = ("src", "tests")
# 실행 중 모듈을 불러오는 호출 이름
LOADERS = {"__import__", "import_module"}
# 대형 실행 환경과 선택 의존성 적재를 사용 시점으로 미루는 문서화한 함수 안 가져오기 위치
DEFERRED = {
    # 추론 시점에만 필요한 검출 모델 대형 실행 환경 분리
    ("src/replay_perception/detector.py", "runtimeBundle"),
    # 운영체제에 따라 없는 자원 사용량 조회 도구의 부재 처리
    ("src/replay_perception/inspection.py", "peakMemory"),
    # 복호화 도구 없는 환경에서도 영상 모듈을 읽는 선택 복호화 도구
    ("src/replay_perception/media.py", "VideoReader.__enter__"),
    # 추론 시점에만 필요한 자세 모델 대형 실행 환경 분리
    ("src/replay_perception/pose.py", "runtimeBundle"),
    # 자세 모델 실행 환경에 속한 처리기 좌표 변환 함수 분리
    ("src/replay_perception/pose.py", "inputTransform"),
    # 환경 변수 고정 뒤에만 읽어야 하는 역할 검출 모델 실행 환경
    ("src/replay_perception/roles.py", "lockedRuntime"),
    # 가중치 검사 시점에만 필요한 텐서 실행 환경 내부 객체
    ("src/replay_perception/roles.py", "lockedCheckpoint"),
}

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

# 원본과 시험 파일마다 선두 묶음에 한 번만 선언하는 가져오기 배치 확인
def test_declares_every_import_once_in_the_leading_block():
    # 뿌리 기준 경로별 원문
    texts = sources()
    # 파일별 가져오기 배치 위반 항목
    found = [(name, *item) for name, text in texts.items() for item in layout(text)]
    # 함수 안 가져오기를 둔 파일과 위치
    nested = {(name, scope) for name, reason, _, scope in found if reason == "NESTED"}

    # 원본과 시험 폴더 모두 읽음 확인
    assert {"src/replay_perception/roles.py", "tests/test_layout.py"} <= set(texts)
    # 함수 안 가져오기 외 배치 위반 없음 확인
    assert [item for item in found if item[1] != "NESTED"] == []
    # 함수 안 가져오기가 문서화한 실행 환경과 선택 의존성 경계와 정확히 일치함 확인
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
            "from replay_perception import pose",
            "from replay_perception.pose import runtimeBundle",
            "VALUE = pose.runtimeBundle",
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
        ("REDUNDANT", 9, "pose.runtimeBundle"),
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
            "from replay_perception import media",
            "# 시험 대상 자료형 읽음",
            "from replay_perception.media import (",
            "    VideoSample,",
            ")",
            "# 패치 조회 위치와 비공개 내부 및 선택 의존성 사용",
            "def test_probe(monkeypatch):",
            "    av = pytest.importorskip('av')",
            "    monkeypatch.setattr(media, 'open', av.open)",
            "    return VideoSample(media._index)",
        ]
    )

    # 모듈 별칭과 이름 가져오기의 역할 분리와 건너뛰기 호출 허용 확인
    assert layout(text) == []
