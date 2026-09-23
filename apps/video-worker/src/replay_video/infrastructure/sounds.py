from __future__ import annotations
import hashlib
from pathlib import Path
from ..domain.audio import association
from .audio import FRAME_DURATION_MS, audioCues

# 원본 변경 비교용 파일 해시 계산
def sha256(path: Path) -> str:
    # 원본 또는 구현 파일을 바이트 단위로 읽음
    with path.open("rb") as stream:
        # 파일 내용 대조용 해시 문자열 반환
        return hashlib.file_digest(stream, "sha256").hexdigest()

# 디지털 신호 처리 음향 측정을 원본 해시와 구현 출처에 결합해 비공개 관측으로 보존
def observations(source: Path, *, duration_ms: int, check_cancelled=None, scan=None) -> dict:
    """원본 결합 디지털 신호 처리 관측이며 발화 해독·의미 사실 추론 제외"""
    # 음향을 읽을 원본 영상의 실제 경로 정규화
    source = Path(source).resolve()
    # 작업 취소 검사 함수가 제공되었는지 확인
    if check_cancelled is not None:
        # 음향 읽기 전후 취소된 작업 진행 중단
        check_cancelled()
    # 음향 분석 전 원본 내용 해시 보존
    source_sha = sha256(source)
    # 주입된 분석기 또는 고정 디지털 신호 처리기로 원본 소리 관측
    measured = (scan or audioCues)(source, duration_ms=duration_ms, check_cancelled=check_cancelled)
    # 작업 취소 검사 함수가 제공되었는지 확인
    if check_cancelled is not None:
        # 음향 읽기 전후 취소된 작업 진행 중단
        check_cancelled()
    # 소리를 읽는 동안 원본 영상 내용이 변경되었는지 확인
    if sha256(source) != source_sha:
        # 시각·음향 출처를 보장할 수 없는 원본 변경 거부
        raise ValueError("AUDIO_SOURCE_CHANGED")
    # 원본 해시와 결합할 음향 단서 목록 생성
    cues = []
    # 주파수 기반으로 관측한 소리 구간 순회
    for index, cue in enumerate(measured.cues):
        # 소리 단서가 원본 시간 범위 내부의 양수 길이인지 확인
        if not 0 <= cue.start_ms < cue.end_ms <= duration_ms:
            # 원본 시간과 맞지 않는 소리 단서 거부
            raise ValueError("AUDIO_CUE_INTERVAL_INVALID")
        # 원본·단서 순서·시간 구간으로 식별 자료 구성
        identity = f"{source_sha}:{index}:{cue.start_ms}:{cue.end_ms}"
        # 소리 단서의 식별자·시간·주파수·표본 수 보존
        cues.append(
            {
                "id": "audio-" + hashlib.sha256(identity.encode()).hexdigest(),
                "startMs": cue.start_ms,
                "endMs": cue.end_ms,
                "peakFrequenciesHz": list(cue.peak_frequencies_hz),
                "frameCount": cue.frame_count,
            }
        )
    # 발화 미해석과 합성 무음 및 방법 미검증 한계 명시
    reasons = [
        "AUDIO_CUE_METHOD_NOT_VERIFIED",
        "SPEECH_NOT_ANALYZED",
        "AUDIO_GAPS_PADDED_NOT_OBSERVED",
    ]
    # 음향 처리 결과에 추가 실패·제한 사유가 있는지 확인
    if measured.reason:
        # 실제 음향 처리 제한사항을 공통 한계에 추가
        reasons.append(measured.reason)
    # 원본 해시와 음향 형식·시간축·단서를 관측 계약으로 구성
    observations = {
        "version": "audio-observations-v1",
        "sourceSha256": source_sha,
        "status": measured.status.value,
        "method": "spectral-multitone-v1",
        # 발화 내용을 전사하거나 의미 해석하지 않은 상태 명시
        "speechStatus": "NOT_ANALYZED",
        "sourceSampleRateHz": measured.source_audio_sample_rate_hz,
        "sourceChannels": measured.source_audio_channels,
        "timeline": {
            "videoOriginSeconds": measured.video_origin_seconds,
            "audioOffsetMs": measured.audio_offset_ms,
            "scannedStartMs": measured.scanned_start_ms,
            "scannedEndMs": measured.scanned_end_ms,
            "decodedFrameCount": measured.decoded_frame_count,
            "frameDurationMs": FRAME_DURATION_MS,
            # 누락 시간은 관측된 무음이 아닌 합성 무음으로 유지했음을 명시
            "gapPolicy": "PRESERVED_WITH_SYNTHETIC_SILENCE",
        },
        "cueCount": len(cues),
        "cues": cues,
        "associations": [],
        "truncated": False,
        "reasons": reasons,
    }
    # 음향 구현 출처 파일을 찾을 모듈 디렉터리 읽음
    directory = Path(__file__).parent
    # 음향 관측과 실제 사용한 구현 파일 해시를 분리해 반환
    return {
        "observations": observations,
        "implementation": {
            "sourceFilesSha256": {
                name: sha256(directory / filename)
                for name, filename in (
                    ("audio.py", "audio.py"),
                    ("audio_observations.py", "sounds.py"),
                )
            }
        },
    }
