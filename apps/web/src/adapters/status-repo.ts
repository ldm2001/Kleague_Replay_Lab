import { sql } from "drizzle-orm";
import type { CandidateView, EvidenceMedia, EvidenceMediaCommand, EvidenceMediaRepo, LatestMediaCommand, LatestMediaRepo, MediaStatusCommand, MediaStatusRepo, MediaView } from "@replay/application";
import type { DatabaseClient } from "@replay/database";

type DatabaseHandle = Pick<DatabaseClient, "db">;

type MediaRow = Readonly<{
  video_asset_id: string;
  video_status: string;
  validation_error_code: string | null;
  analysis_id: string | null;
  analysis_status: string | null;
  stage: string;
  progress_percent: number;
  failure_code: string | null;
  limitations: string[] | null;
  has_decisions: boolean;
}>;

type CandidateRow = Readonly<{
  candidate_index: number;
  start_ms: number;
  end_ms: number;
  anchor_ms: number | null;
  signal_score: number | null;
  camera_sufficiency: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
}>;

type EvidenceRow = Readonly<{
  id: string;
  candidate_index: number;
  kind: "FRAME" | "CLIP";
}>;

export class StatusRepo implements MediaStatusRepo, EvidenceMediaRepo, LatestMediaRepo {
  public constructor(private readonly client: DatabaseHandle) {}

  public async status(command: MediaStatusCommand): Promise<MediaView | null> {
    const rows = await this.client.db.execute(sql`
      select video.id as video_asset_id,
             video.status::text as video_status,
             video.validation_error_code,
             analysis.id as analysis_id,
             analysis.status as analysis_status,
             coalesce(job.stage::text, 'QUEUED') as stage,
             coalesce(job.progress_percent, 0) as progress_percent,
             analysis.failure_code,
             analysis.limitations,
             exists (
               select 1
               from decision_results as decision
               where decision.analysis_id = analysis.id
             ) as has_decisions
      from video_assets as video
      join anonymous_sessions as session on session.id = video.anonymous_session_id
      left join analyses as analysis on analysis.video_asset_id = video.id
      left join lateral (
        select stage, progress_percent
        from processing_jobs
        where analysis_id = analysis.id
        order by created_at desc, id desc
        limit 1
      ) as job on true
      where video.id = ${command.videoAssetId}
        and video.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and (video.expires_at is null or video.expires_at > ${command.now})
        and video.object_deleted_at is null
      limit 1
    `);
    const [row] = rows as unknown as MediaRow[];
    if (!row) return null;
    if (!row.analysis_id || !row.analysis_status) {
      return {
        videoAssetId: row.video_asset_id,
        videoStatus: row.video_status,
        validationErrorCode: row.validation_error_code,
        analysis: null,
      };
    }

    const candidates = await this.client.db.execute(sql`
      select candidate_index, start_ms, end_ms, anchor_ms, detection_confidence as signal_score,
             camera_sufficiency::text as camera_sufficiency, reasons
      from incident_candidates
      where analysis_id = ${row.analysis_id}
      order by detection_confidence desc nulls last, candidate_index
    `);
    const evidence = await this.client.db.execute(sql`
      select asset.id, candidate.candidate_index, asset.kind::text as kind
      from evidence_assets as asset
      join incident_candidates as candidate on candidate.id = asset.incident_candidate_id
      where asset.analysis_id = ${row.analysis_id}
        and asset.object_deleted_at is null
        and (asset.expires_at is null or asset.expires_at > ${command.now})
      order by candidate.candidate_index, asset.kind, asset.id
    `);
    const grouped = new Map<number, Array<{ evidenceId: string; kind: "FRAME" | "CLIP" }>>();
    for (const item of evidence as unknown as EvidenceRow[]) {
      const entries = grouped.get(item.candidate_index) ?? [];
      entries.push({ evidenceId: item.id, kind: item.kind });
      grouped.set(item.candidate_index, entries);
    }
    const views: CandidateView[] = (candidates as unknown as CandidateRow[]).map((item) => ({
      index: item.candidate_index,
      startMs: item.start_ms,
      endMs: item.end_ms,
      anchorMs: item.anchor_ms,
      signalScore: item.signal_score,
      cameraSufficiency: item.camera_sufficiency,
      reasons: item.reasons,
      evidence: grouped.get(item.candidate_index) ?? [],
    }));
    return {
      videoAssetId: row.video_asset_id,
      videoStatus: row.video_status,
      validationErrorCode: row.validation_error_code,
      analysis: {
        analysisId: row.analysis_id,
        mode: row.has_decisions ? "ADJUDICATED" : "VISUAL_CHANGE_BASELINE",
        judgmentStatus: row.has_decisions ? "EVALUATED" : "NOT_EVALUATED",
        status: row.analysis_status,
        stage: row.stage,
        progressPercent: row.progress_percent,
        failureCode: row.failure_code,
        limitations: row.limitations ?? [],
        candidates: views,
      },
    };
  }

  public async media(command: EvidenceMediaCommand): Promise<EvidenceMedia | null> {
    const rows = await this.client.db.execute(sql`
      select asset.object_key, asset.kind::text as kind
      from evidence_assets as asset
      join analyses as analysis on analysis.id = asset.analysis_id
      join anonymous_sessions as session on session.id = analysis.anonymous_session_id
      where asset.id = ${command.evidenceId}
        and asset.analysis_id = ${command.analysisId}
        and analysis.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and analysis.expires_at > ${command.now}
        and asset.object_deleted_at is null
        and (asset.expires_at is null or asset.expires_at > ${command.now})
      limit 1
    `);
    const [row] = rows as unknown as Array<{ object_key: string; kind: "FRAME" | "CLIP" }>;
    if (!row) return null;
    return {
      objectKey: row.object_key,
      contentType: row.kind === "FRAME" ? "image/jpeg" : "video/mp4",
    };
  }

  public async latest(command: LatestMediaCommand): Promise<string | null> {
    const rows = await this.client.db.execute(sql`
      select video.id
      from video_assets as video
      join anonymous_sessions as session on session.id = video.anonymous_session_id
      where video.anonymous_session_id = ${command.anonymousSessionId}
        and session.revoked_at is null
        and session.expires_at > ${command.now}
        and (video.expires_at is null or video.expires_at > ${command.now})
        and video.object_deleted_at is null
      order by video.created_at desc, video.id desc
      limit 1
    `);
    const [row] = rows as unknown as Array<{ id: string }>;
    return row?.id ?? null;
  }
}

export const statusRepo = (client: DatabaseHandle): StatusRepo => new StatusRepo(client);
