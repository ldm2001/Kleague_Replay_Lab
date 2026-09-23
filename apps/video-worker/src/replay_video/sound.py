# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 명령행 인자 읽기와 검증 도구 가져옴
import argparse
# 직렬화 자료 읽기와 기록 도구 가져옴
import json
# 파일 덮어쓰기 없는 연결 생성 도구 가져옴
import os
# 임시 보고서 파일 생성 도구 가져옴
import tempfile
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 다양한 보고서 값의 타입 표기 가져옴
from typing import Any
# 고정 음향 분석 기준과 자료형 및 관측 함수 가져옴
from .infrastructure.audio import (
    FRAME_DURATION_MS,
    MAX_DECODED_SPAN_MS,
    MAX_NORMALIZED_SPECTRAL_ENTROPY,
    MIN_BAND_FREQUENCY_HZ,
    MIN_BAND_POWER_RATIO,
    MIN_CUE_FRAMES,
    MIN_PEAK_RELATIVE_POWER,
    MIN_PEAK_SEPARATION_HZ,
    MIN_RMS,
    MAX_BAND_FREQUENCY_HZ,
    AudioScan,
    audioCues,
)

# 음향 측정값과 제한사항을 독립 진단 보고서로 변환
def audioReport(scan: AudioScan) -> dict[str, Any]:
    # 음향 단서와 분석 한계의 보고서 객체 반환
    return {
        # 음향 스캔 완료 또는 실패 등 상태 기록
        "status": scan.status.value,
        # 해당 음향 상태의 사유 기록
        "reason": scan.reason,
        # 검출한 음향 단서 개수 기록
        "cueCount": len(scan.cues),
        # 각 음향 단서의 구간과 측정값 목록 생성
        "cues": [
            {
                # 단서 시작 원본 밀리초 시각 기록
                "startMs": cue.start_ms,
                # 단서 종료 원본 밀리초 시각 기록
                "endMs": cue.end_ms,
                # 단서에 포함된 봉우리 주파수 목록 기록
                "peakFrequenciesHz": list(cue.peak_frequencies_hz),
                # 단서를 지지한 연속 음향 프레임 수 기록
                "frameCount": cue.frame_count,
                # 관측된 음향 단서 종류 기록과 심판 신호 확정 제외
                "kind": cue.kind,
                # 단서를 검출한 고정 분석 방법 기록
                "method": cue.method,
            }
            for cue in scan.cues
        ],
        # 원본 음향 스트림의 메타데이터 묶음 생성
        "sourceAudio": {
            # 원본 초당 음향 표본 수 기록
            "sampleRateHz": scan.source_audio_sample_rate_hz,
            # 원본 음향 채널 수 기록
            "channels": scan.source_audio_channels,
        },
        # 원본 영상에 연결할 음향 시간축 묶음 생성
        "timeline": {
            # 영상 기준 시작 시각을 초 단위로 기록
            "videoOriginSeconds": scan.video_origin_seconds,
            # 영상 대비 음향 시작 차이를 밀리초로 기록
            "audioOffsetMs": scan.audio_offset_ms,
            # 분석한 원본 구간 시작 시각 기록
            "scannedStartMs": scan.scanned_start_ms,
            # 분석한 원본 구간 종료 시각 기록
            "scannedEndMs": scan.scanned_end_ms,
            # 실제 디코딩한 음향 프레임 수 기록
            "decodedFrameCount": scan.decoded_frame_count,
        },
        # 재현 가능한 고정 신호 분석 설정 묶음 생성
        "method": {
            # 다중 주파수 음향 단서 방법 판본 기록
            "name": "spectral-multitone-v1",
            # 한 음향 측정 프레임 길이 기록
            "frameDurationMs": FRAME_DURATION_MS,
            # 검사할 주파수 대역의 하한과 상한 기록
            "bandHz": [MIN_BAND_FREQUENCY_HZ, MAX_BAND_FREQUENCY_HZ],
            # 최소 실효 음량 기준 기록
            "minimumRms": MIN_RMS,
            # 직류 성분을 뺀 전력 대비 대역 전력 하한 기록
            "minimumBandToNonDcPower": MIN_BAND_POWER_RATIO,
            # 주파수 에너지 분산의 정규화 엔트로피 상한 기록
            "maximumNormalizedSpectralEntropy": MAX_NORMALIZED_SPECTRAL_ENTROPY,
            # 주파수 봉우리의 최소 상대 전력 기록
            "minimumPeakRelativePower": MIN_PEAK_RELATIVE_POWER,
            # 구분할 봉우리 사이 최소 주파수 거리 기록
            "minimumPeakSeparationHz": MIN_PEAK_SEPARATION_HZ,
            # 허용하는 봉우리 개수를 두 개 또는 세 개로 기록
            "acceptedPeakCounts": [2, 3],
            # 단서로 묶을 최소 연속 프레임 수 기록
            "minimumContiguousFrames": MIN_CUE_FRAMES,
            # 디코딩할 최대 시간 범위 기록
            "maximumDecodedSpanMs": MAX_DECODED_SPAN_MS,
            # 첫 음향 시각 기준 정규화와 공백 무음 삽입 방식 기록
            "timelineNormalization": "FIRST_AUDIO_PTS_TO_ZERO_GAPS_FILLED_WITH_SILENCE",
        },
        # 평가 범위를 관측 음향 단서로만 제한
        "scope": "OBSERVED_AUDIO_CUE_ONLY",
        # 발신 주체와 심판 판단 및 재개 유형의 미평가 기록
        "notAssessed": ["SOURCE_IDENTITY", "REFEREE_DECISION", "RESTART_TYPE"],
        # 관중과 음악의 유사 신호 및 해석 한계 보존
        "limitations": [
            "A whistle-like cue can also be produced by supporters, music, or other multitone audio.",
            "Silence inserted to preserve packet timestamp gaps is not observed source audio.",
            "Timestamp gaps shorter than one 100 ms frame can share a frame with observed audio.",
            "Local-peak detection uses interior 10 Hz band bins; tones exactly at the band edges may be missed.",
            "No source identity, referee action, foul, restart, or rules decision is inferred.",
        ],
    }

# 새 직렬화 자료 기록
def publication(path: Path, payload: dict[str, Any]) -> None:
    # 사용자 경로를 확장하고 보고서 절대 경로 계산
    destination = path.expanduser().resolve()
    # 보고서 상위 폴더 존재 확인
    if not destination.parent.is_dir():
        # 없는 보고서 상위 폴더 오류 전달
        raise ValueError("report-parent-missing")
    # 정리할 임시 파일 경로 초기화
    temporary: Path | None = None
    # 성공과 실패 뒤 임시 파일 정리를 보장할 저장 시도
    try:
        # 같은 폴더에 임시 보고서 파일 생성
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            # 정리할 임시 파일의 실제 경로 저장
            temporary = Path(output.name)
            # 비유한 수를 금지한 한글 보고서 기록
            json.dump(payload, output, ensure_ascii=False, indent=2, allow_nan=False)
            # 보고서 끝 줄바꿈 기록
            output.write("\n")
        # 기존 보고서 덮어쓰기 없는 공개 연결 시도
        try:
            # 완성된 임시 파일을 최종 보고서 이름에 연결
            os.link(temporary, destination)
        # 최종 보고서가 이미 있는 경우 분기
        except FileExistsError:
            # 기존 보고서 보존을 위한 중복 경로 오류 전달
            raise FileExistsError("report-already-exists")
    # 보고서 공개 성공과 실패 모두의 임시 파일 정리
    finally:
        # 정리할 임시 파일의 존재 확인
        if temporary is not None and temporary.exists():
            # 최종 보고서는 유지하고 임시 연결 이름 제거
            temporary.unlink()

# 명령행 인자 검증과 진단·영상 작업 실행
def main() -> None:
    # 고정 신호 음향 진단용 명령행 해석기 생성
    parser = argparse.ArgumentParser(description="고정 DSP 휘슬 유사 음향 단서 진단")
    # 원본 영상 경로 인자 등록
    parser.add_argument("source", type=Path)
    # 출력 보고서 경로 인자 등록
    parser.add_argument("report", type=Path)
    # 필수 명령행 경로 읽음과 형식 확인
    args = parser.parse_args()
    # 원본 음향의 고정 주파수 단서 분석
    scan = audioCues(args.source)
    # 최종 보고서 경로 확장과 절대 경로 계산
    report_path = args.report.expanduser().resolve()
    # 음향 보고서를 기존 파일 덮어쓰기 없이 공개
    publication(report_path, audioReport(scan))
    # 분석 상태와 단서 수 및 보고서 경로 출력
    print(f"status={scan.status.value} cues={len(scan.cues)} report={report_path}")


# 파일의 직접 실행 여부 확인
if __name__ == "__main__":
    # 음향 진단 명령행 진입점 실행
    main()
