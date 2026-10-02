# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 기록과 설정을 직렬화할 도구 읽음
import json
# 식별자와 해시 문자열 형식을 검사할 도구 읽음
import re
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 원본 시간축의 반올림 오차를 줄일 유리수 도구 읽음
from fractions import Fraction
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import isfinite
# 불리언과 수치 자료형을 구별할 기준 읽음
from numbers import Real
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any, BinaryIO, Iterator
# 영상 읽기 관련 함수와 자료형 읽음
from .media import MAX_FRAME_PIXELS, VideoReader, VideoSample
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection, LABELS


# 최댓값 직렬화 자료 바이트에 8 및 1024의 곱 및 1024의 곱 저장
MAX_JSON_BYTES = 8 * 1024 * 1024
# 최댓값 기록 목록을 30000 값으로 설정
MAX_RECORDS = 30_000
# 256에 정규식 준비 처리 결과 저장
_SHA256 = re.compile(r"[0-9a-f]{64}")
# 프레임 키 목록을 다음 항목으로 구성
_FRAME_KEYS = {
    "sourceSha256",
    "decodedIndex",
    "streamIndex",
    "pts",
    "timeBase",
    "originPts",
    "originTimeBase",
    "timestampMs",
    "width",
    "height",
    "timestampSource",
    "continuityId",
    "replayState",
    "detections",
    "inferenceSeconds",
}
# 검출 키 목록을 다음 항목으로 구성
_DETECTION_KEYS = {
    "detectionId",
    "label",
    "box",
    "score",
    "trackId",
    "actorRole",
    "source",
}


# 기록된 프레임의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class RecordedFrame:
    # 표본을 보관할 자료형 선언
    sample: VideoSample
    # 검출 목록을 보관할 자료형 선언
    detections: tuple[Detection, ...]
    # 연속 구간 식별자를 보관할 자료형 선언
    continuity_id: int
    # 기록 순번을 보관할 자료형 선언
    record_index: int

    # 초기 상태·입력 계약 구성
    def __post_init__(self) -> None:
        # 기록된 표본의 자료 형식과 허용 조건 확인
        if not isinstance(self.sample, VideoSample):
            # 기록된 표본 유효하지 않음 오류 알림
            raise TypeError("RECORDED_SAMPLE_INVALID")
        # 기록된 검출 목록의 자료 형식과 허용 조건 확인
        if not isinstance(self.detections, tuple) or not all(
            isinstance(detection, Detection) for detection in self.detections
        ):
            # 기록된 검출 목록 유효하지 않음 오류 알림
            raise TypeError("RECORDED_DETECTIONS_INVALID")
        # 연속 구간 식별자의 자료 형식과 허용 조건 확인
        if type(self.continuity_id) is not int or self.continuity_id < 0:
            # 연속 구간 식별자 유효하지 않음 오류 알림
            raise ValueError("CONTINUITY_ID_INVALID")
        # 기록 순번의 자료 형식과 허용 조건 확인
        if type(self.record_index) is not int or self.record_index < 0:
            # 기록 순번 유효하지 않음 오류 알림
            raise ValueError("RECORD_INDEX_INVALID")


# 파일 상태 지문의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class _Fingerprint:
    # 실행 장치를 보관할 자료형 선언
    device: int
    # 파일 식별 번호를 보관할 자료형 선언
    inode: int
    # 크기를 보관할 자료형 선언
    size: int
    # 수정 시각 나노초를 보관할 자료형 선언
    modified_ns: int
    # 내용 해시를 보관할 자료형 선언
    sha256: str


# 검증한 행의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class _ValidatedRow:
    # 값을 보관할 자료형 선언
    value: dict[str, Any]
    # 검출 목록을 보관할 자료형 선언
    detections: tuple[Detection, ...]
    # 시간을 보관할 자료형 선언
    time: Fraction

# 키가 중복된 직렬화 자료 객체 거부
def strictObject(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    # 값을 모를 빈 자료 생성
    value: dict[str, Any] = {}
    # 키와 값 목록에서 키·항목을 하나씩 읽음
    for key, item in pairs:
        # 키 및 값의 포함 조건 확인
        if key in value:
            # 현재 오류를 호출자에게 전달
            raise ValueError("duplicate key")
        # 값의 선택 항목에 항목 저장
        value[key] = item
    # 값 반환
    return value

# 상수 변경 차단
def constantGuard(_value: str) -> None:
    # 현재 오류를 호출자에게 전달
    raise ValueError("non-finite number")

# 문자열 수치 변환과 비유한 값 거부
def finiteFloat(value: str) -> float:
    # 해석한에 값의 실수 변환 결과 저장
    parsed = float(value)
    # 부정 조건 해석한의 유한 수치 여부 확인
    if not isfinite(parsed):
        # 현재 오류를 호출자에게 전달
        raise ValueError("non-finite number")
    # 해석한 반환
    return parsed

# 중복 키와 비유한 수치를 허용하지 않고 직렬화 자료 행을 읽음
def strictJson(data: bytes) -> Any:
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 문자열에 복호화 처리 결과 저장
        text = data.decode("utf-8")
        # 직렬화 문자열을 해석한 자료 반환
        return json.loads(
            text,
            object_pairs_hook=strictObject,
            parse_constant=constantGuard,
            parse_float=finiteFloat,
        )
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        # 직렬화 자료 유효하지 않음 오류 알림
        raise ValueError("JSON_INVALID") from error

# 직렬화 자료 직렬화를 통해 입력과 독립된 기록 사본을 생성
def jsonClone(value: dict[str, Any]) -> dict[str, Any]:
    # 직렬화 문자열을 해석한 자료 반환
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))

# 파일을 읽어 원본 대조용 해시 계산
def fileDigest(path: Path) -> str:
    # 해시 누적기에 내용 변경 검사용 해시 누적기 저장
    digest = hashlib.sha256()
    # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
    with path.open("rb") as source:
        # 반복자에서 읽기 묶음을 하나씩 읽음
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            # 해시 누적기에 읽기 묶음 반영
            digest.update(chunk)
    # 문자열로 표현한 내용 해시 반환
    return digest.hexdigest()

# 파일의 상태 정보를 수집해 처리 중 변경 여부를 비교
def fingerprint(path: Path, missing_reason: str) -> _Fingerprint:
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 처리 전에 현재 파일 상태 저장
        before = path.stat()
        # 부정 조건 일반 파일 존재 여부 확인
        if not path.is_file():
            # 현재 오류를 호출자에게 전달
            raise ValueError(missing_reason)
        # 내용 해시에 파일 해시 누적기 처리 결과 저장
        sha256 = fileDigest(path)
        # 처리 후에 현재 파일 상태 저장
        after = path.stat()
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except (FileNotFoundError, NotADirectoryError, OSError) as error:
        # 현재 오류를 호출자에게 전달
        raise ValueError(missing_reason) from error
    # 처리 전 동일성 정보를 다음 항목으로 구성
    before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    # 처리 후 동일성 정보를 다음 항목으로 구성
    after_identity = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    # 해시 계산 중 파일이 교체되거나 바뀌면 서로 다른 자료의 혼합 사용 차단
    if before_identity != after_identity:
        # 입력 변경 진행 중 재생 오류 알림
        raise ValueError("INPUT_CHANGED_DURING_REPLAY")
    # 파일 상태 지문 처리 결과 반환
    return _Fingerprint(*after_identity, sha256)

# 불리언이 아닌 0 이상의 정수인지 확인
def nonnegativeInteger(value: object) -> bool:
    # 값의 정확한 자료형 및 정수의 동일 객체 조건 및 값 및 0의 이상 조건 반환
    return type(value) is int and value >= 0

# 불리언이 아닌 양의 정수인지 확인
def positiveInteger(value: object) -> bool:
    # 값의 정확한 자료형 및 정수의 동일 객체 조건 및 값 및 0의 초과 조건 반환
    return type(value) is int and value > 0

# 레이블별 수량이 허용된 키와 비음수 정수로 구성됐는지 확인
def labelCounts(value: object) -> bool:
    # 값의 자료형 일치 여부 및 값의 중복을 없앤 집합 변환 결과 및 레이블 목록의 중복을 없앤 집합 변환 결과의 일치 조건 및 레이블 목록의 항목별 변환 결과의 전체 조건 충족 여부 반환
    return (
        isinstance(value, dict)
        and set(value) == set(LABELS)
        and all(nonnegativeInteger(value[label]) for label in LABELS)
    )

# 값이 유한한 0 이상의 수인지 확인
def finiteNonnegative(value: object) -> bool:
    # 값의 자료형 일치 여부 및 부정 조건 값의 자료형 일치 여부 및 값의 유한 수치 여부 반환
    return (
        isinstance(value, Real) and not isinstance(value, bool) and isfinite(value) and value >= 0
    )

# 시간 분자·분모 검증과 정확한 유리수 복원
def fraction(value: object) -> Fraction:
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not isinstance(value, dict) or set(value) != {"numerator", "denominator"}:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 분자에 값의 분자 저장
    numerator = value["numerator"]
    # 분모에 값의 분모 저장
    denominator = value["denominator"]
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if type(numerator) is not int or not positiveInteger(denominator):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 결과에 반올림 없는 유리수 저장
    result = Fraction(numerator, denominator)
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if result <= 0 or result.numerator != numerator or result.denominator != denominator:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 결과 반환
    return result

# 화면 크기 기준 검출 기록 검증·복원
def detection(value: object, width: int, height: int) -> Detection:
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not isinstance(value, dict) or set(value) != _DETECTION_KEYS:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 저장된 관측이 모델 검출 출처와 역할 미검증 계약을 보존하는지 확인
    if value["source"] != "MODEL_DETECTION" or value["actorRole"] != "UNPROVEN":
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not isinstance(value["box"], list):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 결과에 검출 처리 결과 저장
        result = Detection(
            value["detectionId"],
            value["label"],
            tuple(value["box"]),
            value["score"],
            value["trackId"],
        )
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except (TypeError, ValueError) as error:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID") from error
    # 여러 값을 순서대로 모은 자료에 결과의 원본 화면의 시작점과 끝점 상자 좌표 저장
    _, _, x2, y2 = result.box
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if x2 > width or y2 > height:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 결과 반환
    return result

# 원시 행의 원본·시각·검출 구조를 확인해 검증된 행으로 변환
def validatedRow(value: object, source_sha256: str) -> _ValidatedRow:
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not isinstance(value, dict) or set(value) != _FRAME_KEYS:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if value["sourceSha256"] != source_sha256:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not nonnegativeInteger(value["decodedIndex"]) or not nonnegativeInteger(
        value["streamIndex"]
    ):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if type(value["pts"]) is not int or type(value["originPts"]) is not int:
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 눈금당 초 단위 시간에 유리수 처리 결과 저장
    time_base = fraction(value["timeBase"])
    # 유리수에 필요한 입력을 전달해 처리
    fraction(value["originTimeBase"])
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not nonnegativeInteger(value["timestampMs"]):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 너비·높이를 다음 항목으로 구성
    width, height = value["width"], value["height"]
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if (
        not positiveInteger(width)
        or not positiveInteger(height)
        or width * height > MAX_FRAME_PIXELS
    ):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 시각이 복호화기에서 왔고 생중계와 재생 구별이 미확인 상태인지 확인
    if value["timestampSource"] != "DECODER_PTS" or value["replayState"] != "UNKNOWN":
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not nonnegativeInteger(value["continuityId"]):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not finiteNonnegative(value["inferenceSeconds"]):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 원시 검출 목록에 값의 검출 목록 저장
    raw_detections = value["detections"]
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if not isinstance(raw_detections, list):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 각 검출 기록을 원본 화면 크기 안의 유효한 검출 객체로 복원
    detections = tuple(detection(item, width, height) for item in raw_detections)
    # 검출 식별자 목록에 검출 목록의 항목별 변환 결과 저장
    detection_ids = [item.detection_id for item in detections]
    # 상위 단계 행의 자료 형식과 허용 조건 확인
    if len(detection_ids) != len(set(detection_ids)):
        # 상위 단계 행 유효하지 않음 오류 알림
        raise ValueError("UPSTREAM_ROW_INVALID")
    # 검증한 행 처리 결과 반환
    return _ValidatedRow(value, detections, value["pts"] * time_base)

# 크기 제한 행 읽음
def limitedLine(source: BinaryIO) -> bytes:
    # 줄에 파일에서 읽은 한 줄 저장
    line = source.readline(MAX_JSON_BYTES + 2)
    # 줄 끝 개행은 제외하고 실제 기록 본문의 바이트 크기 계산
    payload_size = len(line) - 1 if line.endswith(b"\n") else len(line)
    # 상위 단계 행 지나친 큼을 감지해 잘못된 입력의 후속 사용 차단
    if payload_size > MAX_JSON_BYTES:
        # 상위 단계 행 지나친 큼 오류 알림
        raise ValueError("UPSTREAM_ROW_TOO_LARGE")
    # 줄 반환
    return line


# 기록된 프레임 목록의 필드와 동작을 묶을 자료형 선언
class RecordedFrames:

    # 초기 상태·입력 계약 구성
    def __init__(self, source: Path | str, run_dir: Path | str) -> None:
        # 원본에 심볼릭 링크를 해석한 경로 저장
        self.source = Path(source).expanduser().resolve()
        # 연속 관측 폴더에 심볼릭 링크를 해석한 경로 저장
        self.run_dir = Path(run_dir).expanduser().resolve()
        # 요약 경로에 연속 관측 폴더 및 지정 문자열의 비율 저장
        self._summary_path = self.run_dir / "summary.json"
        # 프레임 목록 경로에 연속 관측 폴더 및 지정 문자열의 비율 저장
        self._frames_path = self.run_dir / "frames.jsonl"
        # 진입 여부를 거짓 값으로 설정
        self._entered = False
        # 닫힘 여부를 거짓 값으로 설정
        self._closed = False
        # 반복 사용 여부를 거짓 값으로 설정
        self._iterated = False
        # 반복자를 아직 없는 상태로 초기화
        self._iterator: Iterator[RecordedFrame] | None = None
        # 요약을 아직 없는 상태로 초기화
        self._summary: dict[str, Any] | None = None
        # 설정을 아직 없는 상태로 초기화
        self._settings: dict[str, int | None] | None = None
        # 출처 정보를 아직 없는 상태로 초기화
        self._provenance: dict[str, Any] | None = None
        # 원본 파일 상태 지문을 아직 없는 상태로 초기화
        self._source_fingerprint: _Fingerprint | None = None
        # 요약 파일 상태 지문을 아직 없는 상태로 초기화
        self._summary_fingerprint: _Fingerprint | None = None
        # 프레임 목록 파일 상태 지문을 아직 없는 상태로 초기화
        self._frames_fingerprint: _Fingerprint | None = None
        # 선택된 기록 수량을 0 값으로 설정
        self._selected_record_count = 0
        # 다시 읽은 프레임 수량을 0 값으로 설정
        self._replayed_frame_count = 0
        # 영상 기록을 모를 빈 자료 생성
        self._video_record: dict[str, Any] = {}
        # 원본 기록을 모를 빈 자료 생성
        self._source_record: dict[str, Any] = {}

    # 관측 또는 모델의 검증된 원본·파일 출처 정보를 반환
    @property
    def provenance(self) -> dict[str, Any]:
        # 기록된 프레임 목록 아닌 진입 여부를 감지해 잘못된 입력의 후속 사용 차단
        if self._provenance is None:
            # 기록된 프레임 목록 아닌 진입 여부 오류 알림
            raise RuntimeError("RECORDED_FRAMES_NOT_ENTERED")
        # 직렬화로 원본과 분리한 기록 사본 반환
        return jsonClone(self._provenance)

    # 요약 읽음
    def summaryData(self) -> dict[str, Any]:
        # 이 단계의 필수 전제인 요약 파일 상태 지문이 있는지 확인
        assert self._summary_fingerprint is not None
        # 상위 단계 요약 지나친 큼을 감지해 잘못된 입력의 후속 사용 차단
        if self._summary_fingerprint.size > MAX_JSON_BYTES:
            # 상위 단계 요약 지나친 큼 오류 알림
            raise ValueError("UPSTREAM_SUMMARY_TOO_LARGE")
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 자료에 파일 내용 바이트 저장
            data = self._summary_path.read_bytes()
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except OSError as error:
            # 상위 단계 요약 아닌 찾은 오류 알림
            raise ValueError("UPSTREAM_SUMMARY_NOT_FOUND") from error
        # 값에 엄격한 오류 처리 직렬화 자료 처리 결과 저장
        value = strictJson(data)
        # 상위 단계 요약의 자료 형식과 허용 조건 확인
        if not isinstance(value, dict):
            # 상위 단계 요약 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SUMMARY_INVALID")
        # 값 반환
        return value

    # 요약 입력 검사
    def summaryValidation(
        self, summary: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, int | None], int]:
        # 상위 단계 계약의 자료 형식과 허용 조건 확인
        if summary.get("schemaVersion") != 1 or type(summary.get("schemaVersion")) is not int:
            # 상위 단계 계약 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SCHEMA_INVALID")
        # 상위 단계 상태의 자료 형식과 허용 조건 확인
        if summary.get("status") != "COMPLETE":
            # 상위 단계 상태 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_STATUS_INVALID")
        # 상위 단계 판정 입력 승인 여부의 자료 형식과 허용 조건 확인
        if summary.get("admission") != "NOT_ADMITTED":
            # 상위 단계 판정 입력 승인 여부 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_ADMISSION_INVALID")
        # 상위 단계 범위의 자료 형식과 허용 조건 확인
        if summary.get("scope") != "OBJECT_DETECTION_AND_TRACKING_ONLY":
            # 상위 단계 범위 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SCOPE_INVALID")

        # 원본에 원본의 키에 해당하는 값 저장
        source = summary.get("source")
        # 상위 단계 원본의 자료 형식과 허용 조건 확인
        if not isinstance(source, dict):
            # 상위 단계 원본 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SOURCE_INVALID")
        # 원본 해시 256에 내용 해시의 키에 해당하는 값 저장
        source_sha256 = source.get("sha256")
        # 상위 단계 원본의 자료 형식과 허용 조건 확인
        if not isinstance(source.get("path"), str) or not source["path"]:
            # 상위 단계 원본 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SOURCE_INVALID")
        # 상위 단계 원본의 자료 형식과 허용 조건 확인
        if not isinstance(source_sha256, str) or _SHA256.fullmatch(source_sha256) is None:
            # 상위 단계 원본 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SOURCE_INVALID")
        # 상위 단계 원본의 자료 형식과 허용 조건 확인
        if not nonnegativeInteger(source.get("sizeBytes")):
            # 상위 단계 원본 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SOURCE_INVALID")

        # 설정에 설정의 키에 해당하는 값 저장
        settings = summary.get("settings")
        # 상위 단계 설정의 자료 형식과 허용 조건 확인
        if not isinstance(settings, dict):
            # 상위 단계 설정 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        # 시작 밀리초에 시작 밀리초의 키에 해당하는 값 저장
        start_ms = settings.get("startMs")
        # 종료 밀리초에 종료 밀리초의 키에 해당하는 값 저장
        end_ms = settings.get("endMs")
        # 간격 밀리초에 표본 간격 밀리초의 키에 해당하는 값 저장
        interval_ms = settings.get("sampleIntervalMs")
        # 상위 단계 설정의 자료 형식과 허용 조건 확인
        if not nonnegativeInteger(start_ms) or not positiveInteger(interval_ms):
            # 상위 단계 설정 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        # 상위 단계 설정의 자료 형식과 허용 조건 확인
        if end_ms is not None and (type(end_ms) is not int or end_ms <= start_ms):
            # 상위 단계 설정 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        # 재생 설정을 다음 항목으로 구성
        replay_settings: dict[str, int | None] = {
            # 시작 밀리초 필드 기록
            "startMs": start_ms,
            # 종료 밀리초 필드 기록
            "endMs": end_ms,
            # 표본 간격 밀리초 필드 기록
            "sampleIntervalMs": interval_ms,
        }

        # 집계에 집계의 키에 해당하는 값 저장
        counts = summary.get("counts")
        # 영상에 영상의 키에 해당하는 값 저장
        video = summary.get("video")
        # 상위 단계 수량 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if not isinstance(counts, dict) or not isinstance(video, dict):
            # 상위 단계 수량 불일치 오류 알림
            raise ValueError("UPSTREAM_COUNT_MISMATCH")
        # 단일 수치 수량 키 목록을 다음 항목으로 구성
        scalar_count_keys = (
            "recordedFrameCount",
            "detectionCount",
            "trackedObservationCount",
            "uniqueTrackIdCount",
        )
        # 레이블 수량 키 목록을 다음 항목으로 구성
        label_count_keys = (
            "detectionsByLabel",
            "framesWithDetectionByLabel",
            "uniqueTrackIdCountByLabel",
        )
        # 상위 단계 수량 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if any(not nonnegativeInteger(counts.get(key)) for key in scalar_count_keys) or any(
            not labelCounts(counts.get(key)) for key in label_count_keys
        ):
            # 상위 단계 수량 불일치 오류 알림
            raise ValueError("UPSTREAM_COUNT_MISMATCH")
        # 기록된 수량에 기록된 프레임 수량의 키에 해당하는 값 저장
        recorded_count = counts.get("recordedFrameCount")
        # 표본 수량에 표본 수량의 키에 해당하는 값 저장
        sample_count = video.get("sampleCount")
        # 상위 단계 수량 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if (
            not nonnegativeInteger(sample_count)
            or recorded_count > MAX_RECORDS
            or sample_count != recorded_count
        ):
            # 상위 단계 수량 불일치 오류 알림
            raise ValueError("UPSTREAM_COUNT_MISMATCH")
        # 상위 단계 설정의 자료 형식과 허용 조건 확인
        if (
            video.get("requestedStartMs") != start_ms
            or video.get("requestedEndMs") != end_ms
            or video.get("sampleIntervalMs") != interval_ms
        ):
            # 상위 단계 설정 유효하지 않음 오류 알림
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        # 원본·재생 설정·기록된 수량 반환
        return source, replay_settings, recorded_count

    # 원시 행 전체의 구조와 원본 해시 및 예상 수량을 검증
    def rowScan(self, summary: dict[str, Any], source_sha256: str, expected_count: int) -> None:
        # 집계 기준 레이블에 레이블 목록의 항목별 변환 결과 저장
        counts_by_label = {label: 0 for label in LABELS}
        # 프레임 목록 기준 레이블에 레이블 목록의 항목별 변환 결과 저장
        frames_by_label = {label: 0 for label in LABELS}
        # 추적된 수량을 0 값으로 설정
        tracked_count = 0
        # 추적 식별자 목록에 레이블 목록의 항목별 변환 결과 저장
        track_ids = {label: set() for label in LABELS}
        # 이전 시간을 아직 없는 상태로 초기화
        previous_time: Fraction | None = None
        # 실제 수량을 0 값으로 설정
        actual_count = 0
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
            with self._frames_path.open("rb") as source:
                # 반복 종료 조건을 본문에서 확인
                while True:
                    # 줄에 한도 적용 줄 처리 결과 저장
                    line = limitedLine(source)
                    # 줄이 비어 있거나 조건을 충족하지 않는지 확인
                    if not line:
                        # 더 처리할 항목이 없거나 종료 조건을 충족해 반복 종료
                        break
                    # 요약 수량과 대조할 실제 기록 행 수 누적
                    actual_count += 1
                    # 상위 단계 기록 한도 초과를 감지해 잘못된 입력의 후속 사용 차단
                    if actual_count > MAX_RECORDS:
                        # 상위 단계 기록 한도 초과 오류 알림
                        raise ValueError("UPSTREAM_RECORD_LIMIT_EXCEEDED")
                    # 행에 검증한 행 처리 결과 저장
                    row = validatedRow(strictJson(line), source_sha256)
                    # 상위 단계 행 출력 대상 정렬 순서를 감지해 잘못된 입력의 후속 사용 차단
                    if previous_time is not None and row.time <= previous_time:
                        # 상위 단계 행 출력 대상 정렬 순서 오류 알림
                        raise ValueError("UPSTREAM_ROW_OUT_OF_ORDER")
                    # 이전 시간에 행의 시간 저장
                    previous_time = row.time
                    # 존재하는에 빈 중복을 없앤 집합 저장
                    present = set()
                    # 행의 검출 목록에서 검출을 하나씩 읽음
                    for detection in row.detections:
                        # 집계 기준 레이블의 선택 항목에 1을 더해 누적
                        counts_by_label[detection.label] += 1
                        # 존재하는에 검출의 레이블을 중복 없이 추가
                        present.add(detection.label)
                        # 검출의 구간 안에서만 유효한 추적 식별자가 있는지 확인
                        if detection.track_id is not None:
                            # 추적된 수량에 1을 더해 누적
                            tracked_count += 1
                            # 추적 식별자 목록의 선택 항목에 검출의 구간 안에서만 유효한 추적 식별자를 중복 없이 추가
                            track_ids[detection.label].add(detection.track_id)
                    # 존재하는에서 레이블을 하나씩 읽음
                    for label in present:
                        # 프레임 목록 기준 레이블의 선택 항목에 1을 더해 누적
                        frames_by_label[label] += 1
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except OSError as error:
            # 상위 단계 프레임 목록 아닌 찾은 오류 알림
            raise ValueError("UPSTREAM_FRAMES_NOT_FOUND") from error
        # 상위 단계 수량 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if actual_count != expected_count:
            # 상위 단계 수량 불일치 오류 알림
            raise ValueError("UPSTREAM_COUNT_MISMATCH")

        # 집계에 요약의 집계 저장
        counts = summary["counts"]
        # 전체 추적 식별자 목록에 합집합 면적 처리 결과 저장
        all_track_ids = set().union(*track_ids.values())
        # 예상 값 목록을 다음 항목으로 구성
        expected_values = {
            # 검출 수량 필드 기록
            "detectionCount": sum(counts_by_label.values()),
            # 검출 목록 기준 레이블 필드 기록
            "detectionsByLabel": counts_by_label,
            # 프레임 목록 포함 검출 기준 레이블 필드 기록
            "framesWithDetectionByLabel": frames_by_label,
            # 추적된 관측 수량 필드 기록
            "trackedObservationCount": tracked_count,
            # 중복 없는 추적 식별자 수량 필드 기록
            "uniqueTrackIdCount": len(all_track_ids),
            # 중복 없는 추적 식별자 수량 기준 레이블 필드 기록
            "uniqueTrackIdCountByLabel": {label: len(track_ids[label]) for label in LABELS},
        }
        # 상위 단계 수량 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if any(counts.get(key) != expected for key, expected in expected_values.items()):
            # 상위 단계 수량 불일치 오류 알림
            raise ValueError("UPSTREAM_COUNT_MISMATCH")

    # 처리 자원 준비
    def __enter__(self) -> RecordedFrames:
        # 기록된 프레임 목록 이미 사용한을 감지해 잘못된 입력의 후속 사용 차단
        if self._entered or self._closed:
            # 기록된 프레임 목록 이미 사용한 오류 알림
            raise RuntimeError("RECORDED_FRAMES_ALREADY_USED")
        # 원본 파일 상태 지문에 실행 중 교체 여부를 비교할 파일 지문 저장
        self._source_fingerprint = fingerprint(self.source, "SOURCE_NOT_FOUND")
        # 요약 파일 상태 지문에 실행 중 교체 여부를 비교할 파일 지문 저장
        self._summary_fingerprint = fingerprint(self._summary_path, "UPSTREAM_SUMMARY_NOT_FOUND")
        # 프레임 목록 파일 상태 지문에 실행 중 교체 여부를 비교할 파일 지문 저장
        self._frames_fingerprint = fingerprint(self._frames_path, "UPSTREAM_FRAMES_NOT_FOUND")
        # 요약에 요약 자료 처리 결과 저장
        summary = self.summaryData()
        # 원본·설정·선택된 수량에 요약 입력 검사 처리 결과 저장
        source, settings, selected_count = self.summaryValidation(summary)
        # 원본 해시 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if source["sha256"] != self._source_fingerprint.sha256:
            # 원본 해시 불일치 오류 알림
            raise ValueError("SOURCE_HASH_MISMATCH")
        # 원본 크기 불일치를 감지해 잘못된 입력의 후속 사용 차단
        if source["sizeBytes"] != self._source_fingerprint.size:
            # 원본 크기 불일치 오류 알림
            raise ValueError("SOURCE_SIZE_MISMATCH")
        # 행 검사에 필요한 입력을 전달해 처리
        self.rowScan(summary, source["sha256"], selected_count)
        # 입력 보호 검사으로 의 계약 확인
        self.inputGuard()

        # 요약에 요약 저장
        self._summary = summary
        # 설정에 설정 저장
        self._settings = settings
        # 선택된 기록 수량에 선택된 수량 저장
        self._selected_record_count = selected_count
        # 원본 기록을 다음 항목으로 구성
        self._source_record = {
            # 경로 필드 기록
            "path": str(self.source),
            # 내용 해시 필드 기록
            "sha256": self._source_fingerprint.sha256,
            # 크기 바이트 필드 기록
            "sizeBytes": self._source_fingerprint.size,
        }
        # 출처 정보를 다음 항목으로 구성
        self._provenance = {
            # 원본 필드 기록
            "source": jsonClone(source),
            # 상위 단계 필드 기록
            "upstream": {
                # 계약 버전 필드 기록
                "schemaVersion": 1,
                # 요약 해시 256 필드 기록
                "summarySha256": self._summary_fingerprint.sha256,
                # 프레임 목록 줄 단위 직렬화 해시 256 필드 기록
                "framesJsonlSha256": self._frames_fingerprint.sha256,
            },
            # 설정 필드 기록
            "settings": dict(settings),
        }
        # 진입 여부를 참 값으로 설정
        self._entered = True
        # 현재 객체 반환
        return self

    # 입력 불변성 확인
    def inputGuard(self) -> None:
        # 기록된 프레임 목록 아닌 진입 여부를 감지해 잘못된 입력의 후속 사용 차단
        if (
            self._source_fingerprint is None
            or self._summary_fingerprint is None
            or self._frames_fingerprint is None
        ):
            # 기록된 프레임 목록 아닌 진입 여부 오류 알림
            raise RuntimeError("RECORDED_FRAMES_NOT_ENTERED")
        # 현재를 다음 항목으로 구성
        current = (
            fingerprint(self.source, "SOURCE_NOT_FOUND"),
            fingerprint(self._summary_path, "UPSTREAM_SUMMARY_NOT_FOUND"),
            fingerprint(self._frames_path, "UPSTREAM_FRAMES_NOT_FOUND"),
        )
        # 예상을 다음 항목으로 구성
        expected = (self._source_fingerprint, self._summary_fingerprint, self._frames_fingerprint)
        # 처리 시작 후 원본과 상위 단계 기록이 바뀌지 않았는지 재확인
        if current != expected:
            # 입력 변경 진행 중 재생 오류 알림
            raise ValueError("INPUT_CHANGED_DURING_REPLAY")

    # 원본 순서로 표본을 제공
    def __iter__(self) -> Iterator[RecordedFrame]:
        # 기록된 프레임 목록 아닌 활성을 감지해 잘못된 입력의 후속 사용 차단
        if not self._entered or self._closed:
            # 기록된 프레임 목록 아닌 활성 오류 알림
            raise RuntimeError("RECORDED_FRAMES_NOT_ACTIVE")
        # 기록된 프레임 목록 이미 반복 사용 여부를 감지해 잘못된 입력의 후속 사용 차단
        if self._iterated:
            # 기록된 프레임 목록 이미 반복 사용 여부 오류 알림
            raise RuntimeError("RECORDED_FRAMES_ALREADY_ITERATED")
        # 반복 사용 여부를 참 값으로 설정
        self._iterated = True
        # 반복자에 재생 처리 결과 저장
        self._iterator = self.replay()
        # 반복자 반환
        return self._iterator

    # 리플레이 행 읽음
    def replayRow(self, source: BinaryIO, index: int) -> _ValidatedRow:
        # 이 단계의 필수 전제인 요약이 있는지 확인
        assert self._summary is not None
        # 줄에 한도 적용 줄 처리 결과 저장
        line = limitedLine(source)
        # 줄이 비어 있거나 조건을 충족하지 않는지 확인
        if not line:
            # 재생 원본 예정보다 이른 파일 끝 오류 알림
            raise ValueError("REPLAY_SOURCE_EARLY_EOF")
        # 행에 검증한 행 처리 결과 저장
        row = validatedRow(strictJson(line), self._summary["source"]["sha256"])
        # 행 반환
        return row

    # 디코딩한 표본의 원본 시각과 크기가 기록된 행과 일치하는지 확인
    @staticmethod
    def matches(sample: VideoSample, row: dict[str, Any]) -> bool:
        # 눈금당 초 단위 시간에 유리수 처리 결과 저장
        time_base = fraction(row["timeBase"])
        # 시작점 눈금당 초 단위 시간에 유리수 처리 결과 저장
        origin_time_base = fraction(row["originTimeBase"])
        # 복호화된 순번 및 행의 복호화된 순번의 일치 조건 및 스트림 순번 및 행의 스트림 순번의 일치 조건 및 원본 표시 시각 눈금 및 행의 원본 표시 시각 눈금의 일치 조건 반환
        return (
            sample.decoded_index == row["decodedIndex"]
            and sample.stream_index == row["streamIndex"]
            and sample.pts == row["pts"]
            and sample.time_base == time_base
            and sample.origin_pts == row["originPts"]
            and sample.origin_time_base == origin_time_base
            and sample.timestamp_ms == row["timestampMs"]
            and sample.rgb.shape[1] == row["width"]
            and sample.rgb.shape[0] == row["height"]
        )

    # 원본 영상을 다시 읽으며 저장된 검출과 동일 시각의 표본을 연결
    def replay(self) -> Iterator[RecordedFrame]:
        # 이 단계의 필수 전제인 설정이 있는지 확인
        assert self._settings is not None
        # 입력 보호 검사으로 의 계약 확인
        self.inputGuard()
        # 읽기 객체를 아직 없는 상태로 초기화
        reader: VideoReader | None = None
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
            with self._frames_path.open("rb") as records:
                # 처리 종료 시 정리되도록 영상 읽기 객체 처리 결과 사용
                with VideoReader(
                    self.source,
                    start_ms=self._settings["startMs"],
                    end_ms=self._settings["endMs"],
                    interval_ms=self._settings["sampleIntervalMs"],
                ) as reader:
                    # 표본 목록에 반복자 저장
                    samples = iter(reader)
                    # 반복할 순번 범위에서 순번을 하나씩 읽음
                    for index in range(self._selected_record_count):
                        # 행에 재생 행 처리 결과 저장
                        row = self.replayRow(records, index)
                        # 실패 시 아래 예외 처리로 정리할 작업 시작
                        try:
                            # 표본에 다음 항목 저장
                            sample = next(samples)
                        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
                        except StopIteration as error:
                            # 재생 원본 예정보다 이른 파일 끝 오류 알림
                            raise ValueError("REPLAY_SOURCE_EARLY_EOF") from error
                        # 저장 행과 다시 복호화한 영상의 시각 및 해상도가 다르면 잘못된 표본 결합 차단
                        if not self.matches(sample, row.value):
                            # 재생 프레임 불일치 오류 알림
                            raise ValueError("REPLAY_FRAME_MISMATCH")
                        # 다시 읽은 프레임 수량에 1을 더해 누적
                        self._replayed_frame_count += 1
                        # 기록된 프레임 처리 결과를 다음 호출까지 한 건씩 제공
                        yield RecordedFrame(
                            sample, row.detections, row.value["continuityId"], index
                        )
                    # 재생 원본 예정보다 이른 파일 끝을 감지해 잘못된 입력의 후속 사용 차단
                    if limitedLine(records):
                        # 재생 원본 예정보다 이른 파일 끝 오류 알림
                        raise ValueError("REPLAY_SOURCE_EARLY_EOF")
                    # 실패 시 아래 예외 처리로 정리할 작업 시작
                    try:
                        # 다음에 필요한 입력을 전달해 처리
                        next(samples)
                    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
                    except StopIteration:
                        # 이 분기에서 추가 작업 없이 기존 처리 흐름 유지
                        pass
                    # 예외 없이 앞선 작업을 마친 경우 처리
                    else:
                        # 재생 기록 없는 오류 알림
                        raise ValueError("REPLAY_RECORD_MISSING")
        # 성공과 실패에 관계없이 남은 자원 정리
        finally:
            # 읽기 객체가 있는지 확인
            if reader is not None:
                # 영상 기록에 저장용 관측 기록 저장
                self._video_record = reader.as_record()
        # 입력 보호 검사으로 의 계약 확인
        self.inputGuard()

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 진입 여부가 비어 있거나 조건을 충족하지 않는지 확인
        if not self._entered:
            # 기록된 프레임 목록 아닌 진입 여부 오류 알림
            raise RuntimeError("RECORDED_FRAMES_NOT_ENTERED")
        # 필드별로 묶은 기록 반환
        return {
            # 선택된 기록 수량 필드 기록
            "selectedRecordCount": self._selected_record_count,
            # 다시 읽은 프레임 수량 필드 기록
            "replayedFrameCount": self._replayed_frame_count,
            # 원본 필드 기록
            "source": dict(self._source_record),
            # 영상 필드 기록
            "video": jsonClone(self._video_record),
        }

    # 처리 자원 정리
    def __exit__(self, exception_type, _exception, _traceback) -> bool:
        # 닫기 오류를 아직 없는 상태로 초기화
        close_error: Exception | None = None
        # 무결성 오류를 아직 없는 상태로 초기화
        integrity_error: Exception | None = None
        # 반복자가 있는지 확인
        if self._iterator is not None:
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 닫기에 반복자의 속성 또는 기본값 저장
                close = getattr(self._iterator, "close", None)
                # 닫기가 있는지 확인
                if close is not None:
                    # 의 열린 자원 정리
                    close()
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception as error:
                # 닫기 오류에 오류 저장
                close_error = error
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 입력 보호 검사으로 의 계약 확인
            self.inputGuard()
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception as error:
            # 무결성 오류에 오류 저장
            integrity_error = error
        # 닫힘 여부를 참 값으로 설정
        self._closed = True
        # 예외 자료형이 없는지 확인
        if exception_type is None:
            # 닫기 오류가 있는지 확인
            if close_error is not None:
                # 현재 오류를 호출자에게 전달
                raise close_error
            # 무결성 오류가 있는지 확인
            if integrity_error is not None:
                # 현재 오류를 호출자에게 전달
                raise integrity_error
        # 거짓 반환
        return False
