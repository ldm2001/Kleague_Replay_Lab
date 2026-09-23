// 저장소 질의와 자료 구조 정의 기능 가져옴
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    AnalysisResult,
    AnalysisStore as AnalysisPort,
    AnalysisCommand
} from "@replay/application";
// 데이터베이스 연결과 저장 구조 가져옴
import {
    competitionRuleVersions,
    idempotencyRecords,
    matches,
    type DatabaseClient
} from "@replay/database";

// 저장소 구현에 필요한 데이터베이스 연결 부분 정의
type DatabaseHandle = Pick<DatabaseClient, "db">;

// 잠금으로 동시 변경을 막은 세션 조회 행 정의
type LockedSessionRow = {
    // 다른 기록과 구별하는 고유 식별자
    id: string;
};

// 잠금으로 보호한 원본 영상 조회 행 정의
type LockedVideoRow = {
    // 다른 기록과 구별하는 고유 식별자
    id: string;
    // 업로드 소유자를 구별하는 익명 세션 식별자
    anonymous_session_id: string;
    // 파일 내용의 동일성을 대조하는 해시
    content_sha256: Buffer;
};

// 원본 영상의 중복 분석을 막는 저장 제약 이름 지정
const videoConflictRule = "analyses_video_asset_id_key";

// 중복 영상 오류 확인
const videoConflict = (error: unknown): boolean => {
    // 객체가 아닌 오류는 데이터베이스 제약 위반으로 해석하지 않음
    if (typeof error !== "object" || error === null) {
        // 중복 분석 제약 위반에 해당하지 않음을 반환
        return false;
    }

    // 일반 오류에서 데이터베이스 오류 코드와 제약 정보 읽음
    const candidate = error as {
        // 실패 종류를 구별하는 오류 코드
        code?: unknown;
        // 위반한 저장 제약 이름
        constraint?: unknown;
        // 위반한 저장 제약 이름
        constraint_name?: unknown;
        // 다른 오류에 감싸진 원래 오류
        cause?: unknown;
    };
    // 데이터베이스가 알려준 위반 제약 이름 읽음
    const constraint = candidate.constraint ?? candidate.constraint_name;
    // 고유성 위반 코드와 원본 중복 분석 제약의 정확한 일치 확인
    if (candidate.code === "23505" && constraint === videoConflictRule) {
        // 동일 원본의 중복 분석 충돌임을 반환
        return true;
    }

    // 감싸진 원래 오류에도 동일한 중복 분석 충돌 검사 적용
    return candidate.cause !== undefined && videoConflict(candidate.cause);
};

// 분석 저장소 어댑터
export class AnalysisStore implements AnalysisPort {
    // 저장소 구현에 사용할 연결과 의존 기능 주입
    public constructor(private readonly client: DatabaseHandle) {}

    // 분석 제출 상태 조회
    public async submission(command: AnalysisCommand): Promise<AnalysisResult> {
        // 멱등 키 버퍼 변환
        const keyHash = Buffer.from(command.keyHash);
        // 요청 해시 버퍼 변환
        const requestHash = Buffer.from(command.requestHash);
        // 세션과 키 기반 잠금 범위
        const lockScope = `${command.anonymousSessionId}:${keyHash.toString("hex")}`;

        // 중복 분석 제약 충돌을 업무 결과로 바꿀 예외 경계 설정
        try {
            // 분석 생성 트랜잭션 시작
            return await this.client.db.transaction(async (transaction) => {
                // 동일 요청 잠금
                await transaction.execute(
                    sql`select pg_advisory_xact_lock(hashtextextended(${lockScope}, 0))`
                );

                // 기존 멱등 기록 조회
                const [existingIdempotency] = await transaction
                    .select({
                        // 동일 키로 다른 요청을 보냈는지 확인하는 해시
                        requestHash: idempotencyRecords.requestHash,
                        // 분석 기록의 식별자
                        analysisId: idempotencyRecords.analysisId
                    })
                    .from(idempotencyRecords)
                    .where(
                        and(
                            eq(idempotencyRecords.anonymousSessionId, command.anonymousSessionId),
                            eq(idempotencyRecords.operation, "CREATE_ANALYSIS"),
                            eq(idempotencyRecords.keyHash, keyHash)
                        )
                    )
                    .limit(1);

                // 기존 멱등 기록 분기
                if (existingIdempotency) {
                    // 요청 해시 비교
                    return Buffer.compare(existingIdempotency.requestHash, requestHash) === 0
                        ? { kind: "REPLAYED", analysisId: existingIdempotency.analysisId }
                        : { kind: "IDEMPOTENCY_KEY_REUSED" };
                }

                // 세션 소유권 조회
                const sessionRows = await transaction.execute(sql`
          select id
          from anonymous_sessions
          where id = ${command.anonymousSessionId}
            and revoked_at is null
            and expires_at > ${command.createdAt}
          for update
        `);
                // 세션 행 선택
                const [session] = sessionRows as unknown as LockedSessionRow[];

                // 세션 유효성 확인
                if (!session) {
                    // 세션에 허용되지 않은 영상 자산 결과 반환
                    return { kind: "VIDEO_ASSET_UNAVAILABLE" };
                }

                // 영상 자산 조회
                const videoRows = await transaction.execute(sql`
          select id, anonymous_session_id, content_sha256
          from video_assets
          where id = ${command.videoAssetId}
            and anonymous_session_id = ${command.anonymousSessionId}
            and status = 'VALID'
            and rights_confirmed_at is not null
            and (expires_at is null or expires_at > ${command.createdAt})
            and object_deleted_at is null
          for update
        `);
                // 영상 행 선택
                const [video] = videoRows as unknown as LockedVideoRow[];

                // 영상 소유권 확인
                if (!video || video.anonymous_session_id !== command.anonymousSessionId) {
                    // 유효성 조건을 충족하지 못한 영상 자산 결과 반환
                    return { kind: "VIDEO_ASSET_UNAVAILABLE" };
                }

                // 경기 조회
                const [match] = await transaction
                    .select({
                        // 다른 기록과 구별하는 고유 식별자
                        id: matches.id,
                        // 규정 적용 대상 대회
                        competition: matches.competition,
                        // 규정 적용 대상 시즌
                        season: matches.season,
                        // 업로드 날짜와 구분한 실제 경기 날짜
                        matchDate: matches.matchDate
                    })
                    .from(matches)
                    .where(eq(matches.id, command.matchId))
                    .limit(1);

                // 경기 존재 확인
                if (!match) {
                    // 사용할 경기 문맥을 확인하지 못한 결과 반환
                    return { kind: "MATCH_UNAVAILABLE" };
                }

                // 경기 날짜 기준 규정 판본 조회
                const [ruleVersion] = await transaction
                    .select({ id: competitionRuleVersions.id })
                    .from(competitionRuleVersions)
                    .where(
                        and(
                            eq(competitionRuleVersions.competition, match.competition),
                            eq(competitionRuleVersions.season, match.season),
                            lte(competitionRuleVersions.effectiveFrom, match.matchDate),
                            or(
                                isNull(competitionRuleVersions.effectiveTo),
                                gte(competitionRuleVersions.effectiveTo, match.matchDate)
                            )
                        )
                    )
                    .orderBy(desc(competitionRuleVersions.effectiveFrom))
                    .limit(1);

                // 규정 판본 존재 확인
                if (!ruleVersion) {
                    // 적용 가능한 규정 판본이 없는 결과 반환
                    return { kind: "RULE_VERSION_UNAVAILABLE" };
                }

                // 분석 행 저장
                const analysisRows = await transaction.execute(sql`
          insert into analyses (
            anonymous_session_id, match_id, video_asset_id, status, retention_class,
            source_url, source_platform, source_fingerprint, applied_rule_version_id,
            pipeline_version, media_policy_version, state_version, created_at, expires_at
          ) values (
            ${command.anonymousSessionId}, ${command.matchId}, ${video.id}, 'QUEUED', 'TEMPORARY',
            ${command.sourceUrl}, ${command.sourcePlatform}, ${Buffer.from(video.content_sha256)}, ${ruleVersion.id},
            ${command.pipelineVersion}, ${command.mediaPolicyVersion}, 0, ${command.createdAt}, ${command.expiresAt}
          )
          returning id
        `);
                // 분석 행 선택
                const [analysis] = analysisRows as unknown as Array<{ id: string }>;

                // 분석 식별자 확인
                if (!analysis) {
                    // 분석 식별자 없이 저장을 성공 처리하지 않도록 오류 전달
                    throw new Error("Analysis insert did not return an id");
                }

                // 분석 작업 저장
                await transaction.execute(sql`
          insert into processing_jobs (
            analysis_id, job_type, status, payload_version, job_revision, attempt,
            max_attempts, next_attempt_at, created_at, updated_at
          ) values (
            ${analysis.id}, 'ANALYZE_VIDEO', 'QUEUED', ${command.jobPayloadVersion}, 0, 0,
            ${command.maxJobAttempts}, ${command.createdAt}, ${command.createdAt}, ${command.createdAt}
          )
        `);

                // 멱등 기록 저장
                await transaction.execute(sql`
          insert into idempotency_records (
            anonymous_session_id, operation, key_hash, request_hash, analysis_id, created_at, expires_at
          ) values (
            ${command.anonymousSessionId}, 'CREATE_ANALYSIS', ${keyHash}, ${requestHash},
            ${analysis.id}, ${command.createdAt}, ${command.expiresAt}
          )
        `);

                // 생성 결과 반환
                return { kind: "CREATED", analysisId: analysis.id };
            });
        } catch (error) {
            // 영상 중복 제약 확인
            if (videoConflict(error)) {
                // 동일 원본 영상의 중복 제출 결과 반환
                return { kind: "VIDEO_ASSET_ALREADY_SUBMITTED" };
            }

            // 처리하지 않은 오류 전달
            throw error;
        }
    }
}

// 분석 저장소 생성
export const analysisStore = (
    client: DatabaseHandle,
): AnalysisStore => new AnalysisStore(client);
