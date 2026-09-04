import { describe, expect, it } from "vitest";
import { asset, latest, status, type Clock, type EvidenceMedia, type EvidenceMediaCommand, type EvidenceMediaRepo, type LatestMediaCommand, type LatestMediaRepo, type MediaStatusCommand, type MediaStatusRepo, type MediaView } from "@replay/application";

const NOW = new Date("2026-08-30T00:00:00.000Z");
const view: MediaView = {
  videoAssetId: "11111111-1111-4111-8111-111111111111",
  videoStatus: "VALID",
  validationErrorCode: null,
  analysis: {
    analysisId: "22222222-2222-4222-8222-222222222222",
    mode: "VISUAL_CHANGE_BASELINE",
    judgmentStatus: "NOT_EVALUATED",
    status: "COMPLETED",
    stage: "SUCCEEDED",
    progressPercent: 100,
    failureCode: null,
    limitations: ["incident_category_classification_pending"],
    candidates: [{
      id: "44444444-4444-4444-8444-444444444444",
      index: 1,
      startMs: 500,
      endMs: 1500,
      anchorMs: 1000,
      signalScore: 0.42,
      cameraSufficiency: "MEDIUM",
      reasons: ["motion-spike"],
    }],
  },
};

class Repo implements MediaStatusRepo {
  commands: MediaStatusCommand[] = [];

  async status(command: MediaStatusCommand): Promise<MediaView | null> {
    this.commands.push(command);
    return view;
  }
}

describe("media status", () => {
  it("loads an owned video and analysis view", async () => {
    const repository = new Repo();
    const result = await status({ clock: { now: () => NOW } satisfies Clock, repository })({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111",
    });

    expect(result).toEqual(view);
    expect(repository.commands).toEqual([{
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      videoAssetId: "11111111-1111-4111-8111-111111111111",
      now: NOW.toISOString(),
    }]);
  });

  it("rejects malformed ownership identifiers", async () => {
    const repository = new Repo();
    await expect(status({ clock: { now: () => NOW }, repository })({
      anonymousSessionId: "bad",
      videoAssetId: "11111111-1111-4111-8111-111111111111",
    })).resolves.toEqual({ kind: "INVALID_INPUT" });
    expect(repository.commands).toHaveLength(0);
  });

  it("loads an owned evidence object reference", async () => {
    const commands: EvidenceMediaCommand[] = [];
    const repository: EvidenceMediaRepo = {
      media: async (command) => {
        commands.push(command);
        return {
          objectKey: "evidence/analysis/job/candidate-0001.jpg",
          contentType: "image/jpeg",
        } satisfies EvidenceMedia;
      },
    };
    const result = await asset({ clock: { now: () => NOW }, repository })({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
      analysisId: "22222222-2222-4222-8222-222222222222",
      evidenceId: "55555555-5555-4555-8555-555555555555",
    });

    expect(result).toEqual({
      objectKey: "evidence/analysis/job/candidate-0001.jpg",
      contentType: "image/jpeg",
    });
    expect(commands).toHaveLength(1);
  });

  it("loads the latest owned video identifier", async () => {
    const commands: LatestMediaCommand[] = [];
    const repository: LatestMediaRepo = {
      latest: async (command) => {
        commands.push(command);
        return "11111111-1111-4111-8111-111111111111";
      },
    };

    await expect(latest({ clock: { now: () => NOW }, repository })({
      anonymousSessionId: "33333333-3333-4333-8333-333333333333",
    })).resolves.toEqual({ videoAssetId: "11111111-1111-4111-8111-111111111111" });
    expect(commands).toHaveLength(1);
  });
});
