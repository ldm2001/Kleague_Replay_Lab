import type { LatestInput, LatestResult, SessionRecord, StatusInput, StatusResult } from "@replay/application";

export type StatusApiDependencies = Readonly<{
  resolve: (token: string) => Promise<SessionRecord | null>;
  status: (input: StatusInput) => Promise<StatusResult>;
  latest: (input: LatestInput) => Promise<LatestResult>;
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

export const media = async (
  request: Request,
  params: Readonly<{ videoAssetId: string }>,
  dependencies: StatusApiDependencies,
): Promise<Response> => {
  // 세션 쿠키로 익명 세션 조회
  const record = await dependencies.resolve(token(request) ?? "");
  // 세션이 없으면 상태 조회 차단
  if (!record) return json({ kind: "UNAUTHORIZED" }, 401);
  // 영상 상태 조회 유스케이스 호출
  const result = await dependencies.status({
    anonymousSessionId: record.sessionId,
    videoAssetId: params.videoAssetId,
  });
  // 입력 오류 응답
  if (result && "kind" in result) return json(result, 400);
  // 대상 영상 없음 응답
  if (!result) return json({ kind: "NOT_FOUND" }, 404);
  // 영상 상태 응답
  return json(result, 200);
};

export const recent = async (
  request: Request,
  dependencies: StatusApiDependencies,
): Promise<Response> => {
  // 세션 쿠키로 익명 세션 조회
  const record = await dependencies.resolve(token(request) ?? "");
  // 세션이 없으면 최근 결과 조회 차단
  if (!record) return json({ kind: "UNAUTHORIZED" }, 401);
  // 최근 결과 조회 유스케이스 호출
  const result = await dependencies.latest({ anonymousSessionId: record.sessionId });
  // 입력 오류 응답
  if (result && "kind" in result) return json(result, 400);
  // 최근 결과 없음 응답
  if (!result) return json({ kind: "NOT_FOUND" }, 404);
  // 최근 결과 응답
  return json(result, 200);
};
