from copy import deepcopy
from .models import Candidate, Evidence


# 음향과 영상 후보의 전송용 연결 개수 상한 정의
MAX_ASSOCIATIONS = 512

# 음향 구간과 후보·증거 클립의 시간적 포함 관계만 연결
def association(
    audio: dict, candidates: tuple[Candidate, ...], evidence: tuple[Evidence, ...]
) -> dict:
    """시각 후보 변경 없이 기존 구간과 이를 덮는 클립만 연결"""
    # 원시 음향 관측을 바꾸지 않을 연결 결과 복사본 생성
    result = deepcopy(audio)
    # 현재 후보·증거에 맞춰 시간 대응 목록 새로 생성
    result["associations"] = []
    # 시간 대응되는 소리 포함 클립 누락 여부 초기화
    missing_clip = False
    # 원본에서 관측한 각 소리 단서의 시간 범위 순회
    for cue in result["cues"]:
        # 현재 소리 구간을 포함하는 영상 후보 탐색
        for candidate in candidates:
            # 후보가 소리 단서 전체를 포함하지 않는 경우 제외
            if not candidate.start_ms <= cue["startMs"] < cue["endMs"] <= candidate.end_ms:
                # 시간 포함 또는 증거·개수 조건을 충족하지 못한 연결 건너뜀
                continue
            # 같은 후보에서 소리를 보존하고 단서 전체를 덮는 클립 번호 수집
            indices = [
                index
                for index, item in enumerate(evidence)
                if item.kind == "CLIP"
                and item.audio_status == "PRESERVED"
                and item.candidate_index == candidate.index
                and item.start_ms <= cue["startMs"]
                and item.end_ms >= cue["endMs"]
            ][:16]
            # 소리 단서를 포함한 음향 보존 클립이 없는지 확인
            if not indices:
                # 후보는 있지만 소리를 확인할 클립이 없는 상태 기록
                missing_clip = True
                # 시간 포함 또는 증거·개수 조건을 충족하지 못한 연결 건너뜀
                continue
            # 전송 가능한 시간 대응 개수 상한 확인
            if len(result["associations"]) >= MAX_ASSOCIATIONS:
                # 상한을 넘는 시간 연결은 생략되었음을 기록
                result["truncated"] = True
                # 연결 수 상한 사유의 중복 기록 방지
                if "AUDIO_ASSOCIATION_LIMIT" not in result["reasons"]:
                    # 시간 대응 요약 생략 사유 추가
                    result["reasons"].append("AUDIO_ASSOCIATION_LIMIT")
                # 시간 포함 또는 증거·개수 조건을 충족하지 못한 연결 건너뜀
                continue
            # 소리 단서와 후보 및 근거 클립의 시간 대응 추가
            result["associations"].append(
                {
                    "cueId": cue["id"],
                    "candidateIndex": candidate.index,
                    "evidenceIndices": indices,
                    # 같은 시간대라는 연결이며 휘슬 의미나 사건 인과관계 확정 아님
                    "relation": "TEMPORAL_OVERLAP_ONLY",
                }
            )
    # 시간 연결이 있어도 시청각 의미 해석은 검증되지 않았음을 확인
    if result["associations"] and "AUDIOVISUAL_ASSOCIATION_NOT_VERIFIED" not in result["reasons"]:
        # 소리와 영상 사건의 의미적 대응 미검증 사유 기록
        result["reasons"].append("AUDIOVISUAL_ASSOCIATION_NOT_VERIFIED")
    # 소리 단서에 대응하는 클립 누락 사유 추가 여부 확인
    if missing_clip and "AUDIO_CUE_WITHOUT_COVERING_CLIP" not in result["reasons"]:
        # 소리 근거 클립을 제공하지 못한 제한사항 기록
        result["reasons"].append("AUDIO_CUE_WITHOUT_COVERING_CLIP")
    # 원시 후보 변경 없이 보강한 시간 대응 음향 결과 반환
    return result
