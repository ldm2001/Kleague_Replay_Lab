// 공통 관측과 판정 자료형 가져오기
import type { EvaluationResult, PushFacts, RuleCitation, RuleSet } from "@replay/shared-types";
// 판정 기준별 설명 가져오기
import { pushAccounts } from "../../interpreter/accounts";
// 사실 내용 해시 기능 가져오기
import { factSignature } from "../../signatures/fact-signature";
// 밀기 적용 조건 검사 가져오기
import { pushGates } from "../../gates/push-gates";

// 화면 요소 구성
const ruleCitations = (citations: RuleCitation[]): RuleCitation[] => {
    // 이미 사용한 조항 식별자 추적
    const seen = new Set<string>();
    // 중복 제거 결과 초기화
    const unique: RuleCitation[] = [];
    // 조항 목록 순회
    for (const citation of citations) {
        // 인용 규정 식별자의 조건에 따라 처리 분기
        if (seen.has(citation.ruleId)) continue;
        // 집합에 현재 항목 등록
        seen.add(citation.ruleId);
        // 중복을 제거한 규정 인용 목록에 현재 항목 추가
        unique.push(citation);
    }
    // 중복을 제거한 규정 인용 반환
    return unique;
};

// 결과 처리
export const pushResult = (facts: PushFacts, rules: RuleSet): EvaluationResult => {
    // 규정 요구사항 우선 생성
    const view = pushAccounts(facts, rules);
    // 계산한 규정 판정 확인
    const verdict = pushGates(facts, rules);

    // 판정 입력의 재현 서명 생성
    const { signature, input } = factSignature({
        // 실제 접촉의 관측값 기록
        contactDetected: facts.contactDetected,
        // 행위 강도 평가 기록
        severity: facts.severity,
        // 상대 움직임 변화의 관측 수준 기록
        opponentDisplacement: facts.opponentDisplacement,
        // 행위 위치의 페널티 지역 여부 기록
        insidePenaltyArea: facts.insidePenaltyArea,
        // 질문 확인에 필요한 카메라 근거 충분성 기록
        cameraSufficiency: facts.cameraSufficiency,
        // 해당 행위에 연결된 경기 문맥 기록
        context: facts.context ?? null,
    });

    // 판정 경로의 조항 결합
    const citations = ruleCitations([
        ...verdict.citations,
        ...view.narrowedTo,
        ...view.accounts.flatMap((account) => account.citations),
    ]);

    // 결론에 연결된 규정 인용의 조건에 따라 처리 분기
    if (citations.length === 0) {
        // 인용 없는 결과 차단
        throw new Error("pushResult가 인용 없이 결과를 만들려 했음 — 규칙 데이터를 확인할 것");
    }

    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return {
        // 판정 기준별 세부 설명 기록
        accounts: view.accounts,
        // 서로 충돌하는 규정 조건 기록
        conflicts: view.conflicts,
        // 상위 규정을 좁혀 적용한 범주 기록
        narrowedTo: view.narrowedTo,
        // 해당 규정으로 차단된 검토 범주 기록
        blockedFrom: view.blockedFrom,
        // 비디오 판독의 독립 평가 기록
        varAssessment: null,
        // 규정 대조로 계산한 판정 기록
        decision: verdict.decision,
        // 행위 강도 평가 기록
        severity: verdict.severity,
        // 경기 재개에 관한 결과 기록
        restart: verdict.restart,
        // 징계에 관한 독립 결과 기록
        disciplinary: verdict.disciplinary,
        // 관측 판정 비교값 보류
        decisionMatch: "UNDETERMINED",
        // 카메라 근거 충분성에서 계산한 평가 신뢰 수준 기록
        confidence: verdict.confidence,
        // 판정을 확정하지 못한 이유 기록
        inconclusiveReason: verdict.inconclusiveReason,
        // 사실 내용의 동일성 해시 기록
        factSignature: signature,
        // 해시 계산에 사용할 사실 내용 기록
        factSignatureInput: input,
        // 결론에 연결된 규정 인용 기록
        citations,
    };
};
