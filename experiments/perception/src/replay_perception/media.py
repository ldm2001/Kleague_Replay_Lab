# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 원본 시간축의 반올림 오차를 줄일 유리수 도구 읽음
from fractions import Fraction
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any, Iterator
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np


# 첨부된 표지 그림을 1024 값으로 설정
ATTACHED_PICTURE = 1024
# 최댓값 프레임 화소 수에 4096 및 2160의 곱 저장
MAX_FRAME_PIXELS = 4096 * 2160

# 표시 시각와 시간 기준을 검증해 정확한 원본 시각으로 변환
def time(pts: int | None, base: Fraction | None, *, origin: bool = False) -> Fraction:
    # 시간축 시작점 없는을 감지해 잘못된 입력의 후속 사용 차단
    if type(pts) is not int:
        # 시간축 시작점 없는 오류 알림
        raise ValueError("TIMELINE_ORIGIN_MISSING" if origin else "TIMELINE_PTS_MISSING")
    # 시간축 눈금당 시간의 자료 형식과 허용 조건 확인
    if not isinstance(base, Fraction) or base <= 0:
        # 시간축 눈금당 시간 유효하지 않음 오류 알림
        raise ValueError("TIMELINE_TIMEBASE_INVALID")
    # 표시 시각 눈금에 눈금당 시간을 곱해 원본 초 단위 시간 반환
    return pts * base

# 원본 영상 시작점을 기준으로 표본 시각을 밀리초로 계산
def timestamp(
    pts: int | None, base: Fraction | None, origin_pts: int | None, origin_base: Fraction | None
) -> int:
    # 원본 시작 시각을 뺀 뒤 천을 곱하고 밀리초 정수로 반올림해 반환
    return round((time(pts, base) - time(origin_pts, origin_base, origin=True)) * 1000)

# 영상 스트림 선택
def videoStream(streams):
    # 스트림 목록에서 스트림을 하나씩 읽음
    for stream in streams:
        # 스트림의 자료형 및 영상의 불일치 조건 확인
        if stream.type != "video":
            # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
            continue
        # 스트림 속성에 스트림의 속성 또는 기본값 저장
        disposition = getattr(stream, "disposition", 0)
        # 스트림 속성에 스트림 속성의 속성 또는 기본값 저장
        disposition = getattr(disposition, "value", disposition)
        # 첨부 표지 그림을 실제 경기 영상 스트림으로 선택하지 않도록 제외
        if not int(disposition) & ATTACHED_PICTURE:
            # 스트림 반환
            return stream
    # 영상 스트림 없음 오류 알림
    raise ValueError("VIDEO_STREAM_ABSENT")

# 유리수 시간값을 분자·분모 기록으로 변환
def fractionRecord(value: Fraction | None) -> dict[str, int] | None:
    # 조건에 따라 선택한 없음 반환
    return (
        None if value is None else {"numerator": value.numerator, "denominator": value.denominator}
    )


# 영상 표본의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class VideoSample:
    # 복호화된 순번을 보관할 자료형 선언
    decoded_index: int
    # 스트림 순번을 보관할 자료형 선언
    stream_index: int
    # 원본 표시 시각 눈금을 보관할 자료형 선언
    pts: int
    # 눈금당 초 단위 시간을 보관할 자료형 선언
    time_base: Fraction
    # 시작점 표시 시각 눈금을 보관할 자료형 선언
    origin_pts: int
    # 시작점 눈금당 초 단위 시간을 보관할 자료형 선언
    origin_time_base: Fraction
    # 원본 시작점 기준 밀리초를 보관할 자료형 선언
    timestamp_ms: int
    # 삼원색 영상을 보관할 자료형 선언
    rgb: np.ndarray

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 복호화된 순번 필드 기록
            "decodedIndex": self.decoded_index,
            # 스트림 순번 필드 기록
            "streamIndex": self.stream_index,
            # 원본 표시 시각 눈금 필드 기록
            "pts": self.pts,
            # 시간 기준 필드 기록
            "timeBase": fractionRecord(self.time_base),
            # 시작점 표시 시각 눈금 필드 기록
            "originPts": self.origin_pts,
            # 시작점 시간 기준 필드 기록
            "originTimeBase": fractionRecord(self.origin_time_base),
            # 시각 밀리초 필드 기록
            "timestampMs": self.timestamp_ms,
            # 너비 필드 기록
            "width": int(self.rgb.shape[1]),
            # 높이 필드 기록
            "height": int(self.rgb.shape[0]),
            # 시각 원본 필드 기록
            "timestampSource": "DECODER_PTS",
        }


# 영상 읽기 객체의 필드와 동작을 묶을 자료형 선언
class VideoReader:

    # 초기 상태·입력 계약 구성
    def __init__(
        self,
        source: Path | str,
        *,
        start_ms: int = 0,
        end_ms: int | None = None,
        interval_ms: int = 500,
    ) -> None:
        # 검사 범위의 자료 형식과 허용 조건 확인
        if (
            type(start_ms) is not int
            or start_ms < 0
            or type(interval_ms) is not int
            or interval_ms <= 0
        ):
            # 검사 범위 유효하지 않음 오류 알림
            raise ValueError("SCAN_RANGE_INVALID")
        # 검사 범위의 자료 형식과 허용 조건 확인
        if end_ms is not None and (type(end_ms) is not int or end_ms <= start_ms):
            # 검사 범위 유효하지 않음 오류 알림
            raise ValueError("SCAN_RANGE_INVALID")
        # 원본에 심볼릭 링크를 해석한 경로 저장
        self.source = Path(source).expanduser().resolve()
        # 시작 밀리초·종료 밀리초·간격 밀리초를 다음 항목으로 구성
        self.start_ms, self.end_ms, self.interval_ms = start_ms, end_ms, interval_ms
        # 영상 컨테이너를 아직 없는 상태로 초기화
        self._container = None
        # 스트림을 아직 없는 상태로 초기화
        self._stream = None
        # 영상 복호화를 아직 없는 상태로 초기화
        self._av = None
        # 반복 사용 여부를 거짓 값으로 설정
        self._iterated = False
        # 시작점 표시 시각 눈금을 아직 없는 상태로 초기화
        self.origin_pts = None
        # 시작점 눈금당 초 단위 시간을 아직 없는 상태로 초기화
        self.origin_time_base = None
        # 시작점 원본을 아직 없는 상태로 초기화
        self.origin_source = None
        # 스트림 순번을 아직 없는 상태로 초기화
        self.stream_index = None
        # 복호화된 프레임 수량을 0 값으로 설정
        self.decoded_frame_count = 0
        # 표본 수량을 0 값으로 설정
        self.sample_count = 0
        # 첫 번째 표본 밀리초를 아직 없는 상태로 초기화
        self.first_sample_ms = None
        # 마지막 표본 밀리초를 아직 없는 상태로 초기화
        self.last_sample_ms = None
        # 도달 여부 파일 끝을 거짓 값으로 설정
        self.reached_eof = False
        # 파일 위치 이동 적용 여부를 거짓 값으로 설정
        self.seek_applied = False

    # 처리 자원 준비
    def __enter__(self) -> VideoReader:
        # 원본 표시 시각을 보존할 영상 복호화 도구 읽음
        import av

        # 영상 읽기 객체 이미 사용한을 감지해 잘못된 입력의 후속 사용 차단
        if self._container is not None or self._iterated:
            # 영상 읽기 객체 이미 사용한 오류 알림
            raise ValueError("VIDEO_READER_ALREADY_USED")
        # 원본 아닌 찾은을 감지해 잘못된 입력의 후속 사용 차단
        if not self.source.is_file():
            # 원본 아닌 찾은 오류 알림
            raise ValueError("SOURCE_NOT_FOUND")
        # 영상 복호화에 영상 복호화 도구 저장
        self._av = av
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 영상 컨테이너에 열린 파일 또는 영상 스트림 저장
            self._container = av.open(str(self.source), mode="r", timeout=(10, 20))
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except (av.error.FFmpegError, OSError) as error:
            # 영상 열기 실패 오류 알림
            raise ValueError("VIDEO_OPEN_FAILED") from error
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 스트림에 영상 스트림 처리 결과 저장
            self._stream = videoStream(self._container.streams)
            # 스트림 순번에 스트림의 순번 저장
            self.stream_index = self._stream.index
            # 스트림의 복호화기 맥락의 작업 스레드 수량을 2 값으로 설정
            self._stream.codec_context.thread_count = 2
            # 스트림의 시작 시간이 있는지 확인
            if self._stream.start_time is not None:
                # 시간에 필요한 입력을 전달해 처리
                time(self._stream.start_time, self._stream.time_base, origin=True)
                # 시작점 표시 시각 눈금에 스트림의 시작 시간 저장
                self.origin_pts = self._stream.start_time
                # 시작점 눈금당 초 단위 시간에 스트림의 눈금당 초 단위 시간 저장
                self.origin_time_base = self._stream.time_base
                # 시작점 원본을 스트림 시작 시간 값으로 설정
                self.origin_source = "STREAM_START_TIME"
                # 시작 밀리초 확인
                if self.start_ms:
                    # 대상에 시작점 표시 시각 눈금 및 수치 연산 결과의 정수 변환 결과의 합 저장
                    target = self.origin_pts + int(
                        Fraction(self.start_ms, 1000) / self.origin_time_base
                    )
                    # 영상 컨테이너의 읽기 또는 쓰기 위치를 대상으로 이동
                    self._container.seek(
                        target, stream=self._stream, backward=True, any_frame=False
                    )
                    # 파일 위치 이동 적용 여부를 참 값으로 설정
                    self.seek_applied = True
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception:
            # 영상 컨테이너의 열린 자원 정리
            self._container.close()
            # 영상 컨테이너를 아직 없는 상태로 초기화
            self._container = None
            # 현재 오류를 호출자에게 전달
            raise
        # 현재 객체 반환
        return self

    # 원본 순서로 표본을 제공
    def __iter__(self) -> Iterator[VideoSample]:
        # 영상 읽기 객체 아닌 준비됨을 감지해 잘못된 입력의 후속 사용 차단
        if self._container is None or self._iterated:
            # 영상 읽기 객체 아닌 준비됨 오류 알림
            raise ValueError("VIDEO_READER_NOT_READY")
        # 반복 사용 여부를 참 값으로 설정
        self._iterated = True
        # 이전 시간을 아직 없는 상태로 초기화
        previous_time = None
        # 다음 표본 예정 밀리초에 시작 밀리초 저장
        due_ms = self.start_ms
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 복호화 처리 결과에서 프레임을 하나씩 읽음
            for frame in self._container.decode(self._stream):
                # 순번에 복호화된 프레임 수량 저장
                index = self.decoded_frame_count
                # 복호화된 프레임 수량에 1을 더해 누적
                self.decoded_frame_count += 1
                # 영상 프레임 손상을 감지해 잘못된 입력의 후속 사용 차단
                if frame.is_corrupt:
                    # 영상 프레임 손상 오류 알림
                    raise ValueError("VIDEO_FRAME_CORRUPT")
                # 프레임 순번 대신 복호화기의 실제 표시 시각과 시간 기준으로 원본 시간 계산
                actual_time = time(frame.pts, frame.time_base)
                # 시각이 되돌아가거나 반복되면 원본 순서가 불명확하므로 처리 중단
                if previous_time is not None and actual_time <= previous_time:
                    # 시간축 아닌 시간순 오류 알림
                    raise ValueError("TIMELINE_NON_MONOTONIC")
                # 이전 시간에 실제 시간 저장
                previous_time = actual_time
                # 시작점 표시 시각 눈금이 없는지 확인
                if self.origin_pts is None:
                    # 시작점 표시 시각 눈금·시작점 눈금당 초 단위 시간을 다음 항목으로 구성
                    self.origin_pts, self.origin_time_base = frame.pts, frame.time_base
                    # 시작점 원본을 첫 번째 복호화된 프레임 값으로 설정
                    self.origin_source = "FIRST_DECODED_FRAME"
                # 실제 표시 시각에서 원본 시작점을 빼 유리수 정밀도의 경과 밀리초 계산
                relative_ms = (
                    actual_time - time(self.origin_pts, self.origin_time_base, origin=True)
                ) * 1000
                # 종료 밀리초가 있는지 및 상대 밀리초 및 종료 밀리초의 이상 조건 확인
                if self.end_ms is not None and relative_ms >= self.end_ms:
                    # 더 처리할 항목이 없거나 종료 조건을 충족해 반복 종료
                    break
                # 요청한 표본 시각보다 이른 프레임은 검출 없이 건너뛰기
                if relative_ms < due_ms:
                    # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                    continue
                # 영상 영상 크기 지원하지 않음을 감지해 잘못된 입력의 후속 사용 차단
                if (
                    frame.width <= 0
                    or frame.height <= 0
                    or frame.width * frame.height > MAX_FRAME_PIXELS
                ):
                    # 영상 영상 크기 지원하지 않음 오류 알림
                    raise ValueError("VIDEO_DIMENSIONS_UNSUPPORTED")
                # 삼원색 영상에 복호화한 삼원색 배열 저장
                rgb = frame.to_ndarray(format="rgb24")
                # 시각에 상대 밀리초의 반올림 값 저장
                timestamp = round(relative_ms)
                # 표본 수량에 1을 더해 누적
                self.sample_count += 1
                # 첫 번째 표본 밀리초가 없는지 확인
                if self.first_sample_ms is None:
                    # 첫 번째 표본 밀리초에 시각 저장
                    self.first_sample_ms = timestamp
                # 마지막 표본 밀리초에 시각 저장
                self.last_sample_ms = timestamp
                # 현재 표본을 기준으로 다음 정규 간격을 계산해 지연 누적 방지
                due_ms = (
                    self.start_ms
                    + (int((relative_ms - self.start_ms) // self.interval_ms) + 1)
                    * self.interval_ms
                )
                # 영상 표본 처리 결과를 다음 호출까지 한 건씩 제공
                yield VideoSample(
                    index,
                    self.stream_index,
                    frame.pts,
                    frame.time_base,
                    self.origin_pts,
                    self.origin_time_base,
                    timestamp,
                    rgb,
                )
            # 반복을 중간 종료하지 않고 끝까지 마친 경우 처리
            else:
                # 도달 여부 파일 끝을 참 값으로 설정
                self.reached_eof = True
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except self._av.error.FFmpegError as error:
            # 영상 복호화 실패 오류 알림
            raise ValueError("VIDEO_DECODE_FAILED") from error
        # 표본 수량이 비어 있거나 조건을 충족하지 않는지 확인
        if not self.sample_count:
            # 없음 영상 프레임 목록 내부 범위 오류 알림
            raise ValueError("NO_VIDEO_FRAMES_IN_RANGE")

    # 처리 자원 정리
    def __exit__(self, *_args: object) -> None:
        # 영상 컨테이너가 있는지 확인
        if self._container is not None:
            # 영상 컨테이너의 열린 자원 정리
            self._container.close()
            # 영상 컨테이너를 아직 없는 상태로 초기화
            self._container = None

    # 관측 값을 저장 계약에 맞는 직렬화 레코드로 변환
    def as_record(self) -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 스트림 순번 필드 기록
            "streamIndex": self.stream_index,
            # 시작점 표시 시각 눈금 필드 기록
            "originPts": self.origin_pts,
            # 시작점 시간 기준 필드 기록
            "originTimeBase": fractionRecord(self.origin_time_base),
            # 시작점 원본 필드 기록
            "originSource": self.origin_source,
            # 요청한 시작 밀리초 필드 기록
            "requestedStartMs": self.start_ms,
            # 요청한 종료 밀리초 필드 기록
            "requestedEndMs": self.end_ms,
            # 표본 간격 밀리초 필드 기록
            "sampleIntervalMs": self.interval_ms,
            # 복호화된 프레임 수량 필드 기록
            "decodedFrameCount": self.decoded_frame_count,
            # 표본 수량 필드 기록
            "sampleCount": self.sample_count,
            # 첫 번째 표본 밀리초 필드 기록
            "firstSampleMs": self.first_sample_ms,
            # 마지막 표본 밀리초 필드 기록
            "lastSampleMs": self.last_sample_ms,
            # 도달 여부 파일 끝 필드 기록
            "reachedEof": self.reached_eof,
            # 파일 위치 이동 적용 여부 필드 기록
            "seekApplied": self.seek_applied,
            # 복호화된 순번 범위 필드 기록
            "decodedIndexScope": "THIS_READER_AFTER_OPTIONAL_SEEK",
        }
