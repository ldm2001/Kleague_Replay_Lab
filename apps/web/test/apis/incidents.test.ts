import { describe, expect, it, vi } from "vitest";
import { incidents } from "../../src/apis/incidents";
import { WORKER_PROTOCOL } from "../../src/shared/worker-protocol";

const analysisId = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";

describe("internal incident query", () => {
    it("requires internal authentication and protocol before querying", async () => {
        const query = vi.fn();
        const response = await incidents(new Request(`http://local?owner=${owner}`), analysisId, { key: "secret", query });
        expect(response.status).toBe(401);
        expect(query).not.toHaveBeenCalled();
    });

    it("validates analysis ownership input and keeps responses private", async () => {
        const query = vi.fn(async () => null);
        const request = new Request(`http://local?owner=${owner}`, { headers: {
            "x-worker-key": "secret", "x-worker-protocol": WORKER_PROTOCOL
        } });
        const response = await incidents(request, analysisId, { key: "secret", query });
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(query).toHaveBeenCalledWith({ analysisId, anonymousSessionId: owner, after: null, limit: 100 });
    });
});
