# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 메모리 바이트 입출력 도구 읽음
import io
# 파일 핸들을 다룰 운영체제 도구 읽음
import os
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 다운로드 요청 도구 읽음
from urllib.request import Request
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception import assets, catalog, transport, weights


# 고정 모델 판본 준비
REVISION = "ac77a11ff0170a41b771c03264987f8ce2b0d753"

# 자산 항목 생성
def _entry(name: str, payload: bytes, *, required: bool = True) -> dict[str, object]:
    # 자산 항목 결과 반환
    return {
        # 항목 이름의 시험값 지정
        "name": name,
        # 파일 무결성 해시의 시험값 지정
        "sha256": hashlib.sha256(payload).hexdigest(),
        # 파일 크기의 시험값 지정
        "size": len(payload),
        # 필수 자산 파일의 시험값 지정
        "required": required,
        # 다운로드 주소의 시험값 지정
        "url": ("https://huggingface.co/PekingU/rtdetr_r18vd/resolve/" f"{REVISION}/{name}"),
    }

# 자산 명세 생성
def _manifest(*entries: dict[str, object]) -> dict[str, object]:
    # 자산 명세 결과 반환
    return {
        # 기록 형식 판본의 시험값 지정
        "schema_version": 1,
        # 승인 모델 식별자의 시험값 지정
        "model_id": "PekingU/rtdetr_r18vd",
        # 고정 모델 판본의 시험값 지정
        "revision": REVISION,
        # 모델 배포 허가 정보의 시험값 지정
        "license": "Apache-2.0",
        # 승인 모델 구조의 시험값 지정
        "architecture": "RTDetrForObjectDetection",
        # 별도 연산 커널 비활성화 여부의 참 시험값 지정
        "disable_custom_kernels": True,
        # 최소 허용 점수의 0점3 시험값 지정
        "threshold": 0.30,
        # 허용 분류명 목록의 사람 · 공 시험값 지정
        "labels": ["person", "sports ball"],
        # 영상 전처리 설정의 시험값 지정
        "preprocessing": {
            # 색상 표준화 여부의 시험값 지정
            "do_normalize": False,
            # 색상 값 배율 변환 여부의 시험값 지정
            "do_rescale": True,
            # 색상 값 변환 배율의 시험값 지정
            "rescale_factor": 1 / 255,
            # 파일 크기의 시험값 지정
            "size": {"height": 640, "width": 640},
        },
        # 자산 파일 명세의 시험값 지정
        "files": list(entries),
    }


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeResponse:

    # 초기 상태와 입력 계약 구성
    def __init__(self, payload: bytes, *, content_length: int | None = None):
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

# 제한된 자식을 실제 크기와 해시 검증 코드를 거치는 제어된 전송으로 대체
@pytest.fixture(autouse=True)
def _replace_bounded_child_with_controlled_transport(monkeypatch):
    # 제한된 자식을 제어된 전송으로 대체 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, "_urlopen", None, raising=False)

    # 제어된 전송 실행
    def controlled_transfer(model_key, filename, descriptor, timeout_seconds):
        # 검출 모델 키로 전송을 요청했는지 확인
        assert model_key == "detector"
        # 검출 모델에 고정된 자산 명세 읽음
        manifest = assets.detectorManifest()
        # 조건에 맞는 다음 항목 생성
        entry = next(item for item in manifest["files"] if item["name"] == filename)
        # 제어된 전송 입력의 비교 결과별 분기
        if assets._urlopen is None:
            # 제어된 전송의 예외 상황 재현
            raise AssertionError("test must provide controlled transport")
        # 자산 다운로드 요청 준비
        request = Request(
            entry["url"],
            # 전송 응답 헤더의 호출 조건 지정
            headers={"User-Agent": "Replay-Lab-Perception/0.1"},
            # 관측 방법의 호출 조건 지정
            method="GET",
        )
        # 제어된 전송 처리 자원의 사용 구간 시작
        with assets._urlopen(
            request,
            # 제한 시간의 호출 조건 지정
            timeout=min(transport.READ_TIMEOUT_SECONDS, timeout_seconds),
        ) as response:
            # 부모가 닫는 핸들과 분리한 복제 핸들로 출력 스트림 연결
            with os.fdopen(os.dup(descriptor), "wb") as output:
                # 실제 크기와 해시 검증 코드로 응답을 출력에 기록
                transport.responseStream(response, entry, output, model_key)

    # 제한된 자식을 제어된 전송으로 대체 의존성의 시험 대역 주입
    monkeypatch.setattr(
        weights,
        'boundedDownload',
        controlled_transfer,
    )

# 승인된 모델 자산만 고정한 명세 확인
def test_packaged_manifest_pins_only_the_approved_model_assets():
    # 고정 모델 명세 준비
    manifest = catalog.detectorManifest()
    # 승인 모델 식별자의 기대 자료 일치 확인
    assert manifest["model_id"] == "PekingU/rtdetr_r18vd"
    # 고정 모델 판본의 기대 자료 일치 확인
    assert manifest["revision"] == REVISION
    # 승인 모델 구조의 기대 자료 일치 확인
    assert manifest["architecture"] == "RTDetrForObjectDetection"
    # 별도 연산 커널 비활성화 여부 값이 참인지 확인
    assert manifest["disable_custom_kernels"] is True
    # 최소 허용 점수의 기대 자료 일치 확인
    assert manifest["threshold"] == pytest.approx(0.30)
    # 허용 분류명 목록 값이 사람 · 공인지 확인
    assert manifest["labels"] == ["person", "sports ball"]
    # 영상 전처리 설정의 기대 자료 일치 확인
    assert manifest["preprocessing"] == {
        # 색상 표준화 여부의 기대값 지정
        "do_normalize": False,
        # 색상 값 배율 변환 여부의 기대값 지정
        "do_rescale": True,
        # 색상 값 변환 배율의 기대값 지정
        "rescale_factor": pytest.approx(1 / 255),
        # 파일 크기의 시험값 지정
        "size": {"height": 640, "width": 640},
    }

    # 자산 파일 명세의 조건별 항목 수집
    files = {entry["name"]: entry for entry in manifest["files"]}
    # 자산 파일 명세의 기대 자료 일치 확인
    assert files == {
        "config.json": {
            # 항목 이름의 시험값 지정
            "name": "config.json",
            # 파일 무결성 해시의 시험값 지정
            "sha256": "8493be71f51a1c0a741f8f71ec151039227579379de7bcba047c0470d9320c3c",
            # 파일 크기의 5267 시험값 지정
            "size": 5267,
            # 필수 자산 파일의 기대값 지정
            "required": True,
            # 다운로드 주소의 시험값 지정
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/config.json",
        },
        "preprocessor_config.json": {
            # 항목 이름의 시험값 지정
            "name": "preprocessor_config.json",
            # 파일 무결성 해시의 시험값 지정
            "sha256": "ffb4b9461a1dad746be8f0f9c8330ed7743a1ba5fba4f75c232cd281b3d4c64a",
            # 파일 크기의 841 시험값 지정
            "size": 841,
            # 필수 자산 파일의 기대값 지정
            "required": True,
            # 다운로드 주소의 시험값 지정
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/preprocessor_config.json",
        },
        "model.safetensors": {
            # 항목 이름의 시험값 지정
            "name": "model.safetensors",
            # 파일 무결성 해시의 시험값 지정
            "sha256": "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093",
            # 파일 크기의 80904152 시험값 지정
            "size": 80904152,
            # 필수 자산 파일의 기대값 지정
            "required": True,
            # 다운로드 주소의 시험값 지정
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/model.safetensors",
        },
        "README.md": {
            # 항목 이름의 시험값 지정
            "name": "README.md",
            # 파일 무결성 해시의 시험값 지정
            "sha256": "0d6d6065595011f4897e724f11d2b86494764eba68e3514cc6c70f0a851e539e",
            # 파일 크기의 9102 시험값 지정
            "size": 9102,
            # 필수 자산 파일의 기대값 지정
            "required": False,
            # 다운로드 주소의 시험값 지정
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/README.md",
        },
    }

# 저장소 외부의 기본 모델 경로 확인
def test_default_model_dir_is_outside_the_repository(monkeypatch, tmp_path):
    # 저장소 외부의 기본 모델 경로 의존성의 시험 대역 주입
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))
    # 시험 모델 파일 폴더의 기대 자료 일치 확인
    assert assets.directory() == (
        tmp_path / ".cache" / "replay-lab" / "models" / "rtdetr_r18vd" / REVISION
    )

# 모델 파일 누락의 고정 실패 코드 확인
def test_missing_model_file_has_a_stable_failure_code(tmp_path):
    # 모델 계약 오류 발생 기대
    with pytest.raises(FileNotFoundError, match="^MODEL_FILE_MISSING: model.safetensors$"):
        # 검출 모델 키로 자산 항목 무결성 검증 실행
        weights.entryValidation(
            tmp_path / "model.safetensors",
            _entry("model.safetensors", b"weights"),
            "detector",
        )

# 변조된 모델 거부 확인
def test_tampered_model_is_rejected(tmp_path):
    # 파일 경로 준비
    path = tmp_path / "model.safetensors"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(b"tampered")
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="^MODEL_HASH_MISMATCH: model.safetensors$"):
        # 검출 모델 키로 자산 항목 무결성 검증 실행
        weights.entryValidation(
            path,
            _entry("model.safetensors", b"expected"),
            "detector",
        )

# 크기만 다른 모델 파일 거부 확인
def test_model_file_with_a_different_size_is_rejected(tmp_path):
    # 전송 본문 준비
    payload = b"verified local bytes"
    # 파일 경로 준비
    path = tmp_path / "config.json"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(payload)
    # 해시는 맞지만 기대 크기만 다른 자산 항목 준비
    entry = {**_entry("config.json", payload), "size": len(payload) + 1}
    # 파일 크기 불일치 발생 기대
    with pytest.raises(ValueError, match="^MODEL_SIZE_MISMATCH: config.json$"):
        # 검출 모델 키로 자산 항목 무결성 검증 실행
        weights.entryValidation(path, entry, "detector")

# 유효한 모델 파일 허용 확인
def test_valid_model_file_is_accepted(tmp_path):
    # 전송 본문 준비
    payload = b"verified local bytes"
    # 파일 경로 준비
    path = tmp_path / "config.json"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(payload)
    # 유효한 파일 검증이 예외 없이 끝나고 별도 값을 반환하지 않음 확인
    assert weights.entryValidation(path, _entry("config.json", payload), "detector") is None

# 필수 파일 검증과 출처 기록 확인
def test_verify_model_assets_requires_all_required_files_and_reports_provenance(
    monkeypatch, tmp_path
):
    # 첫 번째 관측 준비
    first = b"config"
    # 두 번째 관측 준비
    second = b"weights"
    # 고정 자산 시험 명세 읽음
    manifest = _manifest(_entry("config.json", first), _entry("model.safetensors", second))
    # 필수 파일 검증과 출처 기록 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: manifest)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "config.json").write_bytes(first)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "model.safetensors").write_bytes(second)

    # 승인 모델 자산의 검증 결과 생성
    metadata = assets.assetVerification(tmp_path)
    # 모델 명세 판본 값이 1인지 확인
    assert metadata["manifest_version"] == 1
    # 승인 모델 식별자의 기대 자료 일치 확인
    assert metadata["model_id"] == "PekingU/rtdetr_r18vd"
    # 고정 모델 판본의 기대 자료 일치 확인
    assert metadata["revision"] == REVISION
    # 자산 파일 명세의 기대 자료 일치 확인
    assert metadata["files"] == {
        "config.json": hashlib.sha256(first).hexdigest(),
        "model.safetensors": hashlib.sha256(second).hexdigest(),
    }
    # 최소 허용 점수의 기대 자료 일치 확인
    assert metadata["threshold"] == pytest.approx(0.30)
    # 파일 크기의 기대 자료 일치 확인
    assert metadata["preprocessing"]["size"] == {"height": 640, "width": 640}

# 선택적 모델 카드 존재 시 검증 확인
def test_optional_model_card_is_verified_when_present(monkeypatch, tmp_path):
    # 필수 자산 파일 준비
    required = b"config"
    # 선택 자산 파일 준비
    optional = b"tampered card"
    # 고정 자산 시험 명세 읽음
    manifest = _manifest(
        _entry("config.json", required),
        _entry("README.md", b"expected card", required=False),
    )
    # 선택적 모델 카드 존재 시 검증 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: manifest)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "config.json").write_bytes(required)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "README.md").write_bytes(optional)

    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="^MODEL_HASH_MISMATCH"):
        # 승인 모델 자산의 검증 결과 실행
        assets.assetVerification(tmp_path)

# 대상 없는 선택 모델 카드 링크의 누락 거부 확인
def test_optional_model_card_dangling_link_is_rejected(monkeypatch, tmp_path):
    # 필수 자산 파일 준비
    required = b"config"
    # 고정 자산 시험 명세 읽음
    manifest = _manifest(
        _entry("config.json", required),
        _entry("README.md", b"expected card", required=False),
    )
    # 대상 없는 선택 모델 카드 링크의 누락 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: manifest)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "config.json").write_bytes(required)
    # 대상이 없는 심볼릭 링크 생성
    (tmp_path / "README.md").symlink_to(tmp_path / "missing-card")

    # 파일 누락 발생 기대
    with pytest.raises(FileNotFoundError, match="^MODEL_FILE_MISSING: README.md$"):
        # 승인 모델 자산의 검증 결과 실행
        assets.assetVerification(tmp_path)

# 네트워크 없이 검증된 기존 파일 재사용 확인
def test_download_reuses_a_verified_existing_file_without_network(monkeypatch, tmp_path):
    # 전송 본문 준비
    payload = b"already downloaded"
    # 고정 자산 시험 명세 읽음
    manifest = _manifest(_entry("config.json", payload))
    # 네트워크 없이 검증된 기존 파일 재사용 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: manifest)
    # 파일 경로 준비
    path = tmp_path / "config.json"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(payload)

    # 금지된 네트워크 호출 검출
    def network_must_not_run(*_args, **_kwargs):
        # 금지된 네트워크 호출 검출의 예외 상황 재현
        raise AssertionError("verified cached assets must not use the network")

    # 네트워크 없이 검증된 기존 파일 재사용 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, "_urlopen", network_must_not_run)
    # 승인 자산 다운로드 결과 생성
    metadata = assets.download(tmp_path)
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert path.read_bytes() == payload
    # 설정 파일의 출처 해시가 실제 파일 바이트 해시와 같은지 확인
    assert metadata["files"]["config.json"] == hashlib.sha256(payload).hexdigest()

# 잘못된 기존 파일의 교체 없는 거부 확인
def test_download_rejects_an_invalid_existing_file_without_replacing_it(monkeypatch, tmp_path):
    # 기대 자료 준비
    expected = b"expected"
    # 파일 경로 준비
    path = tmp_path / "config.json"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(b"user cache content")
    # 잘못된 기존 파일의 교체 없는 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        'detectorManifest',
        lambda: _manifest(_entry("config.json", expected)),
    )

    # 금지된 네트워크 호출 검출
    def network_must_not_run(*_args, **_kwargs):
        # 금지된 네트워크 호출 검출의 예외 상황 재현
        raise AssertionError("invalid cached assets must not be replaced")

    # 잘못된 기존 파일의 교체 없는 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, "_urlopen", network_must_not_run)
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="^MODEL_HASH_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert path.read_bytes() == b"user cache content"

# 디렉터리 생성과 통신 전 저장소 상위 경로 거부 확인
@pytest.mark.parametrize("git_marker_kind", ["directory", "file", "dangling_symlink"])
def test_download_rejects_repository_ancestor_before_mkdir_or_network(
    monkeypatch, tmp_path, git_marker_kind
):
    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 식별 값 준비
    marker = repository / ".git"
    # 디렉터리 생성과 통신 전 저장소 상위 경로 거부 입력의 비교 결과별 분기
    if git_marker_kind == "directory":
        # 시험 식별 값 생성
        marker.mkdir()
    # 표식 종류가 파일인지 확인
    elif git_marker_kind == "file":
        # 시험 식별 값에 시험 문자열 기록
        marker.write_text("gitdir: ../metadata/worktrees/test\n", encoding="utf-8")
    # 앞선 분기에 해당하지 않는 경우 처리
    else:
        # 대상이 없는 심볼릭 링크 표식 생성
        marker.symlink_to(repository / "missing-git-target")
    # 대상 경로 준비
    target = repository / "nested" / "model-cache"
    # 네트워크 호출 이력의 빈 누적 공간 생성
    network_calls = []
    # 디렉터리 생성과 통신 전 저장소 상위 경로 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        'detectorManifest',
        lambda: _manifest(_entry("config.json", b"expected")),
    )
    # 디렉터리 생성과 통신 전 저장소 상위 경로 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="^MODEL_PATH_IN_REPOSITORY"):
        # 승인 자산 다운로드 결과 실행
        assets.download(target)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not target.exists()
    # 네트워크 호출 이력 값이 빈 목록인지 확인
    assert network_calls == []

# 저장소 내부를 가리키는 심볼릭 링크 다운로드 거부 확인
def test_download_rejects_symlink_that_resolves_inside_a_repository(monkeypatch, tmp_path):
    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 파일 경로 생성
    (repository / ".git").mkdir()
    # 심볼릭 링크 경로 준비
    alias = tmp_path / "outside-looking-alias"
    # 심볼릭 링크 경로의 링크 경로 생성
    alias.symlink_to(repository, target_is_directory=True)
    # 대상 경로 준비
    target = alias / "nested" / "model-cache"
    # 네트워크 호출 이력의 빈 누적 공간 생성
    network_calls = []
    # 저장소 내부를 가리키는 심볼릭 링크 다운로드 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        'detectorManifest',
        lambda: _manifest(_entry("config.json", b"expected")),
    )
    # 저장소 내부를 가리키는 심볼릭 링크 다운로드 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="^MODEL_PATH_IN_REPOSITORY"):
        # 승인 자산 다운로드 결과 실행
        assets.download(target)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not target.resolve().exists()
    # 네트워크 호출 이력 값이 빈 목록인지 확인
    assert network_calls == []

# 저장소 내부 자산의 검증 거부 확인
def test_verification_rejects_assets_located_inside_a_repository(monkeypatch, tmp_path):
    # 가중치 저장 폴더 준비
    repository = tmp_path / "repository"
    # 모델 저장 폴더 준비
    model_dir = repository / "model-cache"
    # 모델 저장 폴더 생성
    model_dir.mkdir(parents=True)
    # 시험 파일 경로 생성
    (repository / ".git").mkdir()
    # 전송 본문 준비
    payload = b"verified bytes"
    # 시험 파일 경로에 시험 바이트 기록
    (model_dir / "config.json").write_bytes(payload)
    # 저장소 내부 자산의 검증 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        'detectorManifest',
        lambda: _manifest(_entry("config.json", payload)),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="^MODEL_PATH_IN_REPOSITORY"):
        # 승인 모델 자산의 검증 결과 실행
        assets.assetVerification(model_dir)

# 고정 주소와 제한 시간 사용 확인
def test_download_uses_fixed_url_and_bounded_timeout(monkeypatch, tmp_path):
    # 전송 본문 준비
    payload = b"downloaded"
    # 시험 자산 명세 항목 읽음
    entry = _entry("config.json", payload)
    # 고정 주소와 제한 시간 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: _manifest(entry))
    # 관측 결과의 빈 누적 공간 생성
    observed = {}

    # 모의 주소 응답 반환
    def fake_urlopen(request, *, timeout):
        # 관측 결과에 현재 입력 반영
        observed.update(url=request.full_url, timeout=timeout)
        # 다운로드 본문과 헤더를 가진 모의 응답 반환
        return FakeResponse(payload, content_length=len(payload))

    # 고정 주소와 제한 시간 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, "_urlopen", fake_urlopen)
    # 승인 자산 다운로드 결과 실행
    assets.download(tmp_path)

    # 다운로드 주소의 기대 자료 일치 확인
    assert observed["url"] == entry["url"]
    # 다운로드 제한 시간이 양수이며 60초 이하인지 확인
    assert 0 < observed["timeout"] <= 60
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (tmp_path / "config.json").read_bytes() == payload
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 선언·전송 크기 초과 거부와 임시 파일 정리 확인
def test_download_rejects_declared_or_streamed_oversize_and_cleans_temp_files(
    monkeypatch, tmp_path
):
    # 기대 자료 준비
    expected = b"small"
    # 시험 자산 명세 항목 읽음
    entry = _entry("config.json", expected)
    # 선언·전송 크기 초과 거부와 임시 파일 정리 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: _manifest(entry))

    # 선언·전송 크기 초과 거부와 임시 파일 정리 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(expected + b"x", content_length=len(expected) + 1),
    )
    # 파일 크기 불일치 발생 기대
    with pytest.raises(ValueError, match="^MODEL_SIZE_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "config.json").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

    # 선언·전송 크기 초과 거부와 임시 파일 정리 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(expected + b"x"),
    )
    # 파일 크기 불일치 발생 기대
    with pytest.raises(ValueError, match="^MODEL_SIZE_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "config.json").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 다운로드 시간 초과 시 부분·공개 파일 부재 확인
def test_download_timeout_leaves_no_partial_or_published_file(monkeypatch, tmp_path):
    # 기대 자료 준비
    expected = b"payload"
    # 다운로드 시간 초과 시 부분·공개 파일 부재 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        'detectorManifest',
        lambda: _manifest(_entry("config.json", expected)),
    )

    # 실제 외부 실행을 대신할 시험 객체 정의
    class TimedOutResponse(FakeResponse):

        # 자료 읽음
        def read(self, _amount):
            # 자료의 예외 상황 재현
            raise TimeoutError("network stalled")

    # 다운로드 시간 초과 시 부분·공개 파일 부재 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: TimedOutResponse(expected, content_length=len(expected)),
    )
    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError, match="^MODEL_DOWNLOAD_TIMEOUT"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "config.json").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 동시 캐시 기록을 덮어쓰지 않는 원자적 공개 확인
def test_atomic_publication_never_clobbers_a_racing_cache_writer(monkeypatch, tmp_path):
    # 다운로드한 바이트 자료 준비
    downloaded = b"downloaded"
    # 경쟁하는 근접 관측 준비
    competing = b"other writer"
    # 동시 캐시 기록을 덮어쓰지 않는 원자적 공개 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets, 'detectorManifest', lambda: _manifest(_entry("config.json", downloaded))
    )
    # 동시 캐시 기록을 덮어쓰지 않는 원자적 공개 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
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
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="^MODEL_HASH_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (tmp_path / "config.json").read_bytes() == competing
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 제한된 전송 위임과 양의 제한 시간 전달 확인
def test_download_delegates_to_the_bounded_transfer_with_a_positive_deadline(monkeypatch, tmp_path):
    # 전송 본문 준비
    payload = b"delegated"
    # 시험 자산 명세 항목 읽음
    entry = _entry("config.json", payload)
    # 제한된 전송 위임과 양의 제한 시간 전달 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: _manifest(entry))
    # 제한된 전송 호출 이력의 빈 누적 공간 생성
    calls = []

    # 제한된 전송 호출 기록
    def recorder(model_key, filename, descriptor, timeout_seconds):
        # 호출 이력에 모델 키와 파일 이름과 제한 시간 추가
        calls.append((model_key, filename, timeout_seconds))
        # 전달받은 핸들에 전송 본문 기록
        os.write(descriptor, payload)

    # 제한된 전송 위임과 양의 제한 시간 전달 의존성의 시험 대역 주입
    monkeypatch.setattr(weights, 'boundedDownload', recorder)
    # 승인 자산 다운로드 결과 실행
    assets.download(tmp_path)

    # 호출 이력의 모델 키와 파일 이름의 기대 자료 일치 확인
    assert [call[:2] for call in calls] == [("detector", "config.json")]
    # 제한 시간이 양수이며 전체 내려받기 한도 이하인지 확인
    assert 0 < calls[0][2] <= weights.MAX_DOWNLOAD_SECONDS
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (tmp_path / "config.json").read_bytes() == payload

# 선택 모델 카드까지 내려받는지 확인
def test_download_fetches_the_optional_model_card_too(monkeypatch, tmp_path):
    # 필수 자산 본문 준비
    required = b"config"
    # 선택 자산 본문 준비
    optional = b"model card"
    # 필수 자산 항목 읽음
    config = _entry("config.json", required)
    # 선택 자산 항목 읽음
    card = _entry("README.md", optional, required=False)
    # 선택 모델 카드 내려받기 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: _manifest(config, card))
    # 주소별 전송 본문 준비
    bodies = {config["url"]: required, card["url"]: optional}

    # 모의 주소 응답 반환
    def fake_urlopen(request, *, timeout):
        # 요청 주소에 대응하는 전송 본문 읽음
        body = bodies[request.full_url]
        # 다운로드 본문과 헤더를 가진 모의 응답 반환
        return FakeResponse(body, content_length=len(body))

    # 선택 모델 카드 내려받기 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, "_urlopen", fake_urlopen)
    # 승인 자산 다운로드 결과 생성
    metadata = assets.download(tmp_path)

    # 필수 파일 바이트의 기대 자료 일치 확인
    assert (tmp_path / "config.json").read_bytes() == required
    # 선택 모델 카드 바이트의 기대 자료 일치 확인
    assert (tmp_path / "README.md").read_bytes() == optional
    # 검증 결과의 파일 목록에 두 파일의 해시가 모두 있는지 확인
    assert metadata["files"] == {
        "config.json": hashlib.sha256(required).hexdigest(),
        "README.md": hashlib.sha256(optional).hexdigest(),
    }

# 제한된 전송 실패 시 부분·공개 파일 부재 확인
def test_bounded_transfer_failure_leaves_no_partial_or_published_file(monkeypatch, tmp_path):
    # 시험 자산 명세 항목 읽음
    entry = _entry("config.json", b"payload")
    # 제한된 전송 실패 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', lambda: _manifest(entry))

    # 일부 본문만 기록하고 실패하는 제한된 전송
    def failing_transfer(_model_key, _filename, descriptor, _timeout_seconds):
        # 임시 파일에 일부 본문 기록
        os.write(descriptor, b"part")
        # 제한된 전송의 예외 상황 재현
        raise RuntimeError("MODEL_DOWNLOAD_FAILED: config.json")

    # 제한된 전송 실패 의존성의 시험 대역 주입
    monkeypatch.setattr(weights, 'boundedDownload', failing_transfer)
    # 고정 내려받기 실패 발생 기대
    with pytest.raises(RuntimeError, match="^MODEL_DOWNLOAD_FAILED: config.json$"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "config.json").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 잘못된 명세의 폴더 생성 전 거부 확인
def test_download_rejects_an_invalid_manifest_before_creating_directories(monkeypatch, tmp_path):
    # 대상 경로 준비
    target = tmp_path / "nested" / "model-cache"

    # 잘못된 명세 읽기 실패 재현
    def invalid_manifest():
        # 잘못된 명세의 예외 상황 재현
        raise ValueError("MODEL_MANIFEST_INVALID")

    # 잘못된 명세의 폴더 생성 전 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'detectorManifest', invalid_manifest)
    # 모델 명세 오류 발생 기대
    with pytest.raises(ValueError, match="^MODEL_MANIFEST_INVALID$"):
        # 승인 자산 다운로드 결과 실행
        assets.download(target)
    # 대상 경로의 상위 폴더까지 생성되지 않았는지 확인
    assert not (tmp_path / "nested").exists()
