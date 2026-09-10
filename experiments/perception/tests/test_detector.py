from contextlib import nullcontext
from pathlib import Path

import numpy as np
import pytest


class FakeTensor:
    def __init__(self, values):
        self.values = values

    def detach(self):
        return self

    def cpu(self):
        return self

    def tolist(self):
        return self.values


class FakeBatch(dict):
    def __init__(self):
        super().__init__(pixels="rgb")
        self.device = None

    def to(self, device):
        self.device = device
        return self


class FakeProcessor:
    def __init__(self, processed):
        self.processed = processed
        self.batch = None
        self.source = None
        self.return_tensors = None
        self.threshold = None
        self.target_sizes = None

    def __call__(self, *, images, return_tensors):
        self.source = images
        self.return_tensors = return_tensors
        self.batch = FakeBatch()
        return self.batch

    def post_process_object_detection(self, outputs, *, threshold, target_sizes):
        assert outputs == {"raw": "outputs"}
        self.threshold = threshold
        self.target_sizes = target_sizes.values
        return [self.processed]


class FakeProcessorClass:
    instance = None
    load = None

    @classmethod
    def from_pretrained(cls, model_dir, **kwargs):
        cls.load = (model_dir, kwargs)
        return cls.instance


class FakeConfig:
    id2label = {0: "person", 1: "bicycle", 32: "sports ball"}
    architectures = ["RTDetrForObjectDetection"]
    disable_custom_kernels = True


class FakeModel:
    def __init__(self):
        self.config = FakeConfig()
        self.eval_called = False
        self.to_args = None
        self.call = None

    def eval(self):
        self.eval_called = True
        return self

    def to(self, *args, **kwargs):
        self.to_args = (args, kwargs)
        return self

    def __call__(self, **kwargs):
        self.call = kwargs
        return {"raw": "outputs"}


class FakeModelClass:
    instance = None
    load = None

    @classmethod
    def from_pretrained(cls, model_dir, **kwargs):
        cls.load = (model_dir, kwargs)
        return cls.instance


class FakeMps:
    available = False

    @classmethod
    def is_available(cls):
        return cls.available


class FakeBackends:
    mps = FakeMps


class FakeTorch:
    __version__ = "2.6.0"
    backends = FakeBackends()
    float32 = "float32"

    @staticmethod
    def inference_mode():
        return nullcontext()

    @staticmethod
    def tensor(values, **_kwargs):
        return FakeTensor(values)


class FakeTransformers:
    __version__ = "5.17.0"


@pytest.fixture
def detector_runtime(monkeypatch, tmp_path):
    from replay_perception import detector

    metadata = {
        "manifest_version": 1,
        "model_id": "PekingU/rtdetr_r18vd",
        "revision": "ac77a11ff0170a41b771c03264987f8ce2b0d753",
        "architecture": "RTDetrForObjectDetection",
        "disable_custom_kernels": True,
        "files": {"model.safetensors": "abc"},
        "threshold": 0.30,
        "preprocessing": {
            "do_normalize": False,
            "do_rescale": True,
            "rescale_factor": 1 / 255,
            "size": {"height": 640, "width": 640},
        },
    }
    monkeypatch.setattr(detector, "verify_model_assets", lambda path: metadata)
    monkeypatch.setattr(
        detector,
        "_load_runtime",
        lambda: (
            FakeTorch,
            FakeTransformers,
            FakeProcessorClass,
            FakeModelClass,
        ),
    )
    FakeMps.available = False
    FakeProcessorClass.load = None
    FakeModelClass.load = None
    yield detector, tmp_path, metadata


def make_detector(runtime, processed, *, device="cpu"):
    detector_module, model_dir, _metadata = runtime
    FakeProcessorClass.instance = FakeProcessor(processed)
    FakeModelClass.instance = FakeModel()
    return detector_module.RtdetrDetector(model_dir, device=device)


def test_loader_uses_only_verified_local_safetensors(detector_runtime):
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
    )

    model_dir = str(detector_runtime[1])
    assert FakeProcessorClass.load == (
        model_dir,
        {"local_files_only": True, "trust_remote_code": False},
    )
    assert FakeModelClass.load == (
        model_dir,
        {"local_files_only": True, "use_safetensors": True},
    )
    assert FakeModelClass.instance.eval_called is True
    assert FakeModelClass.instance.to_args == (("cpu",), {"dtype": "float32"})
    assert instance.provenance == {
        **detector_runtime[2],
        "device": "cpu",
        "precision": "float32",
        "library_versions": {"torch": "2.6.0", "transformers": "5.17.0"},
    }


def test_quoted_home_path_is_canonicalized_once_for_verification_and_loaders(
    detector_runtime, monkeypatch
):
    detector_module, _model_dir, metadata = detector_runtime
    supplied = "~/.cache/replay-lab/models/canonical-path-test"
    expected = Path(supplied).expanduser().resolve()
    verified = []
    monkeypatch.setattr(
        detector_module,
        "verify_model_assets",
        lambda path: verified.append(path) or metadata,
    )
    FakeProcessorClass.instance = FakeProcessor(
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])}
    )
    FakeModelClass.instance = FakeModel()

    detector_module.RtdetrDetector(supplied)

    assert verified == [expected]
    assert FakeProcessorClass.load[0] == str(expected)
    assert FakeModelClass.load[0] == str(expected)


def test_symlink_model_path_is_resolved_for_verification_and_loaders(
    detector_runtime, monkeypatch, tmp_path
):
    detector_module, _model_dir, metadata = detector_runtime
    actual = tmp_path / "actual-model-cache"
    actual.mkdir()
    alias = tmp_path / "model-cache-alias"
    alias.symlink_to(actual, target_is_directory=True)
    expected = actual.resolve()
    verified = []
    monkeypatch.setattr(
        detector_module,
        "verify_model_assets",
        lambda path: verified.append(path) or metadata,
    )
    FakeProcessorClass.instance = FakeProcessor(
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])}
    )
    FakeModelClass.instance = FakeModel()

    detector_module.RtdetrDetector(alias)

    assert verified == [expected]
    assert FakeProcessorClass.load[0] == str(expected)
    assert FakeModelClass.load[0] == str(expected)


def test_predict_restores_source_coordinates_and_filters_to_observed_labels(
    detector_runtime
):
    processed = {
        "boxes": FakeTensor(
            [
                [-4.0, 2.0, 250.0, 130.0],
                [10.0, 11.0, 15.0, 18.0],
                [3.0, 4.0, 8.0, 9.0],
                [20.0, 20.0, 20.0, 30.0],
                [float("nan"), 1.0, 3.0, 4.0],
            ]
        ),
        "scores": FakeTensor([0.91, 0.72, 0.99, 0.8, 0.7]),
        "labels": FakeTensor([0, 32, 1, 0, 0]),
    }
    instance = make_detector(detector_runtime, processed)
    rgb = np.zeros((100, 200, 3), dtype=np.uint8)

    detections = instance.predict(rgb)

    assert [d.as_record() for d in detections] == [
        {
            "detectionId": 0,
            "label": "person",
            "box": [0.0, 2.0, 200.0, 100.0],
            "score": 0.91,
            "trackId": None,
            "actorRole": "UNPROVEN",
            "source": "MODEL_DETECTION",
        },
        {
            "detectionId": 1,
            "label": "sports ball",
            "box": [10.0, 11.0, 15.0, 18.0],
            "score": 0.72,
            "trackId": None,
            "actorRole": "UNPROVEN",
            "source": "MODEL_DETECTION",
        },
    ]
    assert FakeProcessorClass.instance.source is rgb
    assert FakeProcessorClass.instance.return_tensors == "pt"
    assert FakeProcessorClass.instance.batch.device == "cpu"
    assert FakeProcessorClass.instance.threshold == pytest.approx(0.30)
    assert FakeProcessorClass.instance.target_sizes == [[100, 200]]
    assert FakeModelClass.instance.call == {"pixels": "rgb"}


def test_predict_drops_nonfinite_or_out_of_range_scores(detector_runtime):
    processed = {
        "boxes": FakeTensor([[1, 1, 3, 3]] * 4),
        "scores": FakeTensor([float("nan"), float("inf"), 1.1, 0.29]),
        "labels": FakeTensor([0, 0, 0, 0]),
    }
    instance = make_detector(detector_runtime, processed)
    assert instance.predict(np.zeros((8, 8, 3), dtype=np.uint8)) == ()


def test_empty_postprocessed_result_returns_an_empty_tuple(detector_runtime):
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
    )
    assert instance.predict(np.zeros((8, 8, 3), dtype=np.uint8)) == ()


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
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
    )
    with pytest.raises(ValueError, match="DETECTOR_INPUT_INVALID"):
        instance.predict(rgb)


def test_unavailable_mps_fails_without_silent_cpu_fallback(detector_runtime):
    detector_module, model_dir, _metadata = detector_runtime
    FakeMps.available = False
    with pytest.raises(RuntimeError, match="DEVICE_UNAVAILABLE"):
        detector_module.RtdetrDetector(model_dir, device="mps")
    assert FakeProcessorClass.load is None
    assert FakeModelClass.load is None


def test_available_mps_is_used_and_recorded(detector_runtime):
    FakeMps.available = True
    instance = make_detector(
        detector_runtime,
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])},
        device="mps",
    )
    assert instance.provenance["device"] == "mps"
    assert FakeModelClass.instance.to_args == (("mps",), {"dtype": "float32"})


@pytest.mark.parametrize("device", ["cuda", "auto", "CPU", ""])
def test_unsupported_device_is_rejected(detector_runtime, device):
    detector_module, model_dir, _metadata = detector_runtime
    with pytest.raises(ValueError, match="DEVICE_UNSUPPORTED"):
        detector_module.RtdetrDetector(model_dir, device=device)


def test_loaded_model_must_keep_the_verified_safe_configuration(detector_runtime):
    detector_module, model_dir, _metadata = detector_runtime
    FakeProcessorClass.instance = FakeProcessor(
        {"boxes": FakeTensor([]), "scores": FakeTensor([]), "labels": FakeTensor([])}
    )
    FakeModelClass.instance = FakeModel()
    FakeModelClass.instance.config.disable_custom_kernels = False
    with pytest.raises(ValueError, match="MODEL_CONFIG_MISMATCH"):
        detector_module.RtdetrDetector(model_dir)
