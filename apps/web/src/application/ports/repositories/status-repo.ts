export type EvidenceView = Readonly<{
  evidenceId: string;
  kind: "FRAME" | "CLIP";
}>;

export type CandidateView = Readonly<{
  index: number;
  startMs: number;
  endMs: number;
  anchorMs: number | null;
  signalScore: number | null;
  cameraSufficiency: "LOW" | "MEDIUM" | "HIGH";
  reasons: readonly string[];
  evidence?: readonly EvidenceView[];
}>;

export type AnalysisView = Readonly<{
  analysisId: string;
  mode: "VISUAL_CHANGE_BASELINE" | "ADJUDICATED";
  judgmentStatus: "NOT_EVALUATED" | "EVALUATED";
  status: string;
  stage: string;
  progressPercent: number;
  failureCode: string | null;
  limitations: readonly string[];
  candidates: readonly CandidateView[];
}>;

export type MediaView = Readonly<{
  videoAssetId: string;
  videoStatus: string;
  validationErrorCode: string | null;
  analysis: AnalysisView | null;
}>;

export type MediaStatusCommand = Readonly<{
  anonymousSessionId: string;
  videoAssetId: string;
  now: string;
}>;

export type MediaStatusRepo = Readonly<{
  status: (command: MediaStatusCommand) => Promise<MediaView | null>;
}>;

export type EvidenceMedia = Readonly<{
  objectKey: string;
  contentType: "image/jpeg" | "video/mp4";
}>;

export type EvidenceMediaCommand = Readonly<{
  anonymousSessionId: string;
  analysisId: string;
  evidenceId: string;
  now: string;
}>;

export type EvidenceMediaRepo = Readonly<{
  media: (command: EvidenceMediaCommand) => Promise<EvidenceMedia | null>;
}>;

export type LatestMediaCommand = Readonly<{
  anonymousSessionId: string;
  now: string;
}>;

export type LatestMediaRepo = Readonly<{
  latest: (command: LatestMediaCommand) => Promise<string | null>;
}>;
