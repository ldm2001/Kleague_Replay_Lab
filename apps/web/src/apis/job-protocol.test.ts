import { describe, expect, it, vi } from "vitest";
import { claim, evidence, progress, result, type JobApiDependencies } from "./job";

// 시험자료 시험용 4개 항목 목록 준비
const routes = [
    ["claim", (request: Request, dependencies: JobApiDependencies) => claim(request, dependencies)],
    [
        "progress",
        (request: Request, dependencies: JobApiDependencies) =>
            progress(request, { jobId: "job-1" }, dependencies)
    ],
    [
        "result",
        (request: Request, dependencies: JobApiDependencies) =>
            result(request, { jobId: "job-1" }, dependencies)
    ],
    [
        "evidence",
        (request: Request, dependencies: JobApiDependencies) =>
            evidence(request, { jobId: "job-1" }, dependencies)
    ]
] as const;

// 검증용 의존성 구성
const dependencies = () => ({
    key: "worker-secret",
    claim: vi.fn(async () => null),
    progress: vi.fn(async () => ({ kind: "NOT_FOUND" as const })),
    result: vi.fn(async () => ({ kind: "NOT_FOUND" as const })),
    evidence: vi.fn(async () => ({ kind: "NOT_FOUND" as const })),
});

it("does not let a valid legacy claim consume a queued job", async () => {
    // 의존경계 시험용 의존성 결과 준비
    const ports = dependencies();
    // 작업선점 결과를 응답에 저장
    const response = await claim(new Request("http://web.test/internal/jobs/claim", {
        method: "POST",
        headers: { "content-type": "application/json", "x-worker-key": "worker-secret" },
        body: JSON.stringify({ workerId: "video-worker-1", jobType: "ANALYZE_VIDEO" }),
    }), ports);
    // 응답 상태의 기대값 409 일치 확인
    expect(response.status).toBe(409);
    // 의존경계 작업선점의 미호출 확인
    expect(ports.claim).not.toHaveBeenCalled();
});

describe.each(routes)("worker protocol at %s", (_name, invoke) => {
    it.each([
        undefined,
        "",
        "video-baseline-v1",
        "video-observations-v2",
        "video-observations-v3",
        "video-observations-v4",
        "video-observations-v99"
    ])(
        "rejects an incompatible worker before parsing its body or touching a job: %s",
        async (protocol) => {
            // 의존경계 시험용 의존성 결과 준비
            const ports = dependencies();
            // 응답헤더 시험 입력으로 작업자 키 작업자 자료 생성
            const headers: Record<string, string> = { "x-worker-key": "worker-secret" };
            // 시험자료 비교 조건에 따른 처리 경로 분기
            if (protocol !== undefined) headers["x-worker-protocol"] = protocol;
            // 시험자료 결과를 응답에 저장
            const response = await invoke(
                new Request("http://web.test/internal", {
                    method: "POST",
                    headers,
                    body: "not-json"
                }),
                ports
            );

            // 응답 상태의 기대값 409 일치 확인
            expect(response.status).toBe(409);
            // 지원하지 않는 작업자 통신 버전 내용을 포함한 기대 결과 일치 확인
            expect(await response.json()).toEqual({
                kind: "UNSUPPORTED_WORKER_PROTOCOL",
                requiredProtocol: "video-observations-v5"
            });
            // 응답 응답헤더 조회 결과의 기대값 저장소 일치 확인
            expect(response.headers.get("cache-control")).toBe("no-store");
            // 4개 항목 목록의 각 사례 순회
            for (const port of [ports.claim, ports.progress, ports.result, ports.evidence]) {
                // 경계의 미호출 확인
                expect(port).not.toHaveBeenCalled();
            }
        }
    );

    it("authenticates before disclosing protocol requirements", async () => {
        // 의존경계 시험용 의존성 결과 준비
        const ports = dependencies();
        // 시험자료 결과를 응답에 저장
        const response = await invoke(
            new Request("http://web.test/internal", {
                method: "POST",
                headers: { "x-worker-key": "wrong" },
                body: "not-json"
            }),
            ports
        );
        // 응답 상태의 기대값 401 일치 확인
        expect(response.status).toBe(401);
        // 응답 응답본문 결과의 종류 인증실패 자료 기준 구조 일치 확인
        expect(await response.json()).toEqual({ kind: "UNAUTHORIZED" });
        // 4개 항목 목록의 각 사례 순회
        for (const port of [ports.claim, ports.progress, ports.result, ports.evidence]) {
            // 경계의 미호출 확인
            expect(port).not.toHaveBeenCalled();
        }
    });
});
