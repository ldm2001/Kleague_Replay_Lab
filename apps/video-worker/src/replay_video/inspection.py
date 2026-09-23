# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 명령행 인자 읽기와 검증 도구 가져옴
import argparse
# 직렬화 자료 읽기와 기록 도구 가져옴
import json
# 거리 계산과 수치 유효성 확인 도구 가져옴
import math
# 원본 파일의 해시 계산 도구 가져옴
import hashlib
# 관측 자료형의 사전 변환 도구 가져옴
from dataclasses import asdict
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 영상 디코딩과 프레임 비교 도구 가져옴
import cv2
# 프레임 기하와 카메라 이동 관측 함수 가져옴
from .infrastructure.context import frameContext
# 영상 메타데이터 조회 함수 가져옴
from .infrastructure.probe import probe
# 색상 분포 계산 함수 가져옴
from .infrastructure.signals import histogram
# 후보 경로와 보정 움직임 조립 추적기 가져옴
from .application.track import CandidateTracker
# 밝은 원형 물체 후보 추출 함수 가져옴
from .infrastructure.ball import ballCandidates
# 코너 출발 영상 패턴 관측기 가져옴
from .infrastructure.corners import CornerRecognizer
# 득점 방송 표시 관측기 가져옴
from .infrastructure.broadcast import BroadcastCueRecognizer

# 원시 신호·추적 진단 기록과 영상 작업의 구간 요약만 서버 전달
def inspection(source: Path | str, output: Path | str) -> Path:
    # 원본 영상의 기본 메타데이터 읽음
    metadata = probe(source)
    # 진단 출력 폴더의 절대 경로 계산
    root = Path(output).resolve()
    # 진단 출력 폴더 생성
    root.mkdir(parents=True, exist_ok=True)
    # 프레임별 관측 기록 파일 경로 생성
    samples_path = root / "context.jsonl"
    # 전체 진단 요약 파일 경로 생성
    summary_path = root / "context-summary.json"
    # 이전 측정 결과를 덮어쓰지 않아 서로 다른 설정의 평가 기록을 보존
    if samples_path.exists() or summary_path.exists():
        # 기존 진단 기록의 덮어쓰기 오류 전달
        raise FileExistsError("context-output-already-exists")
    # 원본 영상 프레임을 읽을 디코더 생성
    capture = cv2.VideoCapture(str(metadata.source))
    # 디코더의 원본 열기 성공 여부 확인
    if not capture.isOpened():
        # 실패한 디코더 자원 해제
        capture.release()
        # 원본 영상을 열지 못한 오류 전달
        raise RuntimeError("video-open-failed")

    # 빠른 팬과 공 이동이 긴 샘플 간격에서 끊기지 않도록 약 15헤르츠로 측정
    stride = max(1, round(metadata.fps / 15.0))
    # 읽은 원본 프레임 번호 초기화
    index = 0
    # 실제 측정한 표본 수 초기화
    count = 0
    # 카메라 이동 보정이 가능한 표본 쌍 수 초기화
    registered = 0
    # 연속 화면 구간 번호 초기화
    continuity_id = 0
    # 이전 표본 이미지 초기화
    previous = None
    # 이전 표본의 색상 분포 초기화
    previous_histogram = None
    # 원본 시각 증가 검사용 이전 시각 초기화
    last_time = -1
    # 이전 측정 프레임 번호 초기화
    last_source_index = None
    # 명목 프레임률로 시각을 대체한 횟수 초기화
    nominal_times = 0
    # 화면 후보 경로와 보정 움직임 추적기 생성
    tracker = CandidateTracker()
    # 후보 위치가 추적된 표본 수 초기화
    ball_tracked_samples = 0
    # 정지 뒤 움직임 시작 기록 목록 생성
    motion_onsets: list[dict[str, object]] = []
    # 코너 출발 영상 패턴 관측기 생성
    corners = CornerRecognizer()
    # 영상 패턴 사건 목록 생성
    scene_events: list[dict[str, object]] = []
    # 득점 방송 표시 관측기 생성
    broadcast = BroadcastCueRecognizer()
    # 방송 표시 단서 목록 생성
    broadcast_cues: list[dict[str, object]] = []
    # 오류가 나도 디코더를 해제할 분석 구간 시작
    try:
        # 기존 파일을 덮어쓰지 않는 관측 기록 파일 생성
        with samples_path.open("x", encoding="utf-8") as stream:
            # 원본 프레임을 끝까지 순서대로 넘김
            while capture.grab():
                # 현재 프레임 번호 보존
                frame_index = index
                # 읽은 프레임 수 증가
                index += 1
                # 표본 추출 간격에 해당하는지 확인
                if frame_index % stride:
                    # 측정하지 않을 중간 프레임 건너뜀
                    continue
                # 선택 프레임의 실제 픽셀 이미지 읽음
                ok, image = capture.retrieve()
                # 이미지 디코딩 성공 여부 확인
                if not ok:
                    # 선택 프레임 읽기 오류 전달
                    raise RuntimeError("context-frame-read-failed")
                # 디코더가 제공한 원본 밀리초 시각 읽음
                decoder_time = capture.get(cv2.CAP_PROP_POS_MSEC)
                # 시각의 출처를 디코더로 지정
                time_source = "DECODER"
                # 디코더 시각의 유한성 및 증가 여부 확인
                if (
                    not math.isfinite(decoder_time)
                    or decoder_time < 0
                    or round(decoder_time) <= last_time
                ):
                    # 명목 프레임률을 사용하되 이전보다 증가하는 시각 계산
                    timestamp_ms = max(last_time + 1, round(frame_index * 1000 / metadata.fps))
                    # 시각의 출처를 명목 프레임률로 변경
                    time_source = "NOMINAL_FPS"
                    # 대체 시각 사용 횟수 증가
                    nominal_times += 1
                # 디코더 시각이 유효하고 증가하는 경우 분기
                else:
                    # 유효한 디코더 시각을 밀리초 정수로 변환
                    timestamp_ms = round(decoder_time)

                # 색상 분포가 크게 바뀌면 같은 카메라의 연속 움직임으로 연결 금지
                current_histogram = histogram(image)
                # 이전과 현재의 색상 분포 차이로 전환 후보 확인
                cut = (
                    previous_histogram is not None
                    and cv2.compareHist(
                        previous_histogram,
                        current_histogram,
                        cv2.HISTCMP_BHATTACHARYYA,
                    )
                    >= 0.45
                )
                # 화면 전환 후보의 존재 확인
                if cut:
                    # 새로운 연속 화면 구간 번호 생성
                    continuity_id += 1
                    # 전환 전 이미지 연결 초기화
                    previous = None
                    # 전환 전 프레임 번호 연결 초기화
                    last_source_index = None
                # 현재와 이전 이미지의 기하와 움직임 맥락 계산
                context = frameContext(image, previous)
                # 카메라 가로 이동 보정값 존재 확인
                if context.camera_dx is not None:
                    # 보정 가능한 표본 쌍 수 증가
                    registered += 1
                # 진단용 후보 추적과 실제 경기 중단·킥 의미 분리
                candidates = ballCandidates(image)
                # 후보 경로와 움직임 측정 및 대체 시각의 카메라 보정 제외
                selection, motion = tracker.update(
                    timestamp_ms,
                    continuity_id,
                    context.width,
                    context.height,
                    candidates,
                    context.camera_affine if time_source == "DECODER" else None,
                )
                # 현재 화면의 코너 출발 패턴 관측
                scene_event = corners.update(image, timestamp_ms, continuity_id)
                # 코너 영상 패턴 사건 존재 확인
                if scene_event is not None:
                    # 관측된 코너 패턴 사건 보존
                    scene_events.append(scene_event)
                # 현재 화면의 득점 방송 표시 관측
                broadcast_cue = broadcast.update(image, timestamp_ms, continuity_id)
                # 득점 방송 표시 단서 존재 확인
                if broadcast_cue is not None:
                    # 방송 표시 단서 보존과 득점 인정 해석 제외
                    broadcast_cues.append(broadcast_cue)
                # 선택된 공 후보 위치 존재 확인
                if motion.candidate is not None:
                    # 후보가 추적된 표본 수 증가
                    ball_tracked_samples += 1
                # 정지 뒤 움직임 시작 시각 존재 확인
                if motion.motion_onset_ms is not None:
                    # 후보 움직임 시작 진단 기록 추가
                    motion_onsets.append(
                        {
                            # 첫 움직임이 관측된 원본 시각 기록
                            "timestamp_ms": motion.motion_onset_ms,
                            # 연속 이동을 확인한 현재 시각 기록
                            "confirmed_at_ms": timestamp_ms,
                            # 움직인 후보의 경로 식별 번호 기록
                            "track_id": motion.track_id,
                            # 해당 후보의 연속 화면 구간 기록
                            "continuity_id": continuity_id,
                            # 의미를 후보의 정지 후 움직임으로만 제한
                            "meaning": "CANDIDATE_STILL_TO_MOVING",
                        }
                    )
                # 한 표본의 원시 신호와 미확인 의미 자료 조립
                sample = {
                    # 원본 프레임 번호 기록
                    "frame_index": frame_index,
                    # 표본의 원본 밀리초 시각 기록
                    "timestamp_ms": timestamp_ms,
                    # 디코더 또는 명목 프레임률 시각 출처 기록
                    "time_source": time_source,
                    # 연결에 사용한 이전 표본 번호 기록
                    "previous_frame_index": last_source_index,
                    # 표본이 속한 연속 화면 구간 기록
                    "continuity_id": continuity_id,
                    # 화면 전환 후보 여부 기록
                    "cut_candidate": bool(cut),
                    **asdict(context),
                    # 원형 물체 후보들의 화면 좌표 기록
                    "ball_candidates": [asdict(candidate) for candidate in candidates],
                    # 선택 후보의 보정 움직임 기록
                    "ball_track": asdict(motion),
                    # 복수 후보 경로의 선택 근거 기록
                    "path_selection": asdict(selection),
                    # 코너 영상 패턴 사건 기록
                    "scene_event": scene_event,
                    # 득점 방송 표시 단서 기록
                    "broadcast_cue": broadcast_cue,
                    # 코너 패턴이 있을 때 출발 경로 진단 보존
                    "corner_departure_path": (
                        corners.last_departure if scene_event is not None else None
                    ),
                    # 아래 의미 정보는 원시 영상 차이로 대체 금지
                    "ball_position": None,
                    # 확인되지 않은 실제 선수 위치를 빈 값으로 보존
                    "player_positions": None,
                    # 확인되지 않은 경기 중단 사실을 빈 값으로 보존
                    "dead_ball": None,
                    # 확인되지 않은 공 재개 사실을 빈 값으로 보존
                    "ball_restarted": None,
                    # 확인되지 않은 리플레이 여부를 빈 값으로 보존
                    "is_replay": None,
                    # 규정 근거가 없는 재개 유형 목록을 비워 둠
                    "restart_candidates": [],
                }
                # 한 표본을 비유한 수 없는 한 줄 자료로 기록
                stream.write(json.dumps(sample, ensure_ascii=False, allow_nan=False) + "\n")
                # 기록한 표본 수 증가
                count += 1
                # 다음 표본 비교용 원본 시각 갱신
                last_time = timestamp_ms
                # 다음 표본 연결용 프레임 번호 갱신
                last_source_index = frame_index
                # 다음 표본과 비교할 이미지 보존
                previous = image
                # 다음 화면 전환 비교용 색상 분포 보존
                previous_histogram = current_histogram
    # 영상 읽기 성공과 실패 모두의 자원 정리
    finally:
        # 성공과 실패에 관계없이 디코더 자원 해제
        capture.release()

    # 관측한 표본이 하나라도 있는지 확인
    if count == 0:
        # 측정 가능한 프레임 부재 오류 전달
        raise RuntimeError("context-no-frames")
    # 원본 바이트 해시 계산을 위한 파일 열기
    with metadata.source.open("rb") as source_file:
        # 진단과 원본을 연결할 파일 해시 계산
        source_sha256 = hashlib.file_digest(source_file, "sha256").hexdigest()
    # 메타데이터·실제 프레임 수 불일치 시 전체 검사 완료 금지
    summary = {
        # 진단 요약 구조 판본 기록
        "schema_version": 1,
        # 원시 신호 추출기 판본 기록
        "extractor_version": "broadcast-corner-context-v1",
        # 원본 파일 이름 기록
        "source_name": metadata.source.name,
        # 메타데이터 재생 길이 기록
        "duration_ms": metadata.duration_ms,
        # 원본 바이트 해시 기록
        "source_sha256": source_sha256,
        # 실제 읽은 원본 프레임 수 기록
        "decoded_frames": index,
        # 메타데이터의 예상 프레임 수 기록
        "expected_frames": metadata.frame_count,
        # 실제 프레임 수와 예상 수의 일치 여부만 기록
        "coverage_status": "MATCHES_METADATA" if index == metadata.frame_count else "UNVERIFIED",
        # 측정 표본 사이 원본 프레임 간격 기록
        "sample_stride": stride,
        # 실제 측정 표본 수 기록
        "sample_count": count,
        # 카메라 보정 가능 표본 쌍 수 기록
        "registered_pairs": registered,
        # 명목 시각으로 대체한 표본 수 기록
        "nominal_timestamp_count": nominal_times,
        # 후보 위치를 추적한 표본 수 기록
        "ball_tracked_samples": ball_tracked_samples,
        # 후보 정지 후 움직임 시작 목록 보존
        "candidate_motion_onsets": motion_onsets,
        # 코너 영상 패턴 관측 상태 기록과 적법 재개 판단 제외
        "set_piece_status": "OBSERVED" if scene_events else "UNKNOWN",
        # 관측된 영상 패턴 사건 목록 보존
        "scene_events": scene_events,
        # 득점 방송 표시 단서 목록 보존
        "broadcast_cues": broadcast_cues,
        # 진단으로 확인하지 못한 의미 입력 목록 기록
        "missing_inputs": [
            "ball_position",
            "player_positions",
            "dead_ball",
            "ball_restarted",
            "is_replay",
            "restart_candidates",
        ],
        # 프레임별 관측 파일 이름 기록
        "samples_file": samples_path.name,
    }
    # 한글을 보존한 진단 요약 파일 저장
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    # 생성한 진단 요약 경로 반환
    return summary_path

# 명령행 인자 검증과 진단·영상 작업 실행
def main() -> None:
    # 원시 신호 진단용 명령행 해석기 생성
    parser = argparse.ArgumentParser(description="모델 없는 영상 원시 신호 진단")
    # 원본 영상 경로 인자 등록
    parser.add_argument("source", type=Path)
    # 진단 출력 폴더 인자 등록
    parser.add_argument("output", type=Path)
    # 필수 경로 인자 읽음과 형식 확인
    args = parser.parse_args()
    # 진단을 실행하고 요약 경로 출력
    print(inspection(args.source, args.output))


# 파일의 직접 실행 여부 확인
if __name__ == "__main__":
    # 영상 진단 명령행 진입점 실행
    main()
