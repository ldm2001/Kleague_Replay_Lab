# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 메모리 바이트 입출력 도구 읽음
import io
# 기록 직렬화와 읽기 도구 읽음
import json
# 보안 다운로드 연결 도구 읽음
import ssl
# 중첩 시험 자료 복사 도구 읽음
from copy import deepcopy
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 다운로드 요청과 전송 오류 도구 읽음
from urllib.request import Request
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest


# 역할 모델 고정 판본 준비
ROLE_REVISION = "5e83fafa8d564243001ce8e063612a618a138fbe"
# 자세 모델 고정 판본 준비
POSE_REVISION = "0c30b6534bb621af0162b481176742577264e36e"


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeResponse:

    # 초기 상태와 입력 계약 구성
    def __init__(self, payload: bytes, *, content_length: object = None):
        # 메모리에서 읽고 쓸 바이트 저장소 읽음
        self._stream = io.BytesIO(payload)
        # 전송 응답 헤더의 빈 누적 공간 생성
        self.headers = {}
        # 선언한 전송 바이트 수의 비교 결과별 분기
        if content_length is not None:
            # 문자열로 변환한 값 생성
            self.headers["Content-Length"] = str(content_length)

    # 처리 자원 준비
    def __enter__(self):
        # 상태를 기록한 현재 모의 객체 반환
        return self

    # 처리 자원 정리
    def __exit__(self, *_args):
        # 처리 자원 정리 결과 반환
        return False

    # 자료 읽음
    def read(self, amount: int) -> bytes:
        # 요청한 분량의 바이트 자료 반환
        return self._stream.read(amount)

    # 가용 자료 읽음
    def read1(self, amount: int) -> bytes:
        # 요청한 분량의 바이트 자료 반환
        return self.read(amount)

# 제한된 자식을 제어된 전송으로 대체
@pytest.fixture(autouse=True)
def _replace_bounded_child_with_controlled_transport(monkeypatch):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 제한된 자식을 제어된 전송으로 대체 의존성의 시험 대역 주입
    monkeypatch.setattr(weights, "_urlopen", None, raising=False)

    # 제어된 전송 실행
    def controlled_transfer(model_key, filename, descriptor, timeout_seconds):
        # 승인 모델에 고정된 자산 명세 읽음
        model = weights.manifestModel(model_key)
        # 조건에 맞는 다음 항목 생성
        entry = next(item for item in model["files"] if item["name"] == filename)
        # 제어된 전송 입력의 비교 결과별 분기
        if weights._urlopen is None:
            # 제어된 전송의 예외 상황 재현
            raise AssertionError("test must provide controlled transport")
        # 암호화 통신 설정 준비
        context = ssl.create_default_context()
        # 자산 다운로드 요청 준비
        request = Request(
            entry["url"],
            # 전송 응답 헤더의 호출 조건 지정
            headers={"User-Agent": "Replay-Lab-Perception/0.1"},
            # 관측 방법의 호출 조건 지정
            method="GET",
        )
        # 제어된 전송의 실패 가능 구간 처리
        try:
            # 제어된 전송 처리 자원의 사용 구간 시작
            with weights._urlopen(
                request,
                # 제한 시간의 호출 조건 지정
                timeout=min(30, timeout_seconds),
                # 암호화 통신 설정의 호출 조건 지정
                context=context,
            ) as response:
                # 선택한 항목의 값 생성
                declared_size = response.headers.get("Content-Length")
                # 응답에서 선언한 파일 크기의 비교 결과별 분기
                if declared_size is not None:
                    # 제어된 전송의 실패 가능 구간 처리
                    try:
                        # 정수로 변환한 값 생성
                        parsed_size = int(declared_size)
                    except (TypeError, ValueError) as exc:
                        # 제어된 전송의 예외 상황 재현
                        raise ValueError(
                            f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                        ) from exc
                    # 정수로 읽은 파일 크기의 비교 결과별 분기
                    if parsed_size != entry["size"]:
                        # 제어된 전송의 예외 상황 재현
                        raise ValueError(
                            f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                        )

                # 원본 무결성을 비교할 해시 누적기 생성
                digest = hashlib.sha256()
                # 실제로 수신한 바이트 수의 0 설정
                received = 0
                # 선택한 객체 속성 생성
                read_available = getattr(response, "read1", response.read)
                # 종료 조건까지 제어된 전송 반복
                while True:
                    # 응답 조각 읽기 함수 생성
                    chunk = read_available(1024 * 1024)
                    # 읽은 바이트 조각의 조건에 따른 분기
                    if not chunk:
                        # 더 읽을 자료가 없는 반복 종료
                        break
                    # 실제로 수신한 바이트 수 갱신
                    received += len(chunk)
                    # 실제로 수신한 바이트 수의 비교 결과별 분기
                    if received > entry["size"]:
                        # 제어된 전송의 예외 상황 재현
                        raise ValueError(
                            f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                        )
                    # 파일 해시 누적기에 현재 입력 반영
                    digest.update(chunk)
                    # 제어된 전송 대상 동작 실행
                    weights.os.write(descriptor, chunk)
                # 실제로 수신한 바이트 수의 비교 결과별 분기
                if received != entry["size"]:
                    # 제어된 전송의 예외 상황 재현
                    raise ValueError(
                        f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                    )
                # 파일 무결성 비교용 해시 문자열의 비교 결과별 분기
                if digest.hexdigest() != entry["sha256"]:
                    # 제어된 전송의 예외 상황 재현
                    raise ValueError(
                        f"OBSERVER_MODEL_HASH_MISMATCH: {filename}"
                    )
        except TimeoutError as exc:
            # 제어된 전송의 예외 상황 재현
            raise TimeoutError(
                f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {filename}"
            ) from exc

    # 제한된 자식을 제어된 전송으로 대체 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        'boundedDownload',
        controlled_transfer,
    )

# 승인된 두 관측 모델만 고정한 명세 확인
def test_packaged_manifest_pins_only_the_two_approved_observer_models():
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.weights import observerManifest

    # 승인된 관측 모델 전체 명세 읽음
    manifest = observerManifest()

    # 기록 형식 판본 값이 1인지 확인
    assert manifest["schema_version"] == 1
    # 모델 목록의 비교 자료 값이 역할 모델 · 자세 모델인지 확인
    assert set(manifest["models"]) == {"role", "pose"}

    # 역할 가설 준비
    role = manifest["models"]["role"]
    # 역할 가설의 기대 자료 일치 확인
    assert role == {
        # 승인 모델 식별자의 시험값 지정
        "model_id": "martinjolif/yolo-football-player-detection",
        # 모델 저장 이름의 기대값 지정
        "slug": "yolo11m_football",
        # 고정 모델 판본의 시험값 지정
        "revision": ROLE_REVISION,
        # 모델 배포 허가 정보의 시험값 지정
        "license": "AGPL-3.0",
        # 승인 모델 구조의 시험값 지정
        "architecture": "YOLO11m",
        # 허용 분류명 목록의 공 · 골키퍼 · 선수 · 심판 시험값 지정
        "labels": ["ball", "goalkeeper", "player", "referee"],
        # 자산 파일 명세의 시험값 지정
        "files": [
            {
                # 항목 이름의 시험값 지정
                "name": "yolo-football-player-detection.pt",
                # 파일 크기의 40583084 시험값 지정
                "size": 40583084,
                # 파일 무결성 해시의 시험값 지정
                "sha256": "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd",
                # 다운로드 주소의 시험값 지정
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{ROLE_REVISION}/yolo-football-player-detection.pt"
                ),
            },
            {
                # 항목 이름의 시험값 지정
                "name": "README.md",
                # 파일 크기의 2537 시험값 지정
                "size": 2537,
                # 파일 무결성 해시의 시험값 지정
                "sha256": "446b7be35352183834b72eda7e197485a3da660e77a2013409a0e91fe00efb92",
                # 다운로드 주소의 시험값 지정
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{ROLE_REVISION}/README.md"
                ),
            },
        ],
    }

    # 자세 관측 준비
    pose = manifest["models"]["pose"]
    # 승인 모델 식별자의 기대 자료 일치 확인
    assert pose["model_id"] == "usyd-community/vitpose-plus-small"
    # 모델 저장 이름의 기대 자료 일치 확인
    assert pose["slug"] == "vitpose_plus_small"
    # 고정 모델 판본의 기대 자료 일치 확인
    assert pose["revision"] == POSE_REVISION
    # 모델 배포 허가 정보의 기대 자료 일치 확인
    assert pose["license"] == "Apache-2.0"
    # 승인 모델 구조의 기대 자료 일치 확인
    assert pose["architecture"] == "VitPoseForPoseEstimation"
    # 관절 좌표와 점수의 기대 자료 일치 확인
    assert pose["keypoints"] == [
        "nose",
        "left_eye",
        "right_eye",
        "left_ear",
        "right_ear",
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
    ]
    # 자산 파일 명세의 기대 자료 일치 확인
    assert pose["files"] == [
        {
            # 항목 이름의 시험값 지정
            "name": "model.safetensors",
            # 파일 크기의 132619932 시험값 지정
            "size": 132619932,
            # 파일 무결성 해시의 시험값 지정
            "sha256": "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9",
            # 다운로드 주소의 시험값 지정
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/model.safetensors"
            ),
        },
        {
            # 항목 이름의 시험값 지정
            "name": "config.json",
            # 파일 크기의 1846 시험값 지정
            "size": 1846,
            # 파일 무결성 해시의 시험값 지정
            "sha256": "9a81cb593c0af3c5a7e07bb4ffb4643d6a8163f73b4373d294b4a4997c8abe81",
            # 다운로드 주소의 시험값 지정
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/config.json"
            ),
        },
        {
            # 항목 이름의 시험값 지정
            "name": "preprocessor_config.json",
            # 파일 크기의 363 시험값 지정
            "size": 363,
            # 파일 무결성 해시의 시험값 지정
            "sha256": "9b11cadc98c30b968a70cc1658ce1fbd74b721b0f21402a2ff8bc1dc9d1474a0",
            # 다운로드 주소의 시험값 지정
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/preprocessor_config.json"
            ),
        },
        {
            # 항목 이름의 시험값 지정
            "name": "README.md",
            # 파일 크기의 11656 시험값 지정
            "size": 11656,
            # 파일 무결성 해시의 시험값 지정
            "sha256": "0f83999d99d35f74969ff14d33c29fe9657888d92f532baff8339ba1a486f834",
            # 다운로드 주소의 시험값 지정
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/README.md"
            ),
        },
    ]

# 기본 관측 모델 경로의 외부 캐시 사용 확인
@pytest.mark.parametrize(
    ("model_key", "slug", "revision"),
    [
        ("role", "yolo11m_football", ROLE_REVISION),
        ("pose", "vitpose_plus_small", POSE_REVISION),
    ],
)
def test_default_observer_model_dir_uses_the_external_cache(
    monkeypatch, tmp_path, model_key, slug, revision
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.weights import directory

    # 기본 관측 모델 경로의 외부 캐시 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    # 시험 모델 파일 폴더의 기대 자료 일치 확인
    assert directory(model_key) == (
        tmp_path / ".cache" / "replay-lab" / "models" / slug / revision
    )

# 알 수 없는 관측 모델 키 거부 확인
@pytest.mark.parametrize("model_key", ["", "roles", "ROLE", "rtdetr", None])
def test_unknown_observer_model_key_is_rejected(model_key):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.weights import directory

    # 모델 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_KEY_INVALID"):
        # 시험 모델 파일 폴더 실행
        directory(model_key)

# 미승인 식별·어휘의 명세 검증 거부 확인
@pytest.mark.parametrize(
    ("model_key", "field", "replacement"),
    [
        ("role", "model_id", "other/role-model"),
        ("role", "revision", "0" * 40),
        ("role", "architecture", "ArbitraryDetector"),
        ("role", "labels", ["person", "referee"]),
        ("pose", "model_id", "other/pose-model"),
        ("pose", "revision", "f" * 40),
        ("pose", "architecture", "ArbitraryPoseModel"),
        ("pose", "keypoints", ["left_wrist"]),
    ],
)
def test_manifest_validation_rejects_unapproved_identity_or_vocabulary(
    model_key, field, replacement
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 승인된 관측 모델 전체 명세 읽음
    manifest = weights.observerManifest()
    # 모델 목록의 선택 항목의 선택 항목 준비
    manifest["models"][model_key][field] = replacement

    # 모델 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_MANIFEST_INVALID"):
        # 고정 자산 명세 검증 결과 실행
        weights.manifestValidation(manifest)

# 추가 모델 키의 명세 검증 거부 확인
def test_manifest_validation_rejects_an_added_model_key():
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 승인된 관측 모델 전체 명세 읽음
    manifest = weights.observerManifest()
    # 중첩 자료까지 분리한 복사본 생성
    manifest["models"]["extra"] = deepcopy(manifest["models"]["role"])

    # 모델 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_MANIFEST_INVALID"):
        # 고정 자산 명세 검증 결과 실행
        weights.manifestValidation(manifest)

# 시험용 모델 자산 명세 생성
def _test_model(*files: tuple[str, bytes]) -> dict[str, object]:
    # 시험용 모델 자산 명세 결과 반환
    return {
        # 승인 모델 식별자의 시험값 지정
        "model_id": "martinjolif/yolo-football-player-detection",
        # 모델 저장 이름의 시험값 지정
        "slug": "yolo11m_football",
        # 고정 모델 판본의 시험값 지정
        "revision": ROLE_REVISION,
        # 모델 배포 허가 정보의 시험값 지정
        "license": "AGPL-3.0",
        # 승인 모델 구조의 시험값 지정
        "architecture": "YOLO11m",
        # 허용 분류명 목록의 공 · 골키퍼 · 선수 · 심판 시험값 지정
        "labels": ["ball", "goalkeeper", "player", "referee"],
        # 자산 파일 명세의 시험값 지정
        "files": [
            {
                # 항목 이름의 시험값 지정
                "name": name,
                # 파일 크기의 시험값 지정
                "size": len(payload),
                # 파일 무결성 해시의 시험값 지정
                "sha256": hashlib.sha256(payload).hexdigest(),
                # 다운로드 주소의 시험값 지정
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{ROLE_REVISION}/{name}"
                ),
            }
            for name, payload in files
        ],
    }

# 모든 고정 관측 자산 파일 요구 확인
def test_verify_observer_assets_requires_every_pinned_file(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", b"weights"), ("README.md", b"card"))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "weights.pt").write_bytes(b"weights")

    # 모델 계약 오류 발생 기대
    with pytest.raises(FileNotFoundError, match="OBSERVER_MODEL_FILE_MISSING: README.md"):
        # 고정 해시와 대조한 자산 정보 실행
        weights.verification("role", tmp_path)

# 변조 관측 자산 거부 확인
def test_verify_observer_assets_rejects_tampering(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", b"expected"))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "weights.pt").write_bytes(b"tampered")

    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH: weights.pt"):
        # 고정 해시와 대조한 자산 정보 실행
        weights.verification("role", tmp_path)

# 해시 일치 시에도 잘못된 자산 크기 거부 확인
def test_verify_observer_assets_rejects_wrong_size_even_if_hash_matches(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"verified"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 파일 크기 준비
    model["files"][0]["size"] = len(payload) + 1
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "weights.pt").write_bytes(payload)

    # 파일 크기 불일치 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_SIZE_MISMATCH: weights.pt"):
        # 고정 해시와 대조한 자산 정보 실행
        weights.verification("role", tmp_path)

# 관측 자산의 전체 출처 보고 확인
def test_verify_observer_assets_reports_complete_provenance(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 관측 자산의 전체 출처 보고 입력 준비
    payloadWeights = b"weights"
    # 관측 자산의 전체 출처 보고 입력 준비
    card = b"card"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payloadWeights), ("README.md", card))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "weights.pt").write_bytes(payloadWeights)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "README.md").write_bytes(card)

    # 고정 해시와 대조한 자산 정보 읽음
    provenance = weights.verification("role", tmp_path)

    # 원본과 모델 출처의 기대 자료 일치 확인
    assert provenance == {
        # 모델 명세 판본의 1 시험값 지정
        "manifest_version": 1,
        # 모델 구분 키의 역할 모델 시험값 지정
        "model_key": "role",
        # 승인 모델 식별자의 시험값 지정
        "model_id": "martinjolif/yolo-football-player-detection",
        # 고정 모델 판본의 시험값 지정
        "revision": ROLE_REVISION,
        # 모델 배포 허가 정보의 시험값 지정
        "license": "AGPL-3.0",
        # 승인 모델 구조의 시험값 지정
        "architecture": "YOLO11m",
        # 허용 분류명 목록의 공 · 골키퍼 · 선수 · 심판 시험값 지정
        "labels": ["ball", "goalkeeper", "player", "referee"],
        # 자산 파일 명세의 시험값 지정
        "files": {
            "weights.pt": hashlib.sha256(payloadWeights).hexdigest(),
            "README.md": hashlib.sha256(card).hexdigest(),
        },
    }

# 작업 트리 상위 경로의 검증 거부 확인
@pytest.mark.parametrize("marker_kind", ["file", "directory"])
def test_verification_rejects_any_git_worktree_ancestor(monkeypatch, tmp_path, marker_kind):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 모델 저장 폴더 준비
    model_dir = repository / "nested" / "cache"
    # 모델 저장 폴더 생성
    model_dir.mkdir(parents=True)
    # 시험 식별 값 준비
    marker = repository / ".git"
    # 작업 트리 상위 경로의 검증 거부 입력의 비교 결과별 분기
    if marker_kind == "file":
        # 시험 식별 값에 시험 문자열 기록
        marker.write_text("gitdir: elsewhere\n", encoding="utf-8")
    else:
        # 시험 식별 값 생성
        marker.mkdir()
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: _test_model())

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        # 고정 해시와 대조한 자산 정보 실행
        weights.verification("role", model_dir)

# 저장소를 가리키는 외부 심볼릭 링크 검증 거부 확인
def test_verification_rejects_an_outside_symlink_targeting_a_repository(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 파일 경로 생성
    (repository / ".git").mkdir()
    # 심볼릭 링크 경로 준비
    alias = tmp_path / "outside-alias"
    # 심볼릭 링크 경로의 링크 경로 생성
    alias.symlink_to(repository, target_is_directory=True)
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: _test_model())

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        # 고정 해시와 대조한 자산 정보 실행
        weights.verification("role", alias / "cache")

# 외부로 나가는 저장소 심볼릭 링크 검증 거부 확인
def test_verification_rejects_a_repository_symlink_that_escapes_outside(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 파일 경로 생성
    (repository / ".git").mkdir()
    # 외부 경로 준비
    external = tmp_path / "external-cache"
    # 외부 경로 생성
    external.mkdir()
    # 심볼릭 링크 경로 준비
    alias = repository / "escaping-alias"
    # 심볼릭 링크 경로의 링크 경로 생성
    alias.symlink_to(external, target_is_directory=True)
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: _test_model())

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        # 고정 해시와 대조한 자산 정보 실행
        weights.verification("role", alias)

# 저장소를 가리키는 파일 심볼릭 링크 검증 거부 확인
def test_verification_rejects_a_file_symlink_targeting_a_repository(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 파일 경로 생성
    (repository / ".git").mkdir()
    # 대상 경로 준비
    target = repository / "weights.pt"
    # 대상 경로에 시험 바이트 기록
    target.write_bytes(b"weights")
    # 모델 저장 폴더 준비
    model_dir = tmp_path / "external-cache"
    # 모델 저장 폴더 생성
    model_dir.mkdir()
    # 시험 파일 경로의 링크 경로 생성
    (model_dir / "weights.pt").symlink_to(target)
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        'manifestModel',
        lambda _key: _test_model(("weights.pt", b"weights")),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        # 고정 해시와 대조한 자산 정보 실행
        weights.verification("role", model_dir)

# 네트워크 없이 검증된 기존 파일 재사용 확인
def test_download_reuses_verified_existing_files_without_network(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"already verified"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 파일 경로 준비
    path = tmp_path / "weights.pt"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(payload)

    # 금지된 네트워크 호출 검출
    def network_must_not_run(*_args, **_kwargs):
        # 금지된 네트워크 호출 검출의 예외 상황 재현
        raise AssertionError("verified cache files must not use the network")

    # 네트워크 없이 검증된 기존 파일 재사용 의존성의 시험 대역 주입
    monkeypatch.setattr(weights, "_urlopen", network_must_not_run)

    # 승인 자산 다운로드 결과 생성
    provenance = weights.download("role", tmp_path)

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert path.read_bytes() == payload
    # 자산 파일 명세의 기대 자료 일치 확인
    assert provenance["files"] == {
        "weights.pt": hashlib.sha256(payload).hexdigest()
    }

# 부모 다운로드의 제한된 자식과 임시 파일 사용 확인
def test_parent_download_uses_bounded_child_for_the_temporary_file(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"downloaded in bounded child"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 호출 이력의 빈 누적 공간 생성
    calls = []

    # 모의 제한 자식 실행
    def fake_bounded_child(model_key, filename, descriptor, timeout_seconds):
        # 호출 이력에 현재 관측 추가
        calls.append((model_key, filename, timeout_seconds))
        # 모의 제한 자식 대상 동작 실행
        weights.os.write(descriptor, payload)
        # 모의 제한 자식 대상 동작 실행
        weights.os.fsync(descriptor)

    # 부모 다운로드의 제한된 자식과 임시 파일 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        'boundedDownload',
        fake_bounded_child,
        raising=False,
    )
    # 부모 다운로드의 제한된 자식과 임시 파일 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("parent process must not perform network I/O")
        ),
        raising=False,
    )

    # 승인 자산 다운로드 결과 생성
    provenance = weights.download("role", tmp_path)

    # 호출 이력의 개수 값이 1인지 확인
    assert len(calls) == 1
    # 호출 이력의 첫 항목의 선택 항목의 기대 자료 일치 확인
    assert calls[0][:2] == ("role", "weights.pt")
    # 하위 다운로드 제한 시간이 양수이며 전체 허용 시간 이내인지 확인
    assert 0 < calls[0][2] <= weights.MAX_DOWNLOAD_SECONDS
    # 저장한 가중치의 출처 해시가 원본 바이트 해시와 같은지 확인
    assert provenance["files"]["weights.pt"] == hashlib.sha256(
        payload
    ).hexdigest()

# 종료된 자식의 부분 바이트 정리와 공개 방지 확인
def test_killed_child_bytes_are_cleaned_and_never_published(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"complete bytes received after deadline"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)

    # 자식 시간 초과 모사
    def timed_out_child(_key, _filename, descriptor, _timeout_seconds):
        # 자식 시간 초과 모사 대상 동작 실행
        weights.os.write(descriptor, payload)
        # 자식 시간 초과 모사 대상 동작 실행
        weights.os.fsync(descriptor)
        # 자식 시간 초과 모사의 예외 상황 재현
        raise TimeoutError("OBSERVER_MODEL_DOWNLOAD_TIMEOUT: weights.pt")

    # 종료된 자식의 부분 바이트 정리와 공개 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        'boundedDownload',
        timed_out_child,
        raising=False,
    )
    # 종료된 자식의 부분 바이트 정리와 공개 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(payload, content_length=len(payload)),
        raising=False,
    )

    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "weights.pt").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 잘못된 기존 파일의 교체 없는 거부 확인
def test_download_rejects_invalid_existing_file_without_replacing_it(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", b"approved bytes"))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 파일 경로 준비
    path = tmp_path / "weights.pt"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(b"existing user bytes")
    # 네트워크 호출 이력의 빈 누적 공간 생성
    network_calls = []
    # 잘못된 기존 파일의 교체 없는 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert path.read_bytes() == b"existing user bytes"
    # 네트워크 호출 이력 값이 빈 목록인지 확인
    assert network_calls == []

# 디렉터리 생성·통신 전 저장소 상위 경로 거부 확인
@pytest.mark.parametrize("marker_kind", ["file", "directory"])
def test_download_rejects_git_ancestor_before_directory_creation_or_network(
    monkeypatch, tmp_path, marker_kind
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 식별 값 준비
    marker = repository / ".git"
    # 디렉터리 생성·통신 전 저장소 상위 경로 거부 입력의 비교 결과별 분기
    if marker_kind == "file":
        # 시험 식별 값에 시험 문자열 기록
        marker.write_text("gitdir: elsewhere\n", encoding="utf-8")
    else:
        # 시험 식별 값 생성
        marker.mkdir()
    # 모델 저장 폴더 준비
    model_dir = repository / "not-created" / "model-cache"
    # 네트워크 호출 이력의 빈 누적 공간 생성
    network_calls = []
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        'manifestModel',
        lambda _key: _test_model(("weights.pt", b"approved")),
    )
    # 디렉터리 생성·통신 전 저장소 상위 경로 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", model_dir)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not model_dir.exists()
    # 네트워크 호출 이력 값이 빈 목록인지 확인
    assert network_calls == []

# 쓰기·통신 전 저장소 내부 심볼릭 링크 거부 확인
def test_download_rejects_symlink_into_repository_before_writes_or_network(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 파일 경로 생성
    (repository / ".git").mkdir()
    # 심볼릭 링크 경로 준비
    alias = tmp_path / "outside-alias"
    # 심볼릭 링크 경로의 링크 경로 생성
    alias.symlink_to(repository, target_is_directory=True)
    # 모델 저장 폴더 준비
    model_dir = alias / "not-created"
    # 네트워크 호출 이력의 빈 누적 공간 생성
    network_calls = []
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        'manifestModel',
        lambda _key: _test_model(("weights.pt", b"approved")),
    )
    # 쓰기·통신 전 저장소 내부 심볼릭 링크 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", model_dir)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not model_dir.resolve().exists()
    # 네트워크 호출 이력 값이 빈 목록인지 확인
    assert network_calls == []

# 고정 보안 주소·검증된 연결·제한 시간 사용 확인
def test_download_uses_fixed_https_url_verified_tls_and_bounded_timeout(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"downloaded bytes"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 자산 명세 항목 준비
    entry = model["files"][0]
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 관측 결과의 빈 누적 공간 생성
    observed = {}

    # 모의 주소 응답 반환
    def fake_urlopen(request, *, timeout, context):
        # 관측 결과에 현재 입력 반영
        observed.update(url=request.full_url, timeout=timeout, context=context)
        # 다운로드 본문과 헤더를 가진 모의 응답 반환
        return FakeResponse(payload, content_length=len(payload))

    # 고정 보안 주소·검증된 연결·제한 시간 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(weights, "_urlopen", fake_urlopen)

    # 승인 자산 다운로드 결과 실행
    weights.download("role", tmp_path)

    # 다운로드 주소의 기대 자료 일치 확인
    assert observed["url"] == entry["url"]
    # 문자열 앞부분 일치 여부의 조건 충족 확인
    assert observed["url"].startswith("https://huggingface.co/")
    # 다운로드 제한 시간이 양수이며 60초 이하인지 확인
    assert 0 < observed["timeout"] <= 60
    # 보안 연결에서 서버 인증서 검증이 필수인지 확인
    assert observed["context"].verify_mode == ssl.CERT_REQUIRED
    # 보안 연결의 서버 호스트명 검증 활성화 확인
    assert observed["context"].check_hostname is True
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (tmp_path / "weights.pt").read_bytes() == payload
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 잘못된 내용 길이 거부와 임시 파일 정리 확인
@pytest.mark.parametrize("declared_size", ["not-an-integer", 18, -1])
def test_download_rejects_invalid_content_length_and_cleans_temporary_file(
    monkeypatch, tmp_path, declared_size
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"short"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 잘못된 내용 길이 거부와 임시 파일 정리 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(payload, content_length=declared_size),
    )

    # 파일 크기 불일치 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_SIZE_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "weights.pt").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 스트림 크기 불일치 거부와 공개 방지 확인
@pytest.mark.parametrize("received", [b"shor", b"short-plus-extra"])
def test_download_rejects_stream_size_mismatch_and_never_publishes(monkeypatch, tmp_path, received):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 기대 자료 준비
    expected = b"short"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", expected))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 스트림 크기 불일치 거부와 공개 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(received),
    )

    # 파일 크기 불일치 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_SIZE_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "weights.pt").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 동일 크기 해시 불일치 거부와 공개 방지 확인
def test_download_rejects_same_size_hash_mismatch_and_never_publishes(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 기대 자료 준비
    expected = b"expected"
    # 실제로 수신한 바이트 수 준비
    received = b"tampered"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", expected))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 동일 크기 해시 불일치 거부와 공개 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(received, content_length=len(received)),
    )

    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "weights.pt").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 다운로드 시간 초과의 부분 바이트 정리와 고정 오류 확인
def test_download_timeout_cleans_partial_bytes_and_has_stable_error(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"expected"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)

    # 실제 외부 실행을 대신할 시험 객체 정의
    class TimedOutResponse(FakeResponse):

        # 자료 읽음
        def read(self, _amount):
            # 자료의 예외 상황 재현
            raise TimeoutError("network stalled")

    # 다운로드 시간 초과의 부분 바이트 정리와 고정 오류 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: TimedOutResponse(payload, content_length=len(payload)),
    )

    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "weights.pt").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 다운로드 중단의 부분 바이트 정리와 공개 방지 확인
def test_download_interruption_cleans_partial_bytes_and_does_not_publish(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"expected"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)

    # 실제 외부 실행을 대신할 시험 객체 정의
    class InterruptedResponse(FakeResponse):

        # 자료 읽음
        def read(self, _amount):
            # 자료의 예외 상황 재현
            raise KeyboardInterrupt

    # 다운로드 중단의 부분 바이트 정리와 공개 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: InterruptedResponse(payload, content_length=len(payload)),
    )

    # 지정한 예외 발생 기대
    with pytest.raises(KeyboardInterrupt):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "weights.pt").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 공개 전 늦은 파일 끝 도달 거부 확인
def test_download_rejects_late_eof_before_publishing(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"expected"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 공개 전 늦은 파일 끝 도달 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(weights, "MAX_DOWNLOAD_SECONDS", 10)
    # 제어 가능한 시험 시계의 시험 항목 구성
    clock = {"now": 0.0}
    # 단조 증가하는 시험 시각의 시험 대역 주입
    monkeypatch.setattr(weights.time, "monotonic", lambda: clock["now"])

    # 실제 외부 실행을 대신할 시험 객체 정의
    class LateEOFResponse(FakeResponse):

        # 자료 읽음
        def read(self, amount):
            # 요청한 분량의 바이트 자료 읽음
            chunk = super().read(amount)
            # 읽은 바이트 조각의 조건에 따른 분기
            if not chunk:
                # 현재 시각의 11점0 설정
                clock["now"] = 11.0
            # 읽은 바이트 조각 반환
            return chunk

    # 공개 전 늦은 파일 끝 도달 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: LateEOFResponse(payload, content_length=len(payload)),
    )

    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT"):
        # 승인 자산 다운로드 결과 실행
        weights.download("role", tmp_path)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "weights.pt").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 청크 충전 대기 없는 가용 바이트 읽기 확인
def test_download_reads_available_bytes_without_waiting_to_fill_chunk(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 전송 본문 준비
    payload = b"expected"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", payload))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)

    # 실제 외부 실행을 대신할 시험 객체 정의
    class ReadOneResponse(FakeResponse):

        # 자료 읽음
        def read(self, _amount):
            # 자료의 예외 상황 재현
            raise AssertionError("buffer-filling read must not be used")

        # 가용 자료 읽음
        def read1(self, amount):
            # 요청한 분량의 바이트 자료 반환
            return self._stream.read(amount)

    # 청크 충전 대기 없는 가용 바이트 읽기 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: ReadOneResponse(payload, content_length=len(payload)),
    )

    # 승인 자산 다운로드 결과 생성
    provenance = weights.download("role", tmp_path)

    # 저장한 가중치의 출처 해시가 원본 바이트 해시와 같은지 확인
    assert provenance["files"]["weights.pt"] == hashlib.sha256(
        payload
    ).hexdigest()

# 동시 캐시 기록을 덮어쓰지 않는 배타적 공개 확인
@pytest.mark.parametrize("competing", [b"downloaded", b"other writer"])
def test_exclusive_publish_never_clobbers_a_concurrent_cache_writer(
    monkeypatch, tmp_path, competing
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import weights

    # 다운로드한 바이트 자료 준비
    downloaded = b"downloaded"
    # 고정 시험 모델 생성
    model = _test_model(("weights.pt", downloaded))
    # 승인 모델에 고정된 자산 명세의 시험 대역 주입
    monkeypatch.setattr(weights, 'manifestModel', lambda _key: model)
    # 동시 캐시 기록을 덮어쓰지 않는 배타적 공개 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(downloaded, content_length=len(downloaded)),
    )

    # 동시 파일 공개 모사
    def racing_link(_source, destination):
        # 시험 파일 경로에 시험 바이트 기록
        Path(destination).write_bytes(competing)
        # 동시 파일 공개 모사의 예외 상황 재현
        raise FileExistsError(destination)

    # 후보 연결 기록의 시험 대역 주입
    monkeypatch.setattr(weights.os, "link", racing_link)

    # 경쟁하는 근접 관측의 비교 결과별 분기
    if competing == downloaded:
        # 승인 자산 다운로드 결과 생성
        provenance = weights.download("role", tmp_path)
        # 검증한 가중치의 출처 해시가 다운로드한 바이트와 일치하는지 확인
        assert provenance["files"]["weights.pt"] == hashlib.sha256(
            downloaded
        ).hexdigest()
    else:
        # 파일 해시 불일치 발생 기대
        with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH"):
            # 승인 자산 다운로드 결과 실행
            weights.download("role", tmp_path)

    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (tmp_path / "weights.pt").read_bytes() == competing
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 선택한 모델만 준비하는 가져오기 명령 확인
@pytest.mark.parametrize("model_key", ["role", "pose"])
def test_fetch_cli_prepares_only_the_selected_model(monkeypatch, tmp_path, capsys, model_key):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import observercache

    # 호출 이력의 빈 누적 공간 생성
    calls = []
    # 작업 폴더의 시험 대역 주입
    monkeypatch.setattr(
        observercache,
        'directory',
        lambda key: tmp_path / key,
    )

    # 모의 다운로드 실행
    def fake_download(key, directory):
        # 호출 이력에 현재 관측 추가
        calls.append((key, directory))
        # 모의 다운로드 결과 반환
        return {"model_key": key, "revision": f"{key}-revision"}

    # 승인 자산 다운로드 결과의 시험 대역 주입
    monkeypatch.setattr(observercache, 'download', fake_download)

    # 명령줄 진입점 실행 결과 값이 0인지 확인
    assert observercache.main([model_key]) == 0
    # 호출 이력의 기대 자료 일치 확인
    assert calls == [(model_key, tmp_path / model_key)]
    # 명령줄 출력에 선택한 모델의 구분 키와 판본이 직렬화됐는지 확인
    assert json.loads(capsys.readouterr().out) == {
        model_key: {
            # 모델 구분 키의 시험값 지정
            "model_key": model_key,
            # 고정 모델 판본의 시험값 지정
            "revision": f"{model_key}-revision",
        }
    }

# 승인된 두 모델을 기본 준비하는 가져오기 명령 확인
def test_fetch_cli_defaults_to_preparing_both_approved_models(monkeypatch, tmp_path, capsys):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import observercache

    # 호출 이력의 빈 누적 공간 생성
    calls = []
    # 작업 폴더의 시험 대역 주입
    monkeypatch.setattr(
        observercache,
        'directory',
        lambda key: tmp_path / key,
    )

    # 모의 다운로드 실행
    def fake_download(key, directory):
        # 호출 이력에 현재 관측 추가
        calls.append((key, directory))
        # 모의 다운로드 결과 반환
        return {"model_key": key}

    # 승인 자산 다운로드 결과의 시험 대역 주입
    monkeypatch.setattr(observercache, 'download', fake_download)

    # 명령줄 진입점 실행 결과 값이 0인지 확인
    assert observercache.main([]) == 0
    # 호출 이력의 기대 자료 일치 확인
    assert calls == [
        ("role", tmp_path / "role"),
        ("pose", tmp_path / "pose"),
    ]
    # 명령줄 출력에 역할 모델과 자세 모델의 검증 결과가 포함됐는지 확인
    assert json.loads(capsys.readouterr().out) == {
        # 역할 가설의 시험값 지정
        "role": {"model_key": "role"},
        # 자세 관측의 시험값 지정
        "pose": {"model_key": "pose"},
    }

# 미승인 모델 선택의 가져오기 명령 거부 확인
def test_fetch_cli_rejects_unapproved_model_selector():
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import observercache

    # 지정한 예외 발생 기대
    with pytest.raises(SystemExit) as failure:
        # 명령줄 진입점 실행 결과 실행
        observercache.main(["rtdetr"])

    # 미승인 모델 선택의 명령줄 종료 코드가 2인지 확인
    assert failure.value.code == 2
