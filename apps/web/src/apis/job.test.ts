import { describe, expect, it } from "vitest";
import { claim, evidence as jobEvidence, progress, result as jobResult, type JobApiDependencies } from "./job.js";
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

// 작업 API 의존성 모형
const dependencies = (value: JobClaim | null = result): JobApiDependencies => ({
  key: "worker-secret",
  claim: async () => value,
  progress: async () => progressResult,
  result: async () => completionResult,
  evidence: async () => evidenceResult,
});

const progressResult: JobProgress = {
  kind: "UPDATED",
  stage: "DETECTING",
  progressPercent: 40,
  heartbeatAt: "2026-08-29T00:00:00.000Z",
  leaseUntil: "2026-08-29T00:00:30.000Z",
};

const completionResult: JobResult = { kind: "ACCEPTED" };
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
    // 인증된 Worker 요청 구성
    const response = await claim(
      new Request("http://localhost/internal/jobs/claim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-key": "worker-secret",
          "x-worker-protocol": WORKER_PROTOCOL,
        },
        body: JSON.stringify({ workerId: "video-worker-1", jobType: "ANALYZE_VIDEO" }),
      }),
      dependencies(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });

  it("rejects an unauthorized worker before reading the job body", async () => {
    // 잘못된 인증 요청 구성
    const response = await claim(
      new Request("http://localhost/internal/jobs/claim", {
        method: "POST",
        headers: { "x-worker-key": "wrong" },
        body: "not-json",
      }),
      dependencies(),
    );

    expect(response.status).toBe(401);
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
          "x-worker-protocol": WORKER_PROTOCOL,
        },
        body: JSON.stringify({ workerId: "video-worker-1", jobType: "ANALYZE_VIDEO" }),
      }),
      dependencies(null),
    );

    expect(response.status).toBe(204);
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
          "x-worker-protocol": WORKER_PROTOCOL,
        },
        body: JSON.stringify({
          workerId: "video-worker-1",
          jobRevision: 1,
          leaseToken: "lease-token",
          stage: "DETECTING",
          progressPercent: 40,
          message: "candidate scan",
        }),
      }),
      { jobId: "job-1" },
      dependencies(),
    );

    expect(response.status).toBe(200);
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
          "x-worker-protocol": WORKER_PROTOCOL,
        },
        body: JSON.stringify({
          workerId: "video-worker-1",
          jobRevision: 1,
          leaseToken: "lease-token",
          payload: {
            kind: "VALIDATED",
            durationMs: 90_000,
            width: 1920,
            height: 1080,
          },
        }),
      }),
      { jobId: "11111111-1111-4111-8111-111111111111" },
      dependencies(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(completionResult);
  });

  it("maps a structurally valid but unverifiable result to bad request", async () => {
    const deps = { ...dependencies(), result: async () => ({ kind: "INVALID_RESULT", reason: "SOURCE" } as const) };
    const response = await jobResult(new Request("http://localhost/internal/jobs/job-1/result", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-key": "worker-secret", "x-worker-protocol": WORKER_PROTOCOL },
      body: JSON.stringify({ workerId: "video-worker-1", jobRevision: 2, leaseToken: "lease-token",
        payload: { kind: "VALIDATED", durationMs: 90_000, width: 1_920, height: 1_080 } }),
    }), { jobId: "11111111-1111-4111-8111-111111111111" }, deps);

    expect(response.status).toBe(400);
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
          "x-worker-protocol": WORKER_PROTOCOL,
        },
        body: JSON.stringify({
          workerId: "video-worker-1",
          jobRevision: 1,
          leaseToken: "lease-token",
          items: [{ name: "candidate-0001.jpg", contentType: "image/jpeg", sizeBytes: 128 }],
        }),
      }),
      { jobId: "11111111-1111-4111-8111-111111111111" },
      dependencies(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(evidenceResult);
  });

  it("preserves the gzip checksum field for the evidence use case", async () => {
    let received: unknown;
    const deps = { ...dependencies(), evidence: async (input: unknown) => {
      received = input;
      return { kind: "GRANTED", items: [] } as const;
    } } as JobApiDependencies;
    const response = await jobEvidence(new Request("http://localhost/internal/jobs/job-1/evidence", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-key": "worker-secret", "x-worker-protocol": WORKER_PROTOCOL },
      body: JSON.stringify({
        workerId: "video-worker-1", jobRevision: 2, leaseToken: "lease-token",
        items: [{ name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 1024, contentSha256: "a".repeat(64) }],
      }),
    }), { jobId: "11111111-1111-4111-8111-111111111111" }, deps);

    expect(response.status).toBe(200);
    expect(received).toMatchObject({ items: [{ contentSha256: "a".repeat(64) }] });
  });

  it("returns service unavailable when immutable gzip storage is not configured", async () => {
    const deps = { ...dependencies(), evidence: async () => ({ kind: "UNAVAILABLE" } as const) };
    const response = await jobEvidence(new Request("http://localhost/internal/jobs/job-1/evidence", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-key": "worker-secret", "x-worker-protocol": WORKER_PROTOCOL },
      body: JSON.stringify({
        workerId: "video-worker-1", jobRevision: 2, leaseToken: "lease-token",
        items: [{ name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 1024, contentSha256: "a".repeat(64) }],
      }),
    }), { jobId: "11111111-1111-4111-8111-111111111111" }, deps);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: "UNAVAILABLE" });
  });
});
