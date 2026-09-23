from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path


# 시각 로컬 관측 실행 계약의 판본 정의
LOCAL_OBSERVER_PIPELINE_VERSION = "video-local-observers-v1"
# 시각·음향 결합 관측 실행 계약의 판본 정의
AV_OBSERVER_PIPELINE_VERSION = "video-local-observers-av-v1"


@dataclass(frozen=True, slots=True)
class VideoMetadata:
    # 영상 메타데이터
    source: Path
    # 원본 전체 재생 길이를 밀리초로 보존
    duration_ms: int
    # 원본 화면의 가로 픽셀 수 보존
    width: int
    # 원본 화면의 세로 픽셀 수 보존
    height: int
    # 원본 영상의 초당 프레임 수 보존
    fps: float
    # 원본 메타데이터에서 읽은 총 프레임 수 보존
    frame_count: int
    # 원본 영상의 압축 코덱 이름 보존
    codec: str


@dataclass(frozen=True, slots=True)
class Shot:
    # 영상 샷
    index: int
    # 원본 시간축 기준 구간 시작 시각 보존
    start_ms: int
    # 원본 시간축 기준 구간 종료 시각 보존
    end_ms: int
    # 재생 속도를 확정하지 않은 상태를 기본으로 보존
    playback_speed: str = "UNKNOWN"
    # 리플레이 미확인을 본방 확정과 구별하여 보존
    is_replay: bool | None = None
    # 확인하지 못한 촬영 각도는 빈 상태로 보존
    camera_angle: str | None = None


@dataclass(frozen=True, slots=True)
class Candidate:
    # 판정 후보
    index: int
    # 규정 판단 확정과 구별되는 후보 분류값 보존
    category: str
    # 원본 시간축 기준 구간 시작 시각 보존
    start_ms: int
    # 원본 시간축 기준 구간 종료 시각 보존
    end_ms: int
    # 증거 정지 프레임 추출의 기준 원본 시각 보존
    anchor_ms: int
    # 후보 생성 점수이며 실제 파울 확률로 사용하지 않음
    confidence: float
    # 현재 화면으로 사건을 관찰할 수 있는 정도의 상태 보존
    camera_sufficiency: str
    # 후보 생성 이유와 미검증 제한사항 코드 보존
    reasons: tuple[str, ...]
    # 후보 시간 구간과 겹치는 샷 식별자 보존
    shot_indices: tuple[int, ...]
    # 공 후보 경로의 구간별 측정 요약이며 신체 접촉 사실은 미포함
    tracking: dict[str, object] | None = None
    # 영상 재개 관측과 근거 시각의 서버 규정 필터 전달
    scene_event: dict[str, object] | None = None
    # 방송 그래픽의 관찰 단서이며 경기 사건이나 규정 판정을 확정 제외
    broadcast_cue: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class Evidence:
    # 증거 자료
    candidate_index: int
    # 정지 프레임 또는 영상 클립인 증거 종류 보존
    kind: str
    # 생성한 로컬 증거 파일 경로 보존
    path: Path
    # 증거를 대표하는 원본 시각 보존
    timestamp_ms: int
    # 원본 시간축 기준 구간 시작 시각 보존
    start_ms: int
    # 원본 시간축 기준 구간 종료 시각 보존
    end_ms: int
    # 소리 보존·생략·미확인 상태를 구별해 보존
    audio_status: str | None = None
    # 증거 클립 음향 누락 또는 처리 제한 사유 보존
    audio_reason: str | None = None


@dataclass(frozen=True, slots=True)
class PerceptionOutput:
    # 관측과 증거가 연결된 후보 목록 보존
    candidates: tuple[Candidate, ...]
    # 규정 판단과 분리된 모델·음향 관측 자료 보존
    perception: dict[str, object]


@dataclass(frozen=True, slots=True)
class PipelineResult:
    # 파이프라인 결과
    schema_version: int
    # 어떤 관측 흐름으로 생성했는지 실행 판본 보존
    pipeline_version: str
    # 원본 파일과 시간·화면 크기 정보 보존
    video: VideoMetadata
    # 화면 전환으로 나뉜 원본 샷 목록 보존
    shots: tuple[Shot, ...]
    # 관측과 증거가 연결된 후보 목록 보존
    candidates: tuple[Candidate, ...]
    # 후보별 프레임·클립 근거 목록 보존
    evidence: tuple[Evidence, ...]
    # 서버 제출에 사용할 로컬 보고서 경로 보존
    report_path: Path
