import { describe, expect, it, vi } from "vitest";
import { claim, evidence, progress, result, type JobApiDependencies } from "./job";

const routes = [
  ["claim", (request: Request, dependencies: JobApiDependencies) => claim(request, dependencies)],
  ["progress", (request: Request, dependencies: JobApiDependencies) => progress(request, { jobId: "job-1" }, dependencies)],
  ["result", (request: Request, dependencies: JobApiDependencies) => result(request, { jobId: "job-1" }, dependencies)],
  ["evidence", (request: Request, dependencies: JobApiDependencies) => evidence(request, { jobId: "job-1" }, dependencies)],
] as const;

const dependencies = () => ({
  key: "worker-secret",
  claim: vi.fn(async () => null),
  progress: vi.fn(async () => ({ kind: "NOT_FOUND" as const })),
  result: vi.fn(async () => ({ kind: "NOT_FOUND" as const })),
  evidence: vi.fn(async () => ({ kind: "NOT_FOUND" as const })),
});

it("does not let a valid legacy claim consume a queued job", async () => {
  const ports = dependencies();
  const response = await claim(new Request("http://web.test/internal/jobs/claim", {
    method: "POST",
    headers: { "content-type": "application/json", "x-worker-key": "worker-secret" },
    body: JSON.stringify({ workerId: "video-worker-1", jobType: "ANALYZE_VIDEO" }),
  }), ports);
  expect(response.status).toBe(409);
  expect(ports.claim).not.toHaveBeenCalled();
});

describe.each(routes)("worker protocol at %s", (_name, invoke) => {
  it.each([undefined, "", "video-baseline-v1", "video-observations-v99"])(
    "rejects an incompatible worker before parsing its body or touching a job: %s",
    async (protocol) => {
      const ports = dependencies();
      const headers: Record<string, string> = { "x-worker-key": "worker-secret" };
      if (protocol !== undefined) headers["x-worker-protocol"] = protocol;
      const response = await invoke(new Request("http://web.test/internal", {
        method: "POST", headers, body: "not-json",
      }), ports);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        kind: "UNSUPPORTED_WORKER_PROTOCOL", requiredProtocol: "video-observations-v2",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      for (const port of [ports.claim, ports.progress, ports.result, ports.evidence]) {
        expect(port).not.toHaveBeenCalled();
      }
    },
  );

  it("authenticates before disclosing protocol requirements", async () => {
    const ports = dependencies();
    const response = await invoke(new Request("http://web.test/internal", {
      method: "POST", headers: { "x-worker-key": "wrong" }, body: "not-json",
    }), ports);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ kind: "UNAUTHORIZED" });
    for (const port of [ports.claim, ports.progress, ports.result, ports.evidence]) {
      expect(port).not.toHaveBeenCalled();
    }
  });
});
