import type { LatestInput, LatestResult, SessionRecord, StatusInput, StatusResult } from "@replay/application";

export type StatusApiDependencies = Readonly<{
  resolve: (token: string) => Promise<SessionRecord | null>;
  status: (input: StatusInput) => Promise<StatusResult>;
  latest: (input: LatestInput) => Promise<LatestResult>;
}>;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });

const token = (request: Request): string | null => {
  const value = request.headers.get("cookie");
  if (!value) return null;
  for (const item of value.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === "replay_session") return decodeURIComponent(parts.join("="));
  }
  return null;
};

export const media = async (
  request: Request,
  params: Readonly<{ videoAssetId: string }>,
  dependencies: StatusApiDependencies,
): Promise<Response> => {
  const record = await dependencies.resolve(token(request) ?? "");
  if (!record) return json({ kind: "UNAUTHORIZED" }, 401);
  const result = await dependencies.status({
    anonymousSessionId: record.sessionId,
    videoAssetId: params.videoAssetId,
  });
  if (result && "kind" in result) return json(result, 400);
  if (!result) return json({ kind: "NOT_FOUND" }, 404);
  return json(result, 200);
};

export const recent = async (
  request: Request,
  dependencies: StatusApiDependencies,
): Promise<Response> => {
  const record = await dependencies.resolve(token(request) ?? "");
  if (!record) return json({ kind: "UNAUTHORIZED" }, 401);
  const result = await dependencies.latest({ anonymousSessionId: record.sessionId });
  if (result && "kind" in result) return json(result, 400);
  if (!result) return json({ kind: "NOT_FOUND" }, 404);
  return json(result, 200);
};
