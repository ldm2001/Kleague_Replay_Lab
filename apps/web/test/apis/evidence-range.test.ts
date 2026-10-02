import { describe, expect, it, vi } from "vitest";
import { RangeNotSatisfiableError, type EvidenceBody } from "@replay/application";
import { evidence } from "../../src/apis/evidence";

const params = { analysisId: "11111111-1111-4111-8111-111111111111", evidenceId: "22222222-2222-4222-8222-222222222222" };

// 세션과 소유 증거 및 저장소 본문을 대역으로 구성
const fixture = (body: (objectKey: string, range?: string) => Promise<EvidenceBody>) => ({
    resolve: vi.fn(async () => ({ sessionId: "33333333-3333-4333-8333-333333333333" })),
    asset: vi.fn(async () => ({ objectKey: "evidence/clip.mp4", contentType: "video/mp4" as const })),
    body: vi.fn(body)
});

// 세션 쿠키와 추가 헤더를 담은 증거 요청 생성
const request = (headers: Record<string, string> = {}) =>
    new Request("http://local/evidence", { headers: { cookie: "replay_session=token", ...headers } });

// 한 조각 본문 생성
async function* chunk() {
    yield Uint8Array.from([1, 2, 3]);
}

describe("evidence media response", () => {
    it("advertises byte ranges and the stored length on a full response", async () => {
        const dependencies = fixture(async () => ({ body: chunk(), sizeBytes: 3 }));
        const response = await evidence(request(), params, dependencies);
        expect(response.status).toBe(200);
        expect(dependencies.body).toHaveBeenCalledWith("evidence/clip.mp4", undefined);
        expect(Object.fromEntries(response.headers)).toMatchObject({
            "accept-ranges": "bytes", "content-length": "3", "cache-control": "private, no-store"
        });
        expect(response.headers.has("content-range")).toBe(false);
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    });

    it("returns the storage-applied range as a partial response", async () => {
        const dependencies = fixture(async () => ({ body: chunk(), sizeBytes: 3, contentRange: "bytes 2-4/10" }));
        const response = await evidence(request({ range: "bytes=2-4" }), params, dependencies);
        expect(response.status).toBe(206);
        expect(dependencies.body).toHaveBeenCalledWith("evidence/clip.mp4", "bytes=2-4");
        expect(response.headers.get("content-range")).toBe("bytes 2-4/10");
        expect(response.headers.get("content-length")).toBe("3");
    });

    it.each([
        [{ range: "bytes=0-1,4-5" }],
        [{ range: "bytes=5-1" }],
        [{ range: "bytes=-0" }],
        [{ range: "items=0-1" }],
        [{ range: "bytes=0-1", "if-range": "\"unknown\"" }]
    ])("ignores unsupported or conditional range headers %o", async (headers) => {
        const dependencies = fixture(async () => ({ body: chunk(), sizeBytes: 3 }));
        const response = await evidence(request(headers), params, dependencies);
        expect(response.status).toBe(200);
        expect(dependencies.body).toHaveBeenCalledWith("evidence/clip.mp4", undefined);
    });

    it("answers an unsatisfiable range privately without leaking storage errors", async () => {
        const dependencies = fixture(async () => { throw new RangeNotSatisfiableError(); });
        const response = await evidence(request({ range: "bytes=99-" }), params, dependencies);
        expect(response.status).toBe(416);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(await response.json()).toEqual({ kind: "RANGE_NOT_SATISFIABLE" });
    });

    it("keeps other storage failures as server errors", async () => {
        const failure = new Error("storage unavailable");
        const dependencies = fixture(async () => { throw failure; });
        await expect(evidence(request({ range: "bytes=0-" }), params, dependencies)).rejects.toBe(failure);
    });
});
