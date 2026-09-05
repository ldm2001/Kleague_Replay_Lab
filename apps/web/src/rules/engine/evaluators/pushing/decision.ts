import type { EvaluationResult, PushFacts, RuleCitation, RuleSet } from "@replay/shared-types";
import { pushAccounts } from "../../interpreter/accounts";
import { factSignature } from "../../signatures/fact-signature";
import { pushGates } from "../../gates/push-gates";

const ruleCitations = (citations: RuleCitation[]): RuleCitation[] => {
  // 이미 사용한 조항 식별자 추적
  const seen = new Set<string>();
  // 중복 제거 결과 초기화
  const unique: RuleCitation[] = [];
  // 조항 목록 순회
  for (const citation of citations) {
    if (seen.has(citation.ruleId)) continue;
    seen.add(citation.ruleId);
    unique.push(citation);
  }
  return unique;
};

export const pushResult = (facts: PushFacts, rules: RuleSet): EvaluationResult => {
  // 규정 요구사항 우선 생성
  const view = pushAccounts(facts, rules);
  const verdict = pushGates(facts, rules);

  // 판정 입력의 재현 서명 생성
  const { signature, input } = factSignature({
    contactDetected: facts.contactDetected,
    severity: facts.severity,
    opponentDisplacement: facts.opponentDisplacement,
    insidePenaltyArea: facts.insidePenaltyArea,
    cameraSufficiency: facts.cameraSufficiency,
  });

  // 판정 경로의 조항 결합
  const citations = ruleCitations([
    ...verdict.citations,
    ...view.narrowedTo,
    ...view.accounts.flatMap((account) => account.citations),
  ]);

  if (citations.length === 0) {
    // 인용 없는 결과 차단
    throw new Error("pushResult가 인용 없이 결과를 만들려 했음 — 규칙 데이터를 확인할 것");
  }

  return {
    accounts: view.accounts,
    conflicts: view.conflicts,
    narrowedTo: view.narrowedTo,
    blockedFrom: view.blockedFrom,
    varAssessment: null,
    decision: verdict.decision,
    severity: verdict.severity,
    restart: verdict.restart,
    disciplinary: verdict.disciplinary,
    // 관측 판정 비교값 보류
    decisionMatch: "UNDETERMINED",
    confidence: verdict.confidence,
    inconclusiveReason: verdict.inconclusiveReason,
    factSignature: signature,
    factSignatureInput: input,
    citations,
  };
};
