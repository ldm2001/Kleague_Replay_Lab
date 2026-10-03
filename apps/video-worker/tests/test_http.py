from __future__ import annotations
import io
import base64
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
import pytest
from replay_video.http import Api, HttpError, Rejection, Transient
from replay_video.runner import artifacts


# 웹 통신 응답 모형
class Reply:

    # 초기 상태·입력 계약 구성
    def __init__(self, status: int, payload: bytes = b"") -> None:
        # 응답 상태와 본문 초기화
        self.status = status
        # 모의 응답 본문을 반복 읽을 수 있는 메모리 스트림 생성
        self.payload = io.BytesIO(payload)

    # 처리 자원 준비
    def __enter__(self) -> Reply:
        # 문맥 관리자에서 모의 응답 자신을 반환
        return self

    # 처리 자원 정리
    def __exit__(self, *_args: object) -> None:
        # 응답 종료 시 예외를 삼키지 않는 기본 종료 결과 반환
        return None

    # 스트림 읽음
    def read(self, size: int = -1) -> bytes:
        # 응답 본문 읽기
        return self.payload.read(size)


# 웹 통신 호출 모형
class Open:

    # 초기 상태·입력 계약 구성
    def __init__(self, replies: list[Reply | Exception]) -> None:
        # 순서대로 반환할 응답 보관
        self.replies = replies
        # 요청 기록 초기화
        self.requests: list[object] = []
        # 연결 호출 중 스트림에서 읽은 요청 본문 보관
        self.bodies: list[bytes | None] = []
        # 업로드가 메모리 일괄 전송인지 스트리밍인지 기록할 목록 준비
        self.streaming: list[bool] = []

    # 시험 호출 결과 반환
    def __call__(self, request: object, timeout: float = 0) -> Reply:
        # 요청 기록
        self.requests.append(request)
        # 요청 객체에서 전송 본문을 선택적으로 읽음
        data = getattr(request, "data", None)
        # 본문에 읽기 함수가 있는지 기록하여 스트리밍 여부 판별
        self.streaming.append(hasattr(data, "read"))
        # 실제 전송될 바이트를 읽어 본문 이력에 저장
        self.bodies.append(data.read() if hasattr(data, "read") else data)
        # 다음 응답 선택
        reply = self.replies.pop(0)
        # 다음 모의 응답이 오류 객체인 경우 실패 경로 선택
        if isinstance(reply, Exception):
            # 시험 호출 결과 경로를 재현하는 예외 발생
            raise reply
        # 지정 순서에 맞는 정상 모의 응답 반환
        return reply

# 작업 선점 응답 확인
def test_claim() -> None:
    # 선점 응답 모형 구성
    payload = {
        "jobId": "job-1",
        "jobType": "VALIDATE_VIDEO",
        "jobRevision": 1,
        "leaseToken": "lease",
        "sourceUrl": "http://storage/video",
    }
    # 빈 선점 응답 뒤 실제 작업 응답을 내줄 전송 대역 생성
    opener = Open([Reply(204), Reply(200, json.dumps(payload).encode())])
    # 실제 서버 대신 지정 대역을 사용하는 작업자 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    # 빈 응답과 작업 응답 확인
    assert api.claim("VALIDATE_VIDEO") is None
    # 두 번째 선점에서 서버가 준 작업 자료를 그대로 받는지 확인
    assert api.claim("VALIDATE_VIDEO") == payload

# 현재 작업 프로토콜의 직렬화 자료 전송 확인
def test_json_sends_current_worker_protocol() -> None:
    # 본문 없는 성공 응답을 내줄 전송 대역 생성
    opener = Open([Reply(204)])
    # 프로토콜 헤더를 확인할 작업자 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    # 작업 선점 요청을 보내 실제 요청 헤더 생성
    api.json("/api/internal/jobs/claim", {"workerId": "worker-1", "jobType": "ANALYZE_VIDEO"})
    # 대소문자와 무관하게 비교하도록 요청 헤더 이름 정규화
    headers = {key.lower(): value for key, value in opener.requests[0].header_items()}
    # 현재 관측 계약 판본이 작업자 프로토콜 헤더에 실리는지 확인
    assert headers["x-worker-protocol"] == "video-observations-v6"

# 작업 결과 요청 확인
def test_result() -> None:
    # 작업 결과 응답 모형 구성
    opener = Open([Reply(200, b'{"kind":"ACCEPTED"}')])
    # 결과 제출 요청을 기록할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    # 시험 작업을 비교에 사용할 고정 시험 자료로 구성
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    # 검증 완료 결과가 서버의 수락 응답으로 연결되는지 확인
    assert api.result(
        job, {"kind": "VALIDATED", "durationMs": 1000, "width": 320, "height": 180}
    ) == {"kind": "ACCEPTED"}
    # 결과 요청 본문 확인
    request = opener.requests[0]
    # 작업 식별자에 대응하는 결과 제출 주소인지 확인
    assert getattr(request, "full_url") == "http://web.test/api/internal/jobs/job-1/result"
    # 저장된 문자열을 구조화된 자료로 읽음
    body = json.loads(getattr(request, "data").decode())
    # 작업자 식별자가 예상 계약과 일치하는지 확인
    assert body["workerId"] == "worker-1"
    # 작업 개정 번호가 2과 일치하는지 확인
    assert body["jobRevision"] == 2
    # 작업 임대 토큰이 예상 계약과 일치하는지 확인
    assert body["leaseToken"] == "lease"

# 이미 완료된 멱등 응답 수락 확인
def test_result_accepts_idempotent_already_finished_response() -> None:
    # 이미 완료된 작업을 나타내는 충돌 응답 본문 생성
    payload = io.BytesIO(b'{"kind":"ALREADY_FINISHED"}')
    # 본문을 가진 충돌 상태 오류 객체 생성
    error = HTTPError("http://web.test", 409, "finished", {}, payload)
    # 이미 완료된 작업 응답을 돌려줄 통신 대역 연결
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))
    # 시험 작업을 비교에 사용할 고정 시험 자료로 구성
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    # 이미 완료된 작업을 일반 실패 대신 명시적 상태로 반환하는지 확인
    assert api.result(job, {"kind": "VALIDATED"}) == {"kind": "ALREADY_FINISHED"}

# 검증 응답 본문 부재 시 최종 409 보존 확인
def test_result_preserves_terminal_409_when_no_verifiable_body_exists() -> None:
    # 임대 만료를 나타내는 본문 없는 충돌 오류 생성
    error = HTTPError("http://web.test", 409, "stale", {}, None)
    # 임대 만료 오류를 재현할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))
    # 시험 작업을 비교에 사용할 고정 시험 자료로 구성
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    # 검증 응답 본문 부재 시 최종 409 보존을 위한 예상 예외 확인
    with pytest.raises(HttpError, match="http-409"):
        # 만료된 임대의 결과 제출에서 오류 전달 확인
        api.result(job, {"kind": "VALIDATED"})

# 재실행으로 바뀌지 않는 400 거부의 결정적 거부 예외 확인
@pytest.mark.parametrize(
    "body",
    [
        {"kind": "INVALID_RESULT", "reason": "SOURCE"},
        {"kind": "INVALID_RESULT", "reason": "ARTIFACT"},
        {"kind": "INVALID_RESULT", "reason": "REFERENCE"},
        {"kind": "INVALID_RESULT", "reason": "CONTEXT"},
        {"kind": "INVALID_INPUT", "reason": "PAYLOAD"},
        {"kind": "INVALID_REQUEST"},
    ],
)
def test_result_names_deterministic_rejections(body: dict[str, str]) -> None:
    # 거부 본문을 가진 요청 오류 객체 생성
    error = HTTPError("http://web.test", 400, "rejected", {}, io.BytesIO(json.dumps(body).encode()))
    # 거부 응답을 돌려줄 통신 대역 연결
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))

    # 거부 종류와 사유 부호가 결정적 거부 예외에 실리는지 확인
    with pytest.raises(Rejection, match=f"kind={body['kind']}"):
        # 결과 제출 경로 실행
        api.result({"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}, {"kind": "VALIDATED"})

# 저장소와 검증 기능의 일시 400 거부 재실행 경로 보존 확인
@pytest.mark.parametrize("reason", ["STORAGE", "VERIFICATION_UNAVAILABLE"])
def test_result_keeps_transient_rejections_retryable(reason: str) -> None:
    # 일시 거부 본문을 가진 요청 오류 객체 생성
    body = json.dumps({"kind": "INVALID_RESULT", "reason": reason}).encode()
    # 일시 거부 응답을 돌려줄 통신 대역 연결
    api = Api(
        "http://web.test", "secret", "worker-1",
        opener=Open([HTTPError("http://web.test", 400, "rejected", {}, io.BytesIO(body))]),
    )

    # 결정적 거부가 아닌 기존 상태 오류로 전달되는지 확인
    with pytest.raises(HttpError, match="http-400") as caught:
        # 결과 제출 경로 실행
        api.result({"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}, {"kind": "VALIDATED"})
    # 일시 거부가 결정적 거부로 분류되지 않았는지 확인
    assert not isinstance(caught.value, Rejection)

# 예상 밖 성공 응답 거부 확인
def test_result_rejects_unexpected_success_payload() -> None:
    # 거부 응답을 반환할 통신 객체 생성
    api = Api(
        "http://web.test", "secret", "worker-1", opener=Open([Reply(200, b'{"kind":"OTHER"}')])
    )
    # 시험 작업을 비교에 사용할 고정 시험 자료로 구성
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    # 예상 밖 성공 응답 거부를 위한 예상 예외 확인
    with pytest.raises(HttpError, match="result-response-invalid"):
        # 서버 거부 상태를 결과 제출 경로에서 실행
        api.result(job, {"kind": "VALIDATED"})

# 원본 영상 수신 확인
def test_media(tmp_path: Path) -> None:
    # 원본 다운로드 응답 모형 구성
    opener = Open([Reply(200, b"video-bytes")])
    # 미디어 다운로드 응답을 제공할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    # 내려받은 원본을 저장할 임시 파일 경로 구성
    target = tmp_path / "source.mp4"

    # 원본 영상 저장
    api.media("http://storage/video", target)

    # 다운로드한 파일 바이트가 응답 본문과 같은지 확인
    assert target.read_bytes() == b"video-bytes"

# 웹 통신 오류 상태 확인
def test_error() -> None:
    # 인증 실패 응답 모형 구성
    error = HTTPError("http://web.test", 401, "unauthorized", {}, None)
    # 선점 요청 오류를 주입하는 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))

    # 웹 통신 오류 상태를 위한 예상 예외 확인
    with pytest.raises(HttpError, match="http-401"):
        # 선점 실패가 호출자에게 전달되는 경로 실행
        api.claim("VALIDATE_VIDEO")

# 시험 작업 식별자와 임대 자료
JOB = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

# 진행 보고 일시 장애의 같은 본문 재전송 확인
def test_progress_retries_transient_status_with_same_body() -> None:
    # 일시 장애 뒤 성공하는 전송 대역 생성
    opener = Open([HTTPError("http://web.test", 503, "busy", {}, None), Reply(204)])
    # 재시도 대기 기록 목록 준비
    sleeps: list[float] = []
    # 흔들림 값을 고정한 작업자 통신 객체 생성
    api = Api(
        "http://web.test", "secret", "worker-1",
        opener=opener, sleep=sleeps.append, jitter=lambda: 0.5,
    )

    # 두 번째 시도의 빈 성공 응답 반환 확인
    assert api.progress(JOB, "SEGMENTING", 40) is None
    # 같은 요청을 두 번 보냈는지 확인
    assert len(opener.requests) == 2
    # 두 시도의 요청 본문이 같은지 확인
    assert opener.bodies[0] == opener.bodies[1]
    # 첫 재시도 대기가 기준 0.5초의 흔들림 값인지 확인
    assert sleeps == [0.25]

# 결과 응답 유실 뒤 이미 완료 응답 수락 확인
def test_result_retries_lost_response_until_already_finished() -> None:
    # 이미 완료된 작업을 나타내는 충돌 응답 본문 생성
    finished = io.BytesIO(b'{"kind":"ALREADY_FINISHED"}')
    # 응답 수신 시간 초과 뒤 이미 완료 응답을 내줄 전송 대역 생성
    opener = Open([
        TimeoutError("timed out"),
        HTTPError("http://web.test", 409, "done", {}, finished),
    ])
    # 재시도 대기 기록 목록 준비
    sleeps: list[float] = []
    # 첫 시도가 30초 걸린 시계를 쓰는 작업자 통신 객체 생성
    api = Api(
        "http://web.test", "secret", "worker-1",
        opener=opener, sleep=sleeps.append, jitter=lambda: 0.0, clock=iter([0.0, 30.0]).__next__,
    )

    # 먼저 처리된 결과를 이미 완료 상태로 수락하는지 확인
    assert api.result(JOB, {"kind": "VALIDATED"}) == {"kind": "ALREADY_FINISHED"}
    # 같은 결과를 두 번 보냈는지 확인
    assert opener.bodies[0] == opener.bodies[1]
    # 흔들림 0의 재시도 대기 확인
    assert sleeps == [0.0]

# 임대 갱신 시간 상한을 넘긴 진행 보고의 재시도 중단 확인
def test_progress_stops_retrying_after_lease_window() -> None:
    # 시간 초과 뒤 성공 응답이 남은 전송 대역 생성
    opener = Open([TimeoutError("timed out"), Reply(204)])
    # 재시도 대기 기록 목록 준비
    sleeps: list[float] = []
    # 첫 시도가 25초 걸린 시계를 쓰는 작업자 통신 객체 생성
    api = Api(
        "http://web.test", "secret", "worker-1",
        opener=opener, sleep=sleeps.append, jitter=lambda: 0.0, clock=iter([0.0, 25.0]).__next__,
    )

    # 임대 기한을 넘긴 재시도 대신 연결 불가 오류 전달 확인
    with pytest.raises(Transient, match="http-unavailable"):
        # 진행 보고 실행
        api.progress(JOB, "SEGMENTING", 40)
    # 한 번만 보냈고 대기하지 않았는지 확인
    assert (len(opener.requests), sleeps) == (1, [])

# 시도 횟수 상한 뒤 마지막 일시 장애 전달 확인
def test_retry_gives_up_after_attempt_limit() -> None:
    # 계속 일시 장애를 내는 전송 대역 생성
    opener = Open([HTTPError("http://web.test", 503, "busy", {}, None) for _ in range(3)])
    # 재시도 대기 기록 목록 준비
    sleeps: list[float] = []
    # 최대 흔들림 값을 쓰는 작업자 통신 객체 생성
    api = Api(
        "http://web.test", "secret", "worker-1",
        opener=opener, sleep=sleeps.append, jitter=lambda: 1.0,
    )

    # 세 번째 실패의 상태 오류 전달 확인
    with pytest.raises(Transient, match="http-503"):
        # 증거 업로드 권한 요청 실행
        api.evidence(JOB, [])
    # 세 번 보내고 지수 증가 대기를 두 번 했는지 확인
    assert (len(opener.requests), sleeps) == (3, [0.5, 1.0])

# 서버 재시도 대기 요구의 상한 안 수용과 상한 밖 중단 확인
def test_retry_honours_short_retry_after_only() -> None:
    # 2초 대기를 요구한 뒤 성공하는 전송 대역 생성
    short = Open([
        HTTPError("http://web.test", 429, "slow", {"retry-after": "2"}, None),
        Reply(204),
    ])
    # 30초 대기를 요구하는 전송 대역 생성
    long = Open([HTTPError("http://web.test", 503, "busy", {"retry-after": "30"}, None)])
    # 재시도 대기 기록 목록 준비
    sleeps: list[float] = []

    # 짧은 서버 대기 요구를 따른 재시도 성공 확인
    assert Api("http://web.test", "secret", "worker-1", opener=short, sleep=sleeps.append).progress(
        JOB, "SEGMENTING", 40
    ) is None
    # 긴 서버 대기 요구의 즉시 오류 전달 확인
    with pytest.raises(Transient, match="http-503"):
        # 진행 보고 실행
        Api("http://web.test", "secret", "worker-1", opener=long, sleep=sleeps.append).progress(
            JOB, "SEGMENTING", 40
        )
    # 서버가 요구한 2초만 기다렸는지 확인
    assert sleeps == [2.0]

# 멱등 보장이 없는 작업 선점의 재시도 금지 확인
def test_claim_is_not_retried() -> None:
    # 일시 장애 뒤 성공 응답이 남은 전송 대역 생성
    opener = Open([HTTPError("http://web.test", 503, "busy", {}, None), Reply(204)])
    # 선점 요청을 기록할 작업자 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener, sleep=lambda _: None)

    # 선점 일시 장애의 즉시 전달 확인
    with pytest.raises(HttpError, match="http-503"):
        # 작업 선점 실행
        api.claim("VALIDATE_VIDEO")
    # 한 번만 보냈는지 확인
    assert len(opener.requests) == 1

# 응답 수신 중 시간 초과의 연결 불가 오류 변환 확인
def test_raw_timeout_is_reported_as_unavailable() -> None:
    # 응답 수신 시간 초과를 내는 전송 대역 생성
    api = Api("http://web.test", "secret", "worker-1", opener=Open([TimeoutError("timed out")]))

    # 원시 시간 초과 대신 기존 연결 불가 오류 문자열 전달 확인
    with pytest.raises(HttpError, match="http-unavailable"):
        # 작업 선점 실행
        api.claim("VALIDATE_VIDEO")

# 원본 다운로드 일시 장애의 처음부터 재수신 확인
def test_media_retries_transient_download_failure(tmp_path: Path) -> None:
    # 저장소 일시 장애 뒤 원본을 내주는 전송 대역 생성
    opener = Open([HTTPError("http://storage/video", 503, "busy", {}, None), Reply(200, b"video")])
    # 대기 없이 재시도하는 작업자 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener, sleep=lambda _: None)
    # 내려받은 원본을 저장할 임시 파일 경로 구성
    target = tmp_path / "source.mp4"

    # 원본 영상 저장
    api.media("http://storage/video", target)

    # 두 번째 시도의 원본 바이트 저장 확인
    assert (len(opener.requests), target.read_bytes()) == (2, b"video")

# 증거 업로드 요청 확인
@pytest.mark.parametrize("content_type", ["image/jpeg", "video/mp4"])
def test_immutable_media_put_forwards_checksum_and_first_write_headers(
    tmp_path: Path, content_type: str
) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "media"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"media")
    # 저장소의 성공 응답을 제공할 전송 대역 생성
    opener = Open([Reply(200)])
    # 업로드 헤더를 기록할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    # 요청 머리말을 비교에 사용할 고정 시험 자료로 구성
    headers = {"x-amz-checksum-sha256": "a" * 43 + "=", "if-none-match": "*"}
    # 서버가 발급한 조건부 헤더로 증거 파일 업로드
    api.put("http://storage/media", source, content_type, headers)
    # 실제로 보낸 헤더 이름을 비교용으로 정규화
    sent = {key.lower(): value for key, value in opener.requests[0].header_items()}
    # 발급된 내용 지문 검증 헤더가 변경 없이 전달되는지 확인
    assert sent["x-amz-checksum-sha256"] == headers["x-amz-checksum-sha256"]
    # 기존 객체를 덮어쓰지 않는 최초 기록 조건 확인
    assert sent["if-none-match"] == "*"
    # 증거 파일의 미디어 형식이 요청에 실리는지 확인
    assert sent["content-type"] == content_type
    # 내부 작업자 인증 키가 외부 저장소로 유출되지 않는지 확인
    assert "x-worker-key" not in sent

# 실제 웹 통신 클라이언트의 불변 미디어 전송 확인
def test_artifacts_use_the_real_http_client_for_immutable_media(tmp_path: Path) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "frame.jpg"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"frame")
    # 시험 이미지 바이트에서 정상 업로드 지문 계산
    sha256 = hashlib.sha256(b"frame").hexdigest()
    # 요청 머리말을 비교에 사용할 고정 시험 자료로 구성
    headers = {
        "x-amz-checksum-sha256": base64.b64encode(bytes.fromhex(sha256)).decode("ascii"),
        "if-none-match": "*",
    }
    # 시험 작업을 비교에 사용할 고정 시험 자료로 구성
    job = {"jobId": "job-1", "analysisId": "analysis-1", "jobRevision": 2, "leaseToken": "lease"}
    # 불변 체크섬과 최초 기록 조건이 있는 권한 응답 준비
    grant = {
        "kind": "GRANTED",
        "items": [
            {
                "name": "frame.jpg",
                "objectKey": f"evidence/analysis-1/job-1/2/{sha256}/frame.jpg",
                "uploadUrl": "http://storage/frame.jpg",
                "headers": headers,
            }
        ],
    }
    # 권한 발급과 저장소 업로드의 순차 응답 구성
    opener = Open([Reply(200, json.dumps(grant).encode()), Reply(200)])
    # 권한 발급부터 업로드까지 기록할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    # 증거 파일의 경로와 지문을 검증한 뒤 업로드 권한 요청 및 전송
    result = artifacts(
        api,
        job,
        tmp_path,
        [
            {
                "path": "frame.jpg",
                "candidate_index": 0,
                "kind": "FRAME",
                "timestamp_ms": 100,
                "start_ms": 100,
                "end_ms": 100,
            }
        ],
    )
    # 파일 내용 지문이 내용 지문과 일치하는지 확인
    assert result[0]["contentSha256"] == sha256
    # 업로드 본문이 실제 이미지 파일 내용과 같은지 확인
    assert opener.bodies[1] == b"frame"
    # 이미지 업로드가 파일 스트림을 사용하는지 확인
    assert opener.streaming[1] is True
    # 권한 요청과 실제 업로드 사이의 체크섬 계약 일치 확인
    assert (
        dict((key.lower(), value) for key, value in opener.requests[1].header_items())[
            "if-none-match"
        ]
        == "*"
    )

# 불완전·무조건부 미디어 헤더 거부 확인
@pytest.mark.parametrize("headers", [
    {"x-amz-checksum-sha256": "checksum"}, {"if-none-match": "*"},
    {"x-amz-checksum-sha256": "checksum", "if-none-match": "not-first-write"},
    {"x-amz-checksum-sha256": "", "if-none-match": "*"},
])
def test_media_put_rejects_incomplete_or_unconditional_headers(
    tmp_path: Path, headers: dict[str, str]
) -> None:
    # 잘못된 헤더 때문에 호출되지 않아야 하는 빈 전송 대역 생성
    opener = Open([])
    # 통신 이전 헤더 검증을 시험할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    # 불완전·무조건부 미디어 헤더 거부를 위한 예상 예외 확인
    with pytest.raises(HttpError, match="evidence-headers-invalid"):
        # 잘못된 권한 헤더를 업로드 진입점에 전달하여 거부 확인
        api.put("http://storage/media", tmp_path / "unused.jpg", "image/jpeg", headers)
    # 요청 이력이 빈 값으로 유지되는지 확인
    assert opener.requests == []

# 증거 처리 확인
def test_evidence(tmp_path: Path) -> None:
    # 증거 권한 응답 모형 구성
    grant = {
        "kind": "GRANTED",
        "items": [
            {
                "name": "candidate-0001.jpg",
                "objectKey": "evidence/analysis/job/candidate-0001.jpg",
                "uploadUrl": "http://storage.test/candidate-0001.jpg",
            }
        ],
    }
    # 증거 권한 응답과 후속 업로드 성공 응답 구성
    opener = Open([Reply(200, json.dumps(grant).encode()), Reply(200)])
    # 작업 범위 권한 요청을 기록할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    # 시험 작업을 비교에 사용할 고정 시험 자료로 구성
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "candidate-0001.jpg"
    # 증거 파일 저장
    source.write_bytes(b"frame")

    # 권한 요청과 파일 업로드 확인
    assert (
        api.evidence(job, [{"name": source.name, "contentType": "image/jpeg", "sizeBytes": 5}])
        == grant
    )
    # 기존 증거 경로의 이미지 업로드 실행
    api.put("http://storage.test/candidate-0001.jpg", source, "image/jpeg")

    # 서버로 보낸 증거 권한 발급 요청 선택
    grant_request = opener.requests[0]
    # 저장소로 보낸 파일 업로드 요청 선택
    put_request = opener.requests[1]
    # 해당 작업의 증거 권한 주소를 호출하는지 확인
    assert getattr(grant_request, "full_url") == "http://web.test/api/internal/jobs/job-1/evidence"
    # 저장소 전송이 파일 업로드 방식인지 확인
    assert getattr(put_request, "method") == "PUT"
    # 실제 업로드 바이트가 시험 파일 내용과 같은지 확인
    assert opener.bodies[1] == b"frame"
    # 파일 전체를 메모리에 올리지 않고 스트림으로 보내는지 확인
    assert opener.streaming[1] is True
    # 저장소 요청 헤더 이름을 비교용으로 정규화
    headers = {key.lower(): value for key, value in put_request.header_items()}
    # 실제 파일 크기인 다섯 바이트가 내용 길이에 실리는지 확인
    assert headers["content-length"] == "5"
    # 이미지 파일 형식 헤더가 맞는지 확인
    assert headers["content-type"] == "image/jpeg"

# 체크섬 결합 헤더만 사용한 압축 스트리밍 전송 확인
def test_put_streams_gzip_with_only_checksum_bound_headers(tmp_path: Path) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "perception.jsonl.gz"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"diagnostic")
    # 비공개 산출물 업로드의 성공 응답 대역 생성
    opener = Open([Reply(200)])
    # 압축 관측 파일을 업로드할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    # 비공개 관측 파일을 발급된 검증 헤더와 함께 업로드
    api.put(
        "http://storage.test/perception",
        source,
        "application/gzip",
        {
            "x-amz-checksum-sha256": "checksum",
            "if-none-match": "*",
        },
    )

    # 요청 이력의 선택 항목을 후속 비교에 사용할 값으로 보관
    request = opener.requests[0]
    # 실제 압축 파일 요청의 헤더 읽음
    headers = {key.lower(): value for key, value in request.header_items()}
    # 압축 산출물도 파일 스트림으로 전송되는지 확인
    assert opener.streaming == [True]
    # 압축 산출물의 전송 내용이 로컬 파일과 같은지 확인
    assert opener.bodies == [b"diagnostic"]
    # 요청 머리말이 예상 계약과 일치하는지 확인
    assert headers == {
        "content-type": "application/gzip",
        "content-length": str(len(b"diagnostic")),
        "x-amz-checksum-sha256": "checksum",
        "if-none-match": "*",
    }

# 네트워크 연결 전 미승인 권한 헤더 거부 확인
@pytest.mark.parametrize("headers", [
    {"authorization": "secret"},
    {"content-type": "application/gzip"},
    {"x-amz-checksum-sha256": "checksum", "if-none-match": "*", "x-extra": "no"},
])
def test_put_rejects_unapproved_grant_headers_before_network(
    tmp_path: Path, headers: dict[str, str]
) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "perception.jsonl.gz"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"diagnostic")
    # 잘못된 산출물 헤더로 통신이 발생하지 않도록 빈 대역 준비
    opener = Open([])
    # 산출물 헤더 사전 검증용 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    # 네트워크 연결 전 미승인 권한 헤더 거부를 위한 예상 예외 확인
    with pytest.raises(HttpError, match="evidence-headers-invalid"):
        # 잘못된 압축 산출물 권한 헤더의 거부 경로 실행
        api.put("http://storage.test/perception", source, "application/gzip", headers)
    # 요청 이력이 빈 값으로 유지되는지 확인
    assert opener.requests == []

# 네트워크 연결 전 크기 초과 업로드 거부 확인
def test_put_rejects_oversize_before_opening_network(tmp_path: Path) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "candidate.mp4"
    # 입력 영상을 닫힘이 보장되는 범위에서 열기
    with source.open("wb") as output:
        # 큰 데이터를 메모리에 만들지 않고 시험 파일 크기 조절
        output.truncate(50 * 1024 * 1024 + 1)
    # 잘못된 업로드 크기로 통신이 발생하지 않도록 빈 대역 준비
    opener = Open([])
    # 증거 파일 크기 사전 검증용 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    # 네트워크 연결 전 크기 초과 업로드 거부를 위한 예상 예외 확인
    with pytest.raises(HttpError, match="evidence-size-invalid"):
        # 허용 크기 조건을 어긴 클립의 업로드 거부 확인
        api.put("http://storage.test/candidate.mp4", source, "video/mp4")
    # 요청 이력이 빈 값으로 유지되는지 확인
    assert opener.requests == []

# 전제 조건 실패의 업로드 실패 처리 확인
def test_put_treats_precondition_failure_as_upload_failure(tmp_path: Path) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "perception.jsonl.gz"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"diagnostic")
    # 최초 기록 조건과 충돌하는 기존 객체 오류 생성
    error = HTTPError("http://storage.test/perception", 412, "exists", {}, None)
    # 기존 객체 충돌을 주입할 통신 객체 생성
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))

    # 전제 조건 실패의 업로드 실패 처리을 위한 예상 예외 확인
    with pytest.raises(HttpError, match="evidence-412"):
        # 조건부 업로드 실패가 상위 처리로 전달되는 경로 실행
        api.put(
            "http://storage.test/perception",
            source,
            "application/gzip",
            {
                "x-amz-checksum-sha256": "checksum",
                "if-none-match": "*",
            },
        )
