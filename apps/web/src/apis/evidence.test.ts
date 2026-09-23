import { describe, expect, it } from "vitest";
import { evidence, type EvidenceApiDependencies } from "./evidence.js";

// 의존성 시험 입력으로 경로해결 및 자산 및 본문 자료 생성
const dependencies: EvidenceApiDependencies = {
    resolve: async (token) =>
        token === "session-token" ? { sessionId: "33333333-3333-4333-8333-333333333333" } : null,
    asset: async () => ({
        objectKey: "evidence/analysis/job/candidate.jpg",
        contentType: "image/jpeg"
    }),
    body: async () => ({
        body: {
            // 검증용 [비동기 반복자] 구성
            async *[Symbol.asyncIterator]() {
                // 입력 조건 처리 수행
                yield Uint8Array.from([1, 2, 3]);
            }
        }
    })
};

// 증거 스트림 요청 경로 테스트
describe("evidence API", () => {
    it("streams owned private evidence", async () => {
        // 세션 있는 증거 스트림 요청 구성
        const response = await evidence(
            new Request("http://localhost/api/analyses/analysis/evidence/evidence", {
                headers: { cookie: "replay_session=session-token" },
            }),
            {
                analysisId: "22222222-2222-4222-8222-222222222222",
                evidenceId: "55555555-5555-4555-8555-555555555555",
            },
            dependencies,
        );

        // 증거 응답 상태와 본문 확인
        expect(response.status).toBe(200);
        // 응답 응답헤더 조회 결과의 기대값 지정 문자열 일치 확인
        expect(response.headers.get("content-type")).toBe("image/jpeg");
        // 배열 변환 결과의 3개 항목 목록 기준 구조 일치 확인
        expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
    });

    it("rejects a missing session", async () => {
        // 세션 없는 증거 요청 구성
        const response = await evidence(
            new Request("http://localhost/api/analyses/analysis/evidence/evidence"),
            {
                analysisId: "22222222-2222-4222-8222-222222222222",
                evidenceId: "55555555-5555-4555-8555-555555555555",
            },
            dependencies,
        );

        // 응답 상태의 기대값 401 일치 확인
        expect(response.status).toBe(401);
    });
});
