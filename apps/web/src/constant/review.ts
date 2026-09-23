// 서버와 공유할 자료 계약 형식 읽음
import type { EvaluationFacts } from "@replay/shared-types";

// 사실 확인 입력의 어휘와 화면 문구
export const reviewFields = [
    {
        // 입력값을 구분할 항목 이름 연결
        name: "contact",
        // 화면에 표시할 항목 이름 연결
        label: "선수 사이 접촉",
        // 사실 확인 항목의 화면 묶음 연결
        group: "영상 사실",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["null", "미확인"],
            ["true", "접촉 확인"],
            ["false", "접촉 없음 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "severity",
        // 화면에 표시할 항목 이름 연결
        label: "정상 속도에서 본 강도",
        // 사실 확인 항목의 화면 묶음 연결
        group: "영상 사실",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["uncertain", "판단 어려움"],
            ["CARELESS", "부주의"],
            ["RECKLESS", "무모한 동작"],
            ["EXCESSIVE_FORCE", "과도한 힘"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "displacement",
        // 화면에 표시할 항목 이름 연결
        label: "상대 선수의 밀림",
        // 사실 확인 항목의 화면 묶음 연결
        group: "영상 사실",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["uncertain", "판단 어려움"],
            ["possible", "밀림 가능성"],
            ["clear", "명확한 밀림"],
            ["none", "밀림 없음"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "penalty",
        // 화면에 표시할 항목 이름 연결
        label: "페널티 구역 안 접촉",
        // 사실 확인 항목의 화면 묶음 연결
        group: "영상 사실",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["null", "미확인"],
            ["true", "구역 안 확인"],
            ["false", "구역 밖 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "camera",
        // 화면에 표시할 항목 이름 연결
        label: "카메라 근거",
        // 사실 확인 항목의 화면 묶음 연결
        group: "영상 사실",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["LOW", "가림 또는 각도 부족"],
            ["MEDIUM", "일부 확인 가능"],
            ["HIGH", "동작 충분히 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "speed",
        // 화면에 표시할 항목 이름 연결
        label: "중계 영상의 관측 속도",
        // 사실 확인 항목의 화면 묶음 연결
        group: "영상 사실",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["UNKNOWN", "속도 미확인"],
            ["NORMAL", "정상 속도 확인"],
            ["SLOW", "슬로모션만 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "scenario",
        // 화면에 표시할 항목 이름 연결
        label: "중계에서 확인한 상황",
        // 사실 확인 항목의 화면 묶음 연결
        group: "VAR 조건",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["GOAL_DISALLOWED", "득점 취소"],
            ["GOAL_AWARDED", "득점 인정"],
            ["PENALTY_NOT_GIVEN", "페널티 미선언"],
            ["PENALTY_GIVEN", "페널티 선언"],
            ["SENDING_OFF_NOT_GIVEN", "퇴장 미선언"],
            ["CARD_SHOWN", "카드 제시"],
            ["SECOND_CAUTION", "두 번째 경고"],
            ["OTHER", "그 밖의 상황 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "restart",
        // 화면에 표시할 항목 이름 연결
        label: "경기 재개 여부",
        // 사실 확인 항목의 화면 묶음 연결
        group: "VAR 조건",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["null", "미확인"],
            ["true", "이미 재개"],
            ["false", "재개 전 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "dismissal",
        // 화면에 표시할 항목 이름 연결
        label: "퇴장 사유",
        // 사실 확인 항목의 화면 묶음 연결
        group: "VAR 조건",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["NONE", "퇴장 사안 아님"],
            ["DOGSO", "명백한 득점 기회 저지"],
            ["SERIOUS_FOUL_PLAY", "심한 반칙"],
            ["VIOLENT_CONDUCT", "폭력 행위"],
            ["BITING_OR_SPITTING", "물기 또는 침 뱉기"],
            ["OFFENSIVE_LANGUAGE_OR_ACTION", "모욕적 언행"],
            ["SECOND_CAUTION", "두 번째 경고"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "identity",
        // 화면에 표시할 항목 이름 연결
        label: "카드 대상 선수 착오",
        // 사실 확인 항목의 화면 묶음 연결
        group: "VAR 조건",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["null", "미확인"],
            ["false", "착오 없음 확인"],
            ["true", "착오 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "nature",
        // 화면에 표시할 항목 이름 연결
        label: "검토할 판정의 성격",
        // 사실 확인 항목의 화면 묶음 연결
        group: "VAR 조건",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["SUBJECTIVE", "접촉 강도 등 해석 필요"],
            ["FACTUAL", "위치 등 사실 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "error",
        // 화면에 표시할 항목 이름 연결
        label: "명백한 오류 여부",
        // 사실 확인 항목의 화면 묶음 연결
        group: "VAR 조건",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["UNDETERMINED", "판단 보류"],
            ["CLEAR_AND_OBVIOUS", "명백한 오류 확인"],
            ["NOT_CLEAR_AND_OBVIOUS", "명백한 오류로 보기 어려움"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "missed",
        // 화면에 표시할 항목 이름 연결
        label: "심각한 사건의 누락",
        // 사실 확인 항목의 화면 묶음 연결
        group: "VAR 조건",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["null", "미확인"],
            ["false", "누락 없음 확인"],
            ["true", "누락 확인"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "observedRestart",
        // 화면에 표시할 항목 이름 연결
        label: "관측된 경기 재개",
        // 사실 확인 항목의 화면 묶음 연결
        group: "관측 판정",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["UNKNOWN", "재개 방식 미확인"],
            ["PLAY_CONTINUED", "경기 속행"],
            ["DIRECT_FREE_KICK", "직접 프리킥"],
            ["INDIRECT_FREE_KICK", "간접 프리킥"],
            ["PENALTY_KICK", "페널티킥"],
            ["DROP_BALL", "드롭볼"],
            ["THROW_IN", "스로인"],
            ["GOAL_KICK", "골킥"],
            ["CORNER_KICK", "코너킥"],
            ["KICK_OFF", "킥오프"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "beneficiary",
        // 화면에 표시할 항목 이름 연결
        label: "재개 혜택 팀",
        // 사실 확인 항목의 화면 묶음 연결
        group: "관측 판정",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["UNKNOWN", "대상 미확인"],
            ["ATTACKING_TEAM", "공격 팀"],
            ["DEFENDING_TEAM", "수비 팀"],
            ["NONE", "해당 없음"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "observedCard",
        // 화면에 표시할 항목 이름 연결
        label: "관측된 카드",
        // 사실 확인 항목의 화면 묶음 연결
        group: "관측 판정",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["null", "카드 미확인"],
            ["NONE", "카드 없음 확인"],
            ["CAUTION", "경고"],
            ["SECOND_CAUTION", "두 번째 경고"],
            ["SEND_OFF", "퇴장"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "observedGoal",
        // 화면에 표시할 항목 이름 연결
        label: "관측된 득점 판정",
        // 사실 확인 항목의 화면 묶음 연결
        group: "관측 판정",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["UNKNOWN", "득점 판정 미확인"],
            ["GOAL", "득점 인정"],
            ["NO_GOAL", "득점 불인정"],
            ["NOT_APPLICABLE", "득점 상황 아님"]
        ]
    },
    {
        // 입력값을 구분할 항목 이름 연결
        name: "observedSource",
        // 화면에 표시할 항목 이름 연결
        label: "관측 판정 출처",
        // 사실 확인 항목의 화면 묶음 연결
        group: "관측 판정",
        // 서버에 보낼 값과 화면 선택 문구 목록 연결
        options: [
            ["USER_INPUT", "사용자 영상 확인"],
            ["RESTART_INFERRED", "재개 방식에서 확인"],
            ["REFEREE_SIGNAL", "주심 신호에서 확인"],
            ["VAR_OFR", "VAR 또는 OFR에서 확인"],
            ["MATCH_REPORT", "경기 보고서에서 확인"]
        ]
    }
] as const;

// 서버에 저장된 사실을 폼 선택값으로 복원
export const reviewValues = (facts: EvaluationFacts | null | undefined): Record<string, string> => {
    // 최초 검토는 추정 기본값 없이 시작
    if (!facts) return {};
    // 영상 사실과 비디오 판독 조건 참조
    const { push, variable } = facts;
    // 화면별 선택값 구성
    return {
        // 선수 사이 접촉 여부 연결
        contact: String(push.contactDetected.value),
        // 접촉 강도 연결
        severity: push.severity.value,
        // 상대 선수 밀림 정도 연결
        displacement: push.opponentDisplacement.value,
        // 페널티 구역 안 접촉 여부 연결
        penalty: String(push.insidePenaltyArea.value),
        // 카메라 근거 충분성 연결
        camera: push.cameraSufficiency,
        // 관측 영상 재생 속도 연결
        speed: push.severity.observedAtSpeed,
        // 비디오 판독 검토 상황 연결
        scenario: variable.reviewScenario,
        // 경기 재개 여부 연결
        restart: String(variable.restartOccurred),
        // 퇴장 사유 연결
        dismissal: variable.sendOffCategory,
        // 카드 대상 선수 착오 여부 연결
        identity: String(variable.mistakenIdentity),
        // 판정의 해석 필요 여부 연결
        nature: variable.decisionNature,
        // 명백한 오류 정도 연결
        error: variable.errorMagnitude,
        // 심각한 사건 누락 여부 연결
        missed: String(variable.seriousMissedIncident),
        // 관측된 경기 재개 방식 연결
        observedRestart: facts.observed.restartType,
        // 재개 혜택 팀 연결
        beneficiary: facts.observed.restartBeneficiary,
        // 관측된 카드 연결
        observedCard: facts.observed.card ?? "null",
        // 관측된 득점 판정 연결
        observedGoal: facts.observed.goalDecision,
        // 관측 판정 출처 연결
        observedSource: facts.observed.source
    };
};

// 허용된 선택과 실제 영상 샷을 평가 사실로 변환
export const reviewFacts = (
    values: Record<string, string>,
    shots: string[]
): EvaluationFacts | null => {
    // 빈 선택과 변조된 어휘 및 근거 없는 제출 차단
    if (
        shots.length === 0 ||
        reviewFields.some((field) => !field.options.some(([key]) => key === values[field.name]))
    ) {
        // 유효한 사실 묶음을 만들 수 없음을 반환
        return null;
    }
    // 관측 속도와 실제 근거 샷 연결
    const observedAtSpeed = values.speed as EvaluationFacts["push"]["severity"]["observedAtSpeed"];
    // 사용자 확인 사실 구성
    return {
        // 밀기 평가 사실 묶음 연결
        push: {
            // 접촉 관측과 근거 연결
            contactDetected: {
                // 선수 사이 접촉 여부를 서버 사실값으로 변환
                value: values.contact === "null" ? null : values.contact === "true",
                // 사실을 확인한 영상 속도 연결
                observedAtSpeed,
                // 사실의 근거 샷 식별자 목록 연결
                shotIds: shots
            },
            // 접촉 강도 연결
            severity: {
                // 접촉 강도를 서버 사실값으로 변환
                value: values.severity as EvaluationFacts["push"]["severity"]["value"],
                // 사실을 확인한 영상 속도 연결
                observedAtSpeed,
                // 사실의 근거 샷 식별자 목록 연결
                shotIds: shots
            },
            // 상대 선수 밀림과 근거 연결
            opponentDisplacement: {
                // 상대 선수 밀림 정도를 서버 사실값으로 변환
                value: values.displacement as EvaluationFacts["push"]["opponentDisplacement"]["value"],
                // 사실을 확인한 영상 속도 연결
                observedAtSpeed,
                // 사실의 근거 샷 식별자 목록 연결
                shotIds: shots
            },
            // 페널티 구역 안 접촉과 근거 연결
            insidePenaltyArea: {
                // 페널티 구역 안 접촉 여부를 서버 사실값으로 변환
                value: values.penalty === "null" ? null : values.penalty === "true",
                // 사실을 확인한 영상 속도 연결
                observedAtSpeed,
                // 사실의 근거 샷 식별자 목록 연결
                shotIds: shots
            },
            // 카메라 관측 충분성 연결
            cameraSufficiency: values.camera as EvaluationFacts["push"]["cameraSufficiency"]
        },
        // 비디오 판독 검토 조건 연결
        variable: {
            // 비디오 판독 검토 상황 연결
            reviewScenario: values.scenario as EvaluationFacts["variable"]["reviewScenario"],
            // 경기 재개 여부 연결
            restartOccurred: values.restart === "null" ? null : values.restart === "true",
            // 퇴장 사유 연결
            sendOffCategory: values.dismissal as EvaluationFacts["variable"]["sendOffCategory"],
            // 카드 대상 선수 착오 여부 연결
            mistakenIdentity: values.identity === "null" ? null : values.identity === "true",
            // 판정의 해석 필요 여부 연결
            decisionNature: values.nature as EvaluationFacts["variable"]["decisionNature"],
            // 명백한 오류 정도 연결
            errorMagnitude: values.error as EvaluationFacts["variable"]["errorMagnitude"],
            // 심각한 사건 누락 여부 연결
            seriousMissedIncident: values.missed === "null" ? null : values.missed === "true"
        },
        // 화면에서 확인한 원심 판정과 출처 보존
        observed: {
            // 관측된 경기 재개 방식 연결
            restartType: values.observedRestart as EvaluationFacts["observed"]["restartType"],
            // 재개 혜택 팀 연결
            restartBeneficiary:
                values.beneficiary as EvaluationFacts["observed"]["restartBeneficiary"],
            // 관측된 카드 연결
            card:
                values.observedCard === "null"
                    ? null
                    : (values.observedCard as EvaluationFacts["observed"]["card"]),
            // 관측된 득점 판정 연결
            goalDecision: values.observedGoal as EvaluationFacts["observed"]["goalDecision"],
            // 관측 판정 출처 연결
            source: values.observedSource as EvaluationFacts["observed"]["source"]
        }
    };
};
