// 공통 관측과 판정 자료형 가져오기
import type {
    PipelineFilterReason,
    PipelineFilterResult,
    PipelineRuleCondition,
    RuleCitation,
    RuleSet
} from "@replay/shared-types";
// 공통 관측과 판정 자료형 가져오기
import { sceneEventData, trackingData } from "@replay/shared-types";

// 영상 처리에서 생성한 후보의 자료 구조 정의
type PipelineCandidate = Readonly<{
    // 원본 기준 시작 시각
    startMs: number;
    // 원본 기준 종료 시각
    endMs: number;
    // 후보 대표 시각
    anchorMs: number | null;
    // 연결된 증거 식별자 목록
    evidenceIds: readonly string[];
    // 현재 검토 범주
    category: string;
    // 공 후보의 시간별 추적 요약
    tracking?: unknown;
    // 관측된 재개 상황
    sceneEvent?: unknown;
}>;

// 판본 미확정일 때 이 주소들은 참고 주제이며 경기 적용 규정의 인용이 아님
const cornerConditions = (
    references: readonly RuleCitation[]
): readonly PipelineRuleCondition[] => {
    // 코너킥 규칙의 참고 원문 주소 조회
    const cornerUrl =
        references.find((reference) => reference.law === "17")?.sourceUrl ??
        "https://www.theifab.com/laws/latest/the-corner-kick/";
    // 오프사이드 규칙의 참고 원문 주소 조회
    const offsideUrl =
        references.find((reference) => reference.law === "11")?.sourceUrl ??
        "https://www.theifab.com/laws/latest/offside/";
    // 처리 결과 코드 및 자료의 용도 설명를 반영한 결과 반환
    return [
        {
            // 처리 결과 코드 기록
            code: "CORNER_PLACEMENT",
            // 자료의 용도 설명 기록
            description: "공을 해당 코너 구역에 놓았는지 확인이 필요합니다",
            // 현재 처리 상태 기록
            status: "UNVERIFIED",
            // 규정의 법 조항 기록
            law: "17",
            // 규정의 세부 항목 기록
            section: "1",
            // 원문 주소 기록
            sourceUrl: cornerUrl
        },
        {
            // 처리 결과 코드 기록
            code: "CORNER_RESTART",
            // 자료의 용도 설명 기록
            description: "정지한 공을 공격 팀 선수가 차서 명확히 움직였는지 확인이 필요합니다",
            // 현재 처리 상태 기록
            status: "UNVERIFIED",
            // 규정의 법 조항 기록
            law: "17",
            // 규정의 세부 항목 기록
            section: "1",
            // 원문 주소 기록
            sourceUrl: cornerUrl
        },
        {
            // 처리 결과 코드 기록
            code: "CORNER_DISTANCE",
            // 자료의 용도 설명 기록
            description:
                "공이 인플레이가 될 때까지 상대 선수가 코너 아크에서 9.15m를 유지했는지 확인이 필요합니다",
            // 현재 처리 상태 기록
            status: "UNVERIFIED",
            // 규정의 법 조항 기록
            law: "17",
            // 규정의 세부 항목 기록
            section: "1",
            // 원문 주소 기록
            sourceUrl: cornerUrl
        },
        {
            // 처리 결과 코드 기록
            code: "DIRECT_CORNER_OFFSIDE",
            // 자료의 용도 설명 기록
            description: "코너킥에서 직접 공을 받은 경우에만 해당 오프사이드 예외를 검토합니다",
            // 현재 처리 상태 기록
            status: "UNVERIFIED",
            // 규정의 법 조항 기록
            law: "11",
            // 규정의 세부 항목 기록
            section: "3",
            // 원문 주소 기록
            sourceUrl: offsideUrl
        }
    ];
};

// 변화 기반 산출물의 규정 적용 가능성 검사이며 반칙 판정기가 아님
export function pipelineFilter(
    candidate: PipelineCandidate,
    rules: RuleSet | null
): PipelineFilterResult {
    // 이 함수는 산출물의 규정 적용 가능성만 판정하며 접촉이나 파울을 추론하지 않음
    const base = { filterVersion: "pipeline-rules-v3", evidenceIds: [...candidate.evidenceIds] };
    // 원본 기준 시작 시각 및 원본 기준 종료 시각의 조건에 따라 처리 분기
    if (
        !Number.isSafeInteger(candidate.startMs) ||
        candidate.startMs < 0 ||
        !Number.isSafeInteger(candidate.endMs) ||
        candidate.endMs <= candidate.startMs ||
        (candidate.anchorMs !== null &&
            (!Number.isSafeInteger(candidate.anchorMs) ||
                candidate.anchorMs < candidate.startMs ||
                candidate.anchorMs > candidate.endMs))
    ) {
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            ...base,
            // 현재 처리 상태 기록
            status: "EXCLUDED",
            // 처리 상태를 설명하는 사유 코드 기록
            reasonCodes: ["INVALID_INTERVAL"],
            // 확인이 필요한 입력 항목 기록
            missingFields: [],
            // 연결된 규정 조항 목록 기록
            ruleReferences: []
        };
    }
    // 관측된 재개 상황 및 원본 기준 시작 시각의 조건에 따라 처리 분기
    if (
        candidate.sceneEvent != null &&
        !sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)
    ) {
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            ...base,
            // 현재 처리 상태 기록
            status: "EXCLUDED",
            // 처리 상태를 설명하는 사유 코드 기록
            reasonCodes: ["INVALID_SCENE_EVENT"],
            // 확인이 필요한 입력 항목 기록
            missingFields: [],
            // 연결된 규정 조항 목록 기록
            ruleReferences: []
        };
    }

    // 처리 상태를 설명하는 사유 코드 초기화
    const reasonCodes: PipelineFilterReason[] = [];
    // 확인이 필요한 입력 항목 초기화
    const missingFields: string[] = [];
    // 추적 결과의 신뢰 수준 계산
    let trackingStatus: PipelineFilterResult["trackingStatus"] = "UNAVAILABLE";
    // 추적 메타데이터도 데이터베이스나 구버전 작업자에서 잘못 들어올 수 있으므로 여기서 다시 확인
    if (candidate.tracking != null) {
        // 공 후보의 시간별 추적 요약 및 원본 기준 시작 시각의 조건에 따라 처리 분기
        if (!trackingData(candidate.tracking, candidate.startMs, candidate.endMs)) {
            // 호출자가 사용할 결과 항목을 하나의 객체로 반환
            return {
                ...base,
                // 현재 처리 상태 기록
                status: "EXCLUDED",
                // 처리 상태를 설명하는 사유 코드 기록
                reasonCodes: ["INVALID_TRACKING"],
                // 확인이 필요한 입력 항목 기록
                missingFields: [],
                // 연결된 규정 조항 목록 기록
                ruleReferences: [],
                // 추적 결과의 신뢰 수준 기록
                trackingStatus
            };
        }
        // 공 후보의 시간별 추적 요약 참조
        const tracking = candidate.tracking;
        // 원본에서 실제로 처리한 시간 범위의 조건에 따라 처리 분기
        if (tracking.coverage !== "COMPLETE") {
            // 추적 결과의 신뢰 수준 갱신
            trackingStatus = "PARTIAL";
            // 처리 상태를 설명하는 사유 코드 목록에 현재 항목 추가
            reasonCodes.push("TRACKING_INCOMPLETE");
        } else if (tracking.selectedCount > 0) {
            // 추적 결과의 신뢰 수준 갱신
            trackingStatus =
                tracking.motionOnsetsMs.length > 0
                    ? "MOTION_ONSET"
                    : tracking.cameraCount > 0
                      ? "CAMERA_COMPENSATED"
                      : "POSITION_ONLY";
            // 추적 결과의 신뢰 수준의 조건에 따라 처리 분기
            if (trackingStatus === "POSITION_ONLY") reasonCodes.push("CAMERA_MOTION_UNVERIFIED");
        }
    }
    // 추적 결과의 신뢰 수준의 조건에 따라 처리 분기
    if (trackingStatus === "UNAVAILABLE") reasonCodes.push("TRACKING_UNAVAILABLE");
    // 연결된 증거 식별자 목록의 조건에 따라 처리 분기
    if (candidate.evidenceIds.length === 0) reasonCodes.push("EVIDENCE_UNAVAILABLE");
    // 해당 경기의 실행 규정 묶음의 조건에 따라 처리 분기
    if (!rules) {
        // 경기와 규정 문맥 미검증 사유 기록
        reasonCodes.push("RULE_CONTEXT_UNVERIFIED");
        // 확인이 필요한 입력 항목 목록에 현재 항목 추가
        missingFields.push("verifiedRuleContext");
    }
    // 관측된 재개 상황 및 원본 기준 시작 시각의 조건에 따라 처리 분기
    if (sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs)) {
        // 연결된 증거 식별자 목록의 조건에 따라 처리 분기
        if (candidate.evidenceIds.length === 0) {
            // 호출자가 사용할 결과 항목을 하나의 객체로 반환
            return {
                ...base,
                // 현재 처리 상태 기록
                status: "UNDETERMINED",
                // 처리 상태를 설명하는 사유 코드 기록
                reasonCodes,
                // 확인이 필요한 입력 항목 기록
                missingFields: [...missingFields, "sceneEvidence"],
                // 연결된 규정 조항 목록 기록
                ruleReferences: [],
                // 추적 결과의 신뢰 수준 기록
                trackingStatus
            };
        }
        // 코너킥의 관찰로 검토할 조항만 선택하며 절차 준수나 오프사이드 예외 충족을 만들지 않음
        const procedure =
            rules
                ?.cite("LAW_17_CORNER_PROCEDURE")
                .filter((reference) => reference.law === "17" && reference.section === "1") ?? [];
        // 직접 재개에 관한 오프사이드 참고 인용 선별
        const offside =
            rules
                ?.cite("LAW_11_DIRECT_RESTART_OFFSIDE")
                .filter((reference) => reference.law === "11" && reference.section === "3") ?? [];
        // 적용을 확정하지 않은 참고 범주 계산
        const referenceOnly = procedure.length === 0 || offside.length === 0;
        // 연결된 규정 조항 목록 계산
        const ruleReferences = referenceOnly ? [] : [...procedure, ...offside];
        // 처리 상태를 설명하는 사유 코드 목록에 현재 항목 추가
        reasonCodes.push("SITUATION_OBSERVED");
        // 해당 경기의 실행 규정 묶음 및 적용을 확정하지 않은 참고 범주의 조건에 따라 처리 분기
        if (rules && referenceOnly) {
            // 처리 상태를 설명하는 사유 코드 목록에 현재 항목 추가
            reasonCodes.push("RULE_CLAUSES_UNAVAILABLE");
            // 확인이 필요한 입력 항목 목록에 현재 항목 추가
            missingFields.push("cornerRuleClauses");
        }
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            ...base,
            // 현재 처리 상태 기록
            status: referenceOnly ? "OBSERVED" : "APPLICABLE",
            // 관측한 경기 상황 기록
            situation: "CORNER_KICK",
            // 적용을 확정하지 않은 참고 범주 기록
            referenceOnly,
            // 처리 상태를 설명하는 사유 코드 기록
            reasonCodes,
            // 확인이 필요한 입력 항목 기록
            missingFields: [
                ...missingFields,
                "cornerPlacement",
                "stationaryKick",
                "opponentDistance",
                "directReception"
            ],
            // 연결된 규정 조항 목록 기록
            ruleReferences,
            // 추적 결과의 신뢰 수준 기록
            trackingStatus,
            // 개별 규정의 적용 조건 기록
            conditions: cornerConditions(ruleReferences)
        };
    }
    // 현재 검토 범주의 조건에 따라 처리 분기
    if (candidate.category === "CORNER_KICK") {
        // 처리 상태를 설명하는 사유 코드 목록에 현재 항목 추가
        reasonCodes.push("SCENE_EVENT_UNAVAILABLE");
        // 호출자가 사용할 결과 항목을 하나의 객체로 반환
        return {
            ...base,
            // 현재 처리 상태 기록
            status: "UNDETERMINED",
            // 처리 상태를 설명하는 사유 코드 기록
            reasonCodes,
            // 확인이 필요한 입력 항목 기록
            missingFields: [...missingFields, "sceneEvent"],
            // 연결된 규정 조항 목록 기록
            ruleReferences: [],
            // 추적 결과의 신뢰 수준 기록
            trackingStatus
        };
    }
    // 현재 검토 범주의 조건에 따라 처리 분기
    if (candidate.category === "OTHER") {
        // 처리 상태를 설명하는 사유 코드 목록에 현재 항목 추가
        reasonCodes.push("INCIDENT_UNCLASSIFIED");
        // 확인이 필요한 입력 항목 목록에 현재 항목 추가
        missingFields.push("incidentCategory");
    }
    // 점수와 과거 사용자 및 모델 입력으로 누락된 영상 사실을 대체 불가
    reasonCodes.push("CONTACT_UNOBSERVED", "INTENSITY_UNOBSERVED");
    // 확인이 필요한 입력 항목 목록에 현재 항목 추가
    missingFields.push("contact", "intensity");
    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return {
        ...base,
        // 현재 처리 상태 기록
        status: "UNDETERMINED",
        // 처리 상태를 설명하는 사유 코드 기록
        reasonCodes,
        // 확인이 필요한 입력 항목 기록
        missingFields,
        // 추적 결과의 신뢰 수준 기록
        trackingStatus,
        // 연결된 규정 조항 목록 기록
        ruleReferences: rules
            ? [...rules.cite("LAW_12_DIRECT_FREE_KICK"), ...rules.cite("VAR_REVIEW_PROCESS")]
            : []
    };
}
