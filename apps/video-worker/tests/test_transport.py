from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import pytest

from replay_video.runner import artifacts, report


ANALYSIS_ID = "22222222-2222-4222-8222-222222222222"
JOB_ID = "11111111-1111-4111-8111-111111111111"
JOB_REVISION = 2
CLAIM = {"analysisId": ANALYSIS_ID, "jobId": JOB_ID, "jobRevision": JOB_REVISION}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


class TransportApi:
    def __init__(self) -> None:
        self.grants: list[dict[str, object]] = []
        self.requests: list[list[dict[str, object]]] = []
        self.uploads: list[tuple[object, ...]] = []

    def evidence(self, _job: dict[str, object], items: list[dict[str, object]]) -> dict[str, object]:
        self.requests.append(items)
        if self.grants:
            return self.grants.pop(0)
        return {"kind": "GRANTED", "items": [{
            "name": item["name"],
            "objectKey": f"evidence/job/{item['name']}",
            "uploadUrl": f"http://storage/{item['name']}",
        } for item in reversed(items)]}

    def put(self, *args: object) -> None:
        self.uploads.append(args)


def evidence_entry(path: str, candidate: int, kind: str) -> dict[str, object]:
    return {"path": path, "candidate_index": candidate, "kind": kind,
            "timestamp_ms": 100, "start_ms": 50, "end_ms": 150}


def report_value(*, pipeline: str = "video-baseline-v1", evidence: list[dict[str, object]] | None = None) -> dict[str, object]:
    return {"pipeline_version": pipeline, "limitations": [], "shots": [], "candidates": [],
            "evidence": [] if evidence is None else evidence}


def test_media_grants_preserve_local_evidence_order_when_response_is_reversed(tmp_path: Path) -> None:
    (tmp_path / "frames").mkdir()
    (tmp_path / "clips").mkdir()
    frame = tmp_path / "frames" / "one.jpg"
    clip = tmp_path / "clips" / "two.mp4"
    frame.write_bytes(b"frame")
    clip.write_bytes(b"clip")
    api = TransportApi()

    result = artifacts(api, {}, tmp_path, [
        evidence_entry("frames/one.jpg", 7, "FRAME"),
        evidence_entry("clips/two.mp4", 8, "CLIP"),
    ])

    assert [item["candidateIndex"] for item in result] == [7, 8]
    assert [item["objectKey"] for item in result] == ["evidence/job/one.jpg", "evidence/job/two.mp4"]
    assert [item["contentSha256"] for item in result] == [digest(frame), digest(clip)]
    assert [upload[1].name for upload in api.uploads] == ["one.jpg", "two.mp4"]
    assert all(len(upload) == 3 for upload in api.uploads)


def test_media_uploads_split_grants_at_128_items_without_reordering(tmp_path: Path) -> None:
    entries = []
    for index in range(129):
        path = tmp_path / f"frame-{index:03}.jpg"
        path.write_bytes(bytes([index % 256]))
        entries.append(evidence_entry(path.name, index, "FRAME"))
    api = TransportApi()

    result = artifacts(api, {}, tmp_path, entries)

    assert [len(batch) for batch in api.requests] == [128, 1]
    assert [item["candidateIndex"] for item in result] == list(range(129))


def test_media_uploads_split_grants_before_200_mib(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    entries = []
    for index in range(5):
        path = tmp_path / f"clip-{index}.mp4"
        with path.open("wb") as output:
            output.truncate(49 * 1024 * 1024)
        entries.append(evidence_entry(path.name, index, "CLIP"))
    monkeypatch.setattr("replay_video.runner.file_hash", lambda _path: "a" * 64)
    api = TransportApi()

    artifacts(api, {}, tmp_path, entries)

    assert [len(batch) for batch in api.requests] == [4, 1]
    assert [sum(int(item["sizeBytes"]) for item in batch) for batch in api.requests] == [
        196 * 1024 * 1024, 49 * 1024 * 1024,
    ]


@pytest.mark.parametrize("entries, message", [
    ([evidence_entry("a/duplicate.jpg", 0, "FRAME"), evidence_entry("b/duplicate.jpg", 1, "FRAME")], "evidence-name-duplicate"),
    ([evidence_entry("unknown.bin", 0, "FRAME")], "evidence-type-invalid"),
    ([evidence_entry("wrong.mp4", 0, "FRAME")], "evidence-kind-invalid"),
    ([evidence_entry("wrong.jpg", 0, "CLIP")], "evidence-kind-invalid"),
])
def test_media_inputs_fail_closed_before_grants(tmp_path: Path, entries: list[dict[str, object]], message: str) -> None:
    for entry in entries:
        path = tmp_path / str(entry["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"value")
    api = TransportApi()

    with pytest.raises(RuntimeError, match=message):
        artifacts(api, {}, tmp_path, entries)
    assert api.requests == []


def test_media_path_must_be_a_nonempty_string(tmp_path: Path) -> None:
    (tmp_path / "None").write_bytes(b"frame")
    entry = evidence_entry("None.jpg", 0, "FRAME")
    entry["path"] = None
    api = TransportApi()

    with pytest.raises(RuntimeError, match="evidence-path-invalid"):
        artifacts(api, {}, tmp_path, [entry])
    assert api.requests == []


@pytest.mark.parametrize("granted", [
    [],
    [{"name": "one.jpg", "objectKey": "one", "uploadUrl": "http://one"},
     {"name": "one.jpg", "objectKey": "two", "uploadUrl": "http://two"}],
    [{"name": "other.jpg", "objectKey": "one", "uploadUrl": "http://one"}],
])
def test_media_grants_require_one_unique_complete_match_per_request(tmp_path: Path, granted: list[dict[str, object]]) -> None:
    source = tmp_path / "one.jpg"
    source.write_bytes(b"frame")
    api = TransportApi()
    api.grants = [{"kind": "GRANTED", "items": granted}]

    with pytest.raises(RuntimeError, match="evidence-grant-invalid"):
        artifacts(api, {}, tmp_path, [evidence_entry(source.name, 0, "FRAME")])
    assert api.uploads == []


def test_media_validates_every_grant_before_uploading_the_batch(tmp_path: Path) -> None:
    first = tmp_path / "one.jpg"
    second = tmp_path / "two.jpg"
    first.write_bytes(b"one")
    second.write_bytes(b"two")
    api = TransportApi()
    api.grants = [{"kind": "GRANTED", "items": [
        {"name": "one.jpg", "objectKey": "one", "uploadUrl": "http://one"},
        {"name": "two.jpg", "objectKey": "two", "uploadUrl": "http://two",
         "headers": {"authorization": "opaque"}},
    ]}]

    with pytest.raises(RuntimeError, match="evidence-grant-invalid"):
        artifacts(api, {}, tmp_path, [
            evidence_entry("one.jpg", 0, "FRAME"), evidence_entry("two.jpg", 1, "FRAME"),
        ])
    assert api.uploads == []


def test_media_rejects_symlink_escape_and_oversize_before_grants(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside.jpg"
    outside.write_bytes(b"outside")
    (tmp_path / "escaped.jpg").symlink_to(outside)
    api = TransportApi()
    with pytest.raises(RuntimeError, match="evidence-path-invalid"):
        artifacts(api, {}, tmp_path, [evidence_entry("escaped.jpg", 0, "FRAME")])

    large = tmp_path / "large.mp4"
    with large.open("wb") as output:
        output.truncate(50 * 1024 * 1024 + 1)
    with pytest.raises(RuntimeError, match="evidence-size-invalid"):
        artifacts(api, {}, tmp_path, [evidence_entry("large.mp4", 0, "CLIP")])
    assert api.requests == []


def perception_value(
    artifact: Path,
    stored_path: str = "perception/perception.jsonl.gz",
    content_sha256: str | None = None,
) -> dict[str, object]:
    return {
        "schemaVersion": "perception-run-v1", "sourceSha256": "a" * 64,
        "processingStatus": "COMPLETE",
        "coverage": {"startMs": 0, "endMs": 1000, "sampleIntervalMs": 100,
                     "expectedSamples": 10, "processedSamples": 10, "failedSamples": 0},
        "models": [],
        "artifact": {"path": stored_path, "contentType": "application/gzip",
                     "contentSha256": content_sha256 or digest(artifact), "sizeBytes": artifact.stat().st_size},
        "summary": {"roleObservationCount": 0, "poseObservationCount": 0, "officialCueCount": 0,
                    "interactionCount": 0, "linkCount": 0, "truncated": False, "reasons": []},
        "incidents": [],
    }


def test_report_uploads_perception_separately_and_replaces_only_local_path(tmp_path: Path) -> None:
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    artifact.parent.mkdir()
    artifact.write_bytes(b"gzip-data")
    frame = tmp_path / "frame.jpg"
    frame.write_bytes(b"frame")
    value = report_value(pipeline="video-local-observers-v1", evidence=[evidence_entry("frame.jpg", 0, "FRAME")])
    value["perception"] = perception_value(artifact)
    report_path = tmp_path / "report.json"
    report_path.write_text(json.dumps(value))
    sha256 = digest(artifact)
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    api = TransportApi()
    api.grants = [
        {"kind": "GRANTED", "items": [{"name": "frame.jpg", "objectKey": "evidence/frame.jpg", "uploadUrl": "http://frame"}]},
        {"kind": "GRANTED", "items": [{"name": "perception.jsonl.gz",
          "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{sha256}.jsonl.gz",
          "uploadUrl": "http://perception", "headers": {"x-amz-checksum-sha256": checksum, "if-none-match": "*"}}]},
    ]

    payload = report(api, CLAIM, report_path)

    assert len(api.requests) == 2
    assert api.requests[1] == [{"name": "perception.jsonl.gz", "contentType": "application/gzip",
                                "sizeBytes": len(b"gzip-data"), "contentSha256": sha256}]
    assert len(api.uploads[0]) == 3
    assert api.uploads[1] == ("http://perception", artifact, "application/gzip",
                              {"x-amz-checksum-sha256": checksum, "if-none-match": "*"})
    perception = payload["perception"]
    assert isinstance(perception, dict)
    assert "path" not in perception["artifact"]
    assert perception["artifact"] == {
                                      "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{sha256}.jsonl.gz",
                                      "contentType": "application/gzip", "contentSha256": sha256,
                                      "sizeBytes": len(b"gzip-data")}


def test_new_pipeline_requires_perception_without_legacy_fallback(tmp_path: Path) -> None:
    value = report_value(pipeline="video-local-observers-v1")
    path = tmp_path / "report.json"
    path.write_text(json.dumps(value))

    with pytest.raises(RuntimeError, match="perception-required"):
        report(TransportApi(), CLAIM, path)


@pytest.mark.parametrize("change, message", [
    ({"contentType": "video/mp4"}, "perception-artifact-invalid"),
    ({"contentSha256": "0" * 64}, "perception-artifact-invalid"),
    ({"sizeBytes": 999}, "perception-artifact-invalid"),
    ({"path": "../outside.jsonl.gz"}, "perception-path-invalid"),
    ({"sizeBytes": True}, "perception-artifact-invalid"),
])
def test_perception_local_artifact_metadata_must_match_file(tmp_path: Path, change: dict[str, object], message: str) -> None:
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    artifact.parent.mkdir()
    artifact.write_bytes(b"x" if change.get("sizeBytes") is True else b"gzip-data")
    value = report_value(pipeline="video-local-observers-v1")
    perception = perception_value(artifact)
    perception["artifact"].update(change)
    value["perception"] = perception
    path = tmp_path / "report.json"
    path.write_text(json.dumps(value))

    with pytest.raises(RuntimeError, match=message):
        report(TransportApi(), CLAIM, path)


@pytest.mark.parametrize("headers", [
    {"x-amz-checksum-sha256": "wrong", "if-none-match": "*"},
    {"x-amz-checksum-sha256": "unused", "if-none-match": "overwrite"},
    {"x-amz-checksum-sha256": "unused", "if-none-match": "*", "authorization": "secret"},
])
def test_perception_grant_requires_exact_immutable_checksum_headers(tmp_path: Path, headers: dict[str, str]) -> None:
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    artifact.parent.mkdir()
    artifact.write_bytes(b"gzip-data")
    value = report_value(pipeline="video-local-observers-v1")
    value["perception"] = perception_value(artifact)
    path = tmp_path / "report.json"
    path.write_text(json.dumps(value))
    api = TransportApi()
    sha256 = digest(artifact)
    api.grants = [{"kind": "GRANTED", "items": [{"name": artifact.name,
                  "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{sha256}.jsonl.gz",
                  "uploadUrl": "http://perception", "headers": headers}]}]

    with pytest.raises(RuntimeError, match="perception-grant-invalid"):
        report(api, CLAIM, path)
    assert api.uploads == []


def test_perception_grant_object_key_must_bind_the_local_digest(tmp_path: Path) -> None:
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    artifact.parent.mkdir()
    artifact.write_bytes(b"gzip-data")
    value = report_value(pipeline="video-local-observers-v1")
    value["perception"] = perception_value(artifact)
    path = tmp_path / "report.json"
    path.write_text(json.dumps(value))
    sha256 = digest(artifact)
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    api = TransportApi()
    api.grants = [{"kind": "GRANTED", "items": [{
        "name": artifact.name,
        "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{'0' * 64}.jsonl.gz",
        "uploadUrl": "http://perception",
        "headers": {"x-amz-checksum-sha256": checksum, "if-none-match": "*"},
    }]}]

    with pytest.raises(RuntimeError, match="perception-grant-invalid"):
        report(api, CLAIM, path)
    assert api.uploads == []


@pytest.mark.parametrize("variant", ["namespace", "analysis", "job", "revision"])
def test_perception_grant_rejects_any_key_outside_the_exact_claim(
    tmp_path: Path, variant: str,
) -> None:
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    artifact.parent.mkdir()
    artifact.write_bytes(b"gzip-data")
    value = report_value(pipeline="video-local-observers-v1")
    value["perception"] = perception_value(artifact)
    path = tmp_path / "report.json"
    path.write_text(json.dumps(value))
    sha256 = digest(artifact)
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    parts = ["perception", ANALYSIS_ID, JOB_ID, str(JOB_REVISION), f"{sha256}.jsonl.gz"]
    replacements = {"namespace": "other", "analysis": "33333333-3333-4333-8333-333333333333",
                    "job": "44444444-4444-4444-8444-444444444444", "revision": "999"}
    parts[["namespace", "analysis", "job", "revision"].index(variant)] = replacements[variant]
    api = TransportApi()
    api.grants = [{"kind": "GRANTED", "items": [{
        "name": artifact.name, "objectKey": "/".join(parts), "uploadUrl": "http://perception",
        "headers": {"x-amz-checksum-sha256": checksum, "if-none-match": "*"},
    }]}]

    with pytest.raises(RuntimeError, match="perception-grant-invalid"):
        report(api, CLAIM, path)
    assert api.uploads == []


def test_oversize_perception_artifact_is_rejected_before_hashing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    artifact.parent.mkdir()
    with artifact.open("wb") as output:
        output.truncate(128 * 1024 * 1024 + 1)
    value = report_value(pipeline="video-local-observers-v1")
    value["perception"] = perception_value(artifact, content_sha256="a" * 64)
    path = tmp_path / "report.json"
    path.write_text(json.dumps(value))
    called = False

    def unexpected_hash(_path: Path) -> str:
        nonlocal called
        called = True
        raise AssertionError("oversize artifact was hashed")

    monkeypatch.setattr("replay_video.runner.file_hash", unexpected_hash)
    with pytest.raises(RuntimeError, match="perception-artifact-invalid"):
        report(TransportApi(), CLAIM, path)
    assert called is False


def test_perception_report_rejects_raw_observation_arrays(tmp_path: Path) -> None:
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    artifact.parent.mkdir()
    artifact.write_bytes(b"gzip-data")
    value = report_value(pipeline="video-local-observers-v1")
    perception = perception_value(artifact)
    perception["observations"] = []
    value["perception"] = perception
    path = tmp_path / "report.json"
    path.write_text(json.dumps(value))

    with pytest.raises(RuntimeError, match="perception-raw-data-invalid"):
        report(TransportApi(), CLAIM, path)
