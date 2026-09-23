# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 명령행 옵션과 자료형을 검증할 도구 읽음
import argparse
# 여러 자원을 역순으로 정리할 문맥 도구 읽음
from contextlib import ExitStack
# 기록과 설정을 직렬화할 도구 읽음
import json
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
import math
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 실행 경로와 표준 입출력을 다룰 도구 읽음
import sys
# 실행 시간과 제한 시간을 측정할 도구 읽음
import time
# 입출력 자료형과 호출 규약 읽음
from typing import Any, Callable, Protocol
# 영상과 모델 결과를 배열로 다룰 수치 도구 읽음
import numpy as np
# 검출 실증 관련 함수와 자료형 읽음
from .inspection import failureReason, peakMemory, versions
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection
# 관측 보고서 관련 함수와 자료형 읽음
from .journal import ObservationReport
# 관측 목록 관련 함수와 자료형 읽음
from .observations import PoseObservation, RoleDetection
# 프레임 목록 관련 함수와 자료형 읽음
from .frames import RecordedFrames
# 대응 연결 관련 함수와 자료형 읽음
from .matching import MIN_IOU, MIN_IOU_MARGIN, MIN_ROLE_SCORE, assignments
# 동작 신호 관련 함수와 자료형 읽음
from .signals import ArmSignalTracker, armObservations


# 최댓값 실행 환경 초를 1800 값으로 설정
MAX_RUNTIME_SECONDS = 1800
# 최댓값 처리된 프레임 목록을 30000 값으로 설정
MAX_PROCESSED_FRAMES = 30_000


# 역할 모델의 필드와 동작을 묶을 자료형 선언
class RoleModel(Protocol):
    # 출처 정보를 보관할 자료형 선언
    provenance: dict[str, Any]
    # 마지막 좌표 변환을 보관할 자료형 선언
    last_transform: dict[str, Any] | None

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(self, rgb: np.ndarray) -> tuple[RoleDetection, ...]: ...


# 자세 모델의 필드와 동작을 묶을 자료형 선언
class PoseModel(Protocol):
    # 출처 정보를 보관할 자료형 선언
    provenance: dict[str, Any]

    # 고정된 로컬 모델로 현재 삼원색 표본의 관측을 추론
    def predict(
        self, rgb: np.ndarray, detections: tuple[Detection, ...]
    ) -> tuple[PoseObservation, ...]: ...

# 동일 원본 표본의 역할·자세 관측 결합
def observation(
    source: Path | str,
    upstream: Path | str,
    output: Path | str,
    role_detector: RoleModel,
    pose_estimator: PoseModel,
    *,
    max_previews: int = 24,
    progress: Callable[[dict[str, Any]], None] | None = None,
    model_load_seconds: dict[str, float] | None = None,
) -> dict[str, Any]:
    # 출력 경로에 절대 경로 저장
    output_path = Path(output).expanduser().absolute()
    # 보고서 경로 존재 여부를 감지해 잘못된 입력의 후속 사용 차단
    if os.path.lexists(output_path):
        # 보고서 경로 존재 여부 오류 알림
        raise FileExistsError("REPORT_PATH_EXISTS")
    # 최댓값 미리보기 목록의 자료 형식과 허용 조건 확인
    if type(max_previews) is not int or not 2 <= max_previews <= 24:
        # 최댓값 미리보기 목록 유효하지 않음 오류 알림
        raise ValueError("MAX_PREVIEWS_INVALID")
    # 읽기 소요 시간에 모델 읽기 초 또는 빈 사전의 사전 사본 변환 결과 저장
    loads = dict(model_load_seconds or {})
    # 모델 읽기 소요 시간의 자료 형식과 허용 조건 확인
    if any(
        type(value) not in (int, float) or not math.isfinite(value) or value < 0
        for value in loads.values()
    ):
        # 모델 읽기 소요 시간 유효하지 않음 오류 알림
        raise ValueError("MODEL_LOAD_TIMING_INVALID")
    # 시작 시각에 경과 시간 측정용 현재 시각 저장
    started = time.perf_counter()
    # 집계를 다음 항목으로 구성
    counts = {
        # 역할 시도한 프레임 수량 필드 기록
        "roleAttemptedFrameCount": 0,
        # 역할 추론한 프레임 수량 필드 기록
        "roleInferredFrameCount": 0,
        # 역할 대응 연결 프레임 수량 필드 기록
        "roleMatchingFrameCount": 0,
        # 자세 시도한 프레임 수량 필드 기록
        "poseAttemptedFrameCount": 0,
        # 자세 시도한 사람 수량 필드 기록
        "poseAttemptedPersonCount": 0,
        # 자세 추론한 프레임 수량 필드 기록
        "poseInferredFrameCount": 0,
        # 자세 추론한 사람 수량 필드 기록
        "poseInferredPersonCount": 0,
        # 팔 관측된 프레임 수량 필드 기록
        "armObservedFrameCount": 0,
    }
    # 누적을 다음 항목으로 구성
    accumulated = {"roleSeconds": 0., "matchingSeconds": 0., "poseSeconds": 0., "signalSeconds": 0.}
    # 정리 실패를 아직 없는 상태로 초기화
    cleanup_failure: str | None = None

    # 단계별 소요 시간과 처리량을 진단 값으로 집계
    def timings() -> dict[str, Any]:
        # 값을 다음 항목으로 구성
        value = {
            **counts,
            **accumulated,
            # 모델 읽기 초 필드 기록
            "modelLoadSeconds": loads,
            # 관측 초 처리 전 마감 필드 기록
            "observationSecondsBeforeFinalization": time.perf_counter() - started,
            # 최대 프로세스 상주 메모리 바이트 필드 기록
            "peakProcessRssBytes": peakMemory(),
        }
        # 정리 실패가 있는지 확인
        if cleanup_failure is not None:
            # 값의 정리 실패 사유에 정리 실패 저장
            value["cleanupFailureReason"] = cleanup_failure
        # 값 반환
        return value

    # 처리 종료 시 정리되도록 종료 자원 묶음 처리 결과 사용
    with ExitStack() as resources:
        # 재생에 진입 맥락 처리 결과 저장
        replay = resources.enter_context(RecordedFrames(source, upstream))
        # 출처 정보에 재생의 출처 정보 저장
        provenance = replay.provenance
        # 설정을 다음 항목으로 구성
        settings = {
            # 상위 단계 표본 추출 필드 기록
            "upstreamSampling": provenance["settings"],
            # 역할 대응 연결 필드 기록
            "roleMatching": {
                # 하한 역할 점수 필드 기록
                "minimumRoleScore": MIN_ROLE_SCORE,
                # 하한 입출력 합집합 비율 필드 기록
                "minimumIoU": MIN_IOU,
                # 하한 상호 입출력 합집합 비율 점수 차이 필드 기록
                "minimumMutualIoUMargin": MIN_IOU_MARGIN,
                # 방법 필드 기록
                "method": "MUTUAL_UNIQUE_BEST",
            },
            # 팔 관측 필드 기록
            "armObservation": {
                # 하한 관절점 점수 필드 기록
                "minimumKeypointScore": 0.5,
                # 하한 원본 상자 높이 필드 기록
                "minimumSourceBoxHeight": 64,
                # 하한 원본 상자 너비 필드 기록
                "minimumSourceBoxWidth": 12,
                # 하한 몸통 화소 수 필드 기록
                "minimumTorsoPixels": 8,
                # 하한 손목 상승량 몸통 비율 필드 기록
                "minimumWristRiseTorsoRatio": 0.25,
                # 하한 팔꿈치 각도 도 단위 필드 기록
                "minimumElbowAngleDegrees": 150,
                # 상한 세로 방향 각도 도 단위 필드 기록
                "maximumVerticalAngleDegrees": 30,
                # 하한 지지 관측 프레임 목록 필드 기록
                "minimumSupportFrames": 3,
                # 하한 지속 시간 밀리초 필드 기록
                "minimumDurationMs": 200,
                # 상한 관측 공백 밀리초 필드 기록
                "maximumGapMs": 250,
            },
            # 상한 실행 환경 초 필드 기록
            "maximumRuntimeSeconds": MAX_RUNTIME_SECONDS,
            # 실행 환경 한도 강제 적용 시점 필드 기록
            "runtimeLimitEnforcement": "BETWEEN_REPLAYED_FRAMES",
            # 상한 처리된 프레임 목록 필드 기록
            "maximumProcessedFrames": MAX_PROCESSED_FRAMES,
            # 메모리 측정 기준 필드 기록
            "memoryMetric": "PROCESS_RSS_HIGH_WATER_NOT_GPU_MEMORY",
            # 실행 환경 버전 목록 필드 기록
            "runtimeVersions": versions(),
        }
        # 상위 단계 정보를 다음 항목으로 구성
        upstream_info = {
            # 경로 필드 기록
            "path": str(replay.run_dir),
            **provenance["upstream"],
            # 원본 필드 기록
            "source": provenance["source"],
            # 설정 필드 기록
            "settings": provenance["settings"],
        }
        # 추적기에 팔 신호 단서 추적기 처리 결과 저장
        tracker = ArmSignalTracker()
        # 처리 종료 시 정리되도록 관측 보고서 처리 결과 사용
        with ObservationReport(
            output_path,
            source=replay.as_record()["source"],
            upstream=upstream_info,
            models={"role": role_detector.provenance, "pose": pose_estimator.provenance},
            settings=settings,
            max_previews=max_previews,
        ) as report:
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 재생에서 프레임을 하나씩 읽음
                for frame in replay:
                    # 관측 실행 환경 한도를 감지해 잘못된 입력의 후속 사용 차단
                    if time.perf_counter() - started > MAX_RUNTIME_SECONDS:
                        # 관측 실행 환경 한도 오류 알림
                        raise ValueError("OBSERVATION_RUNTIME_LIMIT")
                    # 관측 표본 한도를 감지해 잘못된 입력의 후속 사용 차단
                    if counts["roleAttemptedFrameCount"] >= MAX_PROCESSED_FRAMES:
                        # 관측 표본 한도 오류 알림
                        raise ValueError("OBSERVATION_SAMPLE_LIMIT")
                    # 단계를 모를 빈 자료 생성
                    stage = {}
                    # 단계 시작 시각에 경과 시간 측정용 현재 시각 저장
                    stage_started = time.perf_counter()
                    # 집계의 역할 시도한 프레임 수량에 1을 더해 누적
                    counts["roleAttemptedFrameCount"] += 1
                    # 원시 역할 목록에 확정 사실이 아닌 모델 관측 저장
                    raw_roles = role_detector.predict(frame.sample.rgb)
                    # 단계의 역할 초에 경과 시간 측정용 현재 시각 및 단계 시작 시각의 차이 저장
                    stage["roleSeconds"] = time.perf_counter() - stage_started
                    # 누적의 역할 초에 단계의 역할 초를 더해 누적
                    accumulated["roleSeconds"] += stage["roleSeconds"]
                    # 집계의 역할 추론한 프레임 수량에 1을 더해 누적
                    counts["roleInferredFrameCount"] += 1

                    # 단계 시작 시각에 경과 시간 측정용 현재 시각 저장
                    stage_started = time.perf_counter()
                    # 대응 결과에 상호 유일 최고 겹침으로 연결한 역할 가설 저장
                    matches = assignments(frame.detections, raw_roles)
                    # 집계의 역할 대응 연결 프레임 수량에 1을 더해 누적
                    counts["roleMatchingFrameCount"] += 1
                    # 선택된 식별자 목록에 대응 결과에서 조건에 맞는 항목을 모은 값 저장
                    selected_ids = {
                        match.detection_id for match in matches if match.status == "MATCHED"
                    }
                    # 사람 목록에 검출 목록에서 조건에 맞는 항목을 모은 값의 순서를 고정한 튜플 변환 결과 저장
                    people = tuple(
                        detection
                        for detection in frame.detections
                        if detection.detection_id in selected_ids
                    )
                    # 단계의 대응 연결 초에 경과 시간 측정용 현재 시각 및 단계 시작 시각의 차이 저장
                    stage["matchingSeconds"] = time.perf_counter() - stage_started
                    # 누적의 대응 연결 초에 단계의 대응 연결 초를 더해 누적
                    accumulated["matchingSeconds"] += stage["matchingSeconds"]

                    # 단계 시작 시각에 경과 시간 측정용 현재 시각 저장
                    stage_started = time.perf_counter()
                    # 자세 목록을 모를 빈 자료 생성
                    poses: tuple[PoseObservation, ...] = ()
                    # 사람 목록 확인
                    if people:
                        # 집계의 자세 시도한 프레임 수량에 1을 더해 누적
                        counts["poseAttemptedFrameCount"] += 1
                        # 집계의 자세 시도한 사람 수량에 사람 목록의 항목 수를 더해 누적
                        counts["poseAttemptedPersonCount"] += len(people)
                        # 자세 목록에 확정 사실이 아닌 모델 관측 저장
                        poses = pose_estimator.predict(frame.sample.rgb, people)
                        # 자세 출력 불일치를 감지해 잘못된 입력의 후속 사용 차단
                        if (
                            not isinstance(poses, tuple)
                            or any(not isinstance(pose, PoseObservation) for pose in poses)
                            or tuple(pose.detection_id for pose in poses)
                            != tuple(person.detection_id for person in people)
                            or any(
                                pose.source_box != person.box for pose, person in zip(poses, people)
                            )
                        ):
                            # 자세 출력 불일치 오류 알림
                            raise ValueError("POSE_OUTPUT_MISMATCH")
                        # 집계의 자세 추론한 프레임 수량에 1을 더해 누적
                        counts["poseInferredFrameCount"] += 1
                        # 집계의 자세 추론한 사람 수량에 자세 목록의 항목 수를 더해 누적
                        counts["poseInferredPersonCount"] += len(poses)
                    # 단계의 자세 초에 경과 시간 측정용 현재 시각 및 단계 시작 시각의 차이 저장
                    stage["poseSeconds"] = time.perf_counter() - stage_started
                    # 누적의 자세 초에 단계의 자세 초를 더해 누적
                    accumulated["poseSeconds"] += stage["poseSeconds"]

                    # 단계 시작 시각에 경과 시간 측정용 현재 시각 저장
                    stage_started = time.perf_counter()
                    # 높이·너비에 삼원색 영상의 배열 크기의 선택 항목 저장
                    height, width = frame.sample.rgb.shape[:2]
                    # 팔 목록에 자세 목록의 항목별 변환 결과의 순서를 고정한 튜플 변환 결과 저장
                    arms = tuple(
                        arm for pose in poses for arm in armObservations(pose, width, height)
                    )
                    # 관측 구간 목록에 갱신 처리 결과 저장
                    episodes = tracker.update(frame, matches, poses)
                    # 집계의 팔 관측된 프레임 수량에 1을 더해 누적
                    counts["armObservedFrameCount"] += 1
                    # 단계의 신호 단서 초에 경과 시간 측정용 현재 시각 및 단계 시작 시각의 차이 저장
                    stage["signalSeconds"] = time.perf_counter() - stage_started
                    # 누적의 신호 단서 초에 단계의 신호 단서 초를 더해 누적
                    accumulated["signalSeconds"] += stage["signalSeconds"]
                    # 보고서에 추가
                    report.append(
                        frame=frame,
                        roles_raw=raw_roles,
                        roles_matched=matches,
                        poses=poses,
                        arms=arms,
                        episodes=episodes,
                        timings=stage,
                        role_input_transform=role_detector.last_transform,
                    )
                    # 진행 알림이 있는지 확인
                    if progress is not None:
                        # 진행 알림에 필요한 입력을 전달해 처리
                        progress(
                            {
                                # 다시 읽은 프레임 수량 필드 기록
                                "replayedFrameCount": replay.as_record()["replayedFrameCount"],
                                # 시각 밀리초 필드 기록
                                "timestampMs": frame.sample.timestamp_ms,
                                # 연결된 사람 수량 필드 기록
                                "matchedPersonCount": len(people),
                            }
                        )
                # 자원 묶음의 열린 자원 정리
                resources.close()
                # 관측 구간 목록에 필요한 입력을 전달해 처리
                report.episodes(tracker.finish())
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception as error:
                # 실패 시 아래 예외 처리로 정리할 작업 시작
                try:
                    # 자원 묶음의 열린 자원 정리
                    resources.close()
                # 발생한 예외를 받아 원인 보존과 후속 처리 수행
                except Exception as close_error:
                    # 정리 실패에 진단용 실패 사유 저장
                    cleanup_failure = failureReason(close_error)
                # 마감 처리 결과 반환
                return report.finish(
                    "FAILED",
                    replay=replay.as_record(),
                    timings=timings(),
                    failure_reason=failureReason(error),
                )
            # 마감 처리 결과 반환
            return report.finish("COMPLETE", replay=replay.as_record(), timings=timings())

# 명령행 인자 검증과 진단·영상 작업 실행
def main() -> int:
    # 모델 가중치 관련 함수와 자료형 읽음
    from .weights import directory

    # 명령행 해석기에 인자 명령행 해석기 처리 결과 저장
    parser = argparse.ArgumentParser(description="기존 검출 기록과 원본의 역할·자세·팔 동작 독립 관측")
    # 명령행에서 받을 원본의 형식과 기본값 등록
    parser.add_argument("source", type=Path)
    # 명령행에서 받을 상위 단계의 형식과 기본값 등록
    parser.add_argument("upstream", type=Path)
    # 명령행에서 받을 출력의 형식과 기본값 등록
    parser.add_argument("output", type=Path)
    # 명령행에서 받을 지정 문자열의 형식과 기본값 등록
    parser.add_argument("--device", choices=("cpu", "mps"), default="cpu")
    # 명령행에서 받을 지정 문자열의 형식과 기본값 등록
    parser.add_argument("--role-model-dir", type=Path, default=directory("role"))
    # 명령행에서 받을 지정 문자열의 형식과 기본값 등록
    parser.add_argument("--pose-model-dir", type=Path, default=directory("pose"))
    # 인자에 해석 인자 처리 결과 저장
    args = parser.parse_args()

    # 현재 단계와 처리량을 진행 상태 수신자에게 전달
    def progress(event: dict[str, Any]) -> None:
        # 수량에 이벤트의 다시 읽은 프레임 수량 저장
        count = event["replayedFrameCount"]
        # 수량 및 1의 일치 조건 또는 수치 연산 결과 및 0의 일치 조건 확인
        if count == 1 or count % 50 == 0:
            # 진행 또는 진단 결과를 지정 출력에 표시
            print(
                f"frames={count} sourceMs={event['timestampMs']} matched={event['matchedPersonCount']}",
                file=sys.stderr,
                flush=True,
            )

    # 실패 시 아래 예외 처리로 정리할 작업 시작
    try:
        # 보고서 경로 존재 여부를 감지해 잘못된 입력의 후속 사용 차단
        if os.path.lexists(args.output.expanduser().absolute()):
            # 보고서 경로 존재 여부 오류 알림
            raise FileExistsError("REPORT_PATH_EXISTS")
        # 원본 아닌 찾은을 감지해 잘못된 입력의 후속 사용 차단
        if not args.source.expanduser().is_file():
            # 원본 아닌 찾은 오류 알림
            raise ValueError("SOURCE_NOT_FOUND")
        # 상위 단계 입력 아닌 찾은을 감지해 잘못된 입력의 후속 사용 차단
        if not all(
            (args.upstream.expanduser() / name).is_file()
            for name in ("summary.json", "frames.jsonl")
        ):
            # 상위 단계 입력 아닌 찾은 오류 알림
            raise ValueError("UPSTREAM_INPUT_NOT_FOUND")
        # 역할 목록 관련 함수와 자료형 읽음
        from .roles import YoloRoleDetector
        # 자세 관련 함수와 자료형 읽음
        from .pose import VitPoseEstimator

        # 시작 시각에 경과 시간 측정용 현재 시각 저장
        started = time.perf_counter()
        # 역할에 역할 검출 모델 역할 검출기 처리 결과 저장
        role = YoloRoleDetector(args.role_model_dir, device=args.device)
        # 역할 읽기에 경과 시간 측정용 현재 시각 및 시작 시각의 차이 저장
        role_load = time.perf_counter() - started
        # 시작 시각에 경과 시간 측정용 현재 시각 저장
        started = time.perf_counter()
        # 자세에 자세 모델 자세 추정기 처리 결과 저장
        pose = VitPoseEstimator(args.pose_model_dir, device=args.device)
        # 자세 읽기에 경과 시간 측정용 현재 시각 및 시작 시각의 차이 저장
        pose_load = time.perf_counter() - started
        # 요약에 관측 처리 결과 저장
        summary = observation(
            args.source,
            args.upstream,
            args.output,
            role,
            pose,
            progress=progress,
            model_load_seconds={"role": role_load, "pose": pose_load},
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
    print(f"status={summary['status']} admission=NOT_ADMITTED output={args.output.resolve()}")
    # 조건에 따라 선택한 0 반환
    return 0 if summary["status"] == "COMPLETE" else 1


# 실행 모듈 이름 및 주심의 일치 조건 확인
if __name__ == "__main__":
    # 현재 오류를 호출자에게 전달
    raise SystemExit(main())
