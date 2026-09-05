import type {
  DecisionInput,
  DecisionResult,
  FactInput,
  FactResult,
  SessionRecord,
} from "@replay/application";

export type EvaluationApiDependencies = Readonly<{
  resolve: (token: string) => Promise<SessionRecord | null>;
  facts: (input: FactInput) => Promise<FactResult>;
  decision: (input: DecisionInput) => Promise<DecisionResult>;
}>;

// JSON 응답 생성
const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });

// 세션 쿠키 추출
const cookie = (request: Request): string | null => {
  const value = request.headers.get("cookie");
  if (!value) return null;
  for (const item of value.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === "replay_session") return decodeURIComponent(parts.join("="));
  }
  return null;
};

// 요청 본문 해석
const body = async (request: Request): Promise<Record<string, unknown> | null> => {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

// 사실 입력 검증
const factInput = (value: Record<string, unknown>): Pick<FactInput, "expectedFactRevisionId" | "facts" | "idempotencyKey"> | null => {
  const key = value.idempotencyKey;
  if (typeof key !== "string" || typeof value.facts !== "object" || value.facts === null || Array.isArray(value.facts)) return null;
  if (value.expectedFactRevisionId !== undefined && value.expectedFactRevisionId !== null && typeof value.expectedFactRevisionId !== "string") return null;
  return {
    idempotencyKey: key,
    facts: value.facts,
    ...(value.expectedFactRevisionId === undefined ? {} : { expectedFactRevisionId: value.expectedFactRevisionId as string | null }),
  };
};

// 사실 응답 상태 계산
const factCode = (result: FactResult): number => {
  if (result.kind === "CREATED" || result.kind === "REPLAYED") return result.kind === "CREATED" ? 201 : 200;
  if (result.kind === "STALE_FACT_REVISION" || result.kind === "IDEMPOTENCY_KEY_REUSED") return 409;
  if (result.kind === "NOT_FOUND") return 404;
  return 400;
};

// 판정 응답 상태 계산
const decisionCode = (result: DecisionResult): number => {
  switch (result.kind) {
    case "CREATED": return 201;
    case "REPLAYED": return 200;
    case "NOT_FOUND":
    case "NO_FACTS": return 404;
    case "FACT_NOT_FOUND":
    case "STALE_FACT_REVISION":
    case "STALE_ANALYSIS":
    case "RULE_VERSION_UNAVAILABLE":
    case "RULE_VERSION_UNKNOWN": return 409;
    case "EVALUATION_FAILED": return 422;
    case "INVALID_INPUT": return 400;
  }
};

export const facts = async (
  request: Request,
  params: Readonly<{ analysisId: string; candidateId: string }>,
  dependencies: EvaluationApiDependencies,
): Promise<Response> => {
  const session = await dependencies.resolve(cookie(request) ?? "");
  if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
  const value = await body(request);
  const payload = value ? factInput(value) : null;
  if (!payload) return json({ kind: "INVALID_REQUEST" }, 400);
  const result = await dependencies.facts({
    ...payload,
    anonymousSessionId: session.sessionId,
    analysisId: params.analysisId,
    candidateId: params.candidateId,
  });
  return json(result, factCode(result));
};

export const decision = async (
  request: Request,
  params: Readonly<{ analysisId: string; candidateId: string }>,
  dependencies: EvaluationApiDependencies,
): Promise<Response> => {
  const session = await dependencies.resolve(cookie(request) ?? "");
  if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
  const result = await dependencies.decision({
    anonymousSessionId: session.sessionId,
    analysisId: params.analysisId,
    candidateId: params.candidateId,
  });
  return json(result, decisionCode(result));
};
