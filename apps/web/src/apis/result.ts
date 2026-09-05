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
  // 요청 쿠키 헤더 조회
  const value = request.headers.get("cookie");
  // 쿠키가 없으면 빈 결과 반환
  if (!value) return null;
  // 세션 쿠키 항목 탐색
  for (const item of value.split(";")) {
    // 쿠키 이름과 값 분리
    const [name, ...parts] = item.trim().split("=");
    // 세션 토큰 반환
    if (name === "replay_session") return decodeURIComponent(parts.join("="));
  }
  // 세션 토큰 없음 반환
  return null;
};

export const analysis = async (
  request: Request,
  params: Readonly<{ analysisId: string }>,
  dependencies: ResultApiDependencies,
): Promise<Response> => {
  // 세션 쿠키로 익명 세션 조회
  const session = await dependencies.resolve(token(request) ?? "");
  // 세션이 없으면 결과 조회 차단
  if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
  // 분석 결과 조회 유스케이스 호출
  const result = await dependencies.report({
    anonymousSessionId: session.sessionId,
    analysisId: params.analysisId,
  });
  // 입력 오류 응답
  if (result && "kind" in result) return json(result, 400);
  // 분석 결과 없음 응답
  if (!result) return json({ kind: "NOT_FOUND" }, 404);
  // 분석 결과 응답
  return json(result, 200);
};
