// 공유 자료 계약과 검증 기능 가져옴
import type {
    CompetitionOptions,
    CompetitionRuleSelection,
    EvaluationResult,
    ObservedDecision,
    PushFacts,
    RuleSet,
    VarFacts,
    VarOutcome
} from "@replay/shared-types";

// 국제 축구 규정 집합 조회 함수 정의
type Rule = (versionId: string) => RuleSet | null;
// 대회와 시즌에 맞는 규정 집합 조회 함수 정의
type CompetitionRule = (selection: CompetitionRuleSelection) => RuleSet | null;
// 밀기 사실을 규정에 대조하는 평가 함수 정의
type Push = (facts: PushFacts, rules: RuleSet) => EvaluationResult;
// 영상 판독 적용 요건의 평가 함수 정의
type Variable = (facts: VarFacts, rules: RuleSet, options: CompetitionOptions) => VarOutcome;
// 사실 내용 서명 계산 함수 정의
type Hash = (value: string) => Promise<Uint8Array>;

// 규정 대조 입력 계약 정의
export type AssessmentInput = Readonly<{
    // 대회 규정 판본 식별자
    ruleVersionId: string;
    // 규정 적용 대상 대회
    competition?: Readonly<{ competition: string; season: string }>;
    // 밀기 질문의 규정 평가 또는 사실 자료
    push: PushFacts;
    // 영상 판독 적용 조건의 사실 자료
    variable: VarFacts;
    // 규정이나 저장소 실행에 필요한 선택 값
    options: CompetitionOptions;
    // 규정 판단과 비교하는 관측 원심
    observed: ObservedDecision;
}>;

// 규정 대조 결과 정의
export type AssessmentResult =
    | Readonly<{ kind: "EVALUATED"; value: EvaluationResult }>
    | Readonly<{ kind: "RULE_VERSION_UNKNOWN" }>
    | Readonly<{ kind: "VAR_EVALUATION_FAILED"; error: string; message: string }>;

// 규정 대조 의존 기능 계약 정의
export type AssessmentDependencies = Readonly<{
    // 경기 문맥에 맞춰 연결한 규정 자료
    rule: Rule;
    // 검증된 대회별 규정을 찾는 기능
    competitionRule?: CompetitionRule;
    // 밀기 질문의 규정 평가 또는 사실 자료
    push: Push;
    // 영상 판독 적용 조건의 사실 자료
    variable: Variable;
    // 토큰이나 사실 내용의 동일성 대조 기능
    hash: Hash;
}>;

// 인용 중복 제거
const citations = (
    value: EvaluationResult,
    variable: Extract<VarOutcome, { ok: true }>
): EvaluationResult["citations"] => {
    // 밀기와 비디오 판독 인용 결합
    const values = [...value.citations, ...variable.citations];
    // 중복 조항 추적
    const seen = new Set<string>();
    // 조항 식별자 기준 중복 제거
    return values.filter((item) => {
        // 이미 포함한 규정 인용이면 중복 제외
        if (seen.has(item.ruleId)) return false;
        // 인용 중복 제거 집합에 현재 규정 식별자 기록
        seen.add(item.ruleId);
        // 처음 확인한 규정 인용은 목록에 포함하도록 반환
        return true;
    });
};

// 바이트 해시 변환
const hex = (value: Uint8Array): string =>
    Array.from(value, (item) => item.toString(16).padStart(2, "0")).join("");

// 규정 재개와 관측 원심 비교
const comparison = (
    value: EvaluationResult,
    observed: ObservedDecision,
    facts: PushFacts
): EvaluationResult["decisionMatch"] => {
    // 관측되지 않은 재개 방식은 비교 보류
    if (
        value.decision === "INCONCLUSIVE" ||
        value.decision === "OUT_OF_SCOPE" ||
        observed.restartType === "UNKNOWN" ||
        value.restart === null ||
        value.restart === "UNKNOWN"
    ) {
        // 근거가 부족한 원심 비교를 미확정 상태로 반환
        return "UNDETERMINED";
    }
    // 재개 방식이 다르면 불일치
    if (observed.restartType !== value.restart) return "MISMATCH";
    // 카드 관측이 없으면 전체 비교 보류
    if (observed.card === null) return "UNDETERMINED";
    // 계산되지 않은 징계를 카드 없음으로 바꾸지 않음
    if (value.disciplinary === null) return "UNDETERMINED";
    // 규정 평가의 징계 조치 읽음
    const disciplinary = value.disciplinary;
    // 확인된 카드가 다르면 불일치
    if (observed.card !== disciplinary) return "MISMATCH";
    // 재개 수혜 팀 비교에 필요한 행위 선수의 팀 역할 읽음
    const role = facts.context?.offenderRole.value;
    // 반칙 행위 팀의 반대 팀을 재개 수혜 팀으로 계산
    const beneficiary =
        value.restart === "PLAY_CONTINUED"
            ? "NONE"
            : role === "ATTACKING_TEAM"
              ? "DEFENDING_TEAM"
              : role === "DEFENDING_TEAM"
                ? "ATTACKING_TEAM"
                : "UNKNOWN";
    // 규정 또는 원심의 재개 수혜 팀이 미확정인지 확인
    if (beneficiary === "UNKNOWN" || observed.restartBeneficiary === "UNKNOWN")
        // 수혜 팀 근거가 없어 원심 비교 미확정 반환
        return "UNDETERMINED";
    // 규정상 수혜 팀과 관측 원심의 수혜 팀 불일치 확인
    if (observed.restartBeneficiary !== beneficiary) return "MISMATCH";
    // 밀기 평가는 득점의 적합성을 평가하지 않음
    if (observed.goalDecision !== "NOT_APPLICABLE") return "UNDETERMINED";
    // 비교 가능한 항목이 모두 같으면 일치
    return "MATCH";
};

// 밀기와 비디오 판독 평가
export const assessment =
    ({ rule, competitionRule, push, variable, hash }: AssessmentDependencies) =>
    async (input: AssessmentInput): Promise<AssessmentResult> => {
        // 분석 대상 규정 판본 조회
        const rules = input.competition
            ? competitionRule?.({ ...input.competition, ifabVersionId: input.ruleVersionId })
            : rule(input.ruleVersionId);
        // 적용할 규정집이 없으면 추정 평가 차단
        if (!rules) return { kind: "RULE_VERSION_UNKNOWN" };

        // 밀기 판정 계산
        const pushing = push(input.push, rules);
        // 비디오 판독 판정 계산
        const varValue = variable(input.variable, rules, input.options);
        // 영상 판독 규정 평가 실행 실패 여부 확인
        if (!varValue.ok) {
            // 영상 판독 평가 실패의 코드와 설명 반환
            return {
                // 처리 분기 또는 자료 종류를 구별하는 값
                kind: "VAR_EVALUATION_FAILED",
                // 검사 또는 평가에서 발생한 실패 사유
                error: varValue.error,
                // 처리 진행 또는 실패의 안내 문구
                message: varValue.message
            };
        }

        // 사실 입력 직렬화
        const factSignatureInput = JSON.stringify({
            // 밀기 질문의 규정 평가 또는 사실 자료
            push: input.push,
            // 영상 판독 적용 조건의 사실 자료
            variable: input.variable,
            // 규정 판단과 비교하는 관측 원심
            observed: input.observed
        });
        // 사실 입력 해시 생성
        const factSignature = hex(await hash(factSignatureInput));
        // 통합 판정 결과 반환
        return {
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: "EVALUATED",
            // 해당 계약이 전달하는 값
            value: {
                ...pushing,
                // 관측 원심과 규정 평가의 일치 여부
                decisionMatch: comparison(pushing, input.observed, input.push),
                // 영상 판독 개입에 대한 규정 평가
                varAssessment: varValue.assessment,
                // 평가 사실 내용의 동일성 확인용 서명
                factSignature,
                // 사실 내용 서명을 계산할 입력 자료
                factSignatureInput,
                // 판단 근거가 된 규정 인용 목록
                citations: citations(pushing, varValue)
            }
        };
    };
