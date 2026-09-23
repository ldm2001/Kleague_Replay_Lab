# 인식 모듈 지연 읽기 도구 읽음
from importlib.util import find_spec
# 기록 직렬화와 읽기 도구 읽음
import json
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 가벼운 모의 객체 생성 도구 읽음
from types import SimpleNamespace
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import KEYPOINT_NAMES

# 자세 어댑터 제공 확인
def test_pose_adapter_is_available():
    # 검사할 모듈의 설치 정보 존재 확인
    assert find_spec("replay_perception.pose") is not None, "Missing local pose adapter"

# 시험 실행 환경 생성
@pytest.fixture
def runtime(monkeypatch, tmp_path):
    # 시험 텐서와 추론 상태 점검 도구 읽음
    import torch
    # 모델 전처리 인터페이스 읽음
    import transformers
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import pose

    # 영상 전처리기 준비
    processor = pose.runtimeBundle()[2]()
    # 모델 로드 이력의 빈 누적 공간 생성
    loads = []
    # 모델 메타데이터의 시험 항목 구성
    metadata = {
        # 모델 구분 키의 자세 모델 시험값 지정
        "model_key": "pose",
        # 승인 모델 식별자의 시험값 지정
        "model_id": "usyd-community/vitpose-plus-small",
        # 고정 모델 판본의 시험값 지정
        "revision": "0c30b6534bb621af0162b481176742577264e36e",
        # 승인 모델 구조의 시험값 지정
        "architecture": "VitPoseForPoseEstimation",
        # 자산 파일 명세의 시험값 지정
        "files": {"model.safetensors": "verified"},
    }

    # 실제 외부 실행을 대신할 시험 객체 정의
    class Model:
        # 필요한 속성만 갖춘 모의 객체 생성
        config = SimpleNamespace(
            architectures=["VitPoseForPoseEstimation"],
            # 모델 유형의 호출 조건 지정
            model_type="vitpose",
            id2label=dict(enumerate(KEYPOINT_NAMES)),
            # 분류 수의 호출 조건 지정
            num_labels=17,
            use_simple_decoder=False,
            backbone_config=SimpleNamespace(
                # 모델 유형의 호출 조건 지정
                model_type="vitpose_backbone", image_size=[256, 192], num_experts=6
            ),
        )

        # 초기 상태와 입력 계약 구성
        def __init__(self):
            # 호출 이력의 빈 누적 공간 생성
            self.calls = []
            # 학습 모드 여부의 참 설정
            self.training = True

        # 장치 이동
        def to(self, *args, **kwargs):
            # 장치 이동 인자의 시험 항목 구성
            self.to_args = (args, kwargs)
            # 상태를 기록한 현재 모의 객체 반환
            return self

        # 평가 모드 설정
        def eval(self):
            # 학습 모드 여부의 거짓 설정
            self.training = False
            # 상태를 기록한 현재 모의 객체 반환
            return self

        # 모의 호출 결과 반환
        def __call__(self, pixel_values, dataset_index):
            # 추론 전용 모드 활성 여부의 조건 충족 확인
            assert torch.is_inference_mode_enabled()
            # 호출 이력에 현재 관측 추가
            self.calls.append((pixel_values.detach().clone(), dataset_index.detach().clone()))
            # 세로 좌표 격자과 가로 좌표 격자 준비
            yy, xx = torch.meshgrid(torch.arange(64), torch.arange(48), indexing="ij")
            # 시험 입력의 개수 목록의 합계 생성
            offset = sum(len(indices) for _, indices in self.calls[:-1])
            # 관절 확률 지도의 빈 누적 공간 생성
            heatmaps = []
            # 반복할 순번 범위의 항목별 순회
            for index in range(offset, offset + len(dataset_index)):
                # 단일 관절 확률 지도 준비
                heatmap = (1 + index / 10) * torch.exp(
                    -((xx - 20 - index) ** 2 + (yy - 28) ** 2) / 8
                )
                # 관절 확률 지도에 현재 관측 추가
                heatmaps.append(heatmap.expand(17, 64, 48))
            # 필요한 속성만 갖춘 모의 객체 반환
            return SimpleNamespace(heatmaps=torch.stack(heatmaps))

    # 모의 모델 준비
    model = Model()

    # 실제 외부 실행을 대신할 시험 객체 정의
    class ModelLoader:

        # 사전 학습 모형 로드
        @staticmethod
        def from_pretrained(directory, **kwargs):
            # 모델 로드 이력에 현재 관측 추가
            loads.append(("model", directory, kwargs))
            # 모의 모델 반환
            return model

    # 실제 외부 실행을 대신할 시험 객체 정의
    class ProcessorLoader:

        # 사전 학습 모형 로드
        @staticmethod
        def from_pretrained(directory, **kwargs):
            # 모델 로드 이력에 현재 관측 추가
            loads.append(("processor", directory, kwargs))
            # 영상 전처리기 반환
            return processor

    # 자산 검증 이력의 빈 누적 공간 생성
    verified = []
    # 고정 해시와 대조한 자산 정보의 시험 대역 주입
    monkeypatch.setattr(
        pose, 'verification', lambda key, directory: verified.append((key, directory)) or metadata
    )
    # 모델 실행 의존성 묶음의 시험 대역 주입
    monkeypatch.setattr(
        pose, 'runtimeBundle', lambda: (torch, transformers, ProcessorLoader, ModelLoader)
    )
    # 필요한 속성만 갖춘 모의 객체 반환
    return SimpleNamespace(
        module=pose,
        torch=torch,
        # 영상 전처리기의 호출 조건 지정
        processor=processor,
        # 모의 모델의 호출 조건 지정
        model=model,
        # 모델 로드 이력의 호출 조건 지정
        loads=loads,
        # 자산 검증 이력의 호출 조건 지정
        verified=verified,
        # 작업 폴더의 호출 조건 지정
        directory=tmp_path,
        # 모델 메타데이터의 호출 조건 지정
        metadata=metadata,
    )

# 자세 추정기 생성
def make_estimator(runtime, **kwargs):
    # 사람 영역의 관절 좌표를 추정할 객체 반환
    return runtime.module.VitPoseEstimator(runtime.directory, **kwargs)

# 검증된 로컬 안전 가중치와 명시적 전처리 확인
def test_verified_local_safetensors_and_explicit_preprocessing(runtime):
    # 모의 실행 환경을 주입한 자세 추정기 생성
    estimator = make_estimator(runtime)
    # 자산 검증 이력의 기대 자료 일치 확인
    assert runtime.verified == [("pose", runtime.directory)]
    # 모델 로드 이력의 조건별 항목 수집
    loads = {kind: (directory, kwargs) for kind, directory, kwargs in runtime.loads}
    # 모의 모델의 기대 자료 일치 확인
    assert loads["model"] == (
        str(runtime.directory),
        {
            # 로컬 파일만 읽는 제한의 참 시험값 지정
            "local_files_only": True,
            # 원격 코드 신뢰 여부의 거짓 시험값 지정
            "trust_remote_code": False,
            # 안전 텐서 형식 사용 여부의 참 시험값 지정
            "use_safetensors": True,
            # 가중치 전용 읽기 여부의 참 시험값 지정
            "weights_only": True,
        },
    )
    # 영상 전처리기의 기대 자료 일치 확인
    assert loads["processor"] == (str(runtime.directory / "preprocessor_config.json"), {
        # 로컬 파일만 읽는 제한의 참 시험값 지정
        "local_files_only": True, "trust_remote_code": False,
        # 파일 크기의 시험값 지정
        "size": {"height": 256, "width": 192}, "do_affine_transform": True,
        # 색상 값 변환 배율의 기대값 지정
        "normalize_factor": 200.0, "do_rescale": True, "rescale_factor": 1 / 255,
        # 색상 채널 평균의 기대값 지정
        "do_normalize": True, "image_mean": [0.485, 0.456, 0.406],
        # 색상 채널 표준편차의 기대값 지정
        "image_std": [0.229, 0.224, 0.225],
    })
    # 장치 이동 인자의 기대 자료 일치 확인
    assert runtime.model.to_args == (("cpu",), {"dtype": runtime.torch.float32})
    # 학습 모드 여부 값이 거짓인지 확인
    assert runtime.model.training is False
    # 자산 파일 명세의 기대 자료 일치 확인
    assert estimator.provenance["files"] == runtime.metadata["files"]
    # 관절 전문가 모델 순번 값이 0인지 확인
    assert estimator.provenance["expert_index"] == 0
    # 묶음 처리 크기 값이 8인지 확인
    assert estimator.provenance["batch_size"] == 8
    # 연산 정밀도 값이 단정밀도 실수인지 확인
    assert estimator.provenance["precision"] == "float32"
    # 출처 기록에 수치 계산 의존성의 판본이 포함됐는지 확인
    assert estimator.provenance["library_versions"]["scipy"]
    # 출처 기록에 영상 처리 의존성의 판본이 포함됐는지 확인
    assert estimator.provenance["library_versions"]["pillow"]
    # 사람 영역 여백 비율 값이 1점25인지 확인
    assert estimator.provenance["preprocessing"]["padding_factor"] == 1.25
    # 전처리 구현 정보에 지정한 항목 포함 확인
    assert "VitPoseImageProcessorPil" in estimator.provenance["processor_backend"]

# 실제 처리기의 미검증 인접 설정 읽기 방지 확인
def test_real_processor_loader_never_reads_unverified_sibling_configuration(runtime, monkeypatch):
    # 모델 전처리 인터페이스 읽음
    from transformers import image_processing_base

    # 검증된 설정 파일 준비
    verified_file = runtime.directory / "preprocessor_config.json"
    # 검증된 설정 파일에 시험 문자열 기록
    verified_file.write_text(json.dumps({"do_convert_rgb": False}), encoding="utf-8")
    # 시험 파일 경로에 시험 문자열 기록
    (runtime.directory / "processor_config.json").write_text(
        json.dumps({"image_processor": {"do_convert_rgb": True}}),
        encoding="utf-8",
    )
    # 모델 실행 의존성 묶음 생성
    torch, transformers, _, model_loader = runtime.module.runtimeBundle()
    # 모델 실행 의존성 묶음의 시험 대역 주입
    monkeypatch.setattr(
        runtime.module,
        'runtimeBundle',
        lambda: (torch, transformers, type(runtime.processor), model_loader),
    )
    # 읽은 설정 파일 경로의 빈 누적 공간 생성
    read_paths = []
    # 교체 전 파일 읽기 함수 준비
    original_read = image_processing_base.safe_load_json_file

    # 설정 읽음
    def read_configuration(path):
        # 읽은 설정 파일 경로에 현재 관측 추가
        read_paths.append(Path(path))
        # 교체 전 파일 읽기 함수 반환
        return original_read(path)

    # 실제 처리기의 미검증 인접 설정 읽기 방지 의존성의 시험 대역 주입
    monkeypatch.setattr(image_processing_base, "safe_load_json_file", read_configuration)
    # 모의 실행 환경을 주입한 자세 추정기 생성
    estimator = make_estimator(runtime)
    # 읽은 설정 파일 경로의 기대 자료 일치 확인
    assert read_paths == [verified_file]
    # 색상 채널 변환 여부 값이 거짓인지 확인
    assert estimator._processor.do_convert_rgb is False

# 로드 전 미지원 장치 거부 확인
@pytest.mark.parametrize("device", ["cuda", "auto", "CPU", "mps:0", None])
def test_unsupported_device_rejected_before_loading(runtime, device):
    # 추론 장치 오류 발생 기대
    with pytest.raises(ValueError, match="DEVICE_UNSUPPORTED"):
        # 모의 실행 환경을 주입한 자세 추정기 실행
        make_estimator(runtime, device=device)
    # 모델 로드 이력 값이 빈 목록인지 확인
    assert runtime.loads == []

# 가속 장치 미지원 시 대체 방지 확인
def test_unavailable_mps_does_not_fall_back(runtime, monkeypatch):
    # 추론 장치 사용 가능 여부의 시험 대역 주입
    monkeypatch.setattr(runtime.torch.backends.mps, "is_available", lambda: False)
    # 추론 장치 오류 발생 기대
    with pytest.raises(RuntimeError, match="DEVICE_UNAVAILABLE"):
        # 모의 실행 환경을 주입한 자세 추정기 실행
        make_estimator(runtime, device="mps")
    # 모델 로드 이력 값이 빈 목록인지 확인
    assert runtime.loads == []

# 자산 검증 실패 시 로드 방지 확인
def test_asset_verification_failure_prevents_load(runtime, monkeypatch):

    # 금지 조건 차단
    def reject(*args):
        # 금지 조건 차단의 예외 상황 재현
        raise ValueError("MODEL_HASH_MISMATCH")
    # 고정 해시와 대조한 자산 정보의 시험 대역 주입
    monkeypatch.setattr(runtime.module, 'verification', reject)
    # 파일 해시 불일치 발생 기대
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        # 모의 실행 환경을 주입한 자세 추정기 실행
        make_estimator(runtime)
    # 모델 로드 이력 값이 빈 목록인지 확인
    assert runtime.loads == []

# 경로 해석 전 문자열 기준 저장소 경계 유지 확인
def test_model_path_keeps_lexical_repository_guard_before_resolution(
    runtime, monkeypatch, tmp_path
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception.weights import verification

    # 가중치 저장 폴더 준비
    repository = tmp_path / "repo"
    # 가중치 저장 폴더 생성
    repository.mkdir()
    # 시험 파일 경로 생성
    (repository / ".git").mkdir()
    # 외부 경로 준비
    external = tmp_path / "external-cache"
    # 외부 경로 생성
    external.mkdir()
    # 주입한 시험 입력 준비
    supplied = repository / "model-link"
    # 주입한 시험 입력의 링크 경로 생성
    supplied.symlink_to(external, target_is_directory=True)
    # 고정 해시와 대조한 자산 정보의 시험 대역 주입
    monkeypatch.setattr(runtime.module, 'verification', verification)
    # 파일 경로 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        # 사람 영역의 관절 좌표를 추정할 객체 실행
        runtime.module.VitPoseEstimator(supplied)
    # 모델 로드 이력 값이 빈 목록인지 확인
    assert runtime.loads == []

# 잘못된 관절점 대응 거부 확인
@pytest.mark.parametrize("mapping", [{0: "Nose"}, dict(enumerate(reversed(KEYPOINT_NAMES))),
                                     {str(i): name for i, name in enumerate(KEYPOINT_NAMES)}])
def test_wrong_keypoint_mapping_rejected(runtime, mapping):
    # 분류 번호별 이름 준비
    runtime.model.config.id2label = mapping
    # 모델 설정 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_MODEL_CONFIG_MISMATCH"):
        # 모의 실행 환경을 주입한 자세 추정기 실행
        make_estimator(runtime)

# 미지원 모델 설정 거부 확인
@pytest.mark.parametrize(("field", "value"), [
    ("architectures", ["OtherModel"]), ("model_type", "other"), ("num_labels", 18),
    ("use_simple_decoder", True), ("image_size", None), ("image_size", [192, 256]),
    ("num_experts", 1),
])
def test_unsupported_model_config_rejected(runtime, field, value):
    # 대상 경로의 시험 조건별 값 선택
    target = (
        runtime.model.config.backbone_config
        if field in ("image_size", "num_experts")
        else runtime.model.config
    )
    # 미지원 모델 설정 거부 의존성의 시험 대역 주입
    setattr(target, field, value)
    # 모델 설정 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_MODEL_CONFIG_MISMATCH"):
        # 모의 실행 환경을 주입한 자세 추정기 실행
        make_estimator(runtime)

# 검출 부재 시에도 잘못된 색상 입력 거부 확인
@pytest.mark.parametrize("image", [None, [], np.zeros((20, 20)), np.zeros((20, 20, 3)),
                                   np.zeros((20, 20, 4), np.uint8), np.zeros((0, 20, 3), np.uint8),
                                   np.zeros((20, 0, 3), np.uint8)])
def test_bad_rgb_rejected_even_without_detections(runtime, image):
    # 자세 관측 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_INPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(image, ())
    # 호출 이력 값이 빈 목록인지 확인
    assert runtime.model.calls == []

# 빈 사람 목록의 처리기·추론 생략 확인
def test_empty_people_skips_processor_and_inference(runtime, monkeypatch):
    # 빈 사람 목록의 처리기·추론 생략 외부 호출의 금지된 호출 감시
    monkeypatch.setattr(
        runtime.processor, "preprocess", lambda *args, **kwargs: pytest.fail("empty inference")
    )
    # 시험 영상에 대한 모델 관측 결과 값이 빈 목록인지 확인
    assert make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8), ()) == ()
    # 호출 이력 값이 빈 목록인지 확인
    assert runtime.model.calls == []

# 잘못된 검출 입력의 암묵적 제외 방지 확인
@pytest.mark.parametrize(
    "people",
    [
        [],
        (object(),),
        (Detection(0, "sports ball", (0, 0, 4, 4), 0.8),),
        (Detection(0, "person", (0, 0, 100, 20), 0.8),),
        (Detection(0, "person", (0, 0, 10, 10), 0.8),) * 2,
    ],
)
def test_bad_detection_inputs_are_not_silently_filtered(runtime, people):
    # 자세 관측 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_DETECTIONS_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8), people)
    # 호출 이력 값이 빈 목록인지 확인
    assert runtime.model.calls == []

# 실제 처리기 배치의 검출 순서와 원본 형상 보존 확인
def test_real_processor_batching_preserves_detection_order_and_source_geometry(runtime):
    # 상자와 점수를 가진 원시 검출 목록의 비교 자료 생성
    people = tuple(Detection(i * 7, "person", (10 + i, 20, 70 + i, 120), .8) for i in range(17))
    # 관측 조건을 주입할 영 배열 생성
    rgb = np.zeros((180, 300, 3), np.uint8)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = make_estimator(runtime).predict(rgb, people)
    # 검출 식별자 목록의 비교 자료의 기대 자료 일치 확인
    assert tuple(item.detection_id for item in result) == tuple(
        item.detection_id for item in people
    )
    # 실제 처리기 배치의 검출 순서와 원본 형상 보존의 개수 목록 값이 8 · 8 · 1인지 확인
    assert [len(indices) for _, indices in runtime.model.calls] == [8, 8, 1]
    # 호출 이력의 항목별 순회
    for pixels, indices in runtime.model.calls:
        # 배열 숫자 형식의 기대 자료 일치 확인
        assert pixels.dtype == runtime.torch.float32
        # 배열 차원의 선택 항목의 비교 자료 값이 3 · 256 · 192인지 확인
        assert tuple(pixels.shape[1:]) == (3, 256, 192)
        # 배열 숫자 형식의 기대 자료 일치 확인
        assert indices.dtype == runtime.torch.long
        # 배열을 순서대로 변환한 목록의 기대 자료 일치 확인
        assert indices.tolist() == [0] * len(indices)
    # 순번을 붙인 시험 자료의 항목별 순회
    for index, (item, person) in enumerate(zip(result, people, strict=True)):
        # 원본 검출 상자 좌표의 기대 자료 일치 확인
        assert item.source_box == person.box
        # 항목 이름 목록의 비교 자료의 기대 자료 일치 확인
        assert tuple(point.name for point in item.keypoints) == KEYPOINT_NAMES
        # 관절 좌표와 점수의 개수 값이 17인지 확인
        assert len(item.keypoints) == 17
        # 좌표 변환 행렬 준비
        matrix = np.asarray(item.source_to_input)
        # 시험 좌표와 점수를 담은 배열 생성
        center = np.array([(person.box[0] + person.box[2]) / 2, 70, 1])
        # 실제 처리기 배치의 검출 순서와 원본 형상 보존의 배열 값 오차 범위 일치 확인
        np.testing.assert_allclose(matrix @ center, [95.5, 127.5], atol=1e-5)
        # 실제 처리기 배치의 검출 순서와 원본 형상 보존의 배열 값 오차 범위 일치 확인
        np.testing.assert_allclose(matrix[:, :2], [[191 / 93.75, 0], [0, 255 / 125]], atol=1e-6)
        # 변환한 관절 좌표 준비
        projected = matrix @ [item.keypoints[0].x, item.keypoints[0].y, 1]
        # 실제 처리기 배치의 검출 순서와 원본 형상 보존의 배열 값 오차 범위 일치 확인
        np.testing.assert_allclose(projected, [(20 + index) * 191 / 47, 28 * 255 / 63], atol=1e-4)
        # 검출 신뢰 점수의 기대 자료 일치 확인
        assert item.keypoints[0].score == pytest.approx(1 + index / 10)

# 기록된 행렬의 실제 처리기 화소 재현 확인
@pytest.mark.parametrize("box", [(30, 50, 190, 90), (30, 10, 50, 150), (0, 0, 40, 80)])
def test_recorded_matrix_reproduces_actual_processor_pixels(runtime, box):
    # 시험에 필요한 검증 도구와 의존성 읽음
    from scipy.ndimage import affine_transform

    # 세로 좌표 격자과 가로 좌표 격자 준비
    yy, xx = np.mgrid[:180, :220]
    # 지정 형식으로 변환한 배열 생성
    rgb = np.stack((xx % 256, yy % 256, (xx + yy) % 256), axis=2).astype(np.uint8)
    # 처리 결과 준비
    result = make_estimator(runtime).predict(rgb, (Detection(9, "person", box, .8),))[0]
    # 좌표 변환 행렬 준비
    matrix = np.vstack((result.source_to_input, [0, 0, 1]))
    # 역좌표 변환 준비
    inverse = np.linalg.inv(matrix)
    # 행·열 순서의 연산 좌표와 원본 가로·세로 순서의 출처 좌표 구분
    linear = inverse[:2, :2][::-1, ::-1]
    # 앞선 표본 수 준비
    offset = inverse[:2, 2][::-1]
    # 여러 관측을 묶은 배열 생성
    warped = np.stack(
        [
            affine_transform(
                rgb[:, :, channel],
                linear,
                offset,
                # 출력 배열 차원의 호출 조건 지정
                output_shape=(256, 192),
                order=1,
                mode="constant",
                cval=0,
            )
            for channel in range(3)
        ],
        axis=0,
    )
    # 기대 자료 준비
    expected = (warped.astype(np.float32) / 255 - np.array([.485, .456, .406])[:, None, None])
    # 기대 자료 갱신
    expected /= np.array([.229, .224, .225])[:, None, None]
    # 기록된 행렬의 실제 처리기 화소 재현의 배열 값 오차 범위 일치 확인
    np.testing.assert_allclose(runtime.model.calls[0][0][0].numpy(), expected, atol=1e-6)

# 후처리 자세 생성
def processed_pose(torch):
    # 후처리 자세 결과 반환
    return {
        # 관절 좌표와 점수의 시험값 지정
        "keypoints": torch.tensor([[-12.0, 500.0]] * 17),
        # 관절 신뢰 점수의 시험값 지정
        "scores": torch.tensor([1.25, -0.2] + [0.1] * 15),
        # 허용 분류명 목록의 시험값 지정
        "labels": torch.arange(17),
        # 검출 상자 좌표의 시험값 지정
        "bbox": torch.tensor([1.0, 2.0, 3.0, 4.0]),
    }

# 원시 점수와 화면 밖 좌표 보존 확인
def test_raw_scores_and_outside_coordinates_are_preserved(runtime, monkeypatch):
    # 호출 이력의 빈 누적 공간 생성
    calls = []

    # 모의 후처리 결과 반환
    def postprocess(outputs, **kwargs):
        # 호출 이력에 현재 관측 추가
        calls.append(kwargs)
        # 전처리 결과를 반영한 자세 관측 반환
        return [[processed_pose(runtime.torch)]]
    # 원시 점수와 화면 밖 좌표 보존 의존성의 시험 대역 주입
    monkeypatch.setattr(runtime.processor, "post_process_pose_estimation", postprocess)
    # 시험 영상에 대한 모델 관측 결과 생성
    result = make_estimator(runtime).predict(
        np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
    )
    # 검출 신뢰 점수 값이 1점25인지 확인
    assert result[0].keypoints[0].score == 1.25
    # 검출 신뢰 점수의 기대 자료 일치 확인
    assert result[0].keypoints[1].score == pytest.approx(-.2)
    # 가로 좌표와 세로 좌표의 기대 자료 일치 확인
    assert (result[0].keypoints[0].x, result[0].keypoints[0].y) == (-12, 500)
    # 자세 후처리에 점수 기준을 전달하지 않아 원시 관절을 보존하는지 확인
    assert calls[0]["threshold"] is None
    # 호출 이력의 첫 항목에 지정한 항목 미포함 확인
    assert "target_sizes" not in calls[0]

# 비양수 점수의 실제 디코딩 관절 모두 보존 확인
@pytest.mark.parametrize("score", [0.0, -0.2])
def test_nonpositive_scores_keep_all_real_backend_decoded_joints(runtime, monkeypatch, score):
    # 일정한 값으로 채운 시험 배열 생성
    heatmaps = runtime.torch.full((1, 17, 64, 48), score - 1)
    # 관절 확률 지도의 선택 항목 준비
    heatmaps[:, :, 28, 20] = score
    # 필요한 속성만 갖춘 모의 객체 생성
    outputs = SimpleNamespace(heatmaps=heatmaps)
    # 관측한 호출의 시험 대역 주입
    monkeypatch.setattr(type(runtime.model), "__call__", lambda *args, **kwargs: outputs)
    # 기대 자료 준비
    expected = runtime.processor.post_process_pose_estimation(
        outputs, boxes=[[[10, 20, 60, 100]]], threshold=None
    )[0][0]
    # 처리 결과 준비
    result = make_estimator(runtime).predict(
        np.zeros((180, 300, 3), np.uint8), (Detection(3, "person", (10, 20, 70, 120), 0.8),)
    )[0]
    # 상위 처리기의 최댓값 0 이하 보정 전 표식 정점 사용
    # 대체 정점·가공된 유효 자세 대신 디코딩된 좌표 보존
    assert len(result.keypoints) == 17
    # 비양수 점수의 실제 디코딩 관절 모두 보존의 배열 값 오차 범위 일치 확인
    np.testing.assert_allclose(
        [[point.x, point.y] for point in result.keypoints], expected["keypoints"].numpy()
    )
    # 모든 관절의 원시 점수가 실수 오차 범위 안에서 유지됐는지 확인
    assert all(point.score == pytest.approx(score) for point in result.keypoints)

# 손상된 후처리 출력 실패 확인
@pytest.mark.parametrize(
    "fault", ["images", "people", "joints", "scores", "labels", "float_labels", "nan", "inf"]
)
def test_corrupt_postprocess_output_fails(runtime, monkeypatch, fault):
    # 전처리 결과를 반영한 자세 관측 생성
    entry = processed_pose(runtime.torch)
    # 출력 자료의 시험 항목 구성
    output = [[entry]]
    # 손상된 후처리 출력 실패 입력의 비교 결과별 분기
    if fault == "images":
        # 출력 자료의 빈 누적 공간 생성
        output = []
    # 손상된 후처리 출력 실패 입력의 비교 결과별 분기
    elif fault == "people":
        # 출력 자료의 시험 항목 구성
        output = [[entry, entry]]
    # 손상된 후처리 출력 실패 입력의 비교 결과별 분기
    elif fault == "joints":
        # 관절 좌표와 점수 준비
        entry["keypoints"] = entry["keypoints"][:16]
    # 손상된 후처리 출력 실패 입력의 비교 결과별 분기
    elif fault == "scores":
        # 요구 차원으로 바꾼 배열 생성
        entry["scores"] = entry["scores"].reshape(17, 1)
    # 손상된 후처리 출력 실패 입력의 비교 결과별 분기
    elif fault == "labels":
        # 허용 분류명 목록의 첫 항목의 1 설정
        entry["labels"][0] = 1
    # 손상된 후처리 출력 실패 입력의 비교 결과별 분기
    elif fault == "float_labels":
        # 실수로 변환한 값 생성
        entry["labels"] = entry["labels"].float()
    # 손상된 후처리 출력 실패 입력의 비교 결과별 분기
    elif fault == "nan":
        # 실수로 변환한 값 생성
        entry["keypoints"][0, 0] = float("nan")
    else:
        # 실수로 변환한 값 생성
        entry["scores"][0] = float("inf")
    # 손상된 후처리 출력 실패 의존성의 시험 대역 주입
    monkeypatch.setattr(
        runtime.processor, "post_process_pose_estimation", lambda *args, **kwargs: output
    )
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(
            np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
        )

# 후처리 전 잘못된 열지도 형상 실패 확인
@pytest.mark.parametrize("shape", [(2, 17, 64, 48), (1, 16, 64, 48), (1, 17, 32, 24), (17, 64, 48)])
def test_wrong_heatmap_shape_fails_before_postprocessing(runtime, monkeypatch, shape):
    # 관측한 호출의 시험 대역 주입
    monkeypatch.setattr(
        type(runtime.model),
        "__call__",
        lambda *args, **kwargs: SimpleNamespace(heatmaps=runtime.torch.zeros(shape)),
    )
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(
            np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
        )

# 후처리의 비유한 열지도 보정 방지 확인
@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_nonfinite_heatmaps_are_not_cleaned_by_postprocessing(runtime, monkeypatch, value):
    # 관측 조건을 주입할 영 배열 생성
    heatmaps = runtime.torch.zeros((1, 17, 64, 48))
    # 관절 확률 지도의 선택 항목 준비
    heatmaps[0, 0, 0, 0] = value
    # 관측한 호출의 시험 대역 주입
    monkeypatch.setattr(
        type(runtime.model), "__call__", lambda *args, **kwargs: SimpleNamespace(heatmaps=heatmaps)
    )
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(
            np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
        )

# 비실수 후처리 출력 거부 확인
@pytest.mark.parametrize("field", ["keypoints", "scores"])
def test_nonfloating_postprocess_output_is_rejected(runtime, monkeypatch, field):
    # 전처리 결과를 반영한 자세 관측 생성
    entry = processed_pose(runtime.torch)
    # 지정한 장치와 형식으로 옮긴 텐서 생성
    entry[field] = entry[field].to(dtype=runtime.torch.int64)
    # 비실수 후처리 출력 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        runtime.processor, "post_process_pose_estimation", lambda *args, **kwargs: [[entry]]
    )
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(
            np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
        )

# 비실수 열지도 출력 거부 확인
def test_nonfloating_heatmap_output_is_rejected(runtime, monkeypatch):
    # 같은 값으로 채운 시험 배열 생성
    heatmaps = runtime.torch.ones((1, 17, 64, 48), dtype=runtime.torch.int64)
    # 관측한 호출의 시험 대역 주입
    monkeypatch.setattr(
        type(runtime.model), "__call__", lambda *args, **kwargs: SimpleNamespace(heatmaps=heatmaps)
    )
    # 비실수 열지도 출력 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        runtime.processor,
        "post_process_pose_estimation",
        lambda *args, **kwargs: [[processed_pose(runtime.torch)]],
    )
    # 출력 계약 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(
            np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
        )

# 추론 전 손상된 원본 변환 거부 확인
@pytest.mark.parametrize("matrix", [np.zeros((2, 3)), np.full((2, 3), np.nan), np.zeros((3, 3))])
def test_corrupt_source_transform_rejected_before_inference(runtime, monkeypatch, matrix):
    # 모델 전처리 인터페이스 읽음
    from transformers.models.vitpose import image_processing_pil_vitpose

    # 추론 전 손상된 원본 변환 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(image_processing_pil_vitpose, "get_warp_matrix", lambda *args: matrix)
    # 자세 관측 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_TRANSFORM_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(
            np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
        )
    # 호출 이력 값이 빈 목록인지 확인
    assert runtime.model.calls == []

# 손상된 전처리 거부 확인
@pytest.mark.parametrize("pixels", [np.zeros((1, 3, 256, 192)), None])
def test_corrupt_preprocessing_rejected(runtime, monkeypatch, pixels):
    # 모델 전처리 인터페이스 읽음
    from transformers.image_processing_utils import BatchFeature

    # 손상된 전처리 거부 의존성의 시험 대역 주입
    monkeypatch.setattr(
        runtime.processor,
        "preprocess",
        lambda *args, **kwargs: BatchFeature({"pixel_values": pixels}),
    )
    # 자세 관측 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_PREPROCESSING_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        make_estimator(runtime).predict(
            np.zeros((40, 80, 3), np.uint8), (Detection(3, "person", (0, 0, 20, 40), 0.8),)
        )

# 작은 양수 색상 영상 크기 허용 확인
@pytest.mark.parametrize("dimensions", [(1, 1), (2, 5), (3, 3)])
def test_tiny_positive_rgb_dimensions_remain_valid(runtime, dimensions):
    # 영상 높이과 영상 너비 준비
    height, width = dimensions
    # 시험 영상에 대한 모델 관측 결과 생성
    result = make_estimator(runtime).predict(
        np.zeros((height, width, 3), np.uint8),
        (Detection(3, "person", (0, 0, width, height), 0.8),),
    )
    # 처리 결과의 개수 값이 1인지 확인
    assert len(result) == 1
    # 관절 좌표와 점수의 개수 값이 17인지 확인
    assert len(result[0].keypoints) == 17
