from __future__ import annotations
import base64
import hashlib
import json
from pathlib import Path
import pytest
from replay_video.runner import artifacts, report


# 고정 분석 식별자를 시험 조건에 맞춰 고정
ANALYSIS_ID = "22222222-2222-4222-8222-222222222222"
# 고정 작업 식별자를 시험 조건에 맞춰 고정
JOB_ID = "11111111-1111-4111-8111-111111111111"
# 고정 작업 개정 번호를 시험 조건에 맞춰 고정
JOB_REVISION = 2
# 선점된 작업 범위를 비교에 사용할 고정 시험 자료로 구성
CLAIM = {"analysisId": ANALYSIS_ID, "jobId": JOB_ID, "jobRevision": JOB_REVISION}

# 파일 해시 반환
def digest(path: Path) -> str:
    # 큰 파일도 순차 처리할 수 있는 내용 지문 누적기 생성
    value = hashlib.sha256()
    # 파일 경로를 닫힘이 보장되는 범위에서 열기
    with path.open("rb") as source:
        # 파일을 메비바이트 단위로 나누어 끝까지 읽음
        while chunk := source.read(1024 * 1024):
            # 시험 값에 입력을 반영하여 상태 갱신
            value.update(chunk)
    # 시험 값의 내용 지문을 호출자에게 반환
    return value.hexdigest()


# 권한 요청과 업로드 호출을 기록하는 전송 대역
class TransportApi:

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 서버가 발급할 업로드 권한 목록을 누적할 빈 자료 구조 준비
        self.grants: list[dict[str, object]] = []
        # 요청 이력을 누적할 빈 자료 구조 준비
        self.requests: list[list[dict[str, object]]] = []
        # 업로드 이력을 누적할 빈 자료 구조 준비
        self.uploads: list[tuple[object, ...]] = []

    # 시험용 증거 반환
    def evidence(
        self, _job: dict[str, object], items: list[dict[str, object]]
    ) -> dict[str, object]:
        # 요청 이력에 이번 항목 추가
        self.requests.append(items)
        # 서버가 발급할 업로드 권한 목록이 있는 경우에만 다음 단계 실행
        if self.grants:
            # 시험에서 지정한 권한 응답을 순서대로 반환
            return self.grants.pop(0)
        # 실제 서버 대신 요청 파일에 대응하는 고정 업로드 권한 반환
        return {
            "kind": "GRANTED",
            "items": [
                {
                    "name": item["name"],
                    "objectKey": f"evidence/{_job.get('analysisId')}/{_job.get('jobId')}/{_job.get('jobRevision')}/{item['contentSha256']}/{item['name']}",
                    "uploadUrl": f"http://storage/{item['name']}",
                    "headers": {
                        "x-amz-checksum-sha256": base64.b64encode(
                            bytes.fromhex(item["contentSha256"])
                        ).decode("ascii"),
                        "if-none-match": "*",
                    },
                }
                for item in reversed(items)
            ],
        }

    # 업로드 모형
    def put(self, *args: object) -> None:
        # 업로드 이력에 이번 항목 추가
        self.uploads.append(args)

# 증거 항목 반환
def evidence_entry(path: str, candidate: int, kind: str) -> dict[str, object]:
    # 후보 번호와 증거 유형 및 경로가 연결된 보고서 항목 반환
    return {
        "path": path,
        "candidate_index": candidate,
        "kind": kind,
        "timestamp_ms": 100,
        "start_ms": 50,
        "end_ms": 150,
    }

# 해시 결합 권한과 최초 기록 헤더 전송 확인
def test_media_requests_hash_bound_grants_and_sends_first_write_headers(tmp_path: Path) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "frame.jpg"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"frame")
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
    artifacts(api, CLAIM, tmp_path, [evidence_entry(source.name, 0, "FRAME")])
    # 파일 내용 지문이 파일 바이트로 내용 지문 계산 결과과 일치하는지 확인
    assert api.requests[0][0].get("contentSha256") == digest(source)
    # 업로드 이력의 선택 항목의 개수가 4과 일치하는지 확인
    assert len(api.uploads[0]) == 4
    # 업로드 이력의 선택 항목의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.uploads[0][3] == {
        "x-amz-checksum-sha256": base64.b64encode(bytes.fromhex(digest(source))).decode("ascii"),
        "if-none-match": "*",
    }

# 보고서 값 반환
def report_value(
    *, pipeline: str = "video-baseline-v1", evidence: list[dict[str, object]] | None = None
) -> dict[str, object]:
    # 영상 처리 성공과 증거 목록을 담은 보고서 대역 반환
    return {
        "pipeline_version": pipeline,
        "limitations": [],
        "shots": [],
        "candidates": [],
        "evidence": [] if evidence is None else evidence,
    }

# 역순 권한 응답에도 로컬 증거 순서 보존 확인
def test_media_grants_preserve_local_evidence_order_when_response_is_reversed(
    tmp_path: Path,
) -> None:
    # 시험 대상 경로를 시험용으로 생성
    (tmp_path / "frames").mkdir()
    # 시험 대상 경로를 시험용으로 생성
    (tmp_path / "clips").mkdir()
    # 영상 프레임을 시험용 기준 경로에서 구성
    frame = tmp_path / "frames" / "one.jpg"
    # 증거 클립을 시험용 기준 경로에서 구성
    clip = tmp_path / "clips" / "two.mp4"
    # 영상 프레임에 시험 내용을 기록
    frame.write_bytes(b"frame")
    # 증거 클립에 시험 내용을 기록
    clip.write_bytes(b"clip")
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()

    # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
    result = artifacts(
        api,
        CLAIM,
        tmp_path,
        [
            evidence_entry("frames/one.jpg", 7, "FRAME"),
            evidence_entry("clips/two.mp4", 8, "CLIP"),
        ],
    )

    # 변화 후보 번호 목록이 예상 계약과 일치하는지 확인
    assert [item["candidateIndex"] for item in result] == [7, 8]
    # 저장소 객체 키 목록이 예상 계약과 일치하는지 확인
    assert [item["objectKey"] for item in result] == [
        f"evidence/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{digest(frame)}/one.jpg",
        f"evidence/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{digest(clip)}/two.mp4",
    ]
    # 파일 내용 지문 목록이 파일 바이트로 내용 지문 계산 결과 · 파일 바이트로 내용 지문 계산 결과과 일치하는지 확인
    assert [item["contentSha256"] for item in result] == [digest(frame), digest(clip)]
    # 파일 이름 목록이 예상 계약과 일치하는지 확인
    assert [upload[1].name for upload in api.uploads] == ["one.jpg", "two.mp4"]
    # 모든 업로드 호출이 주소와 파일 및 형식과 헤더를 전달하는지 확인
    assert all(len(upload) == 4 for upload in api.uploads)

# 미디어 권한의 순서 유지와 128개 단위 분할 확인
def test_media_uploads_split_grants_at_128_items_without_reordering(tmp_path: Path) -> None:
    # 증거 파일 항목 목록을 누적할 빈 자료 구조 준비
    entries = []
    # 요청 개수 상한보다 하나 많은 증거 파일 준비
    for index in range(129):
        # 각 증거 파일이 충돌하지 않는 순번 경로 생성
        path = tmp_path / f"frame-{index:03}.jpg"
        # 파일 경로에 시험 내용을 기록
        path.write_bytes(bytes([index % 256]))
        # 증거 파일 항목 목록에 이번 항목 추가
        entries.append(evidence_entry(path.name, index, "FRAME"))
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()

    # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
    result = artifacts(api, CLAIM, tmp_path, entries)

    # 업로드 권한 요청 묶음의 개수 목록이 예상 계약과 일치하는지 확인
    assert [len(batch) for batch in api.requests] == [128, 1]
    # 변화 후보 번호 목록이 예상 계약과 일치하는지 확인
    assert [item["candidateIndex"] for item in result] == list(range(129))

# 미디어 권한의 200메비바이트 이전 분할 확인
def test_media_uploads_split_grants_before_200_mib(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 증거 파일 항목 목록을 누적할 빈 자료 구조 준비
    entries = []
    # 합산 크기 제한을 넘길 다섯 클립 구성
    for index in range(5):
        # 크기 분할 시험용 클립별 경로 생성
        path = tmp_path / f"clip-{index}.mp4"
        # 파일 경로를 닫힘이 보장되는 범위에서 열기
        with path.open("wb") as output:
            # 큰 데이터를 메모리에 만들지 않고 시험 파일 크기 조절
            output.truncate(49 * 1024 * 1024)
        # 증거 파일 항목 목록에 이번 항목 추가
        entries.append(evidence_entry(path.name, index, "CLIP"))
    # 대용량 파일 읽기 없이 요청 크기 분할만 시험하도록 지문 고정
    monkeypatch.setattr('replay_video.runner.digest', lambda _path: "a" * 64)
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()

    # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
    artifacts(api, CLAIM, tmp_path, entries)

    # 업로드 권한 요청 묶음의 개수 목록이 예상 계약과 일치하는지 확인
    assert [len(batch) for batch in api.requests] == [4, 1]
    # 각 요청 묶음의 합산 크기가 예상 분할과 일치하는지 확인
    assert [sum(int(item["sizeBytes"]) for item in batch) for batch in api.requests] == [
        196 * 1024 * 1024, 49 * 1024 * 1024,
    ]

# 권한 요청 전 잘못된 미디어 입력 차단 확인
@pytest.mark.parametrize(
    "entries, message",
    [
        (
            [
                evidence_entry("a/duplicate.jpg", 0, "FRAME"),
                evidence_entry("b/duplicate.jpg", 1, "FRAME"),
            ],
            "evidence-name-duplicate",
        ),
        ([evidence_entry("unknown.bin", 0, "FRAME")], "evidence-type-invalid"),
        ([evidence_entry("wrong.mp4", 0, "FRAME")], "evidence-kind-invalid"),
        ([evidence_entry("wrong.jpg", 0, "CLIP")], "evidence-kind-invalid"),
    ],
)
def test_media_inputs_fail_closed_before_grants(
    tmp_path: Path, entries: list[dict[str, object]], message: str
) -> None:
    # 증거 파일 항목 목록의 각 항목을 순서대로 처리
    for entry in entries:
        # 보고서에 지정된 증거 경로를 로컬 기준 경로와 결합
        path = tmp_path / str(entry["path"])
        # 파일 경로의 상위 디렉터리를 시험용으로 생성
        path.parent.mkdir(parents=True, exist_ok=True)
        # 파일 경로에 시험 내용을 기록
        path.write_bytes(b"value")
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()

    # 권한 요청 전 잘못된 미디어 입력 차단을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match=message):
        # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
        artifacts(api, CLAIM, tmp_path, entries)
    # 요청 이력이 빈 값으로 유지되는지 확인
    assert api.requests == []

# 미디어 경로의 비어 있지 않은 문자열 요구 확인
def test_media_path_must_be_a_nonempty_string(tmp_path: Path) -> None:
    # 시험 대상 경로에 시험 내용을 기록
    (tmp_path / "None").write_bytes(b"frame")
    # 이름과 별개로 잘못된 경로 값을 주입할 증거 항목 생성
    entry = evidence_entry("None.jpg", 0, "FRAME")
    # 파일 경로를 시험 조건에 맞춰 고정
    entry["path"] = None
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()

    # 미디어 경로의 비어 있지 않은 문자열 요구을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="evidence-path-invalid"):
        # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
        artifacts(api, CLAIM, tmp_path, [entry])
    # 요청 이력이 빈 값으로 유지되는지 확인
    assert api.requests == []

# 요청당 유일한 완전 일치 권한 요구 확인
@pytest.mark.parametrize("granted", [
    [],
    [{"name": "one.jpg", "objectKey": "one", "uploadUrl": "http://one"},
     {"name": "one.jpg", "objectKey": "two", "uploadUrl": "http://two"}],
    [{"name": "other.jpg", "objectKey": "one", "uploadUrl": "http://one"}],
])
def test_media_grants_require_one_unique_complete_match_per_request(
    tmp_path: Path, granted: list[dict[str, object]]
) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "one.jpg"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"frame")
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 서버가 발급할 업로드 권한 목록을 비교에 사용할 고정 시험 자료로 구성
    api.grants = [{"kind": "GRANTED", "items": granted}]

    # 요청당 유일한 완전 일치 권한 요구을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="evidence-grant-invalid"):
        # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
        artifacts(api, CLAIM, tmp_path, [evidence_entry(source.name, 0, "FRAME")])
    # 업로드 이력이 빈 값으로 유지되는지 확인
    assert api.uploads == []

# 일괄 업로드 전 전체 권한 검증 확인
def test_media_validates_every_grant_before_uploading_the_batch(tmp_path: Path) -> None:
    # 첫 번째 결과를 시험용 기준 경로에서 구성
    first = tmp_path / "one.jpg"
    # 두 번째 결과를 시험용 기준 경로에서 구성
    second = tmp_path / "two.jpg"
    # 첫 번째 결과에 시험 내용을 기록
    first.write_bytes(b"one")
    # 두 번째 결과에 시험 내용을 기록
    second.write_bytes(b"two")
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 서버가 발급할 업로드 권한 목록을 비교에 사용할 고정 시험 자료로 구성
    api.grants = [
        {
            "kind": "GRANTED",
            "items": [
                {"name": "one.jpg", "objectKey": "one", "uploadUrl": "http://one"},
                {
                    "name": "two.jpg",
                    "objectKey": "two",
                    "uploadUrl": "http://two",
                    "headers": {"authorization": "opaque"},
                },
            ],
        }
    ]

    # 일괄 업로드 전 전체 권한 검증을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="evidence-grant-invalid"):
        # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
        artifacts(
            api,
            CLAIM,
            tmp_path,
            [
                evidence_entry("one.jpg", 0, "FRAME"),
                evidence_entry("two.jpg", 1, "FRAME"),
            ],
        )
    # 업로드 이력이 빈 값으로 유지되는지 확인
    assert api.uploads == []

# 권한 요청 전 링크 이탈·크기 초과 차단 확인
def test_media_rejects_symlink_escape_and_oversize_before_grants(tmp_path: Path) -> None:
    # 허용 디렉터리 바깥 파일을 시험용 기준 경로에서 구성
    outside = tmp_path.parent / "outside.jpg"
    # 허용 디렉터리 바깥 파일에 시험 내용을 기록
    outside.write_bytes(b"outside")
    # 허용 경로 밖으로 나가는 심볼릭 링크 생성
    (tmp_path / "escaped.jpg").symlink_to(outside)
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 권한 요청 전 링크 이탈·크기 초과 차단을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="evidence-path-invalid"):
        # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
        artifacts(api, CLAIM, tmp_path, [evidence_entry("escaped.jpg", 0, "FRAME")])

    # 크기 제한을 넘는 파일을 시험용 기준 경로에서 구성
    large = tmp_path / "large.mp4"
    # 크기 제한을 넘는 파일을 닫힘이 보장되는 범위에서 열기
    with large.open("wb") as output:
        # 큰 데이터를 메모리에 만들지 않고 시험 파일 크기 조절
        output.truncate(50 * 1024 * 1024 + 1)
    # 권한 요청 전 링크 이탈·크기 초과 차단을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="evidence-size-invalid"):
        # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
        artifacts(api, CLAIM, tmp_path, [evidence_entry("large.mp4", 0, "CLIP")])
    # 요청 이력이 빈 값으로 유지되는지 확인
    assert api.requests == []

# 시험용 인식 값 반환
def perception_value(
    artifact: Path,
    stored_path: str = "perception/perception.jsonl.gz",
    content_sha256: str | None = None,
) -> dict[str, object]:
    # 비공개 인식 산출물의 크기와 지문 및 처리 범위 반환
    return {
        "schemaVersion": "perception-run-v1",
        "sourceSha256": "a" * 64,
        "processingStatus": "COMPLETE",
        "coverage": {
            "startMs": 0,
            "endMs": 1000,
            "sampleIntervalMs": 100,
            "expectedSamples": 10,
            "processedSamples": 10,
            "failedSamples": 0,
        },
        "models": [],
        "artifact": {
            "path": stored_path,
            "contentType": "application/gzip",
            "contentSha256": content_sha256 or digest(artifact),
            "sizeBytes": artifact.stat().st_size,
        },
        "summary": {
            "roleObservationCount": 0,
            "poseObservationCount": 0,
            "officialCueCount": 0,
            "interactionCount": 0,
            "linkCount": 0,
            "truncated": False,
            "reasons": [],
        },
        "incidents": [],
    }

# 인식 별도 업로드와 로컬 경로만 교체 확인
@pytest.mark.parametrize("av", [False, True])
def test_report_uploads_perception_separately_and_replaces_only_local_path(
    tmp_path: Path, av: bool
) -> None:
    # 비공개 산출물을 시험용 기준 경로에서 구성
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
    artifact.parent.mkdir()
    # 비공개 산출물에 시험 내용을 기록
    artifact.write_bytes(b"gzip-data")
    # 영상 프레임을 시험용 기준 경로에서 구성
    frame = tmp_path / "frame.jpg"
    # 영상 프레임에 시험 내용을 기록
    frame.write_bytes(b"frame")
    # 현재 파이프라인 판본에 맞는 시험 보고서 구성
    value = report_value(
        pipeline="video-local-observers-v1", evidence=[evidence_entry("frame.jpg", 0, "FRAME")]
    )
    # 생성한 로컬 산출물과 결합된 인식 정보 추가
    value["perception"] = perception_value(artifact)
    # 음향 결합 계약을 사용하는 사례의 추가 필드 구성
    if av:
        # 파이프라인 판본을 시험 조건에 맞춰 고정
        value["pipeline_version"] = "video-local-observers-av-v1"
        # 자료 형식 판본을 시험 조건에 맞춰 고정
        value["perception"]["schemaVersion"] = "perception-run-v2"
        # 음향 관측 정보를 비교에 사용할 고정 시험 자료로 구성
        value["perception"]["audio"] = {
            "version": "audio-observations-v1",
            "sourceSha256": "a" * 64,
            "status": "COMPLETE",
            "method": "spectral-multitone-v1",
            "speechStatus": "NOT_ANALYZED",
            "sourceSampleRateHz": 48000,
            "sourceChannels": 2,
            "timeline": {
                "videoOriginSeconds": 0.0,
                "audioOffsetMs": 0,
                "scannedStartMs": 0,
                "scannedEndMs": 1000,
                "decodedFrameCount": 10,
                "frameDurationMs": 100,
                "gapPolicy": "PRESERVED_WITH_SYNTHETIC_SILENCE",
            },
            "cueCount": 0,
            "cues": [],
            "associations": [],
            "truncated": False,
            "reasons": ["SPEECH_NOT_ANALYZED"],
        }
    # 보고서 경로를 시험용 기준 경로에서 구성
    report_path = tmp_path / "report.json"
    # 보고서 경로에 시험 내용을 기록
    report_path.write_text(json.dumps(value))
    # 파일 바이트로 내용 지문 계산
    sha256 = digest(artifact)
    # 내용 지문을 저장소 검증 헤더의 인코딩 형식으로 변환
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 서버가 발급할 업로드 권한 목록을 비교에 사용할 고정 시험 자료로 구성
    api.grants = [
        {
            "kind": "GRANTED",
            "items": [
                {
                    "name": "frame.jpg",
                    "objectKey": f"evidence/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{digest(tmp_path / 'frame.jpg')}/frame.jpg",
                    "uploadUrl": "http://frame",
                    "headers": {
                        "x-amz-checksum-sha256": base64.b64encode(
                            bytes.fromhex(digest(tmp_path / 'frame.jpg'))
                        ).decode("ascii"),
                        "if-none-match": "*",
                    },
                }
            ],
        },
        {
            "kind": "GRANTED",
            "items": [
                {
                    "name": "perception.jsonl.gz",
                    "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{sha256}.jsonl.gz",
                    "uploadUrl": "http://perception",
                    "headers": {"x-amz-checksum-sha256": checksum, "if-none-match": "*"},
                }
            ],
        },
    ]

    # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
    payload = report(api, CLAIM, report_path)

    # 요청 이력의 개수가 2과 일치하는지 확인
    assert len(api.requests) == 2
    # 요청 이력의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.requests[1] == [{"name": "perception.jsonl.gz", "contentType": "application/gzip",
                                "sizeBytes": len(b"gzip-data"), "contentSha256": sha256}]
    # 업로드 이력의 선택 항목의 개수가 4과 일치하는지 확인
    assert len(api.uploads[0]) == 4
    # 업로드 이력의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.uploads[1] == ("http://perception", artifact, "application/gzip",
                              {"x-amz-checksum-sha256": checksum, "if-none-match": "*"})
    # 모델 관측 정보를 후속 비교에 사용할 값으로 보관
    perception = payload["perception"]
    # 모델 관측 정보가 계약에 지정된 자료형인지 확인
    assert isinstance(perception, dict)
    # 음향 결합 사례에만 필요한 전송 계약 추가 확인
    if av:
        # 음향 관측 정보가 음향 관측 정보와 일치하는지 확인
        assert perception["audio"] == value["perception"]["audio"]
    # 비공개 산출물에 파일 경로가 포함되지 않는지 확인
    assert "path" not in perception["artifact"]
    # 비공개 산출물이 예상 계약과 일치하는지 확인
    assert perception["artifact"] == {
        "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{sha256}.jsonl.gz",
        "contentType": "application/gzip",
        "contentSha256": sha256,
        "sizeBytes": len(b"gzip-data"),
    }

# 새 파이프라인의 구형 대체 없는 인식 요구 확인
def test_new_pipeline_requires_perception_without_legacy_fallback(tmp_path: Path) -> None:
    # 인식 정보가 필수인 새 판본의 시험 보고서 생성
    value = report_value(pipeline="video-local-observers-v1")
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(json.dumps(value))

    # 새 파이프라인의 구형 대체 없는 인식 요구을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="perception-required"):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(TransportApi(), CLAIM, path)

# 로컬 인식 산출물과 메타데이터 일치 확인
@pytest.mark.parametrize("change, message", [
    ({"contentType": "video/mp4"}, "perception-artifact-invalid"),
    ({"contentSha256": "0" * 64}, "perception-artifact-invalid"),
    ({"sizeBytes": 999}, "perception-artifact-invalid"),
    ({"path": "../outside.jsonl.gz"}, "perception-path-invalid"),
    ({"sizeBytes": True}, "perception-artifact-invalid"),
])
def test_perception_local_artifact_metadata_must_match_file(
    tmp_path: Path, change: dict[str, object], message: str
) -> None:
    # 비공개 산출물을 시험용 기준 경로에서 구성
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
    artifact.parent.mkdir()
    # 비공개 산출물에 시험 내용을 기록
    artifact.write_bytes(b"x" if change.get("sizeBytes") is True else b"gzip-data")
    # 변조한 산출물 정보를 넣을 새 판본 보고서 생성
    value = report_value(pipeline="video-local-observers-v1")
    # 검증 실패 조건을 주입할 정상 인식 메타데이터 생성
    perception = perception_value(artifact)
    # 비공개 산출물에 입력을 반영하여 상태 갱신
    perception["artifact"].update(change)
    # 모델 관측 정보를 후속 비교에 사용할 값으로 보관
    value["perception"] = perception
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(json.dumps(value))

    # 로컬 인식 산출물과 메타데이터 일치을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match=message):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(TransportApi(), CLAIM, path)

# 인식 권한의 정확한 불변 체크섬 헤더 요구 확인
@pytest.mark.parametrize("headers", [
    {"x-amz-checksum-sha256": "wrong", "if-none-match": "*"},
    {"x-amz-checksum-sha256": "unused", "if-none-match": "overwrite"},
    {"x-amz-checksum-sha256": "unused", "if-none-match": "*", "authorization": "secret"},
])
def test_perception_grant_requires_exact_immutable_checksum_headers(
    tmp_path: Path, headers: dict[str, str]
) -> None:
    # 비공개 산출물을 시험용 기준 경로에서 구성
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
    artifact.parent.mkdir()
    # 비공개 산출물에 시험 내용을 기록
    artifact.write_bytes(b"gzip-data")
    # 권한 헤더 검증에 사용할 새 판본 보고서 생성
    value = report_value(pipeline="video-local-observers-v1")
    # 로컬 인식 산출물 정보를 보고서에 연결
    value["perception"] = perception_value(artifact)
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(json.dumps(value))
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 파일 바이트로 내용 지문 계산
    sha256 = digest(artifact)
    # 서버가 발급할 업로드 권한 목록을 비교에 사용할 고정 시험 자료로 구성
    api.grants = [
        {
            "kind": "GRANTED",
            "items": [
                {
                    "name": artifact.name,
                    "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{sha256}.jsonl.gz",
                    "uploadUrl": "http://perception",
                    "headers": headers,
                }
            ],
        }
    ]

    # 인식 권한의 정확한 불변 체크섬 헤더 요구을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="perception-grant-invalid"):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(api, CLAIM, path)
    # 업로드 이력이 빈 값으로 유지되는지 확인
    assert api.uploads == []

# 인식 권한 객체 키의 로컬 해시 결합 확인
def test_perception_grant_object_key_must_bind_the_local_digest(tmp_path: Path) -> None:
    # 비공개 산출물을 시험용 기준 경로에서 구성
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
    artifact.parent.mkdir()
    # 비공개 산출물에 시험 내용을 기록
    artifact.write_bytes(b"gzip-data")
    # 객체 키의 지문 결합을 확인할 새 판본 보고서 생성
    value = report_value(pipeline="video-local-observers-v1")
    # 객체 키와 비교할 인식 산출물 정보 연결
    value["perception"] = perception_value(artifact)
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(json.dumps(value))
    # 파일 바이트로 내용 지문 계산
    sha256 = digest(artifact)
    # 정상 지문을 검증 헤더 형식으로 인코딩
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 서버가 발급할 업로드 권한 목록을 비교에 사용할 고정 시험 자료로 구성
    api.grants = [
        {
            "kind": "GRANTED",
            "items": [
                {
                    "name": artifact.name,
                    "objectKey": f"perception/{ANALYSIS_ID}/{JOB_ID}/{JOB_REVISION}/{'0' * 64}.jsonl.gz",
                    "uploadUrl": "http://perception",
                    "headers": {"x-amz-checksum-sha256": checksum, "if-none-match": "*"},
                }
            ],
        }
    ]

    # 인식 권한 객체 키의 로컬 해시 결합을 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="perception-grant-invalid"):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(api, CLAIM, path)
    # 업로드 이력이 빈 값으로 유지되는지 확인
    assert api.uploads == []

# 정확한 선점 범위 밖 인식 권한 키 거부 확인
@pytest.mark.parametrize("variant", ["namespace", "analysis", "job", "revision"])
def test_perception_grant_rejects_any_key_outside_the_exact_claim(
    tmp_path: Path,
    variant: str,
) -> None:
    # 비공개 산출물을 시험용 기준 경로에서 구성
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
    artifact.parent.mkdir()
    # 비공개 산출물에 시험 내용을 기록
    artifact.write_bytes(b"gzip-data")
    # 선점 범위 이탈 시험에 사용할 새 판본 보고서 생성
    value = report_value(pipeline="video-local-observers-v1")
    # 실제 로컬 산출물 정보를 보고서에 연결
    value["perception"] = perception_value(artifact)
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(json.dumps(value))
    # 파일 바이트로 내용 지문 계산
    sha256 = digest(artifact)
    # 범위 이탈 이외의 조건은 정상인 체크섬 헤더 준비
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    # 저장소 객체 키의 구성 요소를 비교에 사용할 고정 시험 자료로 구성
    parts = ["perception", ANALYSIS_ID, JOB_ID, str(JOB_REVISION), f"{sha256}.jsonl.gz"]
    # 범위 이탈 시험용 키 교체값을 비교에 사용할 고정 시험 자료로 구성
    replacements = {
        "namespace": "other",
        "analysis": "33333333-3333-4333-8333-333333333333",
        "job": "44444444-4444-4444-8444-444444444444",
        "revision": "999",
    }
    # 범위 이탈 시험용 키 교체값을 후속 비교에 사용할 값으로 보관
    parts[["namespace", "analysis", "job", "revision"].index(variant)] = replacements[variant]
    # 업로드 권한과 전송 이력을 기록하는 통신 대역 생성
    api = TransportApi()
    # 서버가 발급할 업로드 권한 목록을 비교에 사용할 고정 시험 자료로 구성
    api.grants = [
        {
            "kind": "GRANTED",
            "items": [
                {
                    "name": artifact.name,
                    "objectKey": "/".join(parts),
                    "uploadUrl": "http://perception",
                    "headers": {"x-amz-checksum-sha256": checksum, "if-none-match": "*"},
                }
            ],
        }
    ]

    # 정확한 선점 범위 밖 인식 권한 키 거부를 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="perception-grant-invalid"):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(api, CLAIM, path)
    # 업로드 이력이 빈 값으로 유지되는지 확인
    assert api.uploads == []

# 해시 계산 전 크기 초과 인식 산출물 거부 확인
def test_oversize_perception_artifact_is_rejected_before_hashing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 비공개 산출물을 시험용 기준 경로에서 구성
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
    artifact.parent.mkdir()
    # 비공개 산출물을 닫힘이 보장되는 범위에서 열기
    with artifact.open("wb") as output:
        # 큰 데이터를 메모리에 만들지 않고 시험 파일 크기 조절
        output.truncate(128 * 1024 * 1024 + 1)
    # 크기 초과 검증용 새 판본 보고서 생성
    value = report_value(pipeline="video-local-observers-v1")
    # 파일 해시를 읽지 않아도 검증할 수 있도록 예상 지문 지정
    value["perception"] = perception_value(artifact, content_sha256="a" * 64)
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(json.dumps(value))
    # 해시 계산 호출 여부를 시험 조건에 맞춰 고정
    called = False

    # 예상 밖 해시 계산 차단
    def unexpected_hash(_path: Path) -> str:
        # 해시 함수 호출 여부를 바깥 시험에서 관찰하도록 연결
        nonlocal called
        # 해시 계산 호출 여부를 시험 조건에 맞춰 고정
        called = True
        # 예상 밖 해시 계산 차단 경로를 재현하는 예외 발생
        raise AssertionError("oversize artifact was hashed")

    # 크기 검증 전에 지문을 읽으면 시험이 실패하도록 대역 연결
    monkeypatch.setattr('replay_video.runner.digest', unexpected_hash)
    # 해시 계산 전 크기 초과 인식 산출물 거부를 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="perception-artifact-invalid"):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(TransportApi(), CLAIM, path)
    # 해시 계산 호출 여부가 거짓인지 확인
    assert called is False

# 인식 보고서의 원시 관측 배열 거부 확인
def test_perception_report_rejects_raw_observation_arrays(tmp_path: Path) -> None:
    # 비공개 산출물을 시험용 기준 경로에서 구성
    artifact = tmp_path / "perception" / "perception.jsonl.gz"
    # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
    artifact.parent.mkdir()
    # 비공개 산출물에 시험 내용을 기록
    artifact.write_bytes(b"gzip-data")
    # 원시 관측 배열 혼입 검증용 새 판본 보고서 생성
    value = report_value(pipeline="video-local-observers-v1")
    # 요약 계약에 금지된 필드를 추가할 정상 인식 정보 준비
    perception = perception_value(artifact)
    # 관측 결과 목록을 누적할 빈 자료 구조 준비
    perception["observations"] = []
    # 모델 관측 정보를 후속 비교에 사용할 값으로 보관
    value["perception"] = perception
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(json.dumps(value))

    # 인식 보고서의 원시 관측 배열 거부를 위한 예상 예외 확인
    with pytest.raises(RuntimeError, match="perception-raw-data-invalid"):
        # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
        report(TransportApi(), CLAIM, path)
