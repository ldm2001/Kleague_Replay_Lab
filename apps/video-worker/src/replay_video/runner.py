from __future__ import annotations
import os
import json
import hashlib
import base64
import stat
import tempfile
import threading
import time
import logging
import re
from pathlib import Path
from typing import Callable, Mapping, Protocol
from .http import Api, HttpError
from .worker import job
from .domain.models import AV_OBSERVER_PIPELINE_VERSION, LOCAL_OBSERVER_PIPELINE_VERSION

# 작업 선점·임대·제출 실패를 기록할 실행 모듈 로그 생성
logger = logging.getLogger(__name__)


class PulseStopped(RuntimeError):
    # 작업 임대 확인 불가 시 중단
    pass

# 영상 작업 호출 규약 계약
class WorkerApi(Protocol):

    # 서버 지정 작업 선점
    def claim(self, kind: str) -> dict[str, object] | None: ...

    # 원본 영상 파일을 지정한 로컬 경로로 내려받음
    def media(self, url: str, target: Path) -> None: ...

    # 현재 단계와 처리량을 진행 상태 수신자에게 전달
    def progress(
        self,
        item: dict[str, object],
        stage: str,
        percent: int,
        message: str | None = None,
    ) -> dict[str, object] | None: ...

    # 현재 작업의 내부 호출 규약로 결과 제출
    def result(
        self, item: dict[str, object], payload: dict[str, object]
    ) -> dict[str, object] | None: ...

    # 후보 구간 증거 프레임·클립 확보
    def evidence(
        self, item: dict[str, object], entries: list[dict[str, object]]
    ) -> dict[str, object] | None: ...

    # 업로드 권한·체크섬 기반 증거 전송
    def put(
        self,
        url: str,
        source: Path,
        content_type: str,
        headers: Mapping[str, str] | None = None,
    ) -> None: ...


# 한 번에 발급받을 증거 업로드 권한 개수 상한 정의
MAX_GRANT_ITEMS = 128
# 증거 미디어 한 파일의 최대 업로드 크기 정의
MAX_MEDIA_BYTES = 50 * 1024 * 1024
# 비공개 관측 압축 파일의 최대 업로드 크기 정의
MAX_DIAGNOSTIC_BYTES = 128 * 1024 * 1024
# 한 권한 요청 묶음의 총 파일 크기 상한 정의
MAX_GRANT_BYTES = 200 * 1024 * 1024
# 작업과 분석 식별자의 허용 형식을 검사할 정규식 정의
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")

# 전체 메모리 적재 없는 산출물 해시 계산
def digest(path: Path) -> str:
    # 파일 내용 해시의 누적 계산기 생성
    value = hashlib.sha256()
    # 증거 파일을 변환 없이 바이트로 읽음
    with path.open("rb") as source:
        # 파일 전체를 메모리에 담지 않고 일정 크기씩 읽음
        while chunk := source.read(1024 * 1024):
            # 현재 바이트 묶음을 파일 해시에 누적
            value.update(chunk)
    # 파일 내용에 대응하는 해시 문자열 반환
    return value.hexdigest()

# 작업 결과 폴더 안의 일반 파일만 선택
def localFile(root: Path, value: object, error: str) -> Path:
    # 증거 경로가 비어 있지 않은 문자열인지 확인
    if not isinstance(value, str) or not value:
        # 없거나 잘못된 로컬 증거 경로 입력 거부
        raise RuntimeError(error)
    # 증거 보고서의 상대 경로를 경로 객체로 변환
    relative = Path(value)
    # 보고서가 임의 절대 경로를 참조하는지 확인
    if relative.is_absolute():
        # 작업 경계와 무관한 절대 경로 입력 거부
        raise RuntimeError(error)
    # 작업 출력 디렉터리의 실제 경계 계산
    base = root.resolve()
    try:
        # 실제로 존재하는 증거의 링크와 상대 경로 해석
        path = (base / relative).resolve(strict=True)
        # 디렉터리나 장치 파일을 구분할 파일 종류 읽음
        mode = path.stat().st_mode
    # 근거 경로 접근 실패를 업로드 검증 오류로 변환
    except OSError as cause:
        # 원래 파일 오류를 보존하여 잘못된 증거 경로 알림
        raise RuntimeError(error) from cause
    # 출력 경계 내부의 일반 파일만 업로드 대상으로 허용
    if not path.is_relative_to(base) or not stat.S_ISREG(mode):
        # 경계 밖 파일 또는 일반 파일이 아닌 업로드 대상 거부
        raise RuntimeError(error)
    # 검증된 증거 파일의 실제 경로 반환
    return path

# 요청 이름별 권한 응답 대조
def grants(response: object, names: list[str], error: str) -> dict[str, dict[str, object]]:
    # 서버 응답이 실제 권한 발급과 파일 목록을 포함하는지 확인
    if (
        not isinstance(response, dict)
        or response.get("kind") != "GRANTED"
        or not isinstance(response.get("items"), list)
    ):
        # 업로드 권한 발급 계약과 맞지 않는 응답 거부
        raise RuntimeError(error)
    # 서버가 발급한 파일별 업로드 권한 목록 읽음
    items = response["items"]
    # 요청 파일 수와 발급 권한 수 일치 여부 확인
    if len(items) != len(names):
        # 요청 수와 다른 개수의 업로드 권한 거부
        raise RuntimeError(error)
    # 파일 이름별 검증된 업로드 권한 조회표 생성
    result: dict[str, dict[str, object]] = {}
    # 각 업로드 권한의 대상과 주소 확인
    for grant in items:
        # 권한 항목이 예상한 자료 구조인지 확인
        if not isinstance(grant, dict):
            # 사전 구조가 아닌 개별 업로드 권한 거부
            raise RuntimeError(error)
        # 서버가 권한을 발급한 파일 이름 읽음
        name = grant.get("name")
        # 미요청 파일 또는 중복 발급된 파일 이름인지 확인
        if not isinstance(name, str) or name not in names or name in result:
            # 요청하지 않았거나 중복된 파일 권한 거부
            raise RuntimeError(error)
        # 업로드 주소와 저장소 객체 키 읽음
        upload_url, object_key = grant.get("uploadUrl"), grant.get("objectKey")
        # 업로드 주소와 객체 키가 비어 있지 않은 문자열인지 확인
        if (
            not isinstance(upload_url, str)
            or not upload_url
            or not isinstance(object_key, str)
            or not object_key
        ):
            # 업로드 위치가 없는 파일 권한 거부
            raise RuntimeError(error)
        # 검사한 파일별 권한을 조회표에 보존
        result[name] = grant
    # 요청한 모든 파일에 빠짐없이 권한이 대응되는지 확인
    if set(result) != set(names):
        # 일부 요청 파일이 빠진 권한 목록 거부
        raise RuntimeError(error)
    # 검증된 파일별 업로드 권한 조회표 반환
    return result

# 증거 권한 상실 시 일반 실패 제출 금지
def evidenceGrants(
    api: WorkerApi,
    item: dict[str, object],
    requests: list[dict[str, object]],
    error: str,
) -> dict[str, dict[str, object]]:
    try:
        # 현재 작업 임대에 묶인 증거 업로드 권한 요청
        response = api.evidence(item, requests)
    # 권한 발급 실패가 작업 임대 상실인지 구별
    except HttpError as cause:
        # 작업 없음 또는 임대 충돌을 나타내는 응답인지 확인
        if str(cause) in {"http-404", "http-409"}:
            # 임대 없는 작업의 일반 실패 제출까지 막도록 중단 신호 전달
            raise PulseStopped("WORKER_LEASE_LOST") from cause
        # 임대 상실 외 통신 오류는 원래 실패로 재전달
        raise
    # 구조화 응답에서도 작업 없음·임대 만료·종료 상태 확인
    if isinstance(response, dict) and response.get("kind") in {
        "NOT_FOUND",
        "STALE_LEASE",
        "ALREADY_FINISHED",
    }:
        # 작업 권한이 사라진 상태로 결과를 제출하지 않도록 중단
        raise PulseStopped("WORKER_LEASE_LOST")
    # 요청한 파일 이름과 발급된 권한의 일대일 대응 검증 후 반환
    return grants(response, [str(request["name"]) for request in requests], error)


# 작업 임대 갱신
class Pulse:

    # 초기 상태·입력 계약 구성
    def __init__(
        self, api: WorkerApi, item: dict[str, object], stage: str, interval: float = 10.0
    ) -> None:
        # 호출 규약와 작업 정보 저장
        self.api = api
        # 선점한 작업 식별자와 임대 정보를 보존
        self.item = item
        # 갱신 알림에 보낼 현재 작업 단계 보존
        self.stage = stage
        # 작업 시작 시 기본 진행률 초기화
        self.percent = 10
        # 임대를 갱신할 반복 시간 간격 보존
        self.interval = interval
        # 백그라운드 임대 갱신 종료 신호 생성
        self.stop = threading.Event()
        # 임대 상태의 동시 읽기·쓰기를 보호할 잠금 생성
        self.state_lock = threading.Lock()
        # 단계 보고와 주기 갱신 요청 순서를 직렬화할 잠금 생성
        self.request_lock = threading.Lock()
        # 아직 임대 갱신 실패가 없음을 기록
        self.failure: str | None = None
        # 현재 임대 소유권 확인 상태 해제
        self.confirmed = False
        # 최종 결과 수락 전 상태 초기화
        self.accepted = False
        # 주기적으로 임대를 갱신할 백그라운드 실행 생성
        self.thread = threading.Thread(target=self.beat, daemon=True)

    # 갱신 실패의 작업 임대 상실·연결 실패 구분 보관
    def failed(self, error: object, code: str = "WORKER_HEARTBEAT_FAILED") -> None:
        # 통신 오류 중 작업 소유권이 끝난 응답인지 판별
        terminal = (isinstance(error, HttpError) and str(error) in {"http-404", "http-409"}) or (
            isinstance(error, dict)
            and error.get("kind") in {"NOT_FOUND", "STALE_LEASE", "ALREADY_FINISHED"}
        )
        # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
        with self.state_lock:
            # 최종 수락 또는 이미 기록된 실패를 후속 응답으로 덮지 않음
            if self.accepted or self.failure is not None:
                # 수락 완료 또는 먼저 확정된 실패 상태를 유지하고 종료
                return
            # 임대 상실과 기타 요청 실패를 구별해 기록
            self.failure = "WORKER_LEASE_LOST" if terminal else code
            # 현재 임대 소유권 확인 상태 해제
            self.confirmed = False
            # 주기 임대 갱신의 후속 실행 중단 요청
            self.stop.set()

    # 진행 응답의 실제 작업 임대 갱신 확인
    def renewal(self, stage: str, percent: int, message: str | None) -> None:
        # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
        with self.state_lock:
            # 최종 수락·실패·종료 요청 뒤 불필요한 갱신을 막을 조건 확인
            if (
                self.accepted
                or self.failure is not None
                or (message == "worker-heartbeat" and self.stop.is_set())
            ):
                # 새 임대 갱신이 허용되지 않는 상태에서 요청 없이 종료
                return
        try:
            # 현재 단계 보고와 함께 서버에 작업 임대 갱신 요청
            response = self.api.progress(self.item, stage, percent, message)
        except Exception as error:
            # 갱신 예외가 서버의 작업 없음 또는 임대 충돌인지 판별
            terminal = isinstance(error, HttpError) and str(error) in {"http-404", "http-409"}
            # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
            with self.state_lock:
                # 최종 수락 또는 이미 기록된 실패를 후속 응답으로 덮지 않음
                if self.accepted or self.failure is not None:
                    # 먼저 확정된 결과 수락 또는 실패를 보존하고 종료
                    return
                # 소유권 상실과 갱신 통신 실패를 서로 다른 코드로 보존
                self.failure = "WORKER_LEASE_LOST" if terminal else "WORKER_HEARTBEAT_FAILED"
                # 현재 임대 소유권 확인 상태 해제
                self.confirmed = False
                # 주기 임대 갱신의 후속 실행 중단 요청
                self.stop.set()
            # 민감한 요청 내용 대신 갱신 오류의 종류만 로그 기록
            logger.warning("heartbeat-failed type=%s", type(error).__name__)
            # 갱신 실패 기록 후 현재 갱신 처리 종료
            return
        # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
        with self.state_lock:
            # 최종 수락 또는 이미 기록된 실패를 후속 응답으로 덮지 않음
            if self.accepted or self.failure is not None:
                # 다른 실행이 먼저 확정한 임대 상태를 덮지 않고 종료
                return
            # 서버가 실제 갱신 완료를 확인했는지 검사
            if not isinstance(response, dict) or response.get("kind") != "UPDATED":
                # 작업 종료·없음·만료 응답을 임대 상실로 구분
                terminal = isinstance(response, dict) and response.get("kind") in {
                    "NOT_FOUND",
                    "STALE_LEASE",
                    "ALREADY_FINISHED",
                }
                # 소유권 상실과 갱신 통신 실패를 서로 다른 코드로 보존
                self.failure = "WORKER_LEASE_LOST" if terminal else "WORKER_HEARTBEAT_FAILED"
                # 현재 임대 소유권 확인 상태 해제
                self.confirmed = False
                # 주기 임대 갱신의 후속 실행 중단 요청
                self.stop.set()
                # 갱신 미확인 상태를 기록한 뒤 현재 처리 종료
                return
            # 서버가 갱신한 현재 작업 소유권 확인 상태 기록
            self.confirmed = True

    # 갱신 요청의 서버 저장 순서 직렬화
    def leaseRenewal(self, stage: str, percent: int, message: str | None) -> None:
        # 진행 단계 갱신과 주기 임대 요청의 전송 순서 보호
        with self.request_lock:
            # 현재 단계와 진행률을 서버 임대 갱신으로 전달
            self.renewal(stage, percent, message)

    # 처리 경계의 비동기 상태 갱신 실패 전달
    def check(self) -> None:
        # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
        with self.state_lock:
            # 잠금으로 보호된 임대 실패 상태 읽음
            failure = self.failure
        # 처리 계속을 막아야 할 임대 실패 존재 여부 확인
        if failure is not None:
            # 영상 처리 경계에서 임대 실패를 중단 신호로 전달
            raise PulseStopped(failure)

    # 실패 결과 제출 가능한 작업 임대 확인
    def ownership(self) -> bool:
        # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
        with self.state_lock:
            # 확인된 임대가 유지되고 결과 수락 전인 경우만 소유권 반환
            return self.confirmed and self.failure is None and not self.accepted

    # 최신 진행 상태 보고
    def progress(self, stage: str, percent: int, message: str | None = None) -> None:
        # 상태 갱신과 단계 보고 완료 순서의 별도 잠금 보장
        with self.request_lock:
            # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
            with self.state_lock:
                # 갱신 알림에 보낼 현재 작업 단계 보존
                self.stage = stage
                # 다음 주기 갱신에 사용할 최신 진행률 보존
                self.percent = percent
            # 현재 단계와 진행률을 서버 임대 갱신으로 전달
            self.renewal(stage, percent, message)
        # 임대 확인 실패가 생겼으면 후속 작업 중단
        self.check()

    # 갱신 반복
    def beat(self) -> None:
        # 종료 신호를 기다리면서 주기마다 임대 갱신 실행
        while not self.stop.wait(self.interval):
            # 진행 단계 갱신과 주기 임대 요청의 전송 순서 보호
            with self.request_lock:
                # 백그라운드 갱신과 공유하는 임대 상태를 잠금 안에서 접근
                with self.state_lock:
                    # 최신 처리 단계와 진행률을 일관된 상태로 읽음
                    stage, percent = self.stage, self.percent
                # 최근 진행 상태로 백그라운드 임대 유지 요청
                self.renewal(stage, percent, "worker-heartbeat")

    # 갱신 시작
    def __enter__(self) -> Pulse:
        # 영상 처리 시작 전에 최초 임대를 서버에서 확인
        self.leaseRenewal(self.stage, 10, "worker-started")
        # 임대 확인 실패가 생겼으면 후속 작업 중단
        self.check()
        # 최초 임대 확인 후 백그라운드 갱신 시작
        self.thread.start()
        # 임대 관리 중인 작업 문맥 반환
        return self

    # 상태 갱신 잠금 공유 없이 최종 결과 제출
    def submission(self, payload: dict[str, object]) -> None:
        # 임대 확인 실패가 생겼으면 후속 작업 중단
        self.check()
        try:
            # 선점한 작업의 최종 결과를 서버에 제출
            response = self.api.result(self.item, payload)
        except Exception as error:
            # 결과 제출 예외를 기록하고 임대 갱신 중단
            self.failed(error, "WORKER_RESULT_FAILED")
            # 임대 확인 실패가 생겼으면 후속 작업 중단
            self.check()
            # 결과 제출의 원래 예외를 호출자에게 재전달
            raise
        # 서버가 결과 수락 또는 이미 종료된 작업으로 응답했는지 확인
        if not isinstance(response, dict) or response.get("kind") not in {
            "ACCEPTED",
            "ALREADY_FINISHED",
        }:
            # 결과를 수락하지 않은 서버 응답을 제출 실패로 기록
            self.failed(response, "WORKER_RESULT_FAILED")
            # 임대 확인 실패가 생겼으면 후속 작업 중단
            self.check()
        # 결과 수락 시 동시 상태 갱신의 409보다 최종 결과 우선
        with self.state_lock:
            # 서버가 최종 결과를 수락한 사실 보존
            self.accepted = True
            # 현재 임대 소유권 확인 상태 해제
            self.confirmed = False
            # 최종 결과 수락 뒤 불필요해진 동시 갱신 오류 해제
            self.failure = None
            # 주기 임대 갱신의 후속 실행 중단 요청
            self.stop.set()

    # 갱신 종료
    def __exit__(self, *_args: object) -> None:
        # 주기 임대 갱신의 후속 실행 중단 요청
        self.stop.set()
        # 종료 신호를 받은 갱신 실행을 제한된 시간 동안 정리
        self.thread.join(timeout=1)

# 증거 파일 업로드
def artifacts(
    api: WorkerApi,
    item: dict[str, object],
    root: Path,
    entries: list[dict[str, object]],
    check_cancelled: Callable[[], None] | None = None,
) -> list[dict[str, object]]:
    # 전체 입력 선검증으로 일부 업로드 방지
    files: list[tuple[Path, str, dict[str, object], int, str]] = []
    # 저장소 객체 충돌을 막기 위한 파일 이름 집합 생성
    names: set[str] = set()
    # 증거 입력 순회
    for entry in entries:
        # 작업 폴더 안의 경로 확인
        path = localFile(root, entry.get("path"), "evidence-path-invalid")
        # 대소문자 차이 없이 미디어 확장자 확인
        suffix = path.suffix.lower()
        # 정지 프레임 이미지 형식인지 확인
        if suffix in {".jpg", ".jpeg"}:
            # 이미지 전송 형식과 보고서 증거 종류 대응
            content_type, expected_kind = "image/jpeg", "FRAME"
        # 영상 클립 형식인지 확인
        elif suffix == ".mp4":
            # 영상 전송 형식과 보고서 증거 종류 대응
            content_type, expected_kind = "video/mp4", "CLIP"
        else:
            # 지원하지 않는 증거 파일 형식 거부
            raise RuntimeError("evidence-type-invalid")
        # 확장자와 보고서의 프레임·클립 종류 일치 확인
        if entry.get("kind") != expected_kind:
            # 미디어 형식과 맞지 않는 증거 종류 거부
            raise RuntimeError("evidence-kind-invalid")
        # 같은 이름으로 업로드할 증거 중복 확인
        if path.name in names:
            # 저장소 권한 대응이 모호한 중복 파일 이름 거부
            raise RuntimeError("evidence-name-duplicate")
        # 검사한 증거 이름을 중복 방지 집합에 보존
        names.add(path.name)
        # 실제 업로드할 증거 파일의 바이트 크기 읽음
        size = path.stat().st_size
        # 빈 파일 또는 미디어 용량 상한 초과 여부 확인
        if size <= 0 or size > MAX_MEDIA_BYTES:
            # 허용하지 않는 크기의 미디어 증거 거부
            raise RuntimeError("evidence-size-invalid")
        # 검증한 파일 정보와 내용 해시를 업로드 계획에 보존
        files.append((path, content_type, entry, size, digest(path)))
    # 업로드할 검증된 증거가 없는지 확인
    if not files:
        # 증거가 없으면 빈 결과 반환
        return []
    # 서버 제출에 사용할 업로드 완료 증거 목록 생성
    result: list[dict[str, object]] = []
    # 서버 제한 안에서 순서를 보존한 권한 묶음을 생성
    batches: list[list[tuple[Path, str, dict[str, object], int, str]]] = []
    # 현재 권한 요청 묶음의 파일 목록 생성
    batch: list[tuple[Path, str, dict[str, object], int, str]] = []
    # 현재 업로드 권한 묶음의 총 크기 초기화
    total = 0
    # 증거 순서를 유지하면서 권한 요청 크기 분할
    for source in files:
        # 다음 파일을 넣으면 개수 또는 총용량 상한을 넘는지 확인
        if batch and (len(batch) == MAX_GRANT_ITEMS or total + source[3] > MAX_GRANT_BYTES):
            # 완성된 권한 요청 묶음을 순서대로 보존
            batches.append(batch)
            # 다음 권한 요청 묶음과 누적 크기 초기화
            batch, total = [], 0
        # 현재 권한 묶음에 검증된 파일 추가
        batch.append(source)
        # 현재 묶음의 총 업로드 크기 증가
        total += source[3]
    # 마지막으로 남은 권한 요청 묶음 존재 여부 확인
    if batch:
        # 완성된 권한 요청 묶음을 순서대로 보존
        batches.append(batch)
    # 개수와 용량 상한 안의 묶음별 업로드 실행
    for batch in batches:
        # 업로드 경계에서 취소 검사 함수 존재 여부 확인
        if check_cancelled:
            # 임대 상실 또는 취소된 작업의 후속 업로드 중단
            check_cancelled()
        # 파일별 이름·형식·크기·해시를 권한 요청 자료로 구성
        requests = [
            {
                "name": path.name,
                "contentType": content_type,
                "sizeBytes": size,
                "contentSha256": sha256,
            }
            for path, content_type, _entry, size, sha256 in batch
        ]
        # 현재 작업 소유권으로 미디어 업로드 권한 발급
        granted = evidenceGrants(api, item, requests, "evidence-grant-invalid")
        # 업로드 전 전체 권한의 원본 해시·작업 판본·조건부 최초 기록 확인
        for path, _content_type, _entry, _size, sha256 in batch:
            # 현재 파일 이름에 정확히 대응하는 서버 권한 읽음
            grant = granted[path.name]
            # 내용 해시를 저장소 체크섬 헤더 형식으로 변환
            checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
            # 분석·작업·판본·해시·파일 이름에 한정된 기대 저장소 경로 구성
            expected_key = f"evidence/{item.get('analysisId')}/{item.get('jobId')}/{item.get('jobRevision')}/{sha256}/{path.name}"
            # 서버 권한의 객체 키와 체크섬·최초 쓰기 조건이 정확히 맞는지 확인
            if grant.get("objectKey") != expected_key or grant.get("headers") != {
                "x-amz-checksum-sha256": checksum,
                "if-none-match": "*",
            }:
                # 작업·판본·체크섬·최초 쓰기 조건과 맞지 않는 권한 거부
                raise RuntimeError("evidence-grant-invalid")
        # 전체 권한 검증을 통과한 묶음만 실제 업로드
        for path, content_type, entry, _size, sha256 in batch:
            # 현재 파일 이름에 정확히 대응하는 서버 권한 읽음
            grant = granted[path.name]
            # 업로드 경계에서 취소 검사 함수 존재 여부 확인
            if check_cancelled:
                # 임대 상실 또는 취소된 작업의 후속 업로드 중단
                check_cancelled()
            # 서버가 승인한 주소와 체크섬·최초 쓰기 조건으로 증거 전송
            api.put(str(grant["uploadUrl"]), path, content_type, grant["headers"])
            # 업로드 완료된 증거의 후보 연결과 저장소 객체 참조 추가
            result.append(
                {
                    "candidateIndex": entry["candidate_index"],
                    "kind": entry["kind"],
                    "objectKey": grant["objectKey"],
                    "contentSha256": sha256,
                    "startMs": entry["start_ms"],
                    "endMs": entry["end_ms"],
                    "width": None,
                    "height": None,
                }
            )
    # 검증과 전송이 끝난 결과 자료 반환
    return result

# 체크섬·불변 조건 권한으로 관측 진단 업로드
def perceptionArtifact(
    api: WorkerApi,
    item: dict[str, object],
    root: Path,
    value: object,
    check_cancelled: Callable[[], None] | None = None,
) -> dict[str, object]:
    # 관측 결과가 전송 계약의 사전 형식인지 확인
    if not isinstance(value, dict):
        # 관측 요약으로 해석할 수 없는 자료 거부
        raise RuntimeError("perception-invalid")
    # 공개 결과 자료에 직접 섞을 수 없는 원시 관측 필드 정의
    forbidden = {"observations", "poses", "interactions", "links", "hypotheses", "rawHypotheses"}
    # 원시 관측이나 자세·가설 목록이 전송 요약에 섞였는지 확인
    if set(value) & forbidden:
        # 비공개 원시 자료가 결과 본문에 노출되는 구조 거부
        raise RuntimeError("perception-raw-data-invalid")
    # 관측 요약 전송 계약의 정확한 필드 목록 정의
    required = {
        "schemaVersion",
        "sourceSha256",
        "processingStatus",
        "coverage",
        "models",
        "artifact",
        "summary",
        "incidents",
    }
    # 음향 결합 판본의 추가 필수 자료 처리
    if value.get("schemaVersion") == "perception-run-v2":
        # 음향 결합 판본에서는 음향 필드를 필수로 추가
        required.add("audio")
        # 음향 관측 자료가 사전 구조인지 확인
        if not isinstance(value.get("audio"), dict):
            # 음향 필수 판본의 음향 누락 또는 형식 오류 거부
            raise RuntimeError("perception-audio-required")
    # 시각 전용 판본도 아닌 미지원 관측 자료인지 확인
    elif value.get("schemaVersion") != "perception-run-v1":
        # 지원하지 않는 관측 자료 판본 거부
        raise RuntimeError("perception-invalid")
    # 추가·누락 필드 없이 정확한 관측 전송 구조인지 확인
    if set(value) != required or not isinstance(value.get("artifact"), dict):
        # 필수 필드 누락 또는 초과가 있는 관측 요약 거부
        raise RuntimeError("perception-invalid")
    # 업로드 전 로컬 비공개 관측 파일 참조 읽음
    local = value["artifact"]
    # 앞선 파일 참조 자료형 검사를 타입 문맥에서도 명시
    assert isinstance(local, dict)
    # 로컬 관측 파일 참조가 정해진 네 필드인지 확인
    if set(local) != {"path", "contentType", "contentSha256", "sizeBytes"}:
        # 허용한 필드 이외의 로컬 관측 파일 참조 거부
        raise RuntimeError("perception-artifact-invalid")
    # 관측 파일 경로가 비어 있지 않은 문자열인지 확인
    if not isinstance(local.get("path"), str) or not local["path"]:
        # 비어 있거나 문자열이 아닌 관측 파일 경로 거부
        raise RuntimeError("perception-path-invalid")
    # 비공개 관측 파일이 작업 출력 안의 일반 파일인지 확인
    path = localFile(root, local.get("path"), "perception-path-invalid")
    # 실제 업로드할 증거 파일의 바이트 크기 읽음
    size = path.stat().st_size
    # 관측 파일 형식과 실제 크기 및 용량 상한이 참조 계약에 맞는지 확인
    if (
        path.name.endswith(".jsonl.gz") is False
        or local.get("contentType") != "application/gzip"
        or not isinstance(local.get("sizeBytes"), int)
        or isinstance(local.get("sizeBytes"), bool)
        or local.get("sizeBytes") != size
        or size <= 0
        or size > MAX_DIAGNOSTIC_BYTES
    ):
        # 압축 형식 또는 파일 크기가 잘못된 관측 파일 거부
        raise RuntimeError("perception-artifact-invalid")
    # 실제 비공개 관측 압축 파일의 내용 해시 계산
    sha256 = digest(path)
    # 보고서에 기록된 관측 해시와 실제 파일 해시 일치 확인
    if not isinstance(local.get("contentSha256"), str) or local.get("contentSha256") != sha256:
        # 참조 해시와 실제 내용이 다른 관측 파일 거부
        raise RuntimeError("perception-artifact-invalid")
    # 업로드 경로를 격리할 분석·작업·판본 식별자 읽음
    analysis_id, job_id, revision = (
        item.get("analysisId"),
        item.get("jobId"),
        item.get("jobRevision"),
    )
    # 분석·작업 식별자 형식과 양의 작업 판본 확인
    if (
        not isinstance(analysis_id, str)
        or UUID.fullmatch(analysis_id) is None
        or not isinstance(job_id, str)
        or UUID.fullmatch(job_id) is None
        or not isinstance(revision, int)
        or isinstance(revision, bool)
        or revision < 1
    ):
        # 현재 작업에 안전하게 한정할 수 없는 업로드 권한 요청 거부
        raise RuntimeError("perception-grant-invalid")
    # 업로드 경계에서 취소 검사 함수 존재 여부 확인
    if check_cancelled:
        # 임대 상실 또는 취소된 작업의 후속 업로드 중단
        check_cancelled()
    # 비공개 관측 파일의 이름·형식·크기·해시로 권한 요청 구성
    request = {
        "name": path.name,
        "contentType": "application/gzip",
        "sizeBytes": size,
        "contentSha256": sha256,
    }
    # 현재 임대가 유효한 경우에만 비공개 관측 업로드 권한 요청
    granted = evidenceGrants(api, item, [request], "perception-grant-invalid")
    # 현재 파일 이름에 정확히 대응하는 서버 권한 읽음
    grant = granted[path.name]
    # 분석·작업·판본·내용 해시에 묶인 정확한 저장소 경로 구성
    expected_key = f"perception/{analysis_id}/{job_id}/{revision}/{sha256}.jsonl.gz"
    # 발급된 업로드 객체가 현재 작업의 관측 파일에 해당하는지 확인
    if grant["objectKey"] != expected_key:
        # 현재 작업의 관측 객체가 아닌 업로드 경로 거부
        raise RuntimeError("perception-grant-invalid")
    # 서버가 요구한 무결성·최초 쓰기 헤더 읽음
    raw_headers = grant.get("headers")
    # 권한 헤더가 올바른 자료 구조인지 확인
    if not isinstance(raw_headers, dict):
        # 필수 무결성 헤더가 없는 업로드 권한 거부
        raise RuntimeError("perception-grant-invalid")
    # 대소문자와 무관하게 헤더 이름을 비교할 형태로 변환
    headers = {str(key).lower(): value for key, value in raw_headers.items()}
    # 내용 해시를 저장소 체크섬 헤더 형식으로 변환
    checksum = base64.b64encode(bytes.fromhex(sha256)).decode("ascii")
    # 중복 헤더와 체크섬·최초 쓰기 조건의 정확한 일치 확인
    if len(headers) != len(raw_headers) or headers != {
        "x-amz-checksum-sha256": checksum,
        "if-none-match": "*",
    }:
        # 중복 헤더 또는 다른 체크섬·쓰기 조건의 권한 거부
        raise RuntimeError("perception-grant-invalid")
    # 업로드 경계에서 취소 검사 함수 존재 여부 확인
    if check_cancelled:
        # 임대 상실 또는 취소된 작업의 후속 업로드 중단
        check_cancelled()
    # 검증된 불변 업로드 권한으로 비공개 관측 파일 전송
    api.put(str(grant["uploadUrl"]), path, "application/gzip", headers)
    # 로컬 보고서를 보존할 전송용 관측 결과 복사본 생성
    result = dict(value)
    # 로컬 경로를 제거하고 업로드된 저장소 객체 참조로 교체
    result["artifact"] = {
        "objectKey": grant["objectKey"],
        "contentType": "application/gzip",
        "contentSha256": sha256,
        "sizeBytes": size,
    }
    # 검증과 전송이 끝난 결과 자료 반환
    return result

# 파이프라인 보고서 변환
def report(
    api: WorkerApi,
    item: dict[str, object],
    path: Path,
    check_cancelled: Callable[[], None] | None = None,
) -> dict[str, object]:
    # 파이프라인 보고서 읽기
    value = json.loads(path.read_text(encoding="utf-8"))
    # 샷 결과 호출 규약 형식 변환
    shots = [
        {
            "index": item["index"],
            "startMs": item["start_ms"],
            "endMs": item["end_ms"],
            "playbackSpeed": item["playback_speed"],
            "isReplay": item["is_replay"],
            "cameraAngle": item["camera_angle"],
        }
        for item in value["shots"]
    ]
    # 후보 결과 호출 규약 형식 변환
    candidates = [
        {
            "index": item["index"],
            "category": item["category"],
            "startMs": item["start_ms"],
            "endMs": item["end_ms"],
            "anchorMs": item["anchor_ms"],
            "confidence": item["confidence"],
            "cameraSufficiency": item["camera_sufficiency"],
            "reasons": item["reasons"],
            "shotIndices": item["shot_indices"],
            "tracking": item.get("tracking"),
            "sceneEvent": item.get("scene_event"),
            "broadcastCue": item.get("broadcast_cue"),
        }
        for item in value["candidates"]
    ]
    # 보고서에서 선택적인 로컬 관측 요약 읽음
    perception = value.get("perception")
    # 관측 필수 실행 판본인데 보고서 관측 자료가 빠졌는지 확인
    if (
        value["pipeline_version"] in (LOCAL_OBSERVER_PIPELINE_VERSION, AV_OBSERVER_PIPELINE_VERSION)
        and perception is None
    ):
        # 관측 판본인데 관측 결과가 빠진 보고서 제출 거부
        raise RuntimeError("perception-required")
    # 음향 결합 실행 판본에 맞는 자료 판본과 음향 필드 확인
    if value["pipeline_version"] == AV_OBSERVER_PIPELINE_VERSION and (
        perception.get("schemaVersion") != "perception-run-v2"
        or not isinstance(perception.get("audio"), dict)
    ):
        # 음향 필수 판본의 음향 누락 또는 형식 오류 거부
        raise RuntimeError("perception-audio-required")
    # 프레임·클립을 검증하여 업로드하고 저장소 참조 수집
    evidence = artifacts(api, item, path.parent, value["evidence"], check_cancelled)
    # 관측 결과가 있을 때만 비공개 진단 파일 업로드
    uploaded_perception = (
        perceptionArtifact(api, item, path.parent, perception, check_cancelled)
        if perception is not None
        else None
    )
    # 분석 결과와 증거 업로드 정보 반환
    result = {
        "kind": "ANALYZED",
        "pipelineVersion": value["pipeline_version"],
        "limitations": value["limitations"],
        "shots": shots,
        "candidates": candidates,
        "evidence": evidence,
    }
    # 서버 저장소로 옮긴 관측 결과 존재 여부 확인
    if uploaded_perception is not None:
        # 업로드가 확인된 관측 요약을 최종 제출 자료에 연결
        result["perception"] = uploaded_perception
    # 검증과 전송이 끝난 결과 자료 반환
    return result

# 작업 한 건 처리
def cycle(api: WorkerApi, kind: str, root: Path) -> bool:
    # 처리할 작업 선점
    item = api.claim(kind)
    # 서버가 선점할 작업을 배정하지 않았는지 확인
    if item is None:
        # 이번 조회에서 처리한 작업이 없음을 반환
        return False
    # 작업별 임시 폴더를 담을 실행 루트 생성
    root.mkdir(parents=True, exist_ok=True)
    # 임대 관리자 생성 전 상태를 실패 처리용으로 보존
    pulse: Pulse | None = None
    try:
        # 작업별 임시 폴더 생성
        with tempfile.TemporaryDirectory(prefix="replay-", dir=root) as directory:
            # 이번 작업에만 사용하는 격리 임시 경로 구성
            work = Path(directory)
            # 내려받은 원본 영상의 작업별 로컬 경로 생성
            source = work / "source.mp4"
            # 파이프라인 결과와 증거를 담을 작업별 경로 생성
            output = work / "result"
            # 검증 작업과 분석 작업의 시작 단계 구분
            stage = "VALIDATING" if kind == "VALIDATE_VIDEO" else "SEGMENTING"
            # 작업 임대 갱신과 실행
            pulse = Pulse(api, item, stage)
            # 임대 갱신이 유지되는 동안만 다운로드·분석·제출 실행
            with pulse:
                try:
                    # 선점한 작업에 지정된 원본 다운로드 주소 읽음
                    source_url = item.get("sourceUrl")
                    # 원본 주소 확인
                    if not isinstance(source_url, str) or not source_url:
                        # 원본 다운로드 위치를 알 수 없는 작업 입력 거부
                        raise ValueError("source-url-invalid")
                    # 원본 영상 다운로드
                    api.media(source_url, source)
                    # 비용이 큰 다음 처리 또는 제출 전에 임대 유지 확인
                    pulse.check()
                    # 로컬 파이프라인 실행
                    local = job(
                        {
                            "job_id": item.get("jobId"),
                            "job_type": item.get("jobType"),
                            "source_path": str(source),
                            "output_path": str(output),
                        },
                        progress=pulse.progress,
                        check_cancelled=pulse.check,
                    )
                    # 비용이 큰 다음 처리 또는 제출 전에 임대 유지 확인
                    pulse.check()
                    # 검증 결과의 호출 규약 전송 자료 변환
                    if local.payload.get("kind") == "VALIDATED":
                        # 로컬 영상 검증 메타데이터를 서버 결과 필드로 변환
                        payload = {
                            "kind": "VALIDATED",
                            "durationMs": local.payload["duration_ms"],
                            "width": local.payload["width"],
                            "height": local.payload["height"],
                        }
                    else:
                        # 분석 보고서의 호출 규약 전송 자료 변환
                        payload = report(
                            api, item, Path(str(local.payload["report_path"])), pulse.check
                        )
                    # 비용이 큰 다음 처리 또는 제출 전에 임대 유지 확인
                    pulse.check()
                    # 서버에 검증 또는 분석 결과를 최종 제출
                    pulse.submission(payload)
                # 임대 상실을 일반 처리 오류와 구별
                except PulseStopped:
                    # 임대 중단 신호는 일반 처리 실패로 바꾸지 않고 재전달
                    raise
                except Exception:
                    # 확인된 작업 임대에서만 실패 결과 제출과 상태 갱신 유지
                    if not pulse.ownership():
                        # 비용이 큰 다음 처리 또는 제출 전에 임대 유지 확인
                        pulse.check()
                        # 소유권을 확인하지 못한 작업의 일반 실패 제출 금지
                        raise
                    # 소유권이 확인된 작업에만 최종 실패 결과 제출
                    pulse.submission(
                        {"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}
                    )
            # 작업 완료 반환
            return True
    except PulseStopped as error:
        # 작업 임대 상실이나 확인 실패 뒤 결과 제출 금지
        logger.warning("worker-stopped code=%s", error)
        # 중단된 선점 작업을 이미 처리한 시도로 표시하여 반환
        return True
    except Exception:
        # 처리 실패 결과 전송
        if pulse is None:
            try:
                # 선점한 작업에 처리 실패 결과 제출 시도
                api.result(
                    item, {"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}
                )
            except Exception:
                # 실패 결과 전송 오류 무시
                pass
        # 작업은 처리되었으므로 다음 작업 진행
        return True

# 허용된 영상 작업의 불변 기본 목록 정의
KINDS = ("VALIDATE_VIDEO", "ANALYZE_VIDEO")

# 명시 역할 또는 기존 혼합 작업 목록 반환
def kinds(value: str | None) -> tuple[str, ...]:
    # 미지정 환경의 기존 혼합 실행 보존
    if value is None:
        return KINDS
    # 지정 역할의 주변 공백 제거
    selected = value.strip()
    # 빈 역할과 허용되지 않은 작업 거부
    if selected not in KINDS:
        raise ValueError("WORKER_JOB_TYPE-invalid")
    # 단일 역할의 불변 목록 반환
    return (selected,)

# 영상 작업 반복 실행
def loop(
    api: WorkerApi,
    root: Path,
    delay: float,
    selected: tuple[str, ...] = KINDS,
) -> None:
    # 빈 순회와 잘못된 종류 및 중복 선점 설정 거부
    if (
        not isinstance(selected, tuple)
        or not selected
        or any(kind not in KINDS for kind in selected)
        or len(set(selected)) != len(selected)
    ):
        raise ValueError("WORKER_JOB_TYPE-invalid")
    # 프로세스가 종료될 때까지 서버 작업 조회 반복
    while True:
        # 한 종류의 작업 조회 실패가 전체 워커를 중단하지 않도록 격리
        worked = False
        # 이번 반복의 작업 조회 실패 여부 초기화
        failure = False
        # 현재 실행 역할에 허용된 작업만 조회
        for kind in selected:
            try:
                # 한 종류라도 처리했다면 이번 반복의 작업 수행 상태 유지
                worked = cycle(api, kind, root) or worked
            except Exception as error:
                # 조회 실패 작업 종류와 예외 종류만 로그에 기록
                logger.warning("claim-failed job=%s type=%s", kind, type(error).__name__)
                # 조회 실패가 발생했으므로 다음 반복 지연 필요 상태 기록
                failure = True
        # 작업이 없거나 실패하면 폴링 지연
        # 실패 반복 중 요청 과열 방지
        if failure or not worked:
            # 빈 조회 또는 실패 반복의 서버 요청 빈도 제한
            time.sleep(delay)

# 환경값 조회
def env(name: str) -> str:
    # 필수 환경값의 앞뒤 공백을 제거하여 읽음
    value = os.environ.get(name, "").strip()
    # 필수 환경값이 누락되거나 공백뿐인지 확인
    if not value:
        # 필수 환경 설정 누락을 실행 전에 알림
        raise RuntimeError(f"{name}-required")
    # 검증한 필수 환경값 반환
    return value

# 영상 작업 진입점
def main() -> None:
    # 통신 클라이언트 생성 전 실행 역할 확인
    selected = kinds(os.environ.get("WORKER_JOB_TYPE"))
    # 서버 주소·내부 인증·워커 식별자로 작업 통신 클라이언트 생성
    api = Api(
        env("INTERNAL_API_BASE_URL"),
        env("WORKER_AUTH_TOKEN"),
        os.environ.get("WORKER_ID", "video-worker-1"),
    )
    # 설정된 임시 작업 경로를 읽고 기본 경로 적용
    root = Path(os.environ.get("WORKER_TEMP_DIR", "/tmp/replay-lab-worker"))
    # 밀리초 조회 주기를 초로 변환하고 과도한 반복 방지
    delay = max(0.1, float(os.environ.get("WORKER_POLL_MS", "1000")) / 1000)
    # 검증·분석 작업을 계속 선점하는 실행 루프 시작
    loop(api, root, delay, selected)

# 모듈을 직접 실행한 경우에만 워커 시작
if __name__ == "__main__":
    # 환경을 읽고 서버 작업 처리 실행
    main()
