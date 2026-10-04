// 저장소 질의 생성 기능 가져옴
import { sql } from "drizzle-orm";
// 분석 결과 자료와 결과 제출 계약 및 자동 평가 묶음의 원본 작업 후보 근거 결합 검사 가져옴
import {
    validAutomaticBatch,
    type AnalysisPayload,
    type JobResult,
    type JobResultCommand
} from "@replay/application";
// 자동 평가 묶음과 규정 문맥 및 관측 실행과 비공개 색인 자료 계약 가져옴
import type {
    AutomaticReviewBatch,
    AutomaticRuleContext,
    PerceptionRun,
    PrivateIndex
} from "@replay/shared-types";
// 승인된 고정 모델 출처 충족 검사 가져옴
import { pinnedModels } from "@replay/rule-engine";
// 조회 시점과 보존 규칙이 정한 행 가시성 조건 가져옴
import { liveJob } from "../visibility";
// 저장소 연결과 트랜잭션 질의 실행 및 시계 계약 가져옴
import type { DatabaseHandle, Executor, WallClock } from "./connection";
// 분석 결과 쓰기 문장과 쓰기 문맥 및 비공개 요약 용량 상한 가져옴
import {
    automaticReview,
    candidates,
    completion,
    evidence,
    MAX_PRIVATE_SUMMARY_BYTES,
    perceptionRun,
    privateIndex,
    shots,
    type Write
} from "./records";

// 저장 거부 결과를 보존하여 트랜잭션 전체를 되돌리는 오류 정의
class RejectedAnalysisWrite extends Error {
    // 되돌릴 저장 거부 결과 보존
    public constructor(public readonly result: JobResult) {
        // 저장 거부 시 트랜잭션 전체를 되돌릴 오류 내용 초기화
        super("Analysis write rejected; transaction must roll back");
    }
}

// 서버가 확인한 원본과 사실 채택 검사 결과 정의
type Verification = NonNullable<JobResultCommand["perceptionVerification"]>;

// 서버 검증을 거친 관측 실행과 직렬화한 비공개 요약 정의
type Observation = Readonly<{
    // 사실 채택과 구분한 모델 관측 처리 자료
    perception: PerceptionRun;
    // 원본과 증거 검증 및 사실 채택 검사 결과
    verification: Verification;
    // 저장 상한 안에서 직렬화한 비공개 관측 요약
    summary: string;
}>;

// 잠금 전 입력 검사를 통과한 관측 문맥 또는 거부 결과 정의
type Preparation =
    | Readonly<{ kind: "READY"; observation: Observation | undefined }>
    | Readonly<{ kind: "INVALID_RESULT"; reason: "CONTEXT" }>;

// 비공개 요약에 남길 색인 저장 범위 또는 생략 사유 정의
type IndexSummary =
    | Readonly<{ status: "INDEXED"; observationCount: number; truncated: boolean }>
    | Extract<PrivateIndex, Readonly<{ status: "SKIPPED" }>>;

// 잠금 조회로 읽은 작업과 분석 및 원본의 현재 행 정의
type Target = Readonly<{
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 처리 상태 또는 요청 응답 상태
    status: string;
    // 영상 검증과 분석의 작업 구분
    job_type: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    job_revision: number;
    // 현재 작업 실행 시도 횟수
    attempt: number;
    // 현재 작업을 임대한 작업자 식별자
    lease_owner: string | null;
    // 작업 임대 권한 비교용 토큰 해시
    lease_token_hash: Buffer | null;
    // 현재 작업 임대의 유효 기한
    lease_until: string | null;
    // 분석 기록의 식별자
    analysis_id: string | null;
    // 분석 대상 원본과의 일치 확인용 해시
    source_fingerprint: Buffer | null;
    // 파일 내용의 동일성을 대조하는 해시
    content_sha256: Buffer | null;
    // 접근과 보존을 허용하는 만료 시각
    expires_at: string | null;
    // 검증된 경기 기록의 식별자
    match_id: string | null;
    // 분석에 연결한 대회 규정 판본 식별자
    applied_rule_version_id: string | null;
    // 원본 영상의 검증 상태
    video_status: string;
    // 원본 영상의 보존 만료 시각
    video_expires_at: string | null;
}>;

// 현재 작업자의 임대가 확인되어 분석과 임대 기한 및 토큰이 정해진 작업 행 정의
type LeasedTarget = Target &
    Readonly<{ analysis_id: string; lease_until: string; lease_token_hash: Buffer }>;

// 저장한 색인은 관측 수와 절단 여부만 남기고 생략한 색인은 사유를 그대로 남기는 요약 생성
function indexSummary(index: PrivateIndex): IndexSummary {
    // 생략한 색인의 생략 사유 반환
    if (index.status !== "INDEXED") return index;
    // 저장한 색인의 관측 수와 절단 여부 반환
    return {
        // 비공개 색인을 저장한 상태
        status: "INDEXED",
        // 저장한 관측 행 수
        observationCount: index.batch.rows.length,
        // 생산자 예산으로 일부 관측만 기록했는지 여부
        truncated: index.batch.truncated
    };
}

// 처리 범위와 사건 및 사실 채택 상태를 담은 비공개 관측 요약 직렬화
function privateSummary(
    perception: PerceptionRun,
    verification: Verification,
    index: PrivateIndex | undefined
): string {
    // 처리 범위와 사건 및 사실 채택 상태를 비공개 요약으로 직렬화
    return JSON.stringify({
        ...perception.summary,
        // 사실 채택과 구분한 인식 처리 완료 상태
        processingStatus: perception.processingStatus,
        // 인식 처리의 시간 범위와 표본 처리 집계
        coverage: perception.coverage,
        // 인식한 사건 후보와 증거 연결 목록
        incidents: perception.incidents,
        ...(perception.schemaVersion === "perception-run-v2" ? { audio: perception.audio } : {}),
        // 관측을 규정 사실로 채택할 수 있는지의 검사 결과
        admission: verification.admission,
        // 비공개 관측 색인의 저장 범위 또는 생략 사유
        ...(index ? { privateIndex: indexSummary(index) } : {})
    });
}

// 잠금 전에 프레임 시각과 관측 경로 및 비공개 요약 용량을 검사하여 저장 문맥 생성
function preparation(command: JobResultCommand, payload: AnalysisPayload): Preparation {
    // 디코딩한 한 시각이 아닌 구간을 가진 프레임 증거 존재 여부
    const ranged = (payload.evidence ?? []).some(
        (item) => item.kind === "FRAME" && item.startMs !== item.endMs
    );
    // 신규 프레임 증거를 디코딩한 한 시각으로 제한
    if (ranged) return { kind: "INVALID_RESULT", reason: "CONTEXT" };
    // 승인된 로컬 관측 처리 버전인지 확인
    const localPipeline = [
        "video-local-observers-v1",
        "video-local-observers-av-v1"
    ].includes(payload.pipelineVersion);
    // 사실 채택과 별개인 모델 관측 실행 자료 읽음
    const perception = localPipeline ? payload.perception : undefined;
    // 서버가 확인한 원본과 사실 채택 검사 결과 읽음
    const verification = command.perceptionVerification;
    // 처리 버전에 대응하는 관측 실행 자료 구조 버전
    const schema =
        payload.pipelineVersion === "video-local-observers-v1"
            ? "perception-run-v1"
            : "perception-run-v2";
    // 로컬 관측 자료와 서버 검증 및 버전 대응이 없으면 저장 거부
    if (localPipeline && (!perception || !verification || perception.schemaVersion !== schema)) {
        // 작업과 관측 검증 문맥 불일치 결과 반환
        return { kind: "INVALID_RESULT", reason: "CONTEXT" };
    }
    // 비관측 경로에 관측 검증 결과가 섞이면 저장 거부
    if (!localPipeline && verification) {
        // 처리 경로와 검증 자료의 불일치 결과 반환
        return { kind: "INVALID_RESULT", reason: "CONTEXT" };
    }
    // 비관측 경로는 관측 저장 없이 진행
    if (!perception || !verification) return { kind: "READY", observation: undefined };
    // 직렬화한 비공개 관측 요약의 보관 위치 마련
    let summary: string;
    // 비공개 요약 직렬화 실패를 결과 거부로 처리하는 예외 경계 설정
    try {
        // 처리 범위와 사건 및 사실 채택 상태를 비공개 요약으로 직렬화
        summary = privateSummary(perception, verification, command.privateIndex);
    } catch {
        // 직렬화할 수 없는 관측 요약의 저장 거부 반환
        return { kind: "INVALID_RESULT", reason: "CONTEXT" };
    }
    // 비공개 요약의 실제 바이트 크기가 저장 상한을 넘는지 확인
    if (Buffer.byteLength(summary, "utf8") > MAX_PRIVATE_SUMMARY_BYTES) {
        // 비공개 요약 용량 초과에 따른 저장 거부 반환
        return { kind: "INVALID_RESULT", reason: "CONTEXT" };
    }
    // 서버 검증 관측과 비공개 요약을 담은 저장 문맥 반환
    return { kind: "READY", observation: { perception, verification, summary } };
}

// 기준 시각에 현재 작업자의 분석 작업 임대가 유효한지 확인
function validLease(
    target: Target,
    command: JobResultCommand,
    lease: Buffer,
    now: string
): target is LeasedTarget {
    // 작업 종류와 판본 및 임대 소유자와 토큰과 기한의 일치 여부 반환
    return (
        target.job_type === "ANALYZE_VIDEO" &&
        target.analysis_id !== null &&
        target.job_revision === command.jobRevision &&
        target.lease_owner === command.workerId &&
        target.lease_token_hash !== null &&
        Buffer.compare(target.lease_token_hash, lease) === 0 &&
        target.lease_until !== null &&
        new Date(target.lease_until).getTime() > new Date(now).getTime()
    );
}

// 비공개 색인을 저장할 때 원본 자체의 검증 상태와 기준 시각의 보존 기한 확인
function validPrivateSource(command: JobResultCommand, target: Target, now: string): boolean {
    // 색인 저장이 없거나 검증된 원본이 기준 시각에 보존 중인지 반환
    return (
        command.privateIndex?.status !== "INDEXED" ||
        (target.video_status === "VALID" &&
            target.video_expires_at != null &&
            new Date(target.video_expires_at).getTime() > new Date(now).getTime())
    );
}

// 서버가 검증한 원본 해시와 분석 소유 관계가 잠금 행과 일치하는지 확인
function sameSource(target: LeasedTarget, verification: Verification): boolean {
    // 서버가 검증한 원본 해시를 저장 값 비교용 바이트로 변환
    const verified = Buffer.from(verification.sourceSha256);
    // 보존 기한은 생존 조건이 확인했으므로 원본 해시와 분석 소유 관계 일치 여부 반환
    return (
        verification.analysisId === target.analysis_id &&
        verified.length === 32 &&
        target.source_fingerprint?.length === 32 &&
        target.content_sha256?.length === 32 &&
        Buffer.compare(target.source_fingerprint, verified) === 0 &&
        Buffer.compare(target.content_sha256, verified) === 0
    );
}

// 후보와 화면 구간 및 증거 경로의 중복이 없고 증거가 현재 작업 경로와 후보만 참조하는지 확인
function wellFormed(payload: AnalysisPayload, target: LeasedTarget): boolean {
    // 중복 검사와 증거 연결 검증에 사용할 후보 순번 집합 생성
    const candidateIndices = new Set(payload.candidates.map((item) => item.index));
    // 화면 구간 순번의 중복 검사 집합 생성
    const shotIndices = new Set(payload.shots.map((item) => item.index));
    // 제출 증거 목록 읽음
    const items = payload.evidence ?? [];
    // 증거 파일 경로의 중복 검사 집합 생성
    const objectKeys = new Set(items.map((item) => item.objectKey));
    // 현재 분석과 작업에 허용된 증거 경로 앞부분 생성
    const prefix = `evidence/${target.analysis_id}/${target.id}/`;
    // 순번과 경로의 중복 부재 및 증거의 현재 작업 경로와 후보 참조 여부 반환
    return (
        candidateIndices.size === payload.candidates.length &&
        shotIndices.size === payload.shots.length &&
        objectKeys.size === items.length &&
        items.every(
            (item) => item.objectKey.startsWith(prefix) && candidateIndices.has(item.candidateIndex)
        )
    );
}

// 경기 날짜와 대회 및 시즌에 맞는 검증된 규정 판본을 공유 잠금으로 읽어 자동 평가 규정 문맥 생성
async function ruleContext(
    transaction: Executor,
    target: Target
): Promise<AutomaticRuleContext | null> {
    // 경기 날짜와 대회 및 시즌에 맞는 검증된 규정 판본 조회
    const rules =
        target.applied_rule_version_id && target.match_id
            ? await transaction.execute(sql`
            select rule.id, rule.competition, rule.season, rule.ifab_edition, rule.verification_status
            from competition_rule_versions as rule
            join matches as match on match.id = ${target.match_id}
              and match.competition = rule.competition and match.season = rule.season
              and match.match_date >= rule.effective_from
              and (rule.effective_to is null or match.match_date <= rule.effective_to)
            where rule.id = ${target.applied_rule_version_id} and nullif(trim(rule.source_document), '') is not null
            for share of rule, match
          `)
            : [];
    // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
    const [rule] = rules as unknown as Array<{
        // 다른 기록과 구별하는 고유 식별자
        id: string;
        // 규정 적용 대상 대회
        competition: string;
        // 규정 적용 대상 시즌
        season: string;
        // 국제 축구 규정의 판본
        ifab_edition: string;
        // 규정 문맥의 검증 상태
        verification_status: string;
    }>;
    // 검증된 경기와 판본이 모두 없으면 규정 문맥 없음 반환
    if (rule?.verification_status !== "VERIFIED" || !target.match_id) return null;
    // 검증된 경기와 판본의 규정 문맥 반환
    return {
        // 다른 기록과 구별하는 고유 식별자
        id: rule.id,
        // 검증된 경기 기록의 식별자
        matchId: target.match_id,
        // 규정 적용 대상 대회
        competition: rule.competition,
        // 규정 적용 대상 시즌
        season: rule.season,
        // 국제 축구 규정 판본 식별자
        ifabVersionId: `ifab-${rule.ifab_edition}`,
        // 규정 문맥의 검증 상태
        verificationStatus: "VERIFIED"
    };
}

// 자동 평가 묶음의 고정 모델 출처와 원본 작업 후보 근거 결합 및 저장 용량 확인
function validReview(
    automatic: AutomaticReviewBatch,
    target: LeasedTarget,
    payload: AnalysisPayload,
    observation: Observation | undefined,
    rule: AutomaticRuleContext | null
): boolean {
    // 완료 평가가 있다면 승인된 고정 모델 출처가 모두 존재하는지 확인
    if (
        automatic.rows.some((row) => row.status === "COMPLETED") &&
        (!observation || !pinnedModels(observation.perception.models))
    ) {
        // 고정 모델 출처를 충족하지 못한 완료 결과 거부
        return false;
    }
    // 원본 해시가 없는 분석의 자동 평가 거부
    if (!target.source_fingerprint || !target.content_sha256) return false;
    // 보존 기한은 생존 조건이 확인했으므로 원본 해시와 자동 평가 계약 및 용량 충족 여부 반환
    return (
        target.source_fingerprint.equals(target.content_sha256) &&
        validAutomaticBatch(automatic, {
            // 분석 기록의 식별자
            analysisId: target.analysis_id,
            // 처리 작업의 식별자
            jobId: target.id,
            // 재실행 이전 요청을 구분하는 작업 판본
            jobRevision: target.job_revision,
            // 분석한 원본 영상의 내용 해시
            sourceSha256: target.source_fingerprint.toString("hex"),
            // 영상 처리 절차를 구별하는 버전
            pipelineVersion: payload.pipelineVersion,
            // 분석에 속한 후보 장면 순번 집합
            candidateIndices: [...new Set(payload.candidates.map((item) => item.index))],
            // 원본에 연결한 증거 자료 또는 접근 기능
            evidence: payload.evidence ?? [],
            // 경기 문맥에 맞춰 연결한 규정 자료
            rule
        }) &&
        Buffer.byteLength(JSON.stringify(automatic), "utf8") <= MAX_PRIVATE_SUMMARY_BYTES
    );
}

// 검사 시각에 작업 임대와 분석 보존 기한 및 비공개 원본 보존 기한을 확인하고 실패 결과 반환
function expiry(target: LeasedTarget, command: JobResultCommand, now: number): JobResult | null {
    // 검사 시각의 작업 임대 만료 여부 확인
    if (new Date(target.lease_until).getTime() <= now) return { kind: "STALE_LEASE" };
    // 검사 시각의 분석 보존 기한 만료 여부 확인
    if (!target.expires_at || new Date(target.expires_at).getTime() <= now) {
        // 만료된 원본을 사용하는 결과 저장 거부 반환
        return { kind: "INVALID_RESULT", reason: "SOURCE" };
    }
    // 비공개 색인을 저장할 때 검사 시각의 원본 보존 기한 확인
    if (!validPrivateSource(command, target, new Date(now).toISOString())) {
        // 보존 기한을 넘긴 원본의 비공개 관측 저장 거부 반환
        return { kind: "INVALID_RESULT", reason: "SOURCE" };
    }
    // 임대와 원본 기한 검사에서 실패 없음 반환
    return null;
}

// 잠금 안에서 임대와 원본과 관측 및 자동 평가를 다시 확인한 뒤 분석 결과를 한 묶음으로 저장
export async function analysis(
    client: DatabaseHandle,
    wallClock: WallClock,
    command: JobResultCommand,
    payload: AnalysisPayload
): Promise<JobResult> {
    // 잠금 전 입력 검사와 비공개 관측 요약 준비
    const prepared = preparation(command, payload);
    // 잠금 전 입력 검사 실패 결과 반환
    if (prepared.kind !== "READY") return prepared;
    // 서버 검증을 거친 관측 실행 문맥 읽음
    const observation = prepared.observation;
    // 후보별 자동 규정 평가 자료 읽음
    const automatic = command.automaticReview;
    // 관측이나 자동 평가가 있어 잠금 이후 실제 시각으로 기한을 다시 확인하는 경로 여부
    const clocked = Boolean(observation || automatic);
    // 작업 임대 권한 비교용 토큰 해시 변환
    const lease = Buffer.from(command.leaseTokenHash);
    // 작업 원본과 평가를 잠금 안에서 다시 확인한 뒤 한 묶음으로 저장
    return client.db
        .transaction(async (transaction): Promise<JobResult> => {
            // 결과 저장에 필요한 작업 원본 분석의 현재 행 잠금 조회
            const selected = await transaction.execute(sql`
          select job.id, job.status, job.job_type, job.job_revision, job.attempt, job.lease_owner,
                 job.lease_token_hash, job.lease_until, job.analysis_id,
                 analysis.source_fingerprint, analysis.expires_at, video.content_sha256,
                 video.status as video_status, video.expires_at as video_expires_at,
                 analysis.match_id, analysis.applied_rule_version_id
          from processing_jobs as job
          join analyses as analysis on analysis.id = job.analysis_id
          join video_assets as video on video.id = analysis.video_asset_id
          where job.id = ${command.jobId}
          for update of job, analysis, video
        `);
            // 저장소 조회 목록에서 필요한 첫 번째 행 읽음
            const [target] = selected as unknown as Target[];
            // 작업 대상이 없으면 결과 저장 중단
            if (!target) return { kind: "NOT_FOUND" };
            // 완료된 작업은 중복 결과 차단
            if (target.status !== "PROCESSING") return { kind: "ALREADY_FINISHED" };
            // 새 관측 경로는 행 잠금 대기 이후의 실제 벽시계로 작업 임대와 보존 기한을 다시 확인
            const lockedNow = clocked ? wallClock().toISOString() : command.now;
            // 기준 시각에 임대 권한이 유효하지 않으면 결과 저장 차단
            if (!validLease(target, command, lease, lockedNow)) return { kind: "STALE_LEASE" };
            // 잠금 이후 기준 시각에 작업 대상과 소유 세션이 보존 규칙 안에 있는지 조회
            const [state] = (await transaction.execute(sql`
            select ${liveJob(lockedNow)} as live from processing_jobs as job where job.id = ${target.id}
          `)) as unknown as Array<{ live: boolean }>;
            // 보존 규칙을 벗어난 원본의 결과는 기준선 경로를 포함해 저장 거부
            if (!state?.live) return { kind: "INVALID_RESULT", reason: "SOURCE" };
            // 새 비공개 관측은 원본 자체의 상태와 보존 기한도 확인한 뒤 저장
            if (!validPrivateSource(command, target, lockedNow)) {
                // 검증 상태나 보존 기한을 벗어난 원본의 비공개 관측 저장 거부 반환
                return { kind: "INVALID_RESULT", reason: "SOURCE" };
            }
            // 서버 검증이 있는 관측 결과의 원본 동일성 재검사
            if (observation && !sameSource(target, observation.verification)) {
                // 검증한 원본과 저장된 분석 원본이 다른 결과 거부 반환
                return { kind: "INVALID_RESULT", reason: "SOURCE" };
            }
            // 후보와 화면 구간 및 증거의 중복과 다른 작업 증거 참조 차단
            if (!wellFormed(payload, target)) return { kind: "INVALID_RESULT", reason: "CONTEXT" };
            // 자동 평가가 포함된 경우 현재 경기 규정 문맥 조회
            const rule = automatic ? await ruleContext(transaction, target) : null;
            // 자동 평가가 포함된 경우 고정 모델 출처와 평가 계약 및 용량 재검사
            if (automatic && !validReview(automatic, target, payload, observation, rule)) {
                // 자동 평가 저장 문맥의 부적합 결과 반환
                return { kind: "INVALID_RESULT", reason: "CONTEXT" };
            }
            // 새 관측 경로의 쓰기 직전 실제 시각이며 기준선 경로는 비어 있음
            const writeAt = clocked ? wallClock().getTime() : undefined;
            // 실제 쓰기 직전 임대와 원본 유효 기한 재검사
            const before = writeAt === undefined ? null : expiry(target, command, writeAt);
            // 저장 직전 기한 검사 실패 시 쓰기 시작 차단
            if (before) return before;
            // 기한 재검사를 통과한 실제 시각을 이후 저장 시각으로 사용
            const savedAt = writeAt === undefined ? lockedNow : new Date(writeAt).toISOString();
            // 같은 트랜잭션과 작업 행 및 저장 시각을 공유하는 쓰기 문맥 생성
            const write: Write = { transaction, target, payload, savedAt };
            // 원본 시간축에 연결한 화면 구간 저장
            await shots(write);
            // 원시 관측과 인식 사건을 구분한 후보 장면 저장
            await candidates(write);
            // 후보별 증거 자산 저장과 제출 순번별 저장 식별자 연결
            const bindings = await evidence(write);
            // 증거가 참조한 후보가 없으면 전체 저장 취소
            if (!bindings) {
                // 잘못된 후보 증거 연결을 오류로 전달하여 트랜잭션 되돌림
                throw new RejectedAnalysisWrite({ kind: "INVALID_RESULT", reason: "CONTEXT" });
            }
            // 자동 평가가 있는 경우 증거 연결과 함께 보존
            if (automatic) await automaticReview(write, automatic, bindings);
            // 관측과 서버 검증이 함께 있는 경우 비공개 실행 이력 보존
            if (observation) {
                await perceptionRun(write, observation.perception, observation.summary);
            }
            // 기존 결과와 같은 트랜잭션에서 일반 관측과 유형별 사건을 비공개 저장
            if (command.privateIndex) {
                await privateIndex(write, command.privateIndex, observation?.perception);
            }
            // 분석 완료와 작업 성공 및 완료 이벤트 기록
            await completion(write);
            // 완료와 이벤트 저장을 포함한 모든 쓰기 이후의 실제 시각으로 기한 재검사
            const after = clocked ? expiry(target, command, wallClock().getTime()) : null;
            // 모든 쓰기 후 기한이 만료되었으면 전체 트랜잭션 취소
            if (after) throw new RejectedAnalysisWrite(after);
            // 모든 검증과 저장을 통과한 접수 결과 반환
            return { kind: "ACCEPTED" };
        })
        .catch((error: unknown) => {
            // 의도된 저장 거부 오류는 보존한 실패 결과로 변환
            if (error instanceof RejectedAnalysisWrite) return error.result;
            // 예상하지 못한 저장 오류를 상위 호출로 전달
            throw error;
        });
}
