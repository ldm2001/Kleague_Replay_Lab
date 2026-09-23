from __future__ import annotations
import subprocess
import time
from pathlib import Path
import cv2
from ..domain.models import Candidate, Evidence, VideoMetadata
from .streams import ClipAudioResult, clipStreams, outputStreams

# 증거 프레임 생성
def frame(source: Path, destination: Path, timestamp_ms: int) -> None:
    # 영상 캡처 열기
    capture = cv2.VideoCapture(str(source))
    # 원본 영상 디코더가 정상적으로 열렸는지 확인
    if not capture.isOpened():
        # 원본을 열 수 없으면 증거 생성 중단
        raise RuntimeError("video-open-failed")
    try:
        # 프레임 위치 이동
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp_ms)
        # 프레임 읽기
        ok, image = capture.read()
        # 지정 시각의 화면을 실제로 읽었는지 확인
        if not ok:
            # 읽지 못한 프레임을 증거로 저장하지 않도록 중단
            raise RuntimeError("frame-read-failed")
        # 프레임 파일 기록
        if not cv2.imwrite(str(destination), image, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            # 정지 프레임 파일 저장 실패 알림
            raise RuntimeError("frame-write-failed")
    # 프레임 생성 성공 여부와 무관하게 영상 자원 정리
    finally:
        # 영상 디코더와 연결된 원본 파일 자원 해제
        capture.release()

# 증거 클립 생성
def clip(source: Path, destination: Path, start_ms: int, end_ms: int) -> ClipAudioResult:
    # 클립 길이 계산
    duration = max(0.2, (end_ms - start_ms) / 1000)
    # 클립에 사용할 영상·음향 스트림과 원본 시간 원점 읽음
    selected = clipStreams(source)
    # 후보 상대 시각을 원본 스트림의 절대 시작 시각으로 변환
    source_start = selected.video_origin_seconds + start_ms / 1000
    # 같은 원본 시간축에서 클립 종료 시각 계산
    source_end = source_start + duration
    # 50메비바이트 업로드 상한 내 컨테이너 여유 확보와 비트 전송률 제어
    # 길이 대신 품질 제한과 파일 크기 옵션의 구간 절단 위험
    audio_rate = (
        max(128_000, 64_000 * (selected.audio_channels or 0))
        if selected.audio_index is not None
        else 0
    )
    # 전체 길이를 보존하도록 용량 예산에서 음향을 뺀 영상 전송률 계산
    rate = min(6_000_000, int(44 * 1024 * 1024 * 8 / (duration + 2)) - audio_rate)
    # 요청한 클립 길이에 배정할 영상 전송률이 남는지 확인
    if rate <= 0:
        # 길이를 자르는 대신 용량 예산이 성립하지 않는 요청 거부
        raise ValueError("clip-duration-invalid")
    # 선택한 두 스트림에 동일한 절대 시각 구간을 적용해 원래 간격 보존
    # 음향 재표본화로 원본 패킷 시각의 빈 구간 보충
    video_filter = (
        f"[0:{selected.video_index}]trim=start={source_start:.6f}:end={source_end:.6f},"
        f"setpts=PTS-{source_start:.6f}/TB,scale=-2:min(720\\,ih)[v]"
    )
    # 음향에도 같은 절대 구간과 시간 원점 이동을 적용하는 필터 생성
    audio_filter = (
        f";[0:{selected.audio_index}]atrim=start={source_start:.6f}:end={source_end:.6f},"
        f"asetpts=PTS-{source_start:.6f}/TB,aresample=async=1:first_pts=0[a]"
        if selected.audio_index is not None
        else ""
    )

    # 음향 보존 여부별 미디어 명령 인자 구성
    def command(include_audio: bool) -> list[str]:
        # 시간 보존·크기 제한·호환 코덱을 지정한 인코더 인자 목록 반환
        return [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-xerror",
            "-copyts",
            *(
                ["-ss", f"{source_start - selected.media_origin_seconds - 2.0:.3f}"]
                if start_ms > 2_000
                else []
            ),
            "-i",
            str(source),
            "-filter_complex",
            video_filter + (audio_filter if include_audio else ""),
            "-map",
            "[v]",
            *(
                ["-map", "[a]", "-c:a", "aac", "-b:a", str(audio_rate)]
                if include_audio
                else ["-an"]
            ),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-maxrate",
            str(rate),
            "-bufsize",
            str(rate * 2),
            "-threads",
            "2",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-t",
            f"{duration:.3f}",
            str(destination),
        ]

    # 최초 인코딩과 음향 제외 재시도가 공유할 전체 기한 설정
    deadline = time.monotonic() + 60

    # 음향 포함 여부별 증거 클립 인코딩
    def encoding(include_audio: bool) -> subprocess.CompletedProcess[str]:
        try:
            # 남은 전체 기한 안에서 인코더 실행 결과 수집
            return subprocess.run(
                command(include_audio),
                capture_output=True,
                text=True,
                timeout=max(0.001, deadline - time.monotonic()),
                check=False,
            )
        # 클립 생성용 외부 미디어 실행 파일 누락 처리
        except FileNotFoundError as error:
            # 도구 누락을 영상 사건 부재와 구별해 알림
            raise RuntimeError("media-tool-missing") from error
        # 인코딩이 남은 실행 기한을 넘긴 경우 처리
        except subprocess.TimeoutExpired as error:
            # 클립 생성 시간 초과를 작업 오류로 전달
            raise RuntimeError("clip-timeout") from error

    # 보존할 원본 음향 스트림 존재 여부 계산
    include_audio = selected.audio_index is not None
    # 가능하면 원본 소리를 포함하여 전체 구간 인코딩
    result = encoding(include_audio)
    # 음향 제외 재시도 여부 초기화
    retried_video_only = False
    # 음향 포함 인코딩이 실패했을 때 영상 단독 재시도 허용
    if result.returncode != 0 and include_audio:
        # 영상 전체 재시도 성공 시에만 음향 누락 분류 허용
        # 독립적인 영상 실패는 클립 실패로 유지
        result = encoding(False)
        # 음향 포함 실패 후 영상만 재시도한 이력 보존
        retried_video_only = True
    # 최종 인코더 실행의 실패 여부 확인
    if result.returncode != 0:
        # 완성되지 않은 클립을 증거로 채택하지 않고 중단
        raise RuntimeError("clip-write-failed")
    # 인코더 종료 후 실제 비어 있지 않은 파일 생성 확인
    if not destination.is_file() or destination.stat().st_size <= 0:
        # 완성되지 않은 클립을 증거로 채택하지 않고 중단
        raise RuntimeError("clip-write-failed")
    # 완성된 클립이 업로드 용량 상한을 지키는지 확인
    if destination.stat().st_size > 50 * 1024 * 1024:
        # 시간을 절단하지 않고 과대 클립 생성 실패 알림
        raise RuntimeError("clip-size-limit")
    # 생성된 파일에서 실제 영상 길이와 소리 스트림 확인
    video_duration, output_has_audio = outputStreams(destination)
    # 허용 오차보다 짧게 잘린 증거 클립인지 확인
    if video_duration < duration - 0.10:
        # 요청 구간을 온전히 포함하지 못한 클립 거부
        raise RuntimeError("clip-duration-short")
    # 원본 음향 스트림에 지원 제한이 있었는지 확인
    if selected.audio_issue is not None:
        # 음향 미지원 생략 상태와 원인 반환
        return ClipAudioResult("OMITTED_UNSUPPORTED", selected.audio_issue)
    # 원본에 보존할 음향 스트림이 없는지 확인
    if selected.audio_index is None:
        # 원본 무음 상태를 디코딩 실패와 구별해 반환
        return ClipAudioResult("ABSENT", "SOURCE_AUDIO_ABSENT")
    # 음향 포함 실패 후 영상 단독 생성으로 성공했는지 확인
    if retried_video_only:
        # 영상 성공과 음향 보존 실패를 별도 상태로 반환
        return ClipAudioResult("OMITTED_DECODE_FAILED", "AV_ENCODE_FAILED_VIDEO_RETRY_SUCCEEDED")
    # 인코딩 성공 응답과 달리 출력 음향이 없는지 확인
    if not output_has_audio:
        # 소리 출력 누락을 원본 무음과 구별해 반환
        return ClipAudioResult("OMITTED_DECODE_FAILED", "AUDIO_OUTPUT_EMPTY")
    # 증거 클립에 원본 음향이 포함된 상태 반환
    return ClipAudioResult("PRESERVED")

# 후보 증거 묶음 생성
def evidence(
    source: Path | str,
    output: Path | str,
    metadata: VideoMetadata,
    candidate_list: tuple[Candidate, ...],
    *,
    max_clips: int = 8,
) -> tuple[Evidence, ...]:
    # 입력 경로 정규화
    source_path = Path(source).resolve()
    # 출력 경로 정규화
    root = Path(output).resolve()
    # 프레임 폴더 준비
    frame_root = root / "frames"
    # 클립 폴더 준비
    clip_root = root / "clips"
    # 프레임 폴더 생성
    frame_root.mkdir(parents=True, exist_ok=True)
    # 클립 폴더 생성
    clip_root.mkdir(parents=True, exist_ok=True)

    # 증거 결과 초기화
    result: list[Evidence] = []
    # 모든 후보에 프레임 생성
    targets = sorted(candidate_list, key=lambda item: item.index)
    # 관측 사건 전후 클립 보장과 일반 후보의 잔여 용량 제한
    clips = {
        item.index
        for item in candidate_list
        if item.scene_event is not None
        or item.broadcast_cue is not None
        or "LOCAL_OBSERVER_EVIDENCE_REQUIRED" in item.reasons
    }
    # 관측 근거 필수 클립을 확보한 뒤 일반 후보에 남은 개수 계산
    remaining = max(0, max_clips - len(clips))
    # 남은 용량 안에서 후보 점수가 높은 일반 후보를 클립 대상으로 추가
    clips.update(
        item.index
        for item in sorted(
            (item for item in candidate_list if item.index not in clips),
            key=lambda item: item.confidence,
            reverse=True,
        )[:remaining]
    )
    # 후보별 증거 생성
    for candidate in targets:
        # 프레임 파일 경로 구성
        destination = frame_root / f"candidate-{candidate.index:04d}-frame-01.jpg"
        # 프레임 저장
        frame(source_path, destination, candidate.anchor_ms)
        # 프레임 결과 추가
        result.append(
            Evidence(
                candidate.index,
                "FRAME",
                destination,
                candidate.anchor_ms,
                candidate.start_ms,
                candidate.end_ms,
            )
        )

        # 현재 후보가 영상 클립 확보 대상으로 선정되었는지 확인
        if candidate.index in clips:
            # 클립 파일 경로 구성
            clip_destination = clip_root / f"candidate-{candidate.index:04d}.mp4"
            # 클립 저장
            audio_result = clip(source_path, clip_destination, candidate.start_ms, candidate.end_ms)
            # 클립 결과 추가
            result.append(
                Evidence(
                    candidate.index,
                    "CLIP",
                    clip_destination,
                    candidate.anchor_ms,
                    candidate.start_ms,
                    candidate.end_ms,
                    audio_status=(
                        audio_result.status if isinstance(audio_result, ClipAudioResult) else None
                    ),
                    audio_reason=(
                        audio_result.reason if isinstance(audio_result, ClipAudioResult) else None
                    ),
                )
            )
    # 증거 결과 반환
    return tuple(result)
