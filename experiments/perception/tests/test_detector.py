# 시험 자원 사용 구간 도구 읽음
from contextlib import nullcontext
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeTensor:

    # 초기 상태와 입력 계약 구성
    def __init__(self, values):
        # 시험 값 목록 준비
        self.values = values

    # 연산 그래프 분리
    def detach(self):
        # 상태를 기록한 현재 모의 객체 반환
        return self

    # 중앙 처리 장치 자료 반환
    def cpu(self):
        # 상태를 기록한 현재 모의 객체 반환
        return self

    # 목록 변환
    def tolist(self):
        # 시험 값 목록 반환
        return self.values


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeBatch(dict):

    # 초기 상태와 입력 계약 구성
    def __init__(self):
        # 상위 시험 객체 초기 상태 실행
        super().__init__(pixels="rgb")
        # 추론 장치의 값 없음 설정
        self.device = None

    # 장치 이동
    def to(self, device):
        # 추론 장치 준비
        self.device = device
        # 상태를 기록한 현재 모의 객체 반환
        return self


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeProcessor:

    # 초기 상태와 입력 계약 구성
    def __init__(self, processed):
        # 후처리한 검출 자료 준비
        self.processed = processed
        # 모델 입력 묶음의 값 없음 설정
        self.batch = None
        # 원본 입력의 값 없음 설정
        self.source = None
        # 반환 텐서 형식의 값 없음 설정
        self.return_tensors = None
        # 최소 허용 점수의 값 없음 설정
        self.threshold = None
        # 후처리 대상 원본 크기의 값 없음 설정
        self.target_sizes = None

    # 모의 호출 결과 반환
    def __call__(self, *, images, return_tensors):
        # 원본 입력 준비
        self.source = images
        # 반환 텐서 형식 준비
        self.return_tensors = return_tensors
        # 장치 이동을 기록할 모의 입력 묶음 생성
        self.batch = FakeBatch()
        # 모델 입력 묶음 반환
        return self.batch

    # 검출 후처리 결과 반환
    def post_process_object_detection(self, outputs, *, threshold, target_sizes):
        # 모델 원시 출력의 기대 자료 일치 확인
        assert outputs == {"raw": "outputs"}
        # 최소 허용 점수 준비
        self.threshold = threshold
        # 후처리 대상 원본 크기 준비
        self.target_sizes = target_sizes.values
        # 후처리한 검출 자료 반환
        return [self.processed]


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeProcessorClass:
    # 시험 객체의 값 없음 설정
    instance = None
    # 모델 로드 인자의 값 없음 설정
    load = None

    # 사전 학습 모형 로드
    @classmethod
    def from_pretrained(cls, model_dir, **kwargs):
        # 모델 로드 인자의 시험 항목 구성
        cls.load = (model_dir, kwargs)
        # 시험 객체 반환
        return cls.instance


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeConfig:
    # 분류 번호별 이름의 시험 항목 구성
    id2label = {0: "person", 1: "bicycle", 32: "sports ball"}
    # 허용 모델 구조 목록의 시험 항목 구성
    architectures = ["RTDetrForObjectDetection"]
    # 별도 연산 커널 비활성화 여부의 참 설정
    disable_custom_kernels = True


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeModel:

    # 초기 상태와 입력 계약 구성
    def __init__(self):
        # 모델 설정 준비
        self.config = FakeConfig()
        # 평가 모드 호출 여부의 거짓 설정
        self.eval_called = False
        # 장치 이동 인자의 값 없음 설정
        self.to_args = None
        # 관측한 호출의 값 없음 설정
        self.call = None

    # 평가 모드 설정
    def eval(self):
        # 평가 모드 호출 여부의 참 설정
        self.eval_called = True
        # 상태를 기록한 현재 모의 객체 반환
        return self

    # 장치 이동
    def to(self, *args, **kwargs):
        # 장치 이동 인자의 시험 항목 구성
        self.to_args = (args, kwargs)
        # 상태를 기록한 현재 모의 객체 반환
        return self

    # 모의 호출 결과 반환
    def __call__(self, **kwargs):
        # 관측한 호출 준비
        self.call = kwargs
        # 모의 호출 결과 반환
        return {"raw": "outputs"}


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeModelClass:
    # 시험 객체의 값 없음 설정
    instance = None
    # 모델 로드 인자의 값 없음 설정
    load = None

    # 사전 학습 모형 로드
    @classmethod
    def from_pretrained(cls, model_dir, **kwargs):
        # 모델 로드 인자의 시험 항목 구성
        cls.load = (model_dir, kwargs)
        # 시험 객체 반환
        return cls.instance


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeMps:
    # 가속 장치 사용 가능 여부의 거짓 설정
    available = False

    # 장치 사용 가능 여부 반환
    @classmethod
    def is_available(cls):
        # 가속 장치 사용 가능 여부 반환
        return cls.available


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeBackends:
    # 가속 연산 장치 준비
    mps = FakeMps


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeTorch:
    # 의존성 판본 준비
    __version__ = "2.6.0"
    # 추론 장치 지원 정보 준비
    backends = FakeBackends()
    # 단정밀도 숫자 형식의 단정밀도 실수 설정
    float32 = "float32"

    # 추론 모드 제공
    @staticmethod
    def inference_mode():
        # 추론 모드 제공 결과 반환
        return nullcontext()

    # 텐서 생성
    @staticmethod
    def tensor(values, **_kwargs):
        # 실제 추론 없이 출력 형식을 재현할 모의 텐서 반환
        return FakeTensor(values)


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeTransformers:
    # 의존성 판본 준비
    __version__ = "5.17.0"

# 검출기 시험 실행 환경 생성
@pytest.fixture
def detector_runtime(monkeypatch, tmp_path):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import detector

    # 모델 메타데이터의 시험 항목 구성
    metadata = {
        # 모델 명세 판본의 1 시험값 지정
        "manifest_version": 1,
        # 승인 모델 식별자의 시험값 지정
        "model_id": "PekingU/rtdetr_r18vd",
        # 고정 모델 판본의 시험값 지정
        "revision": "ac77a11ff0170a41b771c03264987f8ce2b0d753",
        # 승인 모델 구조의 시험값 지정
        "architecture": "RTDetrForObjectDetection",
        # 별도 연산 커널 비활성화 여부의 참 시험값 지정
        "disable_custom_kernels": True,
        # 자산 파일 명세의 시험값 지정
        "files": {"model.safetensors": "abc"},
        # 최소 허용 점수의 0점3 시험값 지정
        "threshold": 0.30,
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
    }
    # 승인 모델 자산의 검증 결과의 시험 대역 주입
    monkeypatch.setattr(detector, 'assetVerification', lambda path: metadata)
    # 모델 실행 의존성 묶음의 시험 대역 주입
    monkeypatch.setattr(
        detector,
        'runtimeBundle',
        lambda: (
            FakeTorch,
            FakeTransformers,
            FakeProcessorClass,
            FakeModelClass,
        ),
    )
    # 가속 장치 사용 가능 여부의 거짓 설정
    FakeMps.available = False
    # 모델 로드 인자의 값 없음 설정
    FakeProcessorClass.load = None
    # 모델 로드 인자의 값 없음 설정
    FakeModelClass.load = None
    # 검출기 시험 실행 환경의 시험 단계 실행
    yield detector, tmp_path, metadata

# 검출기 생성
def make_detector(runtime, processed, *, device="cpu"):
    # 검출 모듈과 모델 저장 폴더 준비
    detector_module, model_dir, _metadata = runtime
    # 시험 입력을 기록할 모의 전처리기 생성
    FakeProcessorClass.instance = FakeProcessor(processed)
    # 고정 출력을 반환할 모의 모델 생성
    FakeModelClass.instance = FakeModel()
    # 승인된 가중치를 사용하는 사람 검출기 반환
    return detector_module.RtdetrDetector(model_dir, device=device)

# 검증된 로컬 안전 가중치만 로드 확인
def test_loader_uses_only_verified_local_safetensors(detector_runtime):
    # 모의 실행 환경을 주입한 검출기 생성
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
    )

    # 문자열로 변환한 값 생성
    model_dir = str(detector_runtime[1])
    # 모델 로드 인자의 기대 자료 일치 확인
    assert FakeProcessorClass.load == (
        model_dir,
        {"local_files_only": True, "trust_remote_code": False},
    )
    # 모델 로드 인자의 기대 자료 일치 확인
    assert FakeModelClass.load == (
        model_dir,
        {"local_files_only": True, "use_safetensors": True},
    )
    # 평가 모드 호출 여부 값이 참인지 확인
    assert FakeModelClass.instance.eval_called is True
    # 장치 이동 인자의 기대 자료 일치 확인
    assert FakeModelClass.instance.to_args == (("cpu",), {"dtype": "float32"})
    # 원본과 모델 출처의 기대 자료 일치 확인
    assert instance.provenance == {
        **detector_runtime[2],
        # 추론 장치의 일반 연산 장치 시험값 지정
        "device": "cpu",
        # 연산 정밀도의 단정밀도 실수 시험값 지정
        "precision": "float32",
        # 실행 의존성 판본의 시험값 지정
        "library_versions": {"torch": "2.6.0", "transformers": "5.17.0"},
    }

# 따옴표 포함 홈 경로의 검증·로드용 단일 정규화 확인
def test_quoted_home_path_is_canonicalized_once_for_verification_and_loaders(
    detector_runtime, monkeypatch
):
    # 검출 모듈과 모델 저장 폴더 준비
    detector_module, _model_dir, metadata = detector_runtime
    # 주입한 시험 입력 준비
    supplied = "~/.cache/replay-lab/models/canonical-path-test"
    # 링크를 해석한 실제 경로 생성
    expected = Path(supplied).expanduser().resolve()
    # 자산 검증 이력의 빈 누적 공간 생성
    verified = []
    # 승인 모델 자산의 검증 결과의 시험 대역 주입
    monkeypatch.setattr(
        detector_module,
        'assetVerification',
        lambda path: verified.append(path) or metadata,
    )
    # 시험 입력을 기록할 모의 전처리기 생성
    FakeProcessorClass.instance = FakeProcessor(
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])}
    )
    # 고정 출력을 반환할 모의 모델 생성
    FakeModelClass.instance = FakeModel()

    # 승인된 가중치를 사용하는 사람 검출기 실행
    detector_module.RtdetrDetector(supplied)

    # 자산 검증 이력의 기대 자료 일치 확인
    assert verified == [expected]
    # 모델 로드 인자의 첫 항목의 기대 자료 일치 확인
    assert FakeProcessorClass.load[0] == str(expected)
    # 모델 로드 인자의 첫 항목의 기대 자료 일치 확인
    assert FakeModelClass.load[0] == str(expected)

# 심볼릭 모델 경로의 검증·로드용 해석 확인
def test_symlink_model_path_is_resolved_for_verification_and_loaders(
    detector_runtime, monkeypatch, tmp_path
):
    # 검출 모듈과 모델 저장 폴더 준비
    detector_module, _model_dir, metadata = detector_runtime
    # 실제 저장 경로 준비
    actual = tmp_path / "actual-model-cache"
    # 실제 저장 경로 생성
    actual.mkdir()
    # 심볼릭 링크 경로 준비
    alias = tmp_path / "model-cache-alias"
    # 심볼릭 링크 경로의 링크 경로 생성
    alias.symlink_to(actual, target_is_directory=True)
    # 링크를 해석한 실제 경로 생성
    expected = actual.resolve()
    # 자산 검증 이력의 빈 누적 공간 생성
    verified = []
    # 승인 모델 자산의 검증 결과의 시험 대역 주입
    monkeypatch.setattr(
        detector_module,
        'assetVerification',
        lambda path: verified.append(path) or metadata,
    )
    # 시험 입력을 기록할 모의 전처리기 생성
    FakeProcessorClass.instance = FakeProcessor(
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])}
    )
    # 고정 출력을 반환할 모의 모델 생성
    FakeModelClass.instance = FakeModel()

    # 승인된 가중치를 사용하는 사람 검출기 실행
    detector_module.RtdetrDetector(alias)

    # 자산 검증 이력의 기대 자료 일치 확인
    assert verified == [expected]
    # 모델 로드 인자의 첫 항목의 기대 자료 일치 확인
    assert FakeProcessorClass.load[0] == str(expected)
    # 모델 로드 인자의 첫 항목의 기대 자료 일치 확인
    assert FakeModelClass.load[0] == str(expected)

# 예측의 원본 좌표 복원과 관측 라벨 필터 확인
def test_predict_restores_source_coordinates_and_filters_to_observed_labels(detector_runtime):
    # 후처리한 검출 자료의 시험 항목 구성
    processed = {
        # 검출 상자 목록의 시험값 지정
        "boxes": FakeTensor(
            [
                [-4.0, 2.0, 250.0, 130.0],
                [10.0, 11.0, 15.0, 18.0],
                [3.0, 4.0, 8.0, 9.0],
                [20.0, 20.0, 20.0, 30.0],
                [float("nan"), 1.0, 3.0, 4.0],
            ]
        ),
        # 관절 신뢰 점수의 시험값 지정
        "scores": FakeTensor([0.91, 0.72, 0.99, 0.8, 0.7]),
        # 허용 분류명 목록의 시험값 지정
        "labels": FakeTensor([0, 32, 1, 0, 0]),
    }
    # 모의 실행 환경을 주입한 검출기 생성
    instance = make_detector(detector_runtime, processed)
    # 관측 조건을 주입할 영 배열 생성
    rgb = np.zeros((100, 200, 3), dtype=np.uint8)

    # 시험 영상에 대한 모델 관측 결과 생성
    detections = instance.predict(rgb)

    # 저장 계약에 맞춘 직렬화 자료 목록의 기대 자료 일치 확인
    assert [d.as_record() for d in detections] == [
        {
            # 원본 검출 식별자의 기대값 지정
            "detectionId": 0,
            # 검출 분류명의 사람 시험값 지정
            "label": "person",
            # 검출 상자 좌표의 0점0 · 2점0 · 200점0 · 100점0 시험값 지정
            "box": [0.0, 2.0, 200.0, 100.0],
            # 검출 신뢰 점수의 0점91 시험값 지정
            "score": 0.91,
            # 추적 식별자의 값 없음 시험값 지정
            "trackId": None,
            # 원시 검출의 행위자 역할의 검증되지 않은 역할 시험값 지정
            "actorRole": "UNPROVEN",
            # 원본 입력의 모델 검출 관측 시험값 지정
            "source": "MODEL_DETECTION",
        },
        {
            # 원본 검출 식별자의 기대값 지정
            "detectionId": 1,
            # 검출 분류명의 공 시험값 지정
            "label": "sports ball",
            # 검출 상자 좌표의 10점0 · 11점0 · 15점0 · 18점0 시험값 지정
            "box": [10.0, 11.0, 15.0, 18.0],
            # 검출 신뢰 점수의 0점72 시험값 지정
            "score": 0.72,
            # 추적 식별자의 값 없음 시험값 지정
            "trackId": None,
            # 원시 검출의 행위자 역할의 검증되지 않은 역할 시험값 지정
            "actorRole": "UNPROVEN",
            # 원본 입력의 모델 검출 관측 시험값 지정
            "source": "MODEL_DETECTION",
        },
    ]
    # 원본 입력의 기대 자료 일치 확인
    assert FakeProcessorClass.instance.source is rgb
    # 반환 텐서 형식의 기대 자료 일치 확인
    assert FakeProcessorClass.instance.return_tensors == "pt"
    # 추론 장치 값이 일반 연산 장치인지 확인
    assert FakeProcessorClass.instance.batch.device == "cpu"
    # 최소 허용 점수의 기대 자료 일치 확인
    assert FakeProcessorClass.instance.threshold == pytest.approx(0.30)
    # 후처리 대상 원본 크기 값이 100 · 200인지 확인
    assert FakeProcessorClass.instance.target_sizes == [[100, 200]]
    # 관측한 호출의 기대 자료 일치 확인
    assert FakeModelClass.instance.call == {"pixels": "rgb"}

# 비유한·범위 밖 예측 점수 제외 확인
def test_predict_drops_nonfinite_or_out_of_range_scores(detector_runtime):
    # 후처리한 검출 자료의 시험 항목 구성
    processed = {
        # 검출 상자 목록의 시험값 지정
        "boxes": FakeTensor([[1, 1, 3, 3]] * 4),
        # 관절 신뢰 점수의 시험값 지정
        "scores": FakeTensor([float("nan"), float("inf"), 1.1, 0.29]),
        # 허용 분류명 목록의 시험값 지정
        "labels": FakeTensor([0, 0, 0, 0]),
    }
    # 모의 실행 환경을 주입한 검출기 생성
    instance = make_detector(detector_runtime, processed)
    # 시험 영상에 대한 모델 관측 결과 값이 빈 목록인지 확인
    assert instance.predict(np.zeros((8, 8, 3), dtype=np.uint8)) == ()

# 빈 후처리 결과의 빈 튜플 반환 확인
def test_empty_postprocessed_result_returns_an_empty_tuple(detector_runtime):
    # 모의 실행 환경을 주입한 검출기 생성
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
    )
    # 시험 영상에 대한 모델 관측 결과 값이 빈 목록인지 확인
    assert instance.predict(np.zeros((8, 8, 3), dtype=np.uint8)) == ()

# 잘못된 색상 형식 배열 예측 거부 확인
@pytest.mark.parametrize(
    "rgb",
    [
        np.zeros((4, 5), dtype=np.uint8),
        np.zeros((4, 5, 4), dtype=np.uint8),
        np.zeros((0, 5, 3), dtype=np.uint8),
        np.zeros((4, 5, 3), dtype=np.float32),
        [[[0, 0, 0]]],
    ],
)
def test_predict_rejects_non_rgb_uint8_arrays(detector_runtime, rgb):
    # 모의 실행 환경을 주입한 검출기 생성
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
    )
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="DETECTOR_INPUT_INVALID"):
        # 시험 영상에 대한 모델 관측 결과 실행
        instance.predict(rgb)

# 가속 장치 미지원 시 암묵적 중앙 처리 장치 대체 없는 실패 확인
def test_unavailable_mps_fails_without_silent_cpu_fallback(detector_runtime):
    # 검출 모듈과 모델 저장 폴더 준비
    detector_module, model_dir, _metadata = detector_runtime
    # 가속 장치 사용 가능 여부의 거짓 설정
    FakeMps.available = False
    # 추론 장치 오류 발생 기대
    with pytest.raises(RuntimeError, match="DEVICE_UNAVAILABLE"):
        # 승인된 가중치를 사용하는 사람 검출기 실행
        detector_module.RtdetrDetector(model_dir, device="mps")
    # 모델 로드 인자 부재 확인
    assert FakeProcessorClass.load is None
    # 모델 로드 인자 부재 확인
    assert FakeModelClass.load is None

# 사용 가능한 가속 장치 사용과 기록 확인
def test_available_mps_is_used_and_recorded(detector_runtime):
    # 가속 장치 사용 가능 여부의 참 설정
    FakeMps.available = True
    # 모의 실행 환경을 주입한 검출기 생성
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
        # 추론 장치의 호출 조건 지정
        device="mps",
    )
    # 추론 장치 값이 가속 연산 장치인지 확인
    assert instance.provenance["device"] == "mps"
    # 장치 이동 인자의 기대 자료 일치 확인
    assert FakeModelClass.instance.to_args == (("mps",), {"dtype": "float32"})

# 미지원 장치 거부 확인
@pytest.mark.parametrize("device", ["cuda", "auto", "CPU", ""])
def test_unsupported_device_is_rejected(detector_runtime, device):
    # 검출 모듈과 모델 저장 폴더 준비
    detector_module, model_dir, _metadata = detector_runtime
    # 추론 장치 오류 발생 기대
    with pytest.raises(ValueError, match="DEVICE_UNSUPPORTED"):
        # 승인된 가중치를 사용하는 사람 검출기 실행
        detector_module.RtdetrDetector(model_dir, device=device)

# 로드된 모델의 검증된 안전 설정 유지 확인
def test_loaded_model_must_keep_the_verified_safe_configuration(detector_runtime):
    # 검출 모듈과 모델 저장 폴더 준비
    detector_module, model_dir, _metadata = detector_runtime
    # 시험 입력을 기록할 모의 전처리기 생성
    FakeProcessorClass.instance = FakeProcessor(
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])}
    )
    # 고정 출력을 반환할 모의 모델 생성
    FakeModelClass.instance = FakeModel()
    # 별도 연산 커널 비활성화 여부의 거짓 설정
    FakeModelClass.instance.config.disable_custom_kernels = False
    # 모델 설정 오류 발생 기대
    with pytest.raises(ValueError, match="MODEL_CONFIG_MISMATCH"):
        # 승인된 가중치를 사용하는 사람 검출기 실행
        detector_module.RtdetrDetector(model_dir)
