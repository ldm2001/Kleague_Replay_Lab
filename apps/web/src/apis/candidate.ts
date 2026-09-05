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
  // 요청 쿠키 헤더 조회
  const value = request.headers.get("cookie");
  // 쿠키가 없으면 빈 결과 반환
  if (!value) return null;
  // 세션 쿠키 항목 탐색
  for (const item of value.split(";")) {
    // 쿠키 이름과 값 분리
    const [name, ...parts] = item.trim().split("=");
    // 세션 쿠키 반환
    if (name === "replay_session") return decodeURIComponent(parts.join("="));
  }
  // 세션 쿠키 없음 반환
  return null;
};

// 요청 본문 해석
const body = async (request: Request): Promise<Record<string, unknown> | null> => {
  try {
    // 요청 JSON 본문 조회
    const value: unknown = await request.json();
    // 객체 본문만 반환
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    // JSON 해석 실패 반환
    return null;
  }
};

// 사실 입력 검증
const factInput = (value: Record<string, unknown>): Pick<FactInput, "expectedFactRevisionId" | "facts" | "idempotencyKey"> | null => {
  // 사실 입력 필드 추출
  const key = value.idempotencyKey;
  // 사실 입력 기본 형식 확인
  if (typeof key !== "string" || typeof value.facts !== "object" || value.facts === null || Array.isArray(value.facts)) return null;
  // 예상 이력 식별자 형식 확인
  if (value.expectedFactRevisionId !== undefined && value.expectedFactRevisionId !== null && typeof value.expectedFactRevisionId !== "string") return null;
  // 사실 입력 반환
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
  // 세션 쿠키로 익명 세션 조회
  const session = await dependencies.resolve(cookie(request) ?? "");
  // 세션이 없으면 사실 저장 차단
  if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
  // 사실 요청 본문 조회
  const value = await body(request);
  // 사실 요청 입력 변환
  const payload = value ? factInput(value) : null;
  // 입력 형식 확인
  if (!payload) return json({ kind: "INVALID_REQUEST" }, 400);
  // 사실 저장 유스케이스 호출
  const result = await dependencies.facts({
    ...payload,
    anonymousSessionId: session.sessionId,
    analysisId: params.analysisId,
    candidateId: params.candidateId,
  });
  // 사실 저장 결과 응답
  return json(result, factCode(result));
};

export const decision = async (
  request: Request,
  params: Readonly<{ analysisId: string; candidateId: string }>,
  dependencies: EvaluationApiDependencies,
): Promise<Response> => {
  // 세션 쿠키로 익명 세션 조회
  const session = await dependencies.resolve(cookie(request) ?? "");
  // 세션이 없으면 판정 저장 차단
  if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
  // 판정 계산 유스케이스 호출
  const result = await dependencies.decision({
    anonymousSessionId: session.sessionId,
    analysisId: params.analysisId,
    candidateId: params.candidateId,
  });
  // 판정 결과 응답
  return json(result, decisionCode(result));
};
