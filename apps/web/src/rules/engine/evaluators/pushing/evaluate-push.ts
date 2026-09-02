import type { EvaluationResult, PushFacts, RuleCitation, RuleSet } from "@replay/shared-types";
import { pushAccounts } from "../../interpreter/build-accounts";
import { factSignature } from "../../signatures/fact-signature";
import { pushGates } from "../../gates/push-gates";

const uniqueCitations = (citations: RuleCitation[]): RuleCitation[] => {
  const seen = new Set<string>();
  const unique: RuleCitation[] = [];
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

  const { signature, input } = factSignature({
    contactDetected: facts.contactDetected,
    severity: facts.severity,
    opponentDisplacement: facts.opponentDisplacement,
    insidePenaltyArea: facts.insidePenaltyArea,
    cameraSufficiency: facts.cameraSufficiency,
  });

  const citations = uniqueCitations([
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
