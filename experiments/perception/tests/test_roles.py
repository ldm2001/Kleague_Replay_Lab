# 중첩 시험 자료 복사 도구 읽음
from copy import deepcopy
# 병렬 호출 시험 도구 읽음
from concurrent.futures import ThreadPoolExecutor
# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 파일과 프로세스 상태 점검 도구 읽음
import os
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 격리 명령 실행 도구 읽음
import subprocess
# 현재 실행기와 모듈 경로 정보 읽음
import sys
# 병렬 호출 제어 도구 읽음
import threading
# 가벼운 모의 객체 생성 도구 읽음
from types import SimpleNamespace
# 시험 가중치 압축 파일 도구 읽음
from zipfile import ZIP_DEFLATED, ZipFile
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험 텐서와 추론 상태 점검 도구 읽음
import torch


# 실제 외부 실행을 대신할 시험 객체 정의
class HarmlessUnapproved:
    # 추가 동작 없는 모의 구현 유지
    pass


# 실제 외부 실행을 대신할 시험 객체 정의
class LocalModel(torch.nn.Module):

    # 초기 상태와 입력 계약 구성
    def __init__(self, predictions=None):
        # 상위 시험 객체 초기 상태 실행
        super().__init__()
        # 키별로 모은 자료 생성
        self.names = dict(enumerate(("ball", "goalkeeper", "player", "referee")))
        # 모델 구조 설정의 시험 항목 구성
        self.yaml = {"nc": 4, "scale": "m", "yaml_file": "yolo11m.yaml"}
        # 모의 모델 준비
        self.model = torch.nn.Sequential()
        # 시험 식별 값 준비
        self.marker = torch.nn.Parameter(torch.zeros(1))
        # 모의 예측 배열의 시험 조건별 값 선택
        self.predictions = torch.empty((1, 8, 0)) if predictions is None else predictions
        # 모델에 전달한 입력의 값 없음 설정
        self.input = None
        # 추론 전용 모드 여부의 값 없음 설정
        self.inference = None

    # 모의 순전파 결과 반환
    def forward(self, tensor):
        # 모델에 전달한 입력 준비
        self.input = tensor
        # 추론 전용 모드 활성 여부 생성
        self.inference = torch.is_inference_mode_enabled()
        # 모의 예측 배열과 빈 목록 반환
        return self.predictions, []

# 시험 실행 환경 생성
def runtime(monkeypatch, tmp_path, predictions=None):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles

    # 고정 예측을 반환할 로컬 모의 모델 생성
    model = LocalModel(predictions)
    # 모델 메타데이터의 시험 항목 구성
    metadata = {
        # 모델 명세 판본의 1 시험값 지정
        "manifest_version": 1,
        # 모델 구분 키의 역할 모델 시험값 지정
        "model_key": "role",
        # 승인 모델 식별자의 시험값 지정
        "model_id": "martinjolif/yolo-football-player-detection",
        # 고정 모델 판본의 시험값 지정
        "revision": "5e83fafa8d564243001ce8e063612a618a138fbe",
        # 모델 배포 허가 정보의 시험값 지정
        "license": "AGPL-3.0",
        # 승인 모델 구조의 시험값 지정
        "architecture": "YOLO11m",
        # 허용 분류명 목록의 시험값 지정
        "labels": list(model.names.values()),
        # 자산 파일 명세의 시험값 지정
        "files": {
            "yolo-football-player-detection.pt": "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd"
        },
    }
    # 고정 해시와 대조한 자산 정보의 시험 대역 주입
    monkeypatch.setattr(roles, 'verification', lambda key, directory: deepcopy(metadata))
    # 무거운 파일·의존성 입출력만 시험 경계로 격리
    # 영상·텐서·출력 검증과 중복 억제·좌표 처리의 실제 실행 유지
    import cv2
    # 필요한 속성만 갖춘 모의 객체 생성
    fake_runtime = SimpleNamespace(
        torch=torch,
        cv2=cv2,
        version="8.4.146",
        # 모델 유형의 호출 조건 지정
        model_type=LocalModel,
        trusted_classes=(LocalModel,),
    )
    # 모델 실행 의존성 묶음의 시험 대역 주입
    monkeypatch.setattr(roles, 'runtimeBundle', lambda: fake_runtime)
    # 허용 목록 검사를 거친 가중치 자료의 시험 대역 주입
    monkeypatch.setattr(
        roles,
        'checkpointData',
        lambda path, runtime, **kwargs: ({"model": model}, ["test.LocalModel"]),
    )
    # 승인 모델 구조 검사 결과의 시험 대역 주입
    monkeypatch.setattr(
        roles, 'architectureMetadata', lambda candidate, runtime: {"name": "YOLO11m", "scale": "m"}
    )
    # 역할 관측과 모의 모델 반환
    return roles, model, tmp_path, metadata

# 예측 자료 생성
def predictions(rows):
    """모서리 쌍 대신 중심 가로·세로와 폭·높이 뒤 네 클래스 점수로 행 구성"""
    # 예측 자료 결과 반환
    return torch.tensor(rows, dtype=torch.float32).T.unsqueeze(0)

# 역할 검출기 인터페이스 제공 확인
def test_role_detector_api_is_available():
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.roles import YoloRoleDetector
    # 호출 가능한 인터페이스 여부의 조건 충족 확인
    assert callable(YoloRoleDetector)

# 자산 접근 전 미지원 장치 거부 확인
@pytest.mark.parametrize(
    "device", ["cuda", "cuda:0", "auto", "", None, 0, np.array(["cpu", "mps"])]
)
def test_rejects_unsupported_device_before_assets(monkeypatch, tmp_path, device):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 고정 해시와 대조한 자산 정보의 금지된 호출 감시
    monkeypatch.setattr(roles, 'verification', lambda *_: pytest.fail("read invalid-device assets"))
    # 추론 장치 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_DEVICE_INVALID"):
        # 검증된 가중치를 읽는 역할 검출기 실행
        roles.YoloRoleDetector(tmp_path, device=device)

# 가속 장치 미지원 시 대체 방지 확인
def test_unavailable_mps_does_not_fall_back(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    # 추론 장치 사용 가능 여부의 시험 대역 주입
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: False)
    # 허용 목록 검사를 거친 가중치 자료의 금지된 호출 감시
    monkeypatch.setattr(
        roles, 'checkpointData', lambda *_: pytest.fail("loaded unavailable-device model")
    )
    # 가속 장치 미지원 발생 기대
    with pytest.raises(ValueError, match="ROLE_MPS_UNAVAILABLE"):
        # 검증된 가중치를 읽는 역할 검출기 실행
        roles.YoloRoleDetector(directory, device="mps")

# 실행 환경·가중치 로드 전 해시 실패 확인
def test_hash_failure_precedes_runtime_and_checkpoint_load(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)

    # 손상된 입력 모사
    def corrupt(*args):
        # 손상된 입력 모사의 예외 상황 재현
        raise ValueError("MODEL_HASH_MISMATCH")
    # 고정 해시와 대조한 자산 정보의 시험 대역 주입
    monkeypatch.setattr(roles, 'verification', corrupt)
    # 모델 실행 의존성 묶음의 금지된 호출 감시
    monkeypatch.setattr(
        roles, 'runtimeBundle', lambda: pytest.fail("runtime before verified assets")
    )
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        # 검증된 가중치를 읽는 역할 검출기 실행
        roles.YoloRoleDetector(directory)

# 가중치 링크 해석 전 문자열 경로 검증 확인
def test_verifies_lexical_path_before_resolving_symlink_for_checkpoint(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, metadata = runtime(monkeypatch, tmp_path)
    # 호출 순서 기록의 빈 누적 공간 생성
    events = []
    # 심볼릭 링크 경로 준비
    alias = directory / "alias"
    # 실제 저장 경로 준비
    actual = directory / "actual"
    # 실제 저장 경로 생성
    actual.mkdir()
    # 심볼릭 링크 경로의 링크 경로 생성
    alias.symlink_to(actual, target_is_directory=True)
    # 고정 해시와 대조한 자산 정보의 시험 대역 주입
    monkeypatch.setattr(
        roles, 'verification', lambda key, path: events.append((key, path)) or metadata
    )
    # 허용 목록 검사를 거친 가중치 자료의 시험 대역 주입
    monkeypatch.setattr(
        roles,
        'checkpointData',
        lambda path, rt, **kwargs: events.append(("load", path)) or ({"model": model}, []),
    )
    # 검증된 가중치를 읽는 역할 검출기 실행
    roles.YoloRoleDetector(alias)
    # 호출 순서 기록의 기대 자료 일치 확인
    assert events == [
        ("role", alias.absolute()),
        ("load", actual / "yolo-football-player-detection.pt"),
    ]

# 미승인 직렬화 객체의 로드 없는 안전 거부 확인
def test_safe_loader_rejects_real_unapproved_pickle_without_loading(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 시험 가중치 파일 준비
    checkpoint = tmp_path / "untrusted.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"harmless": HarmlessUnapproved()}, checkpoint)
    # 모델 로드 인자의 금지된 호출 감시
    monkeypatch.setattr(
        torch, "load", lambda *args, **kwargs: pytest.fail("load before unsafe-global rejection")
    )
    # 직렬화 허용 목록 위반 발생 기대
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_UNSUPPORTED_GLOBAL"):
        # 허용 목록 검사를 거친 가중치 자료 실행
        roles.checkpointData(checkpoint, SimpleNamespace(torch=torch, trusted_classes=()))

# 가중치 전용 안전 로드와 허용 목록 복원 확인
def test_safe_loader_passes_weights_only_true_and_restores_allowlist(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 시험 가중치 파일 준비
    checkpoint = tmp_path / "tensor.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"model": torch.tensor([1.0])}, checkpoint)
    # 변경 전 자료 준비
    original = torch.load
    # 호출 이력의 빈 누적 공간 생성
    calls = []
    # 변경 전 상태를 보존한 복사본 생성
    before = torch.serialization.get_safe_globals().copy()

    # 호출 추적
    def tracked(*args, **kwargs):
        # 호출 이력에 현재 관측 추가
        calls.append(kwargs.copy())
        # 교체 전 원래 동작의 결과 반환
        return original(*args, **kwargs)
    # 모델 로드 인자의 시험 대역 주입
    monkeypatch.setattr(torch, "load", tracked)
    # 허용 목록 검사를 거친 가중치 자료 생성
    result, globals_used = roles.checkpointData(
        checkpoint, SimpleNamespace(torch=torch, trusted_classes=())
    )
    # 배열을 순서대로 변환한 목록 값이 1점0인지 확인
    assert result["model"].tolist() == [1.0]
    # 가중치에서 사용한 직렬화 객체 값이 빈 목록인지 확인
    assert globals_used == []
    # 가중치를 한 번만 읽고 가중치 전용 모드와 일반 연산 장치를 사용했는지 확인
    assert (
        len(calls) == 1 and calls[0]["weights_only"] is True and calls[0]["map_location"] == "cpu"
    )
    # 현재 직렬화 객체 허용 목록의 기대 자료 일치 확인
    assert torch.serialization.get_safe_globals() == before

# 기존 허용 목록의 미확인 전역 객체도 거부 확인
def test_safe_loader_rejects_even_previously_allowlisted_unknown_global(tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 시험 가중치 파일 준비
    checkpoint = tmp_path / "globally-allowed.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"unknown": HarmlessUnapproved()}, checkpoint)
    # 직렬화 객체 허용 목록 범위의 사용 구간 시작
    with torch.serialization.safe_globals([HarmlessUnapproved]):
        # 역할 관측 오류 발생 기대
        with pytest.raises(ValueError, match="ROLE_CHECKPOINT_AMBIENT_ALLOWLIST"):
            # 허용 목록 검사를 거친 가중치 자료 실행
            roles.checkpointData(checkpoint, SimpleNamespace(torch=torch, trusted_classes=()))

# 역직렬화 전 불변 내용 해시 검사 확인
def test_safe_loader_checks_immutable_payload_digest_before_deserialization(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 파일 경로 준비
    path = tmp_path / "changed.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"model": torch.tensor([1.0])}, path)
    # 파일 무결성 비교용 해시 문자열 생성
    original_digest = hashlib.sha256(path.read_bytes()).hexdigest()
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"model": torch.tensor([2.0])}, path)
    # 모델 로드 인자의 금지된 호출 감시
    monkeypatch.setattr(torch, "load", lambda *args, **kwargs: pytest.fail("loaded changed bytes"))
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        # 허용 목록 검사를 거친 가중치 자료 실행
        roles.checkpointData(
            path, SimpleNamespace(torch=torch, trusted_classes=()), expected_sha256=original_digest
        )

# 감사 중 경로 변경 시 해시 검증 내용 보존 확인
def test_safe_loader_retains_hashed_payload_if_path_changes_during_audit(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 파일 경로 준비
    path = tmp_path / "changed.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"model": torch.tensor([1.0])}, path)
    # 파일 무결성 비교용 해시 문자열 생성
    original_digest = hashlib.sha256(path.read_bytes()).hexdigest()
    # 호출 검사용 기록 준비
    audit = torch.serialization.get_unsafe_globals_in_checkpoint

    # 파일 교체 후 감사
    def replace_then_audit(stream):
        # 텐서 연산 의존성의 모의 가중치 기록
        torch.save({"model": torch.tensor([2.0])}, path)
        # 호출 검사용 기록 반환
        return audit(stream)
    # 감사 중 경로 변경 시 해시 검증 내용 보존 의존성의 시험 대역 주입
    monkeypatch.setattr(torch.serialization, "get_unsafe_globals_in_checkpoint", replace_then_audit)
    # 허용 목록 검사를 거친 가중치 자료 생성
    value, _ = roles.checkpointData(
        path, SimpleNamespace(torch=torch, trusted_classes=()), expected_sha256=original_digest
    )
    # 배열을 순서대로 변환한 목록 값이 1점0인지 확인
    assert value["model"].tolist() == [1.0]

# 생성자의 실제 로더 명세 해시 전달 확인
def test_constructor_passes_manifest_hash_to_the_actual_loader(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, metadata = runtime(monkeypatch, tmp_path)
    # 관측한 호출 기록의 빈 누적 공간 생성
    seen = []

    # 호출 내용 기록
    def capture(path, runtime, *, expected_sha256=None):
        # 관측한 호출 기록에 현재 관측 추가
        seen.append(expected_sha256)
        # 빈 목록 반환
        return {"model": model}, []
    # 허용 목록 검사를 거친 가중치 자료의 시험 대역 주입
    monkeypatch.setattr(roles, 'checkpointData', capture)
    # 검증된 가중치를 읽는 역할 검출기 실행
    roles.YoloRoleDetector(directory)
    # 관측한 호출 기록의 기대 자료 일치 확인
    assert seen == [metadata["files"]["yolo-football-player-detection.pt"]]

# 신뢰된 이름을 사칭한 주변 객체 거부 확인
def test_ambient_impostor_with_a_trusted_name_is_rejected(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 검사 대상의 자료형 생성
    impostor = type("HarmlessUnapproved", (), {})
    # 객체가 속한 모듈 준비
    impostor.__module__ = HarmlessUnapproved.__module__
    # 객체의 전체 이름 준비
    impostor.__qualname__ = HarmlessUnapproved.__qualname__
    # 모델 로드 인자의 금지된 호출 감시
    monkeypatch.setattr(torch, "load", lambda *args, **kwargs: pytest.fail("loaded with impostor"))
    # 직렬화 객체 허용 목록 범위의 사용 구간 시작
    with torch.serialization.safe_globals([impostor]):
        # 역할 관측 오류 발생 기대
        with pytest.raises(ValueError, match="ROLE_CHECKPOINT_AMBIENT_ALLOWLIST"):
            # 허용 목록 검사를 거친 가중치 자료 실행
            roles.checkpointData(
                tmp_path / "not-read.pt",
                SimpleNamespace(torch=torch, trusted_classes=(HarmlessUnapproved,)),
            )

# 병렬 안전 로드의 프로세스 전역 허용 목록 중첩 방지 확인
def test_parallel_safe_loads_cannot_overlap_process_global_allowlists(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 파일 경로 준비
    path = tmp_path / "parallel.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"model": HarmlessUnapproved()}, path)
    # 실제 가중치 읽기 함수 준비
    real_load = torch.load
    # 첫 작업 진입 신호과 두 번째 작업 진입 신호의 시험 항목 구성
    first_entered, second_entered, release_first = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )
    # 공유 호출 기록 보호 잠금 생성
    counter_lock = threading.Lock()
    # 호출 이력의 빈 누적 공간 생성
    calls = []

    # 호출 추적
    def tracked(*args, **kwargs):
        # 공유 횟수 보호 잠금의 사용 구간 시작
        with counter_lock:
            # 호출 이력에 현재 관측 추가
            calls.append(1)
            # 호출 이력의 개수 생성
            ordinal = len(calls)
        # 관측 순번의 비교 결과별 분기
        if ordinal == 1:
            # 중복을 제거한 자료 실행
            first_entered.set()
            # 병렬 작업 대기 결과의 조건 충족 확인
            assert release_first.wait(3)
        else:
            # 중복을 제거한 자료 실행
            second_entered.set()
        # 실제 가중치 읽기 함수 반환
        return real_load(*args, **kwargs)
    # 모델 로드 인자의 시험 대역 주입
    monkeypatch.setattr(torch, "load", tracked)
    # 필요한 속성만 갖춘 모의 객체 생성
    local_runtime = SimpleNamespace(torch=torch, trusted_classes=(HarmlessUnapproved,))
    # 병렬 호출을 재현할 실행기의 사용 구간 시작
    with ThreadPoolExecutor(max_workers=2) as pool:
        # 병렬로 시작한 시험 작업 생성
        first = pool.submit(roles.checkpointData, path, local_runtime)
        # 병렬 작업 대기 결과의 조건 충족 확인
        assert first_entered.wait(3)
        # 병렬로 시작한 시험 작업 생성
        second = pool.submit(roles.checkpointData, path, local_runtime)
        # 병렬 작업 대기 결과 생성
        overlapped = second_entered.wait(.1)
        # 중복을 제거한 자료 실행
        release_first.set()
        # 완료된 병렬 작업 결과 실행
        first.result(timeout=3)
        # 완료된 병렬 작업 결과 실행
        second.result(timeout=3)
    # 동시에 실행한 호출 값이 거짓인지 확인
    assert overlapped is False

# 병렬 실행 환경 로드의 원본 설정 경로 복원 확인
def test_parallel_runtime_import_restores_original_settings_path(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 시험에 필요한 검증 도구와 의존성 읽음
    import builtins
    # 문자열로 변환한 값 생성
    original = str(tmp_path / "original-settings-parent")
    # 병렬 실행 환경 로드의 원본 설정 경로 복원의 시험 환경변수 설정
    monkeypatch.setenv("YOLO_CONFIG_DIR", original)
    # 실제 의존성 읽기 함수 준비
    real_import = builtins.__import__
    # 첫 작업 진입 신호과 두 번째 작업 진입 신호의 시험 항목 구성
    first_entered, second_entered = threading.Event(), threading.Event()
    # 첫 작업 재개 신호과 두 번째 작업 재개 신호의 시험 항목 구성
    release_first, release_second = threading.Event(), threading.Event()
    # 중복을 제거한 자료 생성
    seen = set()
    # 공유 호출 기록 보호 잠금 생성
    counter_lock = threading.Lock()

    # 제어된 모듈 로드
    def controlled_import(name, *args, **kwargs):
        # 항목 이름의 비교 결과별 분기
        if name == "ultralytics":
            # 공유 횟수 보호 잠금의 사용 구간 시작
            with counter_lock:
                # 원본 파일 식별 정보 준비
                identity = threading.get_ident()
                # 스레드별 첫 호출 여부 준비
                first_for_thread = identity not in seen
                # 제어된 모듈 로드 대상 동작 실행
                seen.add(identity)
                # 관측한 호출 기록의 개수 생성
                ordinal = len(seen)
            # 스레드별 첫 호출 여부의 조건에 따른 분기
            if first_for_thread:
                # 관측 순번의 비교 결과별 분기
                if ordinal == 1:
                    # 중복을 제거한 자료 실행
                    first_entered.set()
                    # 병렬 작업 대기 결과의 조건 충족 확인
                    assert release_first.wait(5)
                else:
                    # 중복을 제거한 자료 실행
                    second_entered.set()
                    # 병렬 작업 대기 결과의 조건 충족 확인
                    assert release_second.wait(5)
        # 실제 의존성 읽기 함수 반환
        return real_import(name, *args, **kwargs)
    # 병렬 실행 환경 로드의 원본 설정 경로 복원 의존성의 시험 대역 주입
    monkeypatch.setattr(builtins, "__import__", controlled_import)
    # 병렬 호출을 재현할 실행기의 사용 구간 시작
    with ThreadPoolExecutor(max_workers=2) as pool:
        # 병렬로 시작한 시험 작업 생성
        first = pool.submit(roles.runtimeBundle)
        # 병렬 작업 대기 결과의 조건 충족 확인
        assert first_entered.wait(5)
        # 병렬로 시작한 시험 작업 생성
        second = pool.submit(roles.runtimeBundle)
        # 병렬 작업 대기 결과 생성
        overlapped = second_entered.wait(.1)
        # 중복을 제거한 자료 실행
        release_first.set()
        # 완료된 병렬 작업 결과 실행
        first.result(timeout=5)
        # 중복을 제거한 자료 실행
        release_second.set()
        # 완료된 병렬 작업 결과 실행
        second.result(timeout=5)
    # 역할 모델 설정 폴더의 기대 자료 일치 확인
    assert os.environ["YOLO_CONFIG_DIR"] == original
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not Path(original).exists()
    # 동시에 실행한 호출 값이 거짓인지 확인
    assert overlapped is False

# 주변 전역 변경 없는 자세 실행 환경 등록 공존 확인
def test_pose_runtime_registration_coexists_without_mutating_ambient_globals(tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import pose, roles
    # 모델 실행 의존성 묶음 실행
    pose.runtimeBundle()
    # 변경 전 자료의 조건별 항목 수집
    before = {id(value) for value in torch.serialization.get_safe_globals()}
    # 파일 경로 준비
    path = tmp_path / "tensor-after-pose.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"model": torch.tensor([1.0])}, path)
    # 허용 목록 검사를 거친 가중치 자료 생성
    result, audited = roles.checkpointData(path, SimpleNamespace(torch=torch, trusted_classes=()))
    # 배열을 순서대로 변환한 목록 값이 1점0인지 확인
    assert result["model"].tolist() == [1.0]
    # 검사한 호출 이력 값이 빈 목록인지 확인
    assert audited == []
    # 객체의 고유 식별값 목록의 기대 자료 일치 확인
    assert {id(value) for value in torch.serialization.get_safe_globals()} == before

# 역할 가중치 내부 자세 실행 환경 전역 객체 금지 확인
@pytest.mark.parametrize(
    "type_name",
    [
        "DeviceMesh",
        "DTensorSpec",
        "TensorMeta",
        "DTensor",
        "Partial",
        "Replicate",
        "Shard",
        "_DimRange",
    ],
)
def test_pose_runtime_global_is_still_forbidden_inside_role_checkpoint(
    monkeypatch, tmp_path, type_name
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import pose, roles
    # 모델 실행 의존성 묶음 실행
    pose.runtimeBundle()
    # 시험 텐서와 추론 상태 점검 도구 읽음
    from torch.distributed.device_mesh import DeviceMesh
    # 시험 텐서와 추론 상태 점검 도구 읽음
    from torch.distributed.tensor._dtensor_spec import DTensorSpec, TensorMeta
    # 시험 텐서와 추론 상태 점검 도구 읽음
    from torch.distributed.tensor import DTensor
    # 시험 텐서와 추론 상태 점검 도구 읽음
    from torch.distributed.tensor.placement_types import Partial, Replicate, Shard
    # 시험 텐서와 추론 상태 점검 도구 읽음
    from torch._dynamo.decorators import _DimRange
    # 손 주변 물체 관측의 조건별 항목 수집
    objects = {
        value.__name__: value
        for value in (
            DeviceMesh,
            DTensorSpec,
            TensorMeta,
            DTensor,
            Partial,
            Replicate,
            Shard,
            _DimRange,
        )
    }
    # 파일 경로 준비
    path = tmp_path / "unrelated-runtime-global.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"unwanted_type": objects[type_name]}, path)
    # 무관한 실행 환경의 기존 등록으로 공개 검사기에서 참조 제외
    # 역할 로더의 독립적인 참조 거부 요구
    assert torch.serialization.get_unsafe_globals_in_checkpoint(path) == []
    # 변경 전 자료의 조건별 항목 수집
    before = {id(value) for value in torch.serialization.get_safe_globals()}
    # 모델 로드 인자의 금지된 호출 감시
    monkeypatch.setattr(
        torch, "load", lambda *args, **kwargs: pytest.fail("loaded unrelated framework global")
    )
    # 직렬화 허용 목록 위반 발생 기대
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_UNSUPPORTED_GLOBAL"):
        # 허용 목록 검사를 거친 가중치 자료 실행
        roles.checkpointData(path, SimpleNamespace(torch=torch, trusted_classes=()))
    # 객체의 고유 식별값 목록의 기대 자료 일치 확인
    assert {id(value) for value in torch.serialization.get_safe_globals()} == before

# 등록 해제 없는 기존 신뢰 전역 객체 감사 확인
def test_preexisting_trusted_global_is_audited_without_removing_registration(tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 파일 경로 준비
    path = tmp_path / "preexisting-trusted.pt"
    # 텐서 연산 의존성의 모의 가중치 기록
    torch.save({"model": HarmlessUnapproved()}, path)
    # 직렬화 객체 허용 목록 범위의 사용 구간 시작
    with torch.serialization.safe_globals([HarmlessUnapproved]):
        # 변경 전 자료의 조건별 항목 수집
        before = {id(value) for value in torch.serialization.get_safe_globals()}
        # 허용 목록 검사를 거친 가중치 자료 생성
        result, audited = roles.checkpointData(
            path, SimpleNamespace(torch=torch, trusted_classes=(HarmlessUnapproved,))
        )
        # 검사 대상의 자료형의 기대 자료 일치 확인
        assert type(result["model"]) is HarmlessUnapproved
        # 검사한 호출 이력의 기대 자료 일치 확인
        assert audited == [f"{HarmlessUnapproved.__module__}.{HarmlessUnapproved.__qualname__}"]
        # 객체의 고유 식별값 목록의 기대 자료 일치 확인
        assert {id(value) for value in torch.serialization.get_safe_globals()} == before

# 공개 감사 전 압축된 과대 직렬화 객체 거부 확인
def test_compressed_oversized_pickle_is_rejected_before_public_audit(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 파일 경로 준비
    path = tmp_path / "compressed-oversized.pt"
    # 공개 감사 전 압축된 과대 직렬화 객체 거부 처리 자원의 사용 구간 시작
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        # 공개 감사 전 압축된 과대 직렬화 객체 거부 대상 동작 실행
        archive.writestr("archive/data.pkl", b"0" * 2048)
    # 압축된 시험 파일 자체의 크기는 1024바이트 미만인지 확인
    assert path.stat().st_size < 1024
    # 공개 감사 전 압축된 과대 직렬화 객체 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(roles, "_CHECKPOINT_MAX_BYTES", 1024)
    # 공개 감사 전 압축된 과대 직렬화 객체 거부 외부 호출의 금지된 호출 감시
    monkeypatch.setattr(
        torch.serialization,
        "get_unsafe_globals_in_checkpoint",
        lambda *args: pytest.fail("public audit ran before decompressed size bound"),
    )
    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_PICKLE_INVALID"):
        # 허용 목록 검사를 거친 가중치 자료 실행
        roles.checkpointData(path, SimpleNamespace(torch=torch, trusted_classes=()))

# 네트워크·사용자 설정 접근 없는 오프라인 실행 환경 로드 확인
def test_offline_runtime_import_does_not_touch_network_or_user_settings(tmp_path):
    # 하위 프로세스 시험 코드 준비
    script = "\nimport os\nimport socket\nimport torch\nfrom replay_perception.roles import runtimeBundle\nattempts = []\ndef forbidden(*args, **kwargs):\n    attempts.append(args)\n    raise AssertionError('NETWORK_FORBIDDEN')\nsocket.getaddrinfo = forbidden\nsocket.socket.connect = forbidden\nsocket.socket.connect_ex = forbidden\nruntime = runtimeBundle()\nfrom ultralytics import utils\nassert attempts == []\nassert utils.ONLINE is False and utils.AUTOINSTALL is False\nassert utils.SETTINGS['sync'] is False\nassert os.environ['YOLO_OFFLINE'] == '1'\nassert os.environ['YOLO_AUTOINSTALL'] == '0'\nprint('OFFLINE_IMPORT_OK')\n"
    # 시험 명령 실행 결과 생성
    result = subprocess.run(
        [sys.executable, "-W", "error", "-c", script],
        cwd=Path(__file__).parents[1],
        env={**os.environ, "PYTHONPATH": "src", "YOLO_CONFIG_DIR": str(tmp_path)},
        capture_output=True,
        # 문자열 자료의 호출 조건 지정
        text=True,
        # 제한 시간의 호출 조건 지정
        timeout=30,
    )
    # 외부 명령 종료 코드 값이 0인지 확인
    assert result.returncode == 0, result.stderr
    # 외부 명령 표준 출력에 지정한 항목 포함 확인
    assert "OFFLINE_IMPORT_OK" in result.stdout
    # 출력 폴더 항목 목록의 비교 자료 값이 빈 목록인지 확인
    assert list(tmp_path.iterdir()) == []

# 대체 활성화 가속 장치의 명시적 거부 확인
def test_mps_with_fallback_enabled_is_explicitly_rejected(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    # 추론 장치 사용 가능 여부의 시험 대역 주입
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: True)
    # 대체 활성화 가속 장치의 명시적 거부의 시험 환경변수 설정
    monkeypatch.setenv("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    # 가속 장치 미지원 발생 기대
    with pytest.raises(ValueError, match="ROLE_MPS_FALLBACK_ENABLED"):
        # 검증된 가중치를 읽는 역할 검출기 실행
        roles.YoloRoleDetector(directory, device="mps")

# 실제 모델 라벨 대응의 정확성 요구 확인
@pytest.mark.parametrize("names", [{0: "player", 1: "ball", 2: "goalkeeper", 3: "referee"},
                                   {"0": "ball", "1": "goalkeeper", "2": "player", "3": "referee"},
                                   {0: "ball", 1: "goalkeeper", 2: "player"},
                                   ["ball", "goalkeeper", "player", "referee"]])
def test_actual_model_label_mapping_must_be_exact(monkeypatch, tmp_path, names):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    # 모델 분류명 목록 준비
    model.names = names
    # 분류명 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_LABEL_MAPPING_MISMATCH"):
        # 검증된 가중치를 읽는 역할 검출기 실행
        roles.YoloRoleDetector(directory)

# 모델 가중치 누락 거부 확인
def test_missing_model_checkpoint_is_rejected(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    # 허용 목록 검사를 거친 가중치 자료의 시험 대역 주입
    monkeypatch.setattr(roles, 'checkpointData', lambda *_, **kwargs: ({"ema": None}, []))
    # 모델 계약 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_MODEL_INVALID"):
        # 검증된 가중치를 읽는 역할 검출기 실행
        roles.YoloRoleDetector(directory)

# 추론 없는 잘못된 색상 입력 거부 확인
@pytest.mark.parametrize(
    "rgb",
    [
        None,
        [],
        np.zeros((4, 4, 3)),
        np.zeros((4, 4), dtype=np.uint8),
        np.zeros((4, 4, 4), dtype=np.uint8),
        np.zeros((0, 4, 3), dtype=np.uint8),
    ],
)
def test_invalid_rgb_is_rejected_without_inference(monkeypatch, tmp_path, rgb):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_RGB_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        detector.predict(rgb)
    # 모델에 전달한 입력 부재 확인
    assert model.input is None

# 빈 예측의 튜플 반환과 32비트 실수 평가 추론 확인
def test_empty_prediction_returns_tuple_and_runs_fp32_eval_inference(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, metadata = runtime(monkeypatch, tmp_path)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 시험 영상에 대한 모델 관측 결과 값이 빈 목록인지 확인
    assert detector.predict(np.zeros((100, 200, 3), dtype=np.uint8)) == ()
    # 학습 모드는 꺼지고 추론 전용 모드는 켜졌는지 확인
    assert model.training is False and model.inference is True
    # 배열 차원 값이 1 · 3 · 640 · 640인지 확인
    assert model.input.shape == (1, 3, 640, 640)
    # 모델 입력이 일반 연산 장치의 단정밀도 텐서인지 확인
    assert model.input.dtype == torch.float32 and model.input.device.type == "cpu"
    # 자산 파일 명세의 기대 자료 일치 확인
    assert detector.provenance["files"] == metadata["files"]
    # 최소 허용 점수 값이 0점5인지 확인
    assert detector.provenance["threshold"] == .50
    # 중복 검출 억제의 상자 겹침 기준이 0점7인지 확인
    assert detector.provenance["nms"]["iou_threshold"] == .70
    # 중복 검출 억제 뒤 최대 검출 수가 300인지 확인
    assert detector.provenance["nms"]["max_detections"] == 300
    # 가중치 전용 읽기 여부 값이 참인지 확인
    assert detector.provenance["safe_loader"]["weights_only"] is True
    # 텐서 연산 의존성의 기대 자료 일치 확인
    assert detector.provenance["library_versions"]["torch"] == torch.__version__

# 주변 자동 형변환 중 모델 순전파의 32비트 실수 유지 확인
def test_model_forward_stays_fp32_inside_ambient_cpu_autocast(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    # 첫 합성곱 계층 준비
    model.first_conv = torch.nn.Conv2d(3, 4, 1)
    # 관측 결과의 빈 누적 공간 생성
    observed = []

    # 모의 순전파 결과 반환
    def forward(tensor):
        # 첫 합성곱 계층 생성
        output = model.first_conv(tensor)
        # 관측 결과에 현재 관측 추가
        observed.append(
            (output.dtype, torch.is_autocast_enabled("cpu"), torch.is_inference_mode_enabled())
        )
        # 32비트 실수 디코딩 출력만으로 이전 계층의 동일 정밀도 입증 불가
        return model.predictions, []
    # 주변 자동 형변환 중 모델 순전파의 32비트 실수 유지 의존성의 시험 대역 주입
    monkeypatch.setattr(model, "forward", forward)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 출처 기록에 자동 정밀도 변환 비활성 상태가 남았는지 확인
    assert detector.provenance["inference"]["autocast_enabled"] is False
    # 자동 정밀도 변환 활성 여부 생성
    previous_enabled = torch.is_autocast_enabled("cpu")
    # 자동 정밀도 변환 숫자 형식 생성
    previous_dtype = torch.get_autocast_dtype("cpu")
    # 자동 정밀도 변환 범위의 사용 구간 시작
    with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
        # 시험 영상에 대한 모델 관측 결과 값이 빈 목록인지 확인
        assert detector.predict(np.zeros((100, 200, 3), dtype=np.uint8)) == ()
        # 관측 결과의 기대 자료 일치 확인
        assert observed == [(torch.float32, False, True)]
        # 자동 정밀도 변환 활성 여부 값이 참인지 확인
        assert torch.is_autocast_enabled("cpu") is True
        # 자동 정밀도 변환 숫자 형식의 기대 자료 일치 확인
        assert torch.get_autocast_dtype("cpu") == torch.bfloat16
    # 자동 정밀도 변환 활성 여부의 기대 자료 일치 확인
    assert torch.is_autocast_enabled("cpu") == previous_enabled
    # 자동 정밀도 변환 숫자 형식의 기대 자료 일치 확인
    assert torch.get_autocast_dtype("cpu") == previous_dtype

# 네 역할과 원본 좌표 역변환 확인
def test_four_roles_and_source_coordinate_backtransform(monkeypatch, tmp_path):
    # 중심 좌표와 분류 점수의 모의 예측 생성
    output = predictions(
        [
            [64, 224, 64, 64, 0.9, 0, 0, 0],
            [192, 224, 64, 64, 0, 0.8, 0, 0],
            [320, 224, 64, 64, 0, 0, 0.7, 0],
            [448, 224, 64, 64, 0, 0, 0, 0.6],
        ]
    )
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, _ = runtime(monkeypatch, tmp_path, output)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 일정한 값으로 채운 시험 배열 생성
    rgb = np.full((100, 200, 3), [255, 64, 0], dtype=np.uint8)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = detector.predict(rgb)
    # 역할 가설 목록의 비교 자료 값이 공 · 골키퍼 · 선수 · 심판인지 확인
    assert tuple(item.role for item in result) == ("ball", "goalkeeper", "player", "referee")
    # 역할 검출 식별자 목록의 비교 자료 값이 0 · 1 · 2 · 3인지 확인
    assert tuple(item.role_detection_id for item in result) == (0, 1, 2, 3)
    # 검출 상자 좌표의 기대 자료 일치 확인
    assert result[0].box == pytest.approx((10, 10, 30, 30))
    # 검출 상자 좌표의 기대 자료 일치 확인
    assert result[3].box == pytest.approx((130, 10, 150, 30))
    # 배열을 순서대로 변환한 목록의 기대 자료 일치 확인
    assert model.input[0, :, 200, 20].tolist() == pytest.approx([1, 64 / 255, 0])
    # 좌표 변환 준비
    transform = detector.last_transform
    # 좌표 변환 기록의 원본 크기가 너비 200과 높이 100인지 확인
    assert transform["sourceWidth"] == 200 and transform["sourceHeight"] == 100
    # 좌표 변환 기록의 변경 크기가 너비 640과 높이 320인지 확인
    assert transform["resizedWidth"] == 640 and transform["resizedHeight"] == 320
    # 상하좌우 여백 값이 0 · 160 · 0 · 160인지 확인
    assert transform["paddingLTRB"] == [0, 160, 0, 160]
    # 원본에서 모델 입력으로의 변환 값이 3점2 · 0 · 0 · 0 · 3점2 · 160인지 확인
    assert transform["sourceToInput"] == [[3.2, 0, 0], [0, 3.2, 160]]

# 성공 프레임별 변환 읽기 전용과 실패 시 초기화 확인
def test_transform_is_read_only_per_successful_frame_and_cleared_on_failure(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 중첩 자료까지 분리한 복사본 생성
    provenance_before = deepcopy(detector.provenance)
    # 마지막 입력 좌표 변환 부재 확인
    assert detector.last_transform is None
    # 시험 영상에 대한 모델 관측 결과 실행
    detector.predict(np.zeros((100, 200, 3), dtype=np.uint8))
    # 변경 전 자료 준비
    original = detector.last_transform
    # 상하좌우 여백의 첫 항목의 999 설정
    original["paddingLTRB"][0] = 999
    # 상하좌우 여백의 첫 항목 값이 0인지 확인
    assert detector.last_transform["paddingLTRB"][0] == 0
    # 시험 영상에 대한 모델 관측 결과 실행
    detector.predict(np.zeros((200, 100, 3), dtype=np.uint8))
    # 원본 영상 너비 값이 100인지 확인
    assert detector.last_transform["sourceWidth"] == 100
    # 상하좌우 여백 값이 160 · 0 · 160 · 0인지 확인
    assert detector.last_transform["paddingLTRB"] == [160, 0, 160, 0]
    # 원본과 모델 출처의 기대 자료 일치 확인
    assert detector.provenance == provenance_before
    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_RGB_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        detector.predict(None)
    # 마지막 입력 좌표 변환 부재 확인
    assert detector.last_transform is None

# 순전파 실패 시 이전 변환 초기화와 자동 형변환 복원 확인
def test_forward_failure_clears_previous_transform_and_restores_autocast(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 관측 조건을 주입할 영 배열 생성
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    # 시험 영상에 대한 모델 관측 결과 실행
    detector.predict(image)
    # 마지막 입력 좌표 변환 존재 확인
    assert detector.last_transform is not None

    # 실패 모사
    def fail(_tensor):
        # 실패 모사의 예외 상황 재현
        raise RuntimeError("SYNTHETIC_FORWARD_FAILURE")
    # 순전파 실패 시 이전 변환 초기화와 자동 형변환 복원 의존성의 시험 대역 주입
    monkeypatch.setattr(model, "forward", fail)
    # 자동 정밀도 변환 범위의 사용 구간 시작
    with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
        # 실행 실패 발생 기대
        with pytest.raises(RuntimeError, match="SYNTHETIC_FORWARD_FAILURE"):
            # 시험 영상에 대한 모델 관측 결과 실행
            detector.predict(image)
        # 자동 정밀도 변환 활성 여부 값이 참인지 확인
        assert torch.is_autocast_enabled("cpu") is True
        # 자동 정밀도 변환 숫자 형식의 기대 자료 일치 확인
        assert torch.get_autocast_dtype("cpu") == torch.bfloat16
    # 마지막 입력 좌표 변환 부재 확인
    assert detector.last_transform is None

# 홀수 레터박스 여백의 가역성 확인
def test_odd_letterbox_padding_is_reversible(monkeypatch, tmp_path):
    # 331×100을 640×193으로 조정 후 위 223화소 아래 224화소 여백 적용
    output = predictions([[320, 319.5, 320, 96.5, 0, 0, 0, .9]])
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = detector.predict(np.zeros((100, 331, 3), dtype=np.uint8))
    # 검출 상자 좌표의 기대 자료 일치 확인
    assert result[0].box == pytest.approx((82.75, 25, 248.25, 75))
    # 상하좌우 여백 값이 0 · 223 · 0 · 224인지 확인
    assert detector.last_transform["paddingLTRB"] == [0, 223, 0, 224]
    # 변환된 영상 높이 값이 193인지 확인
    assert detector.last_transform["resizedHeight"] == 193

# 실제 클래스별 중복 억제와 신뢰도 필터 확인
def test_class_aware_nms_and_confidence_filter_are_real(monkeypatch, tmp_path):
    # 중심 좌표와 분류 점수의 모의 예측 생성
    output = predictions(
        [
            [100, 100, 40, 80, 0, 0, 0.9, 0],
            [101, 100, 40, 80, 0, 0, 0.8, 0],
            [100, 100, 40, 80, 0, 0, 0, 0.7],
            [300, 300, 20, 20, 0.49, 0, 0, 0],
        ]
    )
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    # 역할 가설 목록 값이 선수 · 심판인지 확인
    assert [item.role for item in result] == ["player", "referee"]
    # 검출 신뢰 점수 목록의 기대 자료 일치 확인
    assert [item.score for item in result] == pytest.approx([.9, .7])

# 올림 없는 신뢰도 경계 포함 확인
def test_confidence_boundary_is_inclusive_without_rounding_up(monkeypatch, tmp_path):
    # 경계에 인접한 표현 가능한 실수 생성
    below = np.nextafter(np.float32(.50), np.float32(0))
    # 중심 좌표와 분류 점수의 모의 예측 생성
    output = predictions([[100, 100, 40, 80, 0, 0, .50, 0], [200, 100, 40, 80, 0, 0, below, 0]])
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    # 점수 경계 0점5의 검출 하나가 보존됐는지 확인
    assert len(result) == 1 and result[0].score == .50

# 정확한 겹침 비율 경계 초과만 중복 억제 확인
@pytest.mark.parametrize(("center_x", "expected_count"), [
    (11.5, 2),
    (np.nextafter(np.float32(11.5), np.float32(0)), 1),
    (np.nextafter(np.float32(11.5), np.float32(20)), 2),
])
def test_nms_suppresses_only_above_exact_iou_boundary(
    monkeypatch, tmp_path, center_x, expected_count
):
    # 가로 중심 11과 2분의 1에서 교집합 140 대 합집합 200의 겹침 비율 70퍼센트
    output = predictions([[8.5, 5, 17, 10, 0, 0, .9, 0], [center_x, 5, 17, 10, 0, 0, .8, 0]])
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    # 처리 결과의 개수의 기대 자료 일치 확인
    assert len(result) == expected_count

# 검출 수 제한 확인
def test_detection_count_is_bounded(monkeypatch, tmp_path):
    # 기록 행 목록의 조건별 항목 수집
    rows = [[10 + i % 30 * 20, 10 + i // 30 * 20, 2, 2, .9, 0, 0, 0] for i in range(400)]
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, predictions(rows))
    # 시험 영상에 대한 모델 관측 결과 생성
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    # 처리 결과의 개수 값이 300인지 확인
    assert len(result) == 300

# 원본 프레임 상자 자르기와 여백 전용 상자 거부 확인
def test_boxes_clip_to_original_frame_and_padding_only_boxes_are_rejected(monkeypatch, tmp_path):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(
        monkeypatch, tmp_path, predictions([[20, 170, 80, 80, 0.9, 0, 0, 0]])
    )
    # 시험 영상에 대한 모델 관측 결과 생성
    result = roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8))
    # 검출 상자 좌표의 기대 자료 일치 확인
    assert result[0].box == pytest.approx((0, 0, 18.75, 15.625))
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(
        monkeypatch, tmp_path, predictions([[20, 20, 10, 10, 0.9, 0, 0, 0]])
    )
    # 시험 영상에 대한 모델 관측 결과 값이 빈 목록인지 확인
    assert roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8)) == ()

# 여백 전용 상자의 원본 근거 상자 억제 방지 확인
def test_padding_only_box_cannot_suppress_a_box_with_source_support(monkeypatch, tmp_path):
    # 중심 좌표와 분류 점수의 모의 예측 생성
    output = predictions([[100, 80, 40, 160, .9, 0, 0, 0], [100, 90, 40, 160, .8, 0, 0, 0]])
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8))
    # 검출 하나의 점수가 실수 오차 범위 안에서 0점8인지 확인
    assert len(result) == 1 and result[0].score == pytest.approx(.8)
    # 검출 상자 좌표의 기대 자료 일치 확인
    assert result[0].box == pytest.approx((25, 0, 37.5, 3.125))

# 여백 전용 상자의 원본 검출 상한 소진 방지 확인
def test_padding_only_boxes_do_not_exhaust_the_source_detection_cap(monkeypatch, tmp_path):
    # 기록 행 목록의 조건별 항목 수집
    rows = [[5 + i % 60 * 10, 5 + i // 60 * 20, 2, 2, .9, 0, 0, 0] for i in range(300)]
    # 기록 행 목록에 현재 관측 추가
    rows.append([320, 320, 64, 64, 0, 0, 0, .8])
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, predictions(rows))
    # 시험 영상에 대한 모델 관측 결과 생성
    result = roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8))
    # 중복 억제 뒤 심판 역할 검출 하나만 남았는지 확인
    assert len(result) == 1 and result[0].role == "referee"

# 네트워크 없는 승인 가중치 로컬 실행 확인
@pytest.mark.parametrize("device", ["cpu", "mps"])
def test_approved_checkpoint_runs_locally_without_network(monkeypatch, device):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import pose, roles
    # 선택한 항목의 값 생성
    model_dir = os.environ.get("REPLAY_ROLE_MODEL_DIR")
    # 모델 저장 폴더의 조건에 따른 분기
    if not model_dir:
        # 네트워크 없는 승인 가중치 로컬 실행 대상 동작 실행
        pytest.skip(
            "Set REPLAY_ROLE_MODEL_DIR to the approved external cache for real-model readiness"
        )
    # 시험에 필요한 검증 도구와 의존성 읽음
    import socket
    # 호출 이력의 빈 누적 공간 생성
    calls = []

    # 금지된 호출 검출
    def forbidden(*args, **kwargs):
        # 호출 이력에 현재 관측 추가
        calls.append(args)
        # 금지된 호출 검출의 예외 상황 재현
        raise AssertionError("NETWORK_FORBIDDEN")
    # 네트워크 없는 승인 가중치 로컬 실행 의존성의 시험 대역 주입
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    # 네트워크 없는 승인 가중치 로컬 실행 의존성의 시험 대역 주입
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    # 네트워크 없는 승인 가중치 로컬 실행 의존성의 시험 대역 주입
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    # 모델 실행 의존성 묶음 실행
    pose.runtimeBundle()
    # 처리 전 전역 정밀도 상태의 조건별 항목 수집
    ambient_before = {id(value) for value in torch.serialization.get_safe_globals()}
    # 네트워크 없는 승인 가중치 로컬 실행 입력의 조건에 따른 분기
    if device == "mps" and not torch.backends.mps.is_available():
        # 가속 장치 미지원 발생 기대
        with pytest.raises(ValueError, match="ROLE_MPS_UNAVAILABLE"):
            # 검증된 가중치를 읽는 역할 검출기 실행
            roles.YoloRoleDetector(model_dir, device=device)
        # 네트워크 없는 승인 가중치 로컬 실행 결과 반환
        return
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(model_dir, device=device)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = detector.predict(np.full((360, 640, 3), [24, 115, 43], dtype=np.uint8))
    # 요구 자료형 충족 여부의 조건 충족 확인
    assert isinstance(result, tuple)
    # 상하좌우 여백 값이 0 · 140 · 0 · 140인지 확인
    assert detector.last_transform["paddingLTRB"] == [0, 140, 0, 140]
    # 실제 모델 구조의 매개변수 개수가 20056092인지 확인
    assert detector.provenance["actual_architecture"]["parameter_count"] == 20056092
    # 실제 모델의 네 분류가 공과 골키퍼와 선수와 심판인지 확인
    assert detector.provenance["actual_labels"] == {
        0: "ball",
        1: "goalkeeper",
        2: "player",
        3: "referee",
    }
    # 안전 로더의 직렬화 클래스 허용 목록이 21개인지 확인
    assert len(detector.provenance["safe_loader"]["class_allowlist"]) == 21
    # 호출 이력 값이 빈 목록인지 확인
    assert calls == []
    # 객체의 고유 식별값 목록의 기대 자료 일치 확인
    assert {id(value) for value in torch.serialization.get_safe_globals()} == ambient_before
    # 추론 장치의 비교 결과별 분기
    if device == "cpu":
        # 계층별 숫자 형식의 빈 누적 공간 생성
        layer_dtypes = []
        # 연산 관찰 함수 준비
        hook = detector._model.model[0].conv.register_forward_hook(
            lambda _module, _inputs, output: layer_dtypes.append(output.dtype),
        )
        # 네트워크 없는 승인 가중치 로컬 실행의 실패 가능 구간 처리
        try:
            # 자동 정밀도 변환 범위의 사용 구간 시작
            with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
                # 시험 영상에 대한 모델 관측 결과 실행
                detector.predict(np.full((360, 640, 3), [24, 115, 43], dtype=np.uint8))
                # 자동 정밀도 변환 활성 여부 값이 참인지 확인
                assert torch.is_autocast_enabled("cpu") is True
                # 자동 정밀도 변환 숫자 형식의 기대 자료 일치 확인
                assert torch.get_autocast_dtype("cpu") == torch.bfloat16
        finally:
            # 네트워크 없는 승인 가중치 로컬 실행 대상 동작 실행
            hook.remove()
        # 계층별 숫자 형식의 기대 자료 일치 확인
        assert layer_dtypes == [torch.float32]
        # 호출 이력 값이 빈 목록인지 확인
        assert calls == []
    # 모의 타입 검사 대신 실제 설정·구조 검증에 도달하는 변경
    model, runtime = detector._model, detector._runtime
    # 네트워크 없는 승인 가중치 로컬 실행 입력 목록의 항목별 순회
    for new_scale in ("n", "l"):
        # 영상 배율 준비
        model.yaml["scale"] = new_scale
        # 역할 관측 오류 발생 기대
        with pytest.raises(ValueError, match="ROLE_ARCHITECTURE_MISMATCH"):
            # 승인 모델 구조 검사 결과 실행
            roles.architectureMetadata(model, runtime)
    # 영상 배율 준비
    model.yaml["scale"] = "m"
    # 완료를 기다릴 병렬 작업의 시험 항목 구성
    model.model[-1].f = [15, 19, 22]
    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_ARCHITECTURE_MISMATCH"):
        # 승인 모델 구조 검사 결과 실행
        roles.architectureMetadata(model, runtime)

# 잘못된 원시 출력의 안전한 실패 확인
@pytest.mark.parametrize(
    "output",
    [
        torch.zeros((2, 8, 1)),
        torch.zeros((1, 9, 1)),
        torch.zeros((1, 8)),
        torch.full((1, 8, 1), float("nan")),
        torch.full((1, 8, 1), float("inf")),
        predictions([[10, 10, -1, 3, 0, 0, 0.9, 0]]),
        predictions([[10, 10, 3, 3, 0, 0, 1.1, 0]]),
        predictions([[10, 10, 3, 3, -0.1, 0, 0.9, 0]]),
        "invalid",
        torch.tensor([[[10], [10], [3], [3], [-1e-50], [0], [0.9], [0]]], dtype=torch.float64),
        torch.empty((1, 8, 8401)),
    ],
)
def test_malformed_raw_outputs_fail_closed(monkeypatch, tmp_path, output):
    # 시험용 모델과 검증 기록을 갖춘 실행 환경 생성
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    # 검증된 가중치를 읽는 역할 검출기 생성
    detector = roles.YoloRoleDetector(directory)
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_OUTPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        detector.predict(np.zeros((100, 200, 3), dtype=np.uint8))

# 잘못된 규모·비검출 모델 구조 거부 확인
def test_architecture_rejects_wrong_scale_or_non_detection_model(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import roles
    # 자료형 거부 시험용 일반 객체과 필요한 속성만 갖춘 모의 객체의 항목별 순회
    for candidate in (
        object(),
        SimpleNamespace(yaml={"nc": 4, "scale": "n", "yaml_file": "yolo11n.yaml"}),
    ):
        # 역할 관측 오류 발생 기대
        with pytest.raises(ValueError, match="ROLE_ARCHITECTURE_MISMATCH"):
            # 승인 모델 구조 검사 결과 실행
            roles.architectureMetadata(candidate, SimpleNamespace(model_type=LocalModel))
