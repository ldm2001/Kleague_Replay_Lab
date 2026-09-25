import { timingSafeEqual } from "node:crypto";
import { WORKER_PROTOCOL } from "../shared/worker-protocol";

// 내부 조회에 허용하는 식별자와 제한된 페이지 계약
export interface IncidentQueryInput {
    analysisId: string;
    anonymousSessionId: string;
    after: string | null;
    limit: number;
}

// 내부 인증과 소유 범위를 확인한 비공개 사건 조회
export async function incidents(request: Request, analysisId: string, dependencies: {
    key: string;
    query: (input: IncidentQueryInput) => Promise<unknown | null>;
}): Promise<Response> {
    // 모든 성공과 오류 응답의 공유 캐시 차단
    const response = (body: unknown, status: number) => Response.json(body, {
        status, headers: { "cache-control": "no-store" }
    });
    const supplied = Buffer.from(request.headers.get("x-worker-key") ?? "");
    const expected = Buffer.from(dependencies.key);
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return response({ kind: "UNAUTHORIZED" }, 401);
    }
    if (request.headers.get("x-worker-protocol") !== WORKER_PROTOCOL) {
        return response({ kind: "UNSUPPORTED_WORKER_PROTOCOL" }, 409);
    }
    const parameters = new URL(request.url).searchParams;
    const anonymousSessionId = parameters.get("owner");
    const after = parameters.get("after");
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    if (!uuid.test(analysisId) || !anonymousSessionId || !uuid.test(anonymousSessionId) || (after !== null && !uuid.test(after))) {
        return response({ kind: "INVALID_INPUT" }, 400);
    }
    const result = await dependencies.query({ analysisId, anonymousSessionId, after, limit: 100 });
    return result === null ? response({ kind: "NOT_FOUND" }, 404) : response(result, 200);
}
