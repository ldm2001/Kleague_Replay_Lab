import type { AssetInput, AssetResult, EvidenceBody, SessionRecord } from "@replay/application";

export type EvidenceApiDependencies = Readonly<{
  resolve: (token: string) => Promise<SessionRecord | null>;
  asset: (input: AssetInput) => Promise<AssetResult>;
  body: (objectKey: string) => Promise<EvidenceBody>;
}>;

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
  // 비동기 본문 반복자 생성
  const iterator = body[Symbol.asyncIterator]();
  // 스트림 변환 객체 반환
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // 다음 본문 청크 조회
      const next = await iterator.next();
      // 마지막 청크면 스트림 종료
      if (next.done) controller.close();
      // 본문 청크 전송
      else controller.enqueue(next.value);
    },
    async cancel() {
      // 요청 취소 시 반복자 종료
      await iterator.return?.();
    },
  });
};

export const evidence = async (
  request: Request,
  params: Readonly<{ analysisId: string; evidenceId: string }>,
  dependencies: EvidenceApiDependencies,
): Promise<Response> => {
  // 세션 쿠키로 익명 세션 조회
  const record = await dependencies.resolve(token(request) ?? "");
  // 세션이 없으면 증거 조회 차단
  if (!record) return error("UNAUTHORIZED", 401);
  // 증거 접근 권한 조회
  const asset = await dependencies.asset({
    anonymousSessionId: record.sessionId,
    analysisId: params.analysisId,
    evidenceId: params.evidenceId,
  });
  // 권한 오류 응답
  if (asset && "kind" in asset) return error(asset.kind, 400);
  // 증거 없음 응답
  if (!asset) return error("NOT_FOUND", 404);
  // 저장소 증거 본문 조회
  const object = await dependencies.body(asset.objectKey);
  // 증거 스트림 응답
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
