// 실행 규정 묶음 가져오기
import type { ConceptKey, RuleSet } from "../../../shared/rule-set";
// 규정 인용 자료형 가져오기
import type { RuleCitation } from "../../../shared/citation";
// 사건 관측 자료형 가져오기
import type { IncidentAssertion, IncidentRecordV1 } from "../../../shared/incident";
// 질문별 평가 결과형 가져오기
import type {
    IncidentConclusion,
    IncidentEvaluationV1,
    IncidentFactDiagnostic,
    IncidentQuestion
} from "../../../shared/verdict";
// 사건 구조 검증 기능 가져오기
import { incidentRecordData } from "../../../shared/incident-schema";
// 사실 승인과 영상 근거 기능 가져오기
import {
    admissionMatch,
    incidentDigest,
    incidentClaim,
    type IncidentAdmission,
    type IncidentAssertionRead
} from "./evidence";

// 완료하지 못한 평가 상태의 자료 구조 정의
type PendingState = "UNDETERMINED" | "UNSUPPORTED" | "NOT_APPLICABLE";

// 미완료 결론 구성
const pending = (
    status: PendingState,
    reason: string,
    missingFacts: readonly string[] = [],
    citations: readonly RuleCitation[] = []
): IncidentConclusion<never> => ({
    // 현재 처리 상태 기록
    status,
    // 값 기록
    value: null,
    // 처리 상태를 설명하는 사유 코드 기록
    reasonCodes: [reason],
    // 결론에 필요한 미확인 사실 목록 기록
    missingFacts,
    // 결론에 연결된 규정 인용 기록
    citations
});

// 중복 값 제거
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

// 완료 결론 구성
const completed = <T,>(
    value: T,
    reads: readonly IncidentAssertionRead[],
    citations: readonly RuleCitation[]
): IncidentConclusion<T> => ({
    // 현재 처리 상태 기록
    status: "COMPLETED",
    // 값 기록
    value,
    // 검증에 사용한 사실 식별자 목록 기록
    factIds: unique(reads.flatMap((read) => read.factIds)),
    // 연결된 증거 식별자 목록 기록
    evidenceIds: unique(reads.flatMap((read) => read.evidenceIds)),
    // 결론에 연결된 규정 인용 기록
    citations
});

// 잡기 성립과 재개 평가
export const holdingVerdict = (
    record: IncidentRecordV1,
    actionId: string,
    input: Readonly<{ rules: RuleSet; admission: IncidentAdmission }>
): IncidentEvaluationV1 => {
    // 사건 자료 구조 오류 시 오류로 처리 중단
    if (!incidentRecordData(record)) throw new Error("INCIDENT_RECORD_INVALID");
    // 현재 평가할 행위 조회
    const action = record.actions.find((action) => action.id === actionId);
    // 요청한 행위 누락 시 오류로 처리 중단
    if (!action) throw new Error("INCIDENT_ACTION_NOT_FOUND");
    // 공개하지 않을 사실별 검사 기록 초기화
    const diagnostics: IncidentFactDiagnostic[] = [];
    // 현재까지 계산한 결과 구성
    const result: IncidentEvaluationV1 = {
        // 전송 자료의 구조 버전 기록
        schemaVersion: "incident-evaluation-v1",
        // 판정 계산기의 버전 기록
        evaluatorVersion: "holding-criteria-v2",
        // 경합 사건 식별자 기록
        incidentId: record.incidentId,
        // 사건 안의 행위 식별자 기록
        actionId,
        // 원본 영상의 내용 해시 기록
        sourceSha256: record.sourceSha256,
        // 전체 사건 내용에 결합된 해시 기록
        recordSha256: incidentDigest(record),
        // 실제로 적용한 규정 판본 식별자 기록
        ruleVersionId: record.match.ifabVersionId,
        // 현재 평가 범위 기록
        scope: "HOLDING_ONLY",
        // 사실별 비공개 검사 결과 기록
        factDiagnostics: diagnostics,
        // 질문별로 분리된 규정 결론의 미지원 상태 초기화
        conclusions: {
            // 해당 유형의 반칙 성립 결론의 미지원 상태 초기화
            offence: pending("UNSUPPORTED", "ACTION_EVALUATOR_UNSUPPORTED"),
            // 행위 위험성의 규정상 평가의 미지원 상태 초기화
            risk: pending("UNSUPPORTED", "RISK_EVALUATOR_UNSUPPORTED"),
            // 경기 재개에 관한 결과의 미지원 상태 초기화
            restart: pending("UNSUPPORTED", "ACTION_EVALUATOR_UNSUPPORTED"),
            // 징계에 관한 독립 결과의 미지원 상태 초기화
            disciplinary: pending("UNSUPPORTED", "DISCIPLINARY_EVALUATOR_UNSUPPORTED"),
            // 계산 결과와 원심의 비교 기록
            originalDecisionComparison: pending(
                "UNSUPPORTED",
                "ORIGINAL_DECISION_COMPARISON_UNSUPPORTED"
            ),
            // 비디오 판독 개입에 대한 별도 평가의 미지원 상태 초기화
            varIntervention: pending("UNSUPPORTED", "VAR_EVALUATOR_UNSUPPORTED")
        }
    };
    // 지원하는 잡기 유형인지 확인
    if (action.type !== "HOLDING_MOTION") return result;

    // 성립과 재개 보류
    const pendingPair = (reason: string, missing: readonly string[] = []): IncidentEvaluationV1 => {
        // 해당 유형의 반칙 성립 결론 갱신
        result.conclusions.offence = pending("UNDETERMINED", reason, missing);
        // 경기 재개에 관한 결과 갱신
        result.conclusions.restart = pending("UNDETERMINED", reason, missing);
        // 현재까지 계산한 결과 반환
        return result;
    };
    // 서버 승인과 사건 내용 불일치 시 성립과 재개 보류
    if (!admissionMatch(record, input.admission)) return pendingPair("ADMISSION_RECORD_MISMATCH");
    // 경기와 규정 문맥 미검증 시 성립과 재개 보류
    if (record.match.verification !== "VERIFIED") return pendingPair("RULE_CONTEXT_UNVERIFIED");

    // 규정 출처 확인
    const references = (keys: readonly ConceptKey[]): RuleCitation[] | null => {
        // 요청한 규정별 인용 묶음 구성
        const groups = keys.map((key) => input.rules.cite(key));
        // 필요한 조항 중 인용이 없는 항목이 있는지 확인
        if (groups.some((group) => !group.length)) return null;
        // 결론에 연결된 규정 인용 구성
        const citations = groups.flat();
        // 모든 인용 판본이 맞으면 인용 목록을 반환하고 아니면 빈 값 반환
        return citations.every(
            (citation) =>
                citation.authority === "IFAB" &&
                `ifab-${citation.edition}` === record.match.ifabVersionId
        )
            ? citations
            : null;
    };
    // 잡기 성립에 필요한 규정 인용 확인
    const offenceCitations = references([
        "LAW_12_HOLDING_DEFINITION",
        "LAW_12_HOLDING_OFFENCE",
        "LAW_12_IN_PLAY"
    ]);
    // 필요한 규정 조항 또는 판본 누락 시 성립과 재개 보류
    if (!offenceCitations) return pendingPair("RULE_CLAUSE_OR_EDITION_UNAVAILABLE");
    // 행위 위험성의 규정상 평가 갱신
    result.conclusions.risk = pending(
        "NOT_APPLICABLE",
        "SEVERITY_NOT_A_HOLDING_ESTABLISHMENT_CONDITION",
        [],
        offenceCitations
    );

    // 사실별 근거 상태 확인
    const claimState = (fact: IncidentAssertion, temporal = false) => {
        // 개별 사실에 대한 근거 검사 결과 확인
        const outcome = incidentClaim(record, action, fact, input.admission, { temporal });
        // 같은 사실과 시간 검사 조건이 이미 기록됐는지 확인
        if (!diagnostics.some((item) => item.factId === fact.id && item.temporal === temporal)) {
            // 공개하지 않을 사실별 검사 기록 목록에 현재 항목 추가
            diagnostics.push({
                // 개별 사실 식별자 기록
                factId: fact.id,
                // 현재 확인 상태 기록
                state: outcome.state,
                // 시간 변화 근거가 필요한 질문인지 여부 기록
                temporal,
                // 연결된 증거 식별자 목록 기록
                evidenceIds: outcome.evidenceIds,
                // 확인 불가 또는 차단 사유 목록 기록
                reasons: outcome.reasons
            });
        }
        // 개별 사실에 대한 근거 검사 결과 반환
        return outcome;
    };
    // 해당 행위에 연결된 경기 문맥 참조
    const context = action.context;
    // 행위 관측의 근거 상태 확인
    const actionRead = claimState(action.observations.actionObserved);
    // 행위자 선수 여부의 근거 상태 및 대상이 선수인지에 대한 근거 상태 및 두 선수가 상대 팀인지에 대한 근거 상태 확인
    const playerRead = claimState(context.actorIsPlayer),
        // 대상이 선수인지에 대한 근거 상태 확인
        targetRead = claimState(context.targetIsPlayer),
        // 두 선수가 상대 팀인지에 대한 근거 상태 확인
        opponentRead = claimState(context.opponents);
    // 인플레이 여부의 근거 상태 확인
    const inPlayRead = claimState(context.ballInPlay, true);
    // 평가 범위를 결정하는 확인 상태 목록 구성
    const applicable = [actionRead, playerRead, targetRead, opponentRead, inPlayRead];
    // 평가 범위에 필요한 원시 사실 구성
    const applicableFacts = [
        action.observations.actionObserved,
        context.actorIsPlayer,
        context.targetIsPlayer,
        context.opponents,
        context.ballInPlay
    ];
    // 평가 범위를 결정하지 못한 사실 식별자 구성
    const unresolved = applicable.flatMap((read, index) =>
        read.state === "UNKNOWN" || read.state === "NOT_APPLICABLE"
            ? [applicableFacts[index]!.id]
            : []
    );
    // 잡기 평가 범위의 문맥 미확인 시 성립과 재개 보류
    if (unresolved.length) return pendingPair("HOLDING_CONTEXT_UNDETERMINED", unresolved);
    // 평가 범위를 결정하는 확인 상태 목록 및 현재 확인 상태의 조건에 따라 처리 분기
    if (applicable.some((read) => read.state !== "CONFIRMED")) {
        // 인플레이 상대 선수 잡기 평가 범위 밖 사유 기록
        result.conclusions.offence = pending(
            "UNSUPPORTED",
            "OUTSIDE_IN_PLAY_OPPONENT_HOLDING_SCOPE",
            [],
            offenceCitations
        );
        // 인플레이 상대 선수 잡기 평가 범위 밖 사유 기록
        result.conclusions.restart = pending(
            "UNSUPPORTED",
            "OUTSIDE_IN_PLAY_OPPONENT_HOLDING_SCOPE"
        );
        // 현재까지 계산한 결과 반환
        return result;
    }
    // 해당 행위의 주체 조회
    const actor = record.actors.find((actor) => actor.id === action.actorId)!;
    // 해당 행위의 대상 조회
    const target = record.actors.find((actor) => actor.id === action.targetActorId)!;
    // 행위자 팀 배정의 근거 상태 및 대상 팀 배정의 근거 상태 확인
    const actorTeam = claimState(actor.teamAssignment),
        // 대상 팀 배정의 근거 상태 확인
        targetTeam = claimState(target.teamAssignment);
    // 상대 관계와 팀 배정의 상충 시 성립과 재개 보류
    if (
        actorTeam.state === "CONFIRMED" &&
        targetTeam.state === "CONFIRMED" &&
        actor.teamId === target.teamId
    ) {
        // 상대 관계와 팀 배정의 상충 사유와 함께 결과 반환
        return pendingPair("TEAM_RELATION_CONFLICT", [
            context.opponents.id,
            actor.teamAssignment.id,
            target.teamAssignment.id
        ]);
    }
    // 접촉 관측의 확인 상태 확인
    const contact = claimState(
        action.observations.bodyOrEquipmentContact,
        action.observations.bodyOrEquipmentContact.state === "REFUTED"
    );
    // 해당 접촉에 의한 이동 방해의 근거 상태 확인
    const impeded = claimState(action.observations.movementImpeded, true);
    // 잡기 유지의 검증된 관측 상태 확인
    const grip = claimState(action.observations.gripMaintained, true);
    // 당김의 검증된 관측 상태 확인
    const pulling = claimState(action.observations.pulling, true);
    // 동일 대상에 대한 해당 행위의 접촉 관측
    // 잡기 필수 조건이 아닌 선택적 보조 근거
    const conflicting = [impeded, grip, pulling].filter((item) => item.state === "CONFIRMED");
    // 현재 확인 상태의 조건에 따라 처리 분기
    if (contact.state === "REFUTED" && conflicting.length) {
        // 이미 사용된 식별자 집합 보관 공간 생성
        const ids = new Set([
            action.observations.bodyOrEquipmentContact.id,
            ...conflicting.flatMap((item) => item.factIds)
        ]);
        // 공개하지 않을 사실별 검사 기록의 각 항목을 순서대로 검사
        for (const item of diagnostics) {
            // 동일 행위의 관측 근거 상충에 해당하는 경우 사유 기록
            if (ids.has(item.factId))
                // 동일 행위의 관측 근거 상충 사유 기록
                item.reasons = unique([...item.reasons, "OBSERVATION_CONFLICT"]);
        }
        // 동일 행위의 관측 근거 상충 사유와 함께 결과 반환
        return pendingPair("OBSERVATION_CONFLICT");
    }
    // 현재 확인 상태의 조건에 따라 처리 분기
    if (contact.state === "REFUTED" || impeded.state === "REFUTED") {
        // 해당 유형의 반칙 성립 결론 갱신
        result.conclusions.offence = completed(
            "NO_HOLDING_OFFENCE",
            [...applicable, contact.state === "REFUTED" ? contact : impeded],
            offenceCitations
        );
        // 잡기 불성립으로 재개 평가 제외 사유 기록
        result.conclusions.restart = pending(
            "NOT_APPLICABLE",
            "NO_HOLDING_OFFENCE_TO_RESTART",
            [],
            offenceCitations
        );
        // 현재까지 계산한 결과 반환
        return result;
    }
    // 접촉 또는 이동 방해 미확인 시 성립과 재개 보류
    if (contact.state !== "CONFIRMED" || impeded.state !== "CONFIRMED") {
        // 접촉 또는 이동 방해 미확인 사유와 함께 결과 반환
        return pendingPair("HOLDING_FACTS_UNDETERMINED", [
            ...(contact.state !== "CONFIRMED"
                ? [action.observations.bodyOrEquipmentContact.id]
                : []),
            ...(impeded.state !== "CONFIRMED" ? [action.observations.movementImpeded.id] : [])
        ]);
    }
    // 잡기 성립 판단에 사용한 사실 구성
    const offenceReads = [...applicable, contact, impeded];
    // 해당 유형의 반칙 성립 결론 갱신
    result.conclusions.offence = completed("HOLDING_OFFENCE", offenceReads, offenceCitations);
    // 한 사건에서 관찰한 여러 행위 및 고유 식별자의 조건에 따라 처리 분기
    if (
        record.actions.some(
            (other) =>
                other.id !== action.id &&
                other.observations.actionObserved.state === "CONFIRMED" &&
                input.admission.factIds.has(other.observations.actionObserved.id)
        )
    ) {
        // 여러 행위의 재개 우선순위 미지원 사유 기록
        result.conclusions.restart = pending(
            "UNSUPPORTED",
            "MULTI_ACTION_RESTART_SELECTION_UNSUPPORTED"
        );
        // 현재까지 계산한 결과 반환
        return result;
    }
    // 재개 방식에 필요한 규정 인용 확인
    const restartCitations = references([
        "LAW_12_IN_PLAY",
        "LAW_13_BENEFICIARY",
        "LAW_14_PENALTY",
        "LAW_12_CONTINUING_HOLDING",
        "LAW_5_ADVANTAGE",
        "LAW_5_MULTIPLE_OFFENCES"
    ]);
    // 재개 방식에 필요한 규정 인용의 조건에 따라 처리 분기
    if (!restartCitations) {
        // 필요한 규정 조항 또는 판본 누락 사유 기록
        result.conclusions.restart = pending(
            "UNDETERMINED",
            "RESTART_RULE_CLAUSE_OR_EDITION_UNAVAILABLE"
        );
        // 현재까지 계산한 결과 반환
        return result;
    }
    // 재개 판단에 필요한 사실 항목 구성
    const restartFacts = [
        context.onField,
        context.insideOwnPenaltyArea,
        context.stoppedForThisAction,
        context.advantageApplied,
        context.otherActionInRestartSequence,
        target.teamAssignment
    ];
    // 재개 사실의 근거 검사 결과 구성
    const restartReads = restartFacts.map((fact) =>
        claimState(fact, fact !== target.teamAssignment)
    );
    // 충족되지 않은 입력 목록 구성
    const missing = restartReads.flatMap((read, index) =>
        read.state === "UNKNOWN" || read.state === "NOT_APPLICABLE" ? [restartFacts[index]!.id] : []
    );
    // 충족되지 않은 입력 목록 및 현재 확인 상태의 조건에 따라 처리 분기
    if (missing.length || targetTeam.state !== "CONFIRMED" || !target.teamId) {
        // 재개에 필요한 사실 미확인 사유 기록
        result.conclusions.restart = pending(
            "UNDETERMINED",
            "RESTART_FACTS_UNDETERMINED",
            unique([
                ...missing,
                ...(targetTeam.state !== "CONFIRMED" || !target.teamId
                    ? [target.teamAssignment.id]
                    : [])
            ]),
            restartCitations
        );
        // 현재까지 계산한 결과 반환
        return result;
    }
    // 재개에 필요한 위치·중단·어드밴티지·다른 행위 상태 분리
    const [onField, inside, stopped, advantage, competing] = restartReads;
    // 현재 확인 상태의 조건에 따라 처리 분기
    if (
        onField!.state !== "CONFIRMED" ||
        stopped!.state !== "CONFIRMED" ||
        advantage!.state !== "REFUTED" ||
        competing!.state !== "REFUTED"
    ) {
        // 별도 평가가 필요한 재개 상황 사유 기록
        result.conclusions.restart = pending(
            "UNSUPPORTED",
            "RESTART_CONTEXT_REQUIRES_SEPARATE_EVALUATOR",
            [],
            restartCitations
        );
        // 현재까지 계산한 결과 반환
        return result;
    }
    // 경기 재개에 관한 결과 갱신
    result.conclusions.restart = completed(
        {
            // 자료 또는 행위 종류 기록
            type: inside!.state === "CONFIRMED" ? "PENALTY_KICK" : "DIRECT_FREE_KICK",
            // 재개를 부여받는 팀 식별자 기록
            beneficiaryTeamId: target.teamId
        },
        [...offenceReads, ...restartReads],
        [...offenceCitations, ...restartCitations]
    );
    // 현재까지 계산한 결과 반환
    return result;
};

// 완료된 사건 결론 선택
export const incidentPublic = (result: IncidentEvaluationV1) => {
    // 항목 이름과 값의 묶음 계산
    const entries = Object.entries(result.conclusions) as [
        IncidentQuestion,
        IncidentEvaluationV1["conclusions"][IncidentQuestion]
    ][];
    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return {
        // 전송 자료의 구조 버전 기록
        schemaVersion: result.schemaVersion,
        // 판정 계산기의 버전 기록
        evaluatorVersion: result.evaluatorVersion,
        // 현재 평가 범위 기록
        scope: result.scope,
        // 경합 사건 식별자 기록
        incidentId: result.incidentId,
        // 사건 안의 행위 식별자 기록
        actionId: result.actionId,
        // 실제로 적용한 규정 판본 식별자 기록
        ruleVersionId: result.ruleVersionId,
        // 질문별로 분리된 규정 결론 기록
        conclusions: entries.flatMap(([question, conclusion]) =>
            conclusion.status === "COMPLETED"
                ? [
                      {
                          // 이번 규정 평가가 답하는 질문 기록
                          question,
                          // 값 기록
                          value: conclusion.value,
                          // 연결된 증거 식별자 목록 기록
                          evidenceIds: conclusion.evidenceIds,
                          // 결론에 연결된 규정 인용 기록
                          citations: conclusion.citations
                      }
                  ]
                : []
        ),
        // 이번 평가에서 판단하지 않은 질문 기록
        notAssessed: entries
            .filter(([, conclusion]) => conclusion.status !== "COMPLETED")
            .map(([question]) => question)
    };
};
