# 아직 선언하지 않은 자료형도 표기에 사용할 수 있도록 해석 시점 연기
from __future__ import annotations
# 기록과 설정을 직렬화할 도구 읽음
import json
# 파일 핸들과 환경 변수를 다룰 운영체제 도구 읽음
import os
# 필드 중심 자료 객체를 선언할 도구 읽음
from dataclasses import dataclass
# 거리와 유한 수치 검사를 위한 수학 도구 읽음
from math import isfinite
# 불리언과 수치 자료형을 구별할 기준 읽음
from numbers import Real
# 파일 경로를 운영체제에 맞춰 다룰 도구 읽음
from pathlib import Path
# 입출력 자료형과 호출 규약 읽음
from typing import Any, TextIO
# 영상 읽기 관련 함수와 자료형 읽음
from .media import VideoSample
# 모델 목록 관련 함수와 자료형 읽음
from .models import Detection, LABELS
# 미리보기 관련 함수와 자료형 읽음
from .preview import preview


# 이 실증에서 평가하지 않은 축구 판단 목록을 다음 항목으로 구성
_NOT_ASSESSED = ["actorRoles", "refereeSignals", "contact", "foul", "restarts", "liveReplay"]

# 유한한 수치만 허용하는 직렬화 자료 문자열을 생성
def jsonText(value: object) -> str:
    # 저장용 직렬화 문자열 반환
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

# 직렬화 자료 직렬화를 통해 입력과 독립된 기록 사본을 생성
def jsonClone(value: dict[str, Any]) -> dict[str, Any]:
    # 보고서 메타데이터의 자료 형식과 허용 조건 확인
    if not isinstance(value, dict):
        # 보고서 메타데이터 유효하지 않음 오류 알림
        raise TypeError("REPORT_METADATA_INVALID")
    # 직렬화 문자열을 해석한 자료 반환
    return json.loads(jsonText(value))

# 끊어진 심볼릭 링크까지 포함해 출력 경로의 기존 점유를 확인
def pathExists(path: Path) -> bool:
    # 끊어진 링크까지 포함한 경로 점유 여부 반환
    return os.path.lexists(path)

# 출력 경로의 버전 관리 작업 폴더 내부 여부 확인
def gitWorktree(path: Path) -> bool:
    # 상위 경로에 심볼릭 링크를 해석한 경로 저장
    parent = path.parent.resolve(strict=False)
    # 상위 경로·상위 경로 목록의 펼친 값의 항목별 변환 결과의 하나 이상 조건 충족 여부 반환
    return any(pathExists(ancestor / ".git") for ancestor in (parent, *parent.parents))


# 미리보기 후보의 필드와 동작을 묶을 자료형 선언
@dataclass(frozen=True, slots=True)
class _PreviewCandidate:
    # 기록된 순번을 보관할 자료형 선언
    recorded_index: int
    # 압축 이미지를 보관할 자료형 선언
    jpeg: bytes
    # 기록을 보관할 자료형 선언
    record: dict[str, Any]


# 보고서 기록기의 필드와 동작을 묶을 자료형 선언
class ReportWriter:

    # 초기 상태·입력 계약 구성
    def __init__(
        self,
        output: Path,
        *,
        source: dict[str, Any],
        model: dict[str, Any],
        tracker: dict[str, Any],
        settings: dict[str, Any],
        max_previews: int = 24,
    ) -> None:
        # 최댓값 미리보기 목록의 자료 형식과 허용 조건 확인
        if type(max_previews) is not int or not 2 <= max_previews <= 24:
            # 최댓값 미리보기 목록 유효하지 않음 오류 알림
            raise ValueError("MAX_PREVIEWS_INVALID")
        # 출력에 절대 경로 저장
        self.output = Path(output).expanduser().absolute()
        # 원본에 직렬화로 원본과 분리한 기록 사본 저장
        self.source = jsonClone(source)
        # 모델에 직렬화로 원본과 분리한 기록 사본 저장
        self.model = jsonClone(model)
        # 추적기에 직렬화로 원본과 분리한 기록 사본 저장
        self.tracker = jsonClone(tracker)
        # 설정에 직렬화로 원본과 분리한 기록 사본 저장
        self.settings = jsonClone(settings)
        # 원본 256 없는을 감지해 잘못된 입력의 후속 사용 차단
        if not isinstance(self.source.get("sha256"), str) or not self.source["sha256"]:
            # 원본 256 없는 오류 알림
            raise ValueError("SOURCE_SHA256_MISSING")
        # 최댓값 미리보기 목록에 최댓값 미리보기 목록 저장
        self.max_previews = max_previews

        # 진입 여부를 거짓 값으로 설정
        self._entered = False
        # 마감 호출 여부를 거짓 값으로 설정
        self._finish_called = False
        # 요약 기록한을 거짓 값으로 설정
        self._summary_written = False
        # 진단 스트림을 아직 없는 상태로 초기화
        self._trace: TextIO | None = None
        # 기록된 프레임 수량을 0 값으로 설정
        self._recorded_frame_count = 0
        # 검출 집계에 레이블 목록의 항목별 변환 결과 저장
        self._detection_counts = {label: 0 for label in LABELS}
        # 프레임 목록 포함 검출에 레이블 목록의 항목별 변환 결과 저장
        self._frames_with_detection = {label: 0 for label in LABELS}
        # 추적된 관측 수량을 0 값으로 설정
        self._tracked_observation_count = 0
        # 추적 식별자 목록에 레이블 목록의 항목별 변환 결과 저장
        self._track_ids = {label: set() for label in LABELS}
        # 미리보기 간격을 1 값으로 설정
        self._preview_stride = 1
        # 미리보기 간격별 표본을 모를 빈 자료 생성
        self._preview_grid: list[_PreviewCandidate] = []
        # 마지막 미리보기를 아직 없는 상태로 초기화
        self._last_preview: _PreviewCandidate | None = None
        # 기록한 미리보기 목록을 모를 빈 자료 생성
        self._written_previews: dict[int, dict[str, Any]] = {}
        # 마감 영상을 모를 빈 자료 생성
        self._finalization_video: dict[str, Any] = {}
        # 마감 단계별 소요 시간을 모를 빈 자료 생성
        self._finalization_timings: dict[str, Any] = {}

    # 처리 자원 준비
    def __enter__(self) -> ReportWriter:
        # 보고서 기록기 이미 진입 여부를 감지해 잘못된 입력의 후속 사용 차단
        if self._entered:
            # 보고서 기록기 이미 진입 여부 오류 알림
            raise RuntimeError("REPORT_WRITER_ALREADY_ENTERED")
        # 경로 존재 여부 처리 결과 확인
        if pathExists(self.output):
            # 현재 오류를 호출자에게 전달
            raise FileExistsError(self.output)
        # 출력 내부 버전 관리 작업 폴더를 감지해 잘못된 입력의 후속 사용 차단
        if gitWorktree(self.output):
            # 출력 내부 버전 관리 작업 폴더 오류 알림
            raise ValueError("OUTPUT_INSIDE_GIT_WORKTREE")
        # 출력에 필요한 출력 폴더 생성
        self.output.mkdir(parents=True, exist_ok=False)
        # 출력 및 프레임 목록의 비율에 필요한 출력 폴더 생성
        (self.output / "frames").mkdir(exist_ok=False)
        # 진단 스트림에 열린 파일 또는 영상 스트림 저장
        self._trace = (self.output / "frames.jsonl").open("x", encoding="utf-8", newline="\n")
        # 진입 여부를 참 값으로 설정
        self._entered = True
        # 현재 객체 반환
        return self

    # 보고서가 기록 가능한 상태인지 확인하고 열린 스트림을 반환
    def activeStreams(self) -> TextIO:
        # 보고서 기록기 아닌 활성을 감지해 잘못된 입력의 후속 사용 차단
        if not self._entered or self._trace is None or self._trace.closed:
            # 보고서 기록기 아닌 활성 오류 알림
            raise RuntimeError("REPORT_WRITER_NOT_ACTIVE")
        # 보고서 이미 종료 여부를 감지해 잘못된 입력의 후속 사용 차단
        if self._finish_called:
            # 보고서 이미 종료 여부 오류 알림
            raise RuntimeError("REPORT_ALREADY_FINISHED")
        # 진단 스트림 반환
        return self._trace

    # 프레임·검출·추적을 원본 시각과 함께 기록하고 미리보기 후보를 보존
    def append(
        self,
        frame: VideoSample,
        detections: tuple[Detection, ...],
        continuity_id: int,
        inference_seconds: float,
    ) -> None:
        # 진단 스트림에 활성 스트림 목록 처리 결과 저장
        trace = self.activeStreams()
        # 보고서 프레임의 자료 형식과 허용 조건 확인
        if not isinstance(frame, VideoSample):
            # 보고서 프레임 유효하지 않음 오류 알림
            raise TypeError("REPORT_FRAME_INVALID")
        # 보고서 검출 목록의 자료 형식과 허용 조건 확인
        if not isinstance(detections, tuple) or not all(
            isinstance(value, Detection) for value in detections
        ):
            # 보고서 검출 목록 유효하지 않음 오류 알림
            raise TypeError("REPORT_DETECTIONS_INVALID")
        # 연속 구간 식별자의 자료 형식과 허용 조건 확인
        if type(continuity_id) is not int or continuity_id < 0:
            # 연속 구간 식별자 유효하지 않음 오류 알림
            raise ValueError("CONTINUITY_ID_INVALID")
        # 추론 초의 자료 형식과 허용 조건 확인
        if (
            not isinstance(inference_seconds, Real)
            or isinstance(inference_seconds, bool)
            or not isfinite(inference_seconds)
            or inference_seconds < 0
        ):
            # 추론 초 유효하지 않음 오류 알림
            raise ValueError("INFERENCE_SECONDS_INVALID")

        # 행을 다음 항목으로 구성
        row = {
            # 원본 해시 256 필드 기록
            "sourceSha256": self.source["sha256"],
            **frame.as_record(),
            # 연속 구간 식별자 필드 기록
            "continuityId": continuity_id,
            # 생중계와 재생의 구별 상태를 미승인 또는 미확인 상태로 보존
            "replayState": "UNKNOWN",
            # 검출 목록 필드 기록
            "detections": [detection.as_record() for detection in detections],
            # 추론 초 필드 기록
            "inferenceSeconds": float(inference_seconds),
        }
        # 줄에 유한한 수치만 포함한 저장 문자열 및 지정 문자열의 합 저장
        line = jsonText(row) + "\n"
        # 한 줄 쓰기가 실패할 때 불완전한 기록을 제거할 시작 위치 보존
        position = trace.tell()
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 진단 스트림에 줄 기록
            trace.write(line)
            # 진단 스트림의 메모리 버퍼를 출력 스트림에 반영
            trace.flush()
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception:
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 진단 스트림의 읽기 또는 쓰기 위치를 기록 위치으로 이동
                trace.seek(position)
                # 진단 스트림의 현재 위치 뒤 불완전한 기록 제거
                trace.truncate()
                # 진단 스트림의 메모리 버퍼를 출력 스트림에 반영
                trace.flush()
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception:
                # 이 분기에서 추가 작업 없이 기존 처리 흐름 유지
                pass
            # 현재 오류를 호출자에게 전달
            raise

        # 기록된 순번에 기록된 프레임 수량 저장
        recorded_index = self._recorded_frame_count
        # 기록이 정상 반영된 뒤에만 저장 프레임 수 증가
        self._recorded_frame_count += 1
        # 존재하는 레이블 목록에 빈 중복을 없앤 집합 저장
        present_labels = set()
        # 검출 목록에서 검출을 하나씩 읽음
        for detection in detections:
            # 검출 집계의 선택 항목에 1을 더해 누적
            self._detection_counts[detection.label] += 1
            # 존재하는 레이블 목록에 검출의 레이블을 중복 없이 추가
            present_labels.add(detection.label)
            # 검출의 구간 안에서만 유효한 추적 식별자가 있는지 확인
            if detection.track_id is not None:
                # 추적된 관측 수량에 1을 더해 누적
                self._tracked_observation_count += 1
                # 추적 식별자 목록의 선택 항목에 검출의 구간 안에서만 유효한 추적 식별자를 중복 없이 추가
                self._track_ids[detection.label].add(detection.track_id)
        # 존재하는 레이블 목록에서 레이블을 하나씩 읽음
        for label in present_labels:
            # 프레임 목록 포함 검출의 선택 항목에 1을 더해 누적
            self._frames_with_detection[label] += 1
        # 미리보기 보존에 필요한 입력을 전달해 처리
        self.previewRetention(recorded_index, frame, detections)

    # 메모리 상한 안에서 미리보기 후보 프레임을 보존
    def previewRetention(
        self, recorded_index: int, frame: VideoSample, detections: tuple[Detection, ...]
    ) -> None:
        # 압축 이미지·기록에 판정과 구분해 표시한 미리보기 저장
        jpeg, record = preview(frame, detections)
        # 후보에 미리보기 후보 처리 결과 저장
        candidate = _PreviewCandidate(recorded_index, jpeg, record)
        # 기록된 순번 및 미리보기 간격의 나머지 및 0의 일치 조건 확인
        if recorded_index % self._preview_stride == 0:
            # 미리보기 간격별 표본에 후보 추가
            self._preview_grid.append(candidate)
        # 간격별 표본 한도에 최댓값 미리보기 목록 및 1의 차이 저장
        grid_limit = self.max_previews - 1
        # 미리보기 간격별 표본의 항목 수 및 간격별 표본 한도의 초과 조건을 만족하는 동안 반복
        while len(self._preview_grid) > grid_limit:
            # 보존 후보가 상한을 넘으면 표본 간격을 두 배로 늘려 메모리 사용 제한
            self._preview_stride *= 2
            # 미리보기 간격별 표본에 미리보기 간격별 표본에서 조건에 맞는 항목을 모은 값 저장
            self._preview_grid = [
                retained
                for retained in self._preview_grid
                if retained.recorded_index % self._preview_stride == 0
            ]
        # 마지막 미리보기에 후보 저장
        self._last_preview = candidate

    # 진단 구간을 대표하도록 보존된 미리보기 후보를 선택
    def selectedPreviews(self) -> list[_PreviewCandidate]:
        # 선택 결과에 미리보기 간격별 표본의 목록 변환 결과 저장
        selected = list(self._preview_grid)
        # 마지막 미리보기가 있는지 및 선택 결과의 항목별 변환 결과의 전체 조건 충족 여부 확인
        if self._last_preview is not None and all(
            item.recorded_index != self._last_preview.recorded_index for item in selected
        ):
            # 선택 결과에 마지막 미리보기 추가
            selected.append(self._last_preview)
        # 선택 결과를 지정한 비교 기준으로 정렬
        selected.sort(key=lambda item: item.recorded_index)
        # 선택 결과의 선택 항목 반환
        return selected[: self.max_previews]

    # 선택한 진단 표본을 미리보기 이미지 파일로 저장
    def previewFiles(self, *, strict: bool) -> list[dict[str, Any]]:
        # 기록 목록을 모를 빈 자료 생성
        records: list[dict[str, Any]] = []
        # 순번을 붙인 항목 목록에서 저장 순서·후보를 하나씩 읽음
        for ordinal, candidate in enumerate(self.selectedPreviews()):
            # 기존에 후보의 기록된 순번의 키에 해당하는 값 저장
            existing = self._written_previews.get(candidate.recorded_index)
            # 이미 저장한 기록이 있는지 확인
            if existing is not None:
                # 기록 목록에 기존 추가
                records.append(existing)
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 상대 경로에 파일 경로 객체 및 현재 값을 포함한 문자열의 비율 저장
            relative_path = (
                Path("frames") / f"preview-{ordinal:04d}-frame-{candidate.recorded_index:08d}.jpg"
            )
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
                with (self.output / relative_path).open("xb") as destination:
                    # 대상 파일에 후보의 압축 이미지 기록
                    destination.write(candidate.jpeg)
                    # 대상 파일의 메모리 버퍼를 출력 스트림에 반영
                    destination.flush()
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception:
                # 엄격한 오류 처리 확인
                if strict:
                    # 현재 오류를 호출자에게 전달
                    raise
                # 현재 항목의 남은 처리를 생략하고 다음 항목 확인
                continue
            # 기록을 다음 항목으로 구성
            record = {"path": relative_path.as_posix(), **candidate.record}
            # 기록한 미리보기 목록의 선택 항목에 기록 저장
            self._written_previews[candidate.recorded_index] = record
            # 기록 목록에 기록 추가
            records.append(record)
        # 기록 목록을 지정한 비교 기준으로 정렬
        records.sort(key=lambda value: value["timestampMs"])
        # 기록 목록 반환
        return records

    # 기록한 표본과 검출 및 추적의 누적 수량을 집계
    def counts(self) -> dict[str, Any]:
        # 중복 없는 기준 레이블에 레이블 목록의 항목별 변환 결과 저장
        unique_by_label = {label: len(self._track_ids[label]) for label in LABELS}
        # 전체 추적 식별자 목록에 합집합 면적 처리 결과 저장
        all_track_ids = set().union(*self._track_ids.values())
        # 필드별로 묶은 기록 반환
        return {
            # 기록된 프레임 수량 필드 기록
            "recordedFrameCount": self._recorded_frame_count,
            # 검출 수량 필드 기록
            "detectionCount": sum(self._detection_counts.values()),
            # 검출 목록 기준 레이블 필드 기록
            "detectionsByLabel": dict(self._detection_counts),
            # 프레임 목록 포함 검출 기준 레이블 필드 기록
            "framesWithDetectionByLabel": dict(self._frames_with_detection),
            # 추적된 관측 수량 필드 기록
            "trackedObservationCount": self._tracked_observation_count,
            # 중복 없는 추적 식별자 수량 필드 기록
            "uniqueTrackIdCount": len(all_track_ids),
            # 중복 없는 추적 식별자 수량 기준 레이블 필드 기록
            "uniqueTrackIdCountByLabel": unique_by_label,
        }

    # 진단 수량과 처리 범위 및 제한사항을 최종 요약으로 구성
    def summary(
        self,
        status: str,
        *,
        video: dict[str, Any],
        timings: dict[str, Any],
        previews: list[dict[str, Any]],
        failure_reason: str | None,
    ) -> dict[str, Any]:
        # 값을 다음 항목으로 구성
        value: dict[str, Any] = {
            # 계약 버전 필드 기록
            "schemaVersion": 1,
            # 상태 필드 기록
            "status": status,
            # 관측 결과를 규정 판단에 사용할 승인된 사실로 승격하지 않도록 상태 기록
            "admission": "NOT_ADMITTED",
            # 원본 필드 기록
            "source": self.source,
            # 모델 필드 기록
            "model": self.model,
            # 추적기 필드 기록
            "tracker": self.tracker,
            # 설정 필드 기록
            "settings": self.settings,
            # 영상 필드 기록
            "video": video,
            # 단계별 소요 시간 필드 기록
            "timings": timings,
            # 집계 필드 기록
            "counts": self.counts(),
            # 미리보기 목록 필드 기록
            "previews": previews,
            # 처리 성공을 전체 파울 판정 성공으로 오인하지 않도록 작업 범위 기록
            "scope": "OBJECT_DETECTION_AND_TRACKING_ONLY",
            # 아닌 평가 대상 필드 기록
            "notAssessed": list(_NOT_ASSESSED),
        }
        # 실패 사유가 있는지 확인
        if failure_reason is not None:
            # 값의 실패 사유에 실패 사유 저장
            value["failureReason"] = failure_reason
        # 값 반환
        return value

    # 요약 기록
    def summaryFile(self, summary: dict[str, Any]) -> None:
        # 직렬화한에 유한한 수치만 포함한 저장 문자열 및 지정 문자열의 합 저장
        serialized = jsonText(summary) + "\n"
        # 처리 종료 시 정리되도록 열린 파일 또는 영상 스트림 사용
        with (self.output / "summary.json").open(
            "x", encoding="utf-8", newline="\n"
        ) as destination:
            # 대상 파일에 직렬화한 기록
            destination.write(serialized)
            # 대상 파일의 메모리 버퍼를 출력 스트림에 반영
            destination.flush()
        # 요약 기록한을 참 값으로 설정
        self._summary_written = True

    # 원시 기록과 미리보기를 마감하고 최종 처리 상태를 요약 파일에 저장
    def finish(
        self,
        status: str,
        *,
        video: dict[str, Any],
        timings: dict[str, Any],
        failure_reason: str | None = None,
    ) -> dict[str, Any]:
        # 활성 스트림 목록에 필요한 입력을 전달해 처리
        self.activeStreams()
        # 마감 호출 여부를 참 값으로 설정
        self._finish_called = True
        # 보고서 상태의 자료 형식과 허용 조건 확인
        if status not in {"COMPLETE", "FAILED"}:
            # 보고서 상태 유효하지 않음 오류 알림
            raise ValueError("REPORT_STATUS_INVALID")
        # 실패 필요 실패 사유를 감지해 잘못된 입력의 후속 사용 차단
        if status == "FAILED" and (
            not isinstance(failure_reason, str) or not failure_reason.strip()
        ):
            # 실패 필요 실패 사유 오류 알림
            raise ValueError("FAILED_REQUIRES_FAILURE_REASON")
        # 완료 허용하지 않음 실패 사유를 감지해 잘못된 입력의 후속 사용 차단
        if status == "COMPLETE" and failure_reason is not None:
            # 완료 허용하지 않음 실패 사유 오류 알림
            raise ValueError("COMPLETE_FORBIDS_FAILURE_REASON")
        # 정규화한 영상에 직렬화로 원본과 분리한 기록 사본 저장
        normalized_video = jsonClone(video)
        # 정규화한 단계별 소요 시간에 직렬화로 원본과 분리한 기록 사본 저장
        normalized_timings = jsonClone(timings)
        # 마감 영상에 정규화한 영상 저장
        self._finalization_video = normalized_video
        # 마감 단계별 소요 시간에 정규화한 단계별 소요 시간 저장
        self._finalization_timings = normalized_timings
        # 미리보기 목록에 미리보기 파일 목록 처리 결과 저장
        previews = self.previewFiles(strict=True)
        # 요약에 요약 처리 결과 저장
        summary = self.summary(
            status,
            video=normalized_video,
            timings=normalized_timings,
            previews=previews,
            failure_reason=failure_reason,
        )
        # 요약 파일에 필요한 입력을 전달해 처리
        self.summaryFile(summary)
        # 요약 반환
        return summary

    # 중간 결과를 보존하면서 실패 사유를 보고서에 기록
    def failureRecord(self, reason: str) -> None:
        # 실패 시 아래 예외 처리로 정리할 작업 시작
        try:
            # 미리보기 목록에 미리보기 파일 목록 처리 결과 저장
            previews = self.previewFiles(strict=False)
            # 요약에 요약 처리 결과 저장
            summary = self.summary(
                "FAILED",
                video=self._finalization_video,
                timings=self._finalization_timings,
                previews=previews,
                failure_reason=reason,
            )
            # 요약 파일에 필요한 입력을 전달해 처리
            self.summaryFile(summary)
        # 발생한 예외를 받아 원인 보존과 후속 처리 수행
        except Exception:
            # 실패 기록은 가능한 범위에서 수행하고 원래 오류 보존
            pass

    # 처리 자원 정리
    def __exit__(self, exception_type, exception, _traceback) -> bool:
        # 닫기 오류를 아직 없는 상태로 초기화
        close_error: Exception | None = None
        # 진단 스트림이 있는지 및 부정 조건 닫힘 여부 확인
        if self._trace is not None and not self._trace.closed:
            # 실패 시 아래 예외 처리로 정리할 작업 시작
            try:
                # 진단 스트림의 열린 자원 정리
                self._trace.close()
            # 발생한 예외를 받아 원인 보존과 후속 처리 수행
            except Exception as error:
                # 닫기 오류에 오류 저장
                close_error = error
        # 요약 기록한이 비어 있거나 조건을 충족하지 않는지 확인
        if not self._summary_written:
            # 예외 자료형이 있는지 확인
            if exception_type is not None:
                # 사유에 예외 자료형의 실행 모듈 이름 저장
                reason = exception_type.__name__
            # 닫기 오류가 있는지 확인
            elif close_error is not None:
                # 사유에 닫기 오류의 정확한 자료형의 실행 모듈 이름 저장
                reason = type(close_error).__name__
            # 앞선 분기에 해당하지 않는 경우 처리
            else:
                # 사유를 보고서 마감 아닌 호출 여부 값으로 설정
                reason = "REPORT_FINISH_NOT_CALLED"
            # 실패 기록에 필요한 입력을 전달해 처리
            self.failureRecord(reason)
        # 예외 자료형이 없는지 및 닫기 오류가 있는지 확인
        if exception_type is None and close_error is not None:
            # 현재 오류를 호출자에게 전달
            raise close_error
        # 거짓 반환
        return False
