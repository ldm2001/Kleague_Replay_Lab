# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 명령행 옵션과 자료형을 검증할 도구 읽음
import argparse
# 파일 내용이 바뀌지 않았는지 비교할 해시 도구 읽음
import hashlib
# 기록과 설정을 직렬화할 도구 읽음
import json
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 재현을 위한 실행 플랫폼 조회 도구 읽음
import platform
# 식별자와 해시 문자열 형식을 검사할 도구 읽음
import re
# 실행 경로와 표준 입출력을 다룰 도구 읽음
import sys
# 실행 시간과 제한 시간을 측정할 도구 읽음
import time
# 설치 라이브러리 버전 조회 도구 읽음
from importlib.metadata import PackageNotFoundError, version
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any, Callable, Protocol
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 연속 구간 관련 함수와 자료형 읽음
from .continuity import AppearanceContinuity
# 영상 읽기 관련 함수와 자료형 읽음
from .media import VideoReader
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection
# 보고서 관련 함수와 자료형 읽음
from .report import ReportWriter
# 추적 관련 함수와 자료형 읽음
from .tracking import TrackAssociator


# 최댓값 실행 환경 초를 1800 값으로 설정
MAX_RUNTIME_SECONDS = 1800
# 최댓값 처리된 프레임 목록을 30000 값으로 설정
MAX_PROCESSED_FRAMES = 30_000


# 검출기의 필드와 동작을 묶을 자료형 선언
class Detector(Protocol):
    # 출처 정보를 보관할 자료형 선언
    provenance: dict[str, Any]

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(self, rgb: np.ndarray) -> tuple[Detection, ...]: ...

# 파일의 상태 정보를 수집해 처리 중 변경 여부를 비교
def fingerprint(path: Path) -> tuple[int, int, int, int]:
    # 파일 상태에 현재 파일 상태 저장
    stat = path.stat()
    # 여러 값을 순서대로 모은 자료 반환
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns

# 진단용 설치 라이브러리 버전 수집
def versions() -> dict[str, str | None]:
    # 버전 목록을 다음 항목으로 구성
    versions = {
        # 파이썬 필드 기록
        "python": platform.python_version(),
        # 실행 플랫폼 필드 기록
        "platform": platform.platform(),
        # 장치 구조 필드 기록
        "machine": platform.machine(),
    }
    # 여러 값을 순서대로 모은 자료에서 이름을 하나씩 읽음
    for name in (
        "torch",
        "torchvision",
        "transformers",
        "trackers",
        "supervision",
        "av",
        "numpy",
        "opencv-python",
    ):
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 버전 목록의 선택 항목에 버전 처리 결과 저장
            versions[name] = version(name)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except PackageNotFoundError:
            # 버전 목록의 선택 항목을 아직 없는 상태로 초기화
            versions[name] = None
    # 버전 목록 반환
    return versions

# 현재 프로세스의 최대 메모리 사용량을 바이트로 반환
def peakMemory() -> int | None:
    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 현재 프로세스의 자원 사용량 조회 도구 읽음
        import resource
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except ImportError:
        # 없음 반환
        return None
    # 최대에 프로세스 자원 사용량 처리 결과의 프로세스 자원 최대 상주 메모리 저장
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # 조건에 따라 선택한 최대의 정수 변환 결과 반환
    return int(peak if sys.platform == "darwin" else peak * 1024)

# 예외를 진단 계약에서 사용하는 실패 사유로 정리
def failureReason(error: Exception) -> str:
    # 문자열에 오류의 문자열 변환 결과 저장
    text = str(error)
    # 조건에 따라 선택한 문자열 반환
    return text if re.fullmatch(r"[A-Z][A-Z0-9_]{0,100}", text) else type(error).__name__

# 원본 영상을 검출·추적해 판정과 분리된 개발 진단을 저장
def inspection(
    source: Path | str,
    output: Path | str,
    detector: Detector,
    tracker: TrackAssociator | None = None,
    *,
    start_ms: int = 0,
    end_ms: int | None = None,
    interval_ms: int = 500,
    max_previews: int = 24,
    model_load_seconds: float = 0.0,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    # 시작 시각에 경과 시간 측정용 현재 시각 저장
    started = time.perf_counter()
    # 읽기 객체에 영상 읽기 객체 처리 결과 저장
    reader = VideoReader(source, start_ms=start_ms, end_ms=end_ms, interval_ms=interval_ms)
    # 원본 경로에 읽기 객체의 원본 저장
    source_path = reader.source
    # 출력 경로에 절대 경로 저장
    output_path = Path(output).expanduser().absolute()
    # 보고서 경로 존재 여부를 감지해 잘못된 입력의 후속 사용 차단
    if os.path.lexists(output_path):
        # 보고서 경로 존재 여부 오류 알림
        raise FileExistsError("REPORT_PATH_EXISTS")
    # 원본 아닌 찾은을 감지해 잘못된 입력의 후속 사용 차단
    if not source_path.is_file():
        # 원본 아닌 찾은 오류 알림
        raise ValueError("SOURCE_NOT_FOUND")
    # 초기 파일 상태 지문에 실행 중 교체 여부를 비교할 파일 지문 저장
    initial_fingerprint = fingerprint(source_path)
    # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
    with source_path.open("rb") as stream:
        # 원본 해시 256에 문자열로 표현한 내용 해시 저장
        source_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    # 영상 원본 변경을 감지해 잘못된 입력의 후속 사용 차단
    if fingerprint(source_path) != initial_fingerprint:
        # 영상 원본 변경 오류 알림
        raise ValueError("VIDEO_SOURCE_CHANGED")
    # 추적 연결기에 조건에 따라 선택한 추적기 저장
    associator = tracker if tracker is not None else TrackAssociator(frame_rate=1000 / interval_ms)
    # 연속 구간에 화면 외형 연속 구간 처리 결과 저장
    continuity = AppearanceContinuity()
    # 설정을 다음 항목으로 구성
    settings = {
        # 표본 간격 밀리초 필드 기록
        "sampleIntervalMs": interval_ms,
        # 시작 밀리초 필드 기록
        "startMs": start_ms,
        # 종료 밀리초 필드 기록
        "endMs": end_ms,
        # 연속 구간 필드 기록
        "continuity": continuity.provenance,
        # 실행 환경 버전 목록 필드 기록
        "runtimeVersions": versions(),
        # 상한 실행 환경 초 필드 기록
        "maximumRuntimeSeconds": MAX_RUNTIME_SECONDS,
        # 실행 환경 한도 강제 적용 시점 필드 기록
        "runtimeLimitEnforcement": "BETWEEN_SAMPLES",
        # 상한 처리된 프레임 목록 필드 기록
        "maximumProcessedFrames": MAX_PROCESSED_FRAMES,
        # 메모리 측정 기준 필드 기록
        "memoryMetric": "PROCESS_RSS_HIGH_WATER_NOT_GPU_MEMORY",
    }
    # 원본 정보를 다음 항목으로 구성
    source_info = {
        # 경로 필드 기록
        "path": str(source_path),
        # 내용 해시 필드 기록
        "sha256": source_sha256,
        # 크기 바이트 필드 기록
        "sizeBytes": initial_fingerprint[2],
    }
    # 추론한을 0 값으로 설정
    inferred = 0
    # 연결된을 0 값으로 설정
    associated = 0
    # 추론 초를 0점0 값으로 설정
    inference_seconds = 0.0
    # 연결 초를 0점0 값으로 설정
    association_seconds = 0.0

    # 단계별 소요 시간과 처리량을 진단 값으로 집계
    def timings() -> dict[str, Any]:
        # 필드별로 묶은 기록 반환
        return {
            # 모델 읽기 초 필드 기록
            "modelLoadSeconds": model_load_seconds,
            # 검출 실증 초 처리 전 마감 필드 기록
            "inspectionSecondsBeforeFinalization": time.perf_counter() - started,
            # 추론 초 필드 기록
            "inferenceSeconds": inference_seconds,
            # 연결 초 필드 기록
            "associationSeconds": association_seconds,
            # 추론한 프레임 수량 필드 기록
            "inferredFrameCount": inferred,
            # 연결된 프레임 수량 필드 기록
            "associatedFrameCount": associated,
            # 화면 외형 경계 수량 필드 기록
            "appearanceBoundaryCount": continuity.boundary_count,
            # 최대 프로세스 상주 메모리 바이트 필드 기록
            "peakProcessRssBytes": peakMemory(),
        }

    # 처리 종료 시 정리되도록 보고서 기록기 처리 결과 사용
    with ReportWriter(
        output_path,
        source=source_info,
        model=detector.provenance,
        tracker=associator.provenance,
        settings=settings,
        max_previews=max_previews,
    ) as report:
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 처리 종료 시 정리되도록 읽기 객체 사용
            with reader:
                # 읽기 객체에서 프레임을 하나씩 읽음
                for frame in reader:
                    # 검출 실증 실행 환경 한도를 감지해 잘못된 입력의 후속 사용 차단
                    if time.perf_counter() - started > MAX_RUNTIME_SECONDS:
                        # 검출 실증 실행 환경 한도 오류 알림
                        raise ValueError("INSPECTION_RUNTIME_LIMIT")
                    # 검출 실증 표본 한도를 감지해 잘못된 입력의 후속 사용 차단
                    if inferred >= MAX_PROCESSED_FRAMES:
                        # 검출 실증 표본 한도 오류 알림
                        raise ValueError("INSPECTION_SAMPLE_LIMIT")
                    # 맥락 식별자에 갱신 처리 결과 저장
                    context_id = continuity.update(frame.rgb)
                    # 추론 시작 시각에 경과 시간 측정용 현재 시각 저장
                    inference_started = time.perf_counter()
                    # 검출 목록에 확정 사실이 아닌 모델 관측 저장
                    detections = detector.predict(frame.rgb)
                    # 추론 경과 시간에 경과 시간 측정용 현재 시각 및 추론 시작 시각의 차이 저장
                    inference_elapsed = time.perf_counter() - inference_started
                    # 추론 초에 추론 경과 시간을 더해 누적
                    inference_seconds += inference_elapsed
                    # 추론한에 1을 더해 누적
                    inferred += 1
                    # 추적 시작 시각에 경과 시간 측정용 현재 시각 저장
                    tracking_started = time.perf_counter()
                    # 관측된에 갱신 처리 결과 저장
                    observed = associator.update(detections, frame.timestamp_ms, context_id)
                    # 연결 초에 경과 시간 측정용 현재 시각 및 추적 시작 시각의 차이를 더해 누적
                    association_seconds += time.perf_counter() - tracking_started
                    # 연결된에 1을 더해 누적
                    associated += 1
                    # 보고서에 프레임 추가
                    report.append(frame, observed, context_id, inference_elapsed)
                    # 진행 알림이 있는지 확인
                    if progress is not None:
                        # 진행 알림에 필요한 입력을 전달해 처리
                        progress(
                            {"inferredFrameCount": inferred, "timestampMs": frame.timestamp_ms}
                        )
            # 영상 원본 변경을 감지해 잘못된 입력의 후속 사용 차단
            if fingerprint(source_path) != initial_fingerprint:
                # 영상 원본 변경 오류 알림
                raise ValueError("VIDEO_SOURCE_CHANGED")
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception as error:
            # 마감 처리 결과 반환
            return report.finish(
                "FAILED",
                video=reader.as_record(),
                timings=timings(),
                failure_reason=failureReason(error),
            )
        # 마감 처리 결과 반환
        return report.finish("COMPLETE", video=reader.as_record(), timings=timings())

# 명령행 인자 검증과 진단·영상 작업 실행
def main() -> int:
    # 모델 자산 관련 함수와 자료형 읽음
    from .assets import directory

    # 명령행 해석기에 인자 명령행 해석기 처리 결과 저장
    parser = argparse.ArgumentParser(description="RT-DETR 검출과 ByteTrack 추적의 독립 진단")
    # 명령행에서 받을 원본의 형식과 기본값 등록
    parser.add_argument("source", type=Path)
    # 명령행에서 받을 출력의 형식과 기본값 등록
    parser.add_argument("output", type=Path)
    # 명령행에서 받을 지정 문자열의 형식과 기본값 등록
    parser.add_argument("--model-dir", type=Path, default=directory())
    # 명령행에서 받을 지정 문자열의 형식과 기본값 등록
    parser.add_argument("--device", choices=("cpu", "mps"), default="cpu")
    # 명령행에서 받을 지정 문자열의 형식과 기본값 등록
    parser.add_argument("--start-ms", type=int, default=0)
    # 명령행에서 받을 지정 문자열의 형식과 기본값 등록
    parser.add_argument("--end-ms", type=int)
    # 인자에 해석 인자 처리 결과 저장
    args = parser.parse_args()

    # 현재 단계와 처리량을 진행 상태 수신자에게 전달
    def progress(value: dict[str, Any]) -> None:
        # 값의 추론한 프레임 수량 및 1의 일치 조건 또는 수치 연산 결과 및 0의 일치 조건 확인
        if value["inferredFrameCount"] == 1 or value["inferredFrameCount"] % 100 == 0:
            # 진행 또는 진단 결과를 지정 출력에 표시
            print(
                f"frames={value['inferredFrameCount']} sourceMs={value['timestampMs']}",
                file=sys.stderr,
                flush=True,
            )

    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 검출기 관련 함수와 자료형 읽음
        from .detector import RtdetrDetector

        # 시작 시각에 경과 시간 측정용 현재 시각 저장
        started = time.perf_counter()
        # 검출기에 사람과 공 검출 모델 검출기 처리 결과 저장
        detector = RtdetrDetector(args.model_dir, device=args.device)
        # 읽은에 경과 시간 측정용 현재 시각 및 시작 시각의 차이 저장
        loaded = time.perf_counter() - started
        # 요약에 검출 실증 처리 결과 저장
        summary = inspection(
            args.source,
            args.output,
            detector,
            start_ms=args.start_ms,
            end_ms=args.end_ms,
            model_load_seconds=loaded,
            progress=progress,
        )
    # 발생한 예외를 받아 원인 보존과 후속 처리 수행
    except Exception as error:
        # 진행 또는 진단 결과를 지정 출력에 표시
        print(
            json.dumps({"status": "FAILED", "failureReason": failureReason(error)}), file=sys.stderr
        )
        # 1 반환
        return 1
    # 진행 또는 진단 결과를 지정 출력에 표시
    print(f"status={summary['status']} output={args.output.resolve()}")
    # 조건에 따라 선택한 0 반환
    return 0 if summary["status"] == "COMPLETE" else 1


# 실행 모듈 이름 및 주심의 일치 조건 확인
if __name__ == "__main__":
    # 현재 오류를 호출자에게 전달
    raise SystemExit(main())
