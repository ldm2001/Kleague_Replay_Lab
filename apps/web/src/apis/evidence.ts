import type { AssetInput, AssetResult, EvidenceBody, SessionRecord } from "@replay/application";

export type EvidenceApiDependencies = Readonly<{
  resolve: (token: string) => Promise<SessionRecord | null>;
  asset: (input: AssetInput) => Promise<AssetResult>;
  body: (objectKey: string) => Promise<EvidenceBody>;
}>;

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

// 오류 응답 생성
const error = (kind: string, status: number): Response =>
  new Response(JSON.stringify({ kind }), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });

// 증거 스트림 생성
const stream = (body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> => {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
};

export const evidence = async (
  request: Request,
  params: Readonly<{ analysisId: string; evidenceId: string }>,
  dependencies: EvidenceApiDependencies,
): Promise<Response> => {
  const record = await dependencies.resolve(token(request) ?? "");
  if (!record) return error("UNAUTHORIZED", 401);
  const asset = await dependencies.asset({
    anonymousSessionId: record.sessionId,
    analysisId: params.analysisId,
    evidenceId: params.evidenceId,
  });
  if (asset && "kind" in asset) return error(asset.kind, 400);
  if (!asset) return error("NOT_FOUND", 404);
  const object = await dependencies.body(asset.objectKey);
  return new Response(stream(object.body), {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": "inline",
      "content-type": asset.contentType,
      "x-content-type-options": "nosniff",
    },
  });
};
