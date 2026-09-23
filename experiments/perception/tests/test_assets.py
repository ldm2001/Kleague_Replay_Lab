# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 메모리 바이트 입출력 도구 읽음
import io
# 보안 다운로드 연결 도구 읽음
import ssl
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest


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

# 승인된 모델 자산만 고정한 명세 확인
def test_packaged_manifest_pins_only_the_approved_model_assets():
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.assets import assetManifest

    # 고정 모델 명세 준비
    manifest = assetManifest()
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
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.assets import directory

    # 저장소 외부의 기본 모델 경로 의존성의 시험 대역 주입
    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))
    # 시험 모델 파일 폴더의 기대 자료 일치 확인
    assert directory() == (
        tmp_path / ".cache" / "replay-lab" / "models" / "rtdetr_r18vd" / REVISION
    )

# 모델 파일 누락의 고정 실패 코드 확인
def test_missing_model_file_has_a_stable_failure_code(tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.assets import verification

    # 모델 계약 오류 발생 기대
    with pytest.raises(FileNotFoundError, match="MODEL_FILE_MISSING"):
        # 고정 해시와 대조한 자산 정보 실행
        verification(tmp_path / "model.safetensors", "0" * 64)

# 변조된 모델 거부 확인
def test_tampered_model_is_rejected(tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.assets import verification

    # 파일 경로 준비
    path = tmp_path / "model.safetensors"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(b"tampered")
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        # 고정 해시와 대조한 자산 정보 실행
        verification(path, "0" * 64)

# 유효한 모델 파일 허용 확인
def test_valid_model_file_is_accepted(tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.assets import verification

    # 전송 본문 준비
    payload = b"verified local bytes"
    # 파일 경로 준비
    path = tmp_path / "config.json"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(payload)
    # 유효한 파일 검증이 예외 없이 끝나고 별도 값을 반환하지 않음 확인
    assert verification(path, hashlib.sha256(payload).hexdigest()) is None

# 필수 파일 검증과 출처 기록 확인
def test_verify_model_assets_requires_all_required_files_and_reports_provenance(
    monkeypatch, tmp_path
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

    # 첫 번째 관측 준비
    first = b"config"
    # 두 번째 관측 준비
    second = b"weights"
    # 고정 자산 시험 명세 읽음
    manifest = _manifest(_entry("config.json", first), _entry("model.safetensors", second))
    # 필수 파일 검증과 출처 기록 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'assetManifest', lambda: manifest)
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
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

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
    monkeypatch.setattr(assets, 'assetManifest', lambda: manifest)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "config.json").write_bytes(required)
    # 시험 파일 경로에 시험 바이트 기록
    (tmp_path / "README.md").write_bytes(optional)

    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        # 승인 모델 자산의 검증 결과 실행
        assets.assetVerification(tmp_path)

# 네트워크 없이 검증된 기존 파일 재사용 확인
def test_download_reuses_a_verified_existing_file_without_network(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

    # 전송 본문 준비
    payload = b"already downloaded"
    # 고정 자산 시험 명세 읽음
    manifest = _manifest(_entry("config.json", payload))
    # 네트워크 없이 검증된 기존 파일 재사용 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'assetManifest', lambda: manifest)
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
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

    # 기대 자료 준비
    expected = b"expected"
    # 파일 경로 준비
    path = tmp_path / "config.json"
    # 파일 경로에 시험 바이트 기록
    path.write_bytes(b"user cache content")
    # 잘못된 기존 파일의 교체 없는 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'assetManifest', lambda: _manifest(_entry("config.json", expected)))

    # 금지된 네트워크 호출 검출
    def network_must_not_run(*_args, **_kwargs):
        # 금지된 네트워크 호출 검출의 예외 상황 재현
        raise AssertionError("invalid cached assets must not be replaced")

    # 잘못된 기존 파일의 교체 없는 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, "_urlopen", network_must_not_run)
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert path.read_bytes() == b"user cache content"

# 디렉터리 생성과 통신 전 저장소 상위 경로 거부 확인
@pytest.mark.parametrize("git_marker_kind", ["directory", "file"])
def test_download_rejects_repository_ancestor_before_mkdir_or_network(
    monkeypatch, tmp_path, git_marker_kind
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

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
    else:
        # 시험 식별 값에 시험 문자열 기록
        marker.write_text("gitdir: ../metadata/worktrees/test\n", encoding="utf-8")
    # 대상 경로 준비
    target = repository / "nested" / "model-cache"
    # 네트워크 호출 이력의 빈 누적 공간 생성
    network_calls = []
    # 디렉터리 생성과 통신 전 저장소 상위 경로 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        'assetManifest',
        lambda: _manifest(_entry("config.json", b"expected")),
    )
    # 디렉터리 생성과 통신 전 저장소 상위 경로 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="MODEL_PATH_IN_REPOSITORY"):
        # 승인 자산 다운로드 결과 실행
        assets.download(target)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not target.exists()
    # 네트워크 호출 이력 값이 빈 목록인지 확인
    assert network_calls == []

# 저장소 내부를 가리키는 심볼릭 링크 다운로드 거부 확인
def test_download_rejects_symlink_that_resolves_inside_a_repository(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

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
        'assetManifest',
        lambda: _manifest(_entry("config.json", b"expected")),
    )
    # 저장소 내부를 가리키는 심볼릭 링크 다운로드 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="MODEL_PATH_IN_REPOSITORY"):
        # 승인 자산 다운로드 결과 실행
        assets.download(target)

    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not target.resolve().exists()
    # 네트워크 호출 이력 값이 빈 목록인지 확인
    assert network_calls == []

# 저장소 내부 자산의 검증 거부 확인
def test_verification_rejects_assets_located_inside_a_repository(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

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
        'assetManifest',
        lambda: _manifest(_entry("config.json", payload)),
    )

    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="MODEL_PATH_IN_REPOSITORY"):
        # 승인 모델 자산의 검증 결과 실행
        assets.assetVerification(model_dir)

# 검증된 보안 연결과 제한 시간 및 고정 주소 사용 확인
def test_download_uses_verified_tls_timeout_and_fixed_url(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

    # 전송 본문 준비
    payload = b"downloaded"
    # 시험 자산 명세 항목 읽음
    entry = _entry("config.json", payload)
    # 검증된 보안 연결과 제한 시간 및 고정 주소 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'assetManifest', lambda: _manifest(entry))
    # 관측 결과의 빈 누적 공간 생성
    observed = {}

    # 모의 주소 응답 반환
    def fake_urlopen(request, *, timeout, context):
        # 관측 결과에 현재 입력 반영
        observed.update(url=request.full_url, timeout=timeout, context=context)
        # 다운로드 본문과 헤더를 가진 모의 응답 반환
        return FakeResponse(payload, content_length=len(payload))

    # 검증된 보안 연결과 제한 시간 및 고정 주소 사용 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, "_urlopen", fake_urlopen)
    # 승인 자산 다운로드 결과 실행
    assets.download(tmp_path)

    # 다운로드 주소의 기대 자료 일치 확인
    assert observed["url"] == entry["url"]
    # 다운로드 제한 시간이 양수이며 60초 이하인지 확인
    assert 0 < observed["timeout"] <= 60
    # 보안 연결에서 서버 인증서 검증이 필수인지 확인
    assert observed["context"].verify_mode == ssl.CERT_REQUIRED
    # 보안 연결의 서버 호스트명 검증 활성화 확인
    assert observed["context"].check_hostname is True
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (tmp_path / "config.json").read_bytes() == payload
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 선언·전송 크기 초과 거부와 임시 파일 정리 확인
def test_download_rejects_declared_or_streamed_oversize_and_cleans_temp_files(
    monkeypatch, tmp_path
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

    # 기대 자료 준비
    expected = b"small"
    # 시험 자산 명세 항목 읽음
    entry = _entry("config.json", expected)
    # 선언·전송 크기 초과 거부와 임시 파일 정리 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'assetManifest', lambda: _manifest(entry))

    # 선언·전송 크기 초과 거부와 임시 파일 정리 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(expected + b"x", content_length=len(expected) + 1),
    )
    # 파일 크기 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_SIZE_MISMATCH"):
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
    with pytest.raises(ValueError, match="MODEL_SIZE_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "config.json").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 다운로드 시간 초과 시 부분·공개 파일 부재 확인
def test_download_timeout_leaves_no_partial_or_published_file(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

    # 기대 자료 준비
    expected = b"payload"
    # 다운로드 시간 초과 시 부분·공개 파일 부재 의존성의 시험 대역 주입
    monkeypatch.setattr(assets, 'assetManifest', lambda: _manifest(_entry("config.json", expected)))

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
    with pytest.raises(TimeoutError, match="MODEL_DOWNLOAD_TIMEOUT"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일 존재 여부의 부재 또는 비활성 확인
    assert not (tmp_path / "config.json").exists()
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))

# 동시 캐시 기록을 덮어쓰지 않는 원자적 공개 확인
def test_atomic_publication_never_clobbers_a_racing_cache_writer(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import assets

    # 다운로드한 바이트 자료 준비
    downloaded = b"downloaded"
    # 경쟁하는 근접 관측 준비
    competing = b"other writer"
    # 동시 캐시 기록을 덮어쓰지 않는 원자적 공개 의존성의 시험 대역 주입
    monkeypatch.setattr(
        assets, 'assetManifest', lambda: _manifest(_entry("config.json", downloaded))
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
    monkeypatch.setattr(assets.os, "link", racing_link)
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        # 승인 자산 다운로드 결과 실행
        assets.download(tmp_path)
    # 파일의 원래 바이트 자료의 기대 자료 일치 확인
    assert (tmp_path / "config.json").read_bytes() == competing
    # 조건에 맞는 출력 파일 목록의 비교 자료의 부재 또는 비활성 확인
    assert not list(tmp_path.glob(".*.download-*"))
