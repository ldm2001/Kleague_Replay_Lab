import type { ReportInput, ReportResult, SessionRecord } from "@replay/application";

export type ResultApiDependencies = Readonly<{
  resolve: (token: string) => Promise<SessionRecord | null>;
  report: (input: ReportInput) => Promise<ReportResult>;
}>;

// JSON 응답 생성
const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });

// 세션 쿠키 추출
const token = (request: Request): string | null => {
  const value = request.headers.get("cookie");
  if (!value) return null;
  for (const item of value.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === "replay_session") return decodeURIComponent(parts.join("="));
  }
  return null;
};

export const analysis = async (
  request: Request,
  params: Readonly<{ analysisId: string }>,
  dependencies: ResultApiDependencies,
): Promise<Response> => {
  const session = await dependencies.resolve(token(request) ?? "");
  if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
  const result = await dependencies.report({
    anonymousSessionId: session.sessionId,
    analysisId: params.analysisId,
  });
  if (result && "kind" in result) return json(result, 400);
  if (!result) return json({ kind: "NOT_FOUND" }, 404);
  return json(result, 200);
};
