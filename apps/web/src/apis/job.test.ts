import { describe, expect, it } from "vitest";
import {
    claim,
    evidence as jobEvidence,
    progress,
    result as jobResult,
    type JobApiDependencies
} from "./job.js";
import type { EvidenceResult, JobClaim, JobProgress, JobResult } from "@replay/application";
import { WORKER_PROTOCOL } from "@replay/shared-types";

// 작업 선점 응답 모형
const result: JobClaim = {
    jobId: "11111111-1111-4111-8111-111111111111",
    jobType: "ANALYZE_VIDEO" as const,
    payloadVersion: 1,
    jobRevision: 1,
    attempt: 1,
    stage: "SEGMENTING",
    progressPercent: 0,
    leaseToken: "lease-token",
    leaseUntil: "2026-08-29T00:00:30.000Z",
    analysisId: "22222222-2222-4222-8222-222222222222",
    videoAssetId: "33333333-3333-4333-8333-333333333333",
    objectKey: "uploads/video.mp4",
};

// 작업 요청 경로 의존성 모형
const dependencies = (value: JobClaim | null = result): JobApiDependencies => ({
    key: "worker-secret",
    claim: async () => value,
    progress: async () => progressResult,
    result: async () => completionResult,
    evidence: async () => evidenceResult,
});

// 진행률 결과 시험 입력으로 종류 지정 문자열 및 단계 지정 문자열 및 진행률 백분율 40 및 시점 2026 08 00 00 자료 생성
const progressResult: JobProgress = {
    kind: "UPDATED",
    stage: "DETECTING",
    progressPercent: 40,
    heartbeatAt: "2026-08-29T00:00:00.000Z",
    leaseUntil: "2026-08-29T00:00:30.000Z",
};

// 완료처리 결과 시험 입력으로 종류 접수완료 자료 생성
const completionResult: JobResult = { kind: "ACCEPTED" };
// 근거 결과 시험 입력으로 종류 지정 문자열 및 항목목록 자료 생성
const evidenceResult: EvidenceResult = {
    kind: "GRANTED",
    items: [{
        name: "candidate-0001.jpg",
        objectKey: "evidence/analysis/job/candidate-0001.jpg",
        uploadUrl: "http://storage.test/candidate-0001.jpg",
    }],
};

describe("job claim API", () => {
    it("returns a claimed job for an authorized worker", async () => {
        // 인증된 작업자 요청 구성
        const response = await claim(
            new Request("http://localhost/internal/jobs/claim", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({ workerId: "video-worker-1", jobType: "ANALYZE_VIDEO" })
            }),
            dependencies()
        );

        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 응답 응답본문 결과의 결과 기준 구조 일치 확인
        expect(await response.json()).toEqual(result);
    });

    it("rejects an unauthorized worker before reading the job body", async () => {
        // 잘못된 인증 요청 구성
        const response = await claim(
            new Request("http://localhost/internal/jobs/claim", {
                method: "POST",
                headers: { "x-worker-key": "wrong" },
                body: "not-json"
            }),
            dependencies()
        );

        // 응답 상태의 기대값 401 일치 확인
        expect(response.status).toBe(401);
        // 응답 응답본문 결과의 종류 인증실패 자료 기준 구조 일치 확인
        expect(await response.json()).toEqual({ kind: "UNAUTHORIZED" });
    });

    it("returns no-content when the queue has no eligible job", async () => {
        // 대기 작업 없음 요청 구성
        const response = await claim(
            new Request("http://localhost/internal/jobs/claim", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({ workerId: "video-worker-1", jobType: "ANALYZE_VIDEO" })
            }),
            dependencies(null)
        );

        // 응답 상태의 기대값 204 일치 확인
        expect(response.status).toBe(204);
        // 응답 문구 결과의 기대값 지정 문자열 일치 확인
        expect(await response.text()).toBe("");
    });

    it("returns the updated progress for the claimed lease", async () => {
        // 진행 상태 요청 구성
        const response = await progress(
            new Request("http://localhost/internal/jobs/job-1/progress", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({
                    workerId: "video-worker-1",
                    jobRevision: 1,
                    leaseToken: "lease-token",
                    stage: "DETECTING",
                    progressPercent: 40,
                    message: "candidate scan"
                })
            }),
            { jobId: "job-1" },
            dependencies()
        );

        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 응답 응답본문 결과의 진행률 결과 기준 구조 일치 확인
        expect(await response.json()).toEqual(progressResult);
    });

    it("accepts a validation result for the claimed lease", async () => {
        // 검증 결과 요청 구성
        const response = await jobResult(
            new Request("http://localhost/internal/jobs/job-1/result", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({
                    workerId: "video-worker-1",
                    jobRevision: 1,
                    leaseToken: "lease-token",
                    payload: {
                        kind: "VALIDATED",
                        durationMs: 90_000,
                        width: 1920,
                        height: 1080
                    }
                })
            }),
            { jobId: "11111111-1111-4111-8111-111111111111" },
            dependencies()
        );

        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 응답 응답본문 결과의 완료처리 결과 기준 구조 일치 확인
        expect(await response.json()).toEqual(completionResult);
    });

    it("maps a structurally valid but unverifiable result to bad request", async () => {
        // 의존성 시험 입력으로 기존 항목 및 결과 자료 생성
        const deps = {
            ...dependencies(),
            result: async () => ({ kind: "INVALID_RESULT", reason: "SOURCE" }) as const
        };
        // 작업 결과를 응답에 저장
        const response = await jobResult(
            new Request("http://localhost/internal/jobs/job-1/result", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({
                    workerId: "video-worker-1",
                    jobRevision: 2,
                    leaseToken: "lease-token",
                    payload: { kind: "VALIDATED", durationMs: 90_000, width: 1_920, height: 1_080 }
                })
            }),
            { jobId: "11111111-1111-4111-8111-111111111111" },
            deps
        );

        // 응답 상태의 기대값 400 일치 확인
        expect(response.status).toBe(400);
        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        expect(await response.json()).toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
    });

    it("returns scoped evidence upload grants", async () => {
        // 증거 권한 요청 구성
        const response = await jobEvidence(
            new Request("http://localhost/internal/jobs/job-1/evidence", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({
                    workerId: "video-worker-1",
                    jobRevision: 1,
                    leaseToken: "lease-token",
                    items: [
                        { name: "candidate-0001.jpg", contentType: "image/jpeg", sizeBytes: 128 }
                    ]
                })
            }),
            { jobId: "11111111-1111-4111-8111-111111111111" },
            dependencies()
        );

        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 응답 응답본문 결과의 근거 결과 기준 구조 일치 확인
        expect(await response.json()).toEqual(evidenceResult);
    });

    it("preserves the gzip checksum field for the evidence use case", async () => {
        // 시험자료 보관 변수 생성
        let received: unknown;
        // 의존성 시험용 기존 항목 및 근거 자료 준비
        const deps = {
            ...dependencies(),
            evidence: async (input: unknown) => {
                // 시험자료를 입력 값으로 설정
                received = input;
                // 종류 지정 문자열 및 항목목록 자료 반환
                return { kind: "GRANTED", items: [] } as const;
            }
        } as JobApiDependencies;
        // 작업 근거 결과를 응답에 저장
        const response = await jobEvidence(
            new Request("http://localhost/internal/jobs/job-1/evidence", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({
                    workerId: "video-worker-1",
                    jobRevision: 2,
                    leaseToken: "lease-token",
                    items: [
                        {
                            name: "observations.jsonl.gz",
                            contentType: "application/gzip",
                            sizeBytes: 1024,
                            contentSha256: "a".repeat(64)
                        }
                    ]
                })
            }),
            { jobId: "11111111-1111-4111-8111-111111111111" },
            deps
        );

        // 응답 상태의 기대값 200 일치 확인
        expect(response.status).toBe(200);
        // 시험자료의 항목목록 자료의 필드 일치 확인
        expect(received).toMatchObject({ items: [{ contentSha256: "a".repeat(64) }] });
    });

    it("returns service unavailable when immutable gzip storage is not configured", async () => {
        // 의존성 시험 입력으로 기존 항목 및 근거 자료 생성
        const deps = {
            ...dependencies(),
            evidence: async () => ({ kind: "UNAVAILABLE" }) as const
        };
        // 작업 근거 결과를 응답에 저장
        const response = await jobEvidence(
            new Request("http://localhost/internal/jobs/job-1/evidence", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-worker-key": "worker-secret",
                    "x-worker-protocol": WORKER_PROTOCOL
                },
                body: JSON.stringify({
                    workerId: "video-worker-1",
                    jobRevision: 2,
                    leaseToken: "lease-token",
                    items: [
                        {
                            name: "observations.jsonl.gz",
                            contentType: "application/gzip",
                            sizeBytes: 1024,
                            contentSha256: "a".repeat(64)
                        }
                    ]
                })
            }),
            { jobId: "11111111-1111-4111-8111-111111111111" },
            deps
        );

        // 응답 상태의 기대값 503 일치 확인
        expect(response.status).toBe(503);
        // 사용 불가 내용을 포함한 기대 결과 일치 확인
        expect(await response.json()).toEqual({ kind: "UNAVAILABLE" });
    });
});
