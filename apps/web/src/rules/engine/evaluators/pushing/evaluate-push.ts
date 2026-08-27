import type { EvaluationResult, PushFacts, RuleCitation, RuleSet } from "@replay/shared-types";
import { buildPushAccounts } from "../../interpreter/build-accounts";
import { buildFactSignature } from "../../signatures/fact-signature";
import { applyPushGates } from "../../gates/push-gates";

const dedupeByRuleId = (citations: RuleCitation[]): RuleCitation[] => {
  const seen = new Set<string>();
  const unique: RuleCitation[] = [];
  for (const citation of citations) {
    if (seen.has(citation.ruleId)) continue;
    seen.add(citation.ruleId);
    unique.push(citation);
  }
  return unique;
};

export const evaluatePush = (facts: PushFacts, rules: RuleSet): EvaluationResult => {
  // 규정이 무엇을 요구하는지가 먼저다. 게이트는 이 결과를 지우지 않는다.
  const view = buildPushAccounts(facts, rules);
  const verdict = applyPushGates(facts, rules);

  const { signature, input } = buildFactSignature({
    contactDetected: facts.contactDetected,
    severity: facts.severity,
    opponentDisplacement: facts.opponentDisplacement,
    insidePenaltyArea: facts.insidePenaltyArea,
    cameraSufficiency: facts.cameraSufficiency,
  });

  const citations = dedupeByRuleId([
    ...verdict.citations,
    ...view.narrowedTo,
    ...view.accounts.flatMap((account) => account.citations),
  ]);

  if (citations.length === 0) {
    // 조항 없이 결론만 나가는 경로를 만들지 않는다 (README 11절).
    throw new Error("evaluatePush가 인용 없이 결과를 만들려 했음 — 규칙 데이터를 확인할 것");
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
    // 비교할 관측 판정이 아직 입력에 없다. 없는 비교를 MATCH로 채우지 않는다.
    decisionMatch: "UNDETERMINED",
    confidence: verdict.confidence,
    inconclusiveReason: verdict.inconclusiveReason,
    factSignature: signature,
    factSignatureInput: input,
    citations,
  };
};
