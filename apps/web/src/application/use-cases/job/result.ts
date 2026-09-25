// 유효 기한 계산에 필요한 시계 계약 가져옴
import type { Clock } from "../../ports/clock/clock";
// 규정 관측 채택 검사 기능 가져옴
import { perceptionAdmission } from "@replay/rule-engine";
// 입력 자료 검증 기능 가져옴
import { payload } from "./payload";
// 실제 객체 검증과 해시 비교 기능 가져옴
import { bytesHex, verifiedHash, objects } from "./objects";
// 자동 평가 입력 조립 기능 가져옴
import { review } from "./review";
// 비공개 단계 진단 경계 가져옴
import { diagnostic as boundary, notice, type Diagnostic, type ResultDiagnostic } from "./diagnostic";
// 내용 동일성 확인에 필요한 해시 계약 가져옴
import type { Hasher } from "../../ports/hashing/hasher";
// 영상 작업의 임대와 결과 처리 계약 가져옴
import type {
    JobResult,
    JobResultPayload,
    JobResultStore
} from "../../ports/repositories/job-store";
// 영상 업로드의 허가와 완료 계약 가져옴
import type { CompletionStorage } from "../../ports/storage/upload-storage";
import type { EvidenceBodyStorage } from "../../ports/storage/evidence-storage";
import { incidentArchive } from "../incidents/archive";
import { incidentBatch } from "../incidents/batch";

// 외부 식별자의 고유 식별자 형식 검사 패턴 생성
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 작업 결과 입력
export type ResultInput = Readonly<{
    // 처리 작업의 식별자
    jobId: string;
    // 작업을 수행하는 실행자의 식별자
    workerId: string;
    // 재실행 이전 요청을 구분하는 작업 판본
    jobRevision: number;
    // 현재 작업 임대를 증명하는 비밀 토큰
    leaseToken: string;
    // 작업에 전달하거나 제출하는 자료
    payload: JobResultPayload;
}>;

// 결과 부적합 사유 정의
export type ResultInvalidReason =
    | "JOB_ID"
    | "WORKER_ID"
    | "REVISION"
    | "LEASE"
    | "PAYLOAD";

// 결과 결과 정의
export type ResultResult = JobResult | Readonly<{
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "INVALID_INPUT";
    // 입력 거부 또는 처리 보류 사유
    reason: ResultInvalidReason;
}> | Readonly<{
    // 처리 분기 또는 자료 종류를 구별하는 값
    kind: "INVALID_RESULT";
    // 입력 거부 또는 처리 보류 사유
    reason: "VERIFICATION_UNAVAILABLE" | "SOURCE" | "ARTIFACT" | "REFERENCE" | "STORAGE";
}>;

// 결과 의존 기능 계약 정의
export type ResultDependencies = Readonly<{
    // 유효 기한 계산에 사용하는 시계
    clock: Clock;
    // 비밀 토큰과 파일의 내용 해시 계산 기능
    hasher: Hasher;
    // 기록을 조회하고 보존하는 저장소 기능
    repository: JobResultStore;
    // 원본과 증거 파일을 다루는 저장소 기능
    storage?: CompletionStorage;
    // 비공개 산출물의 실제 스트리밍 읽기 기능
    privateStorage?: EvidenceBodyStorage;
    // 원본 예외를 포함하지 않는 비공개 단계 진단 기능
    diagnostic?: Diagnostic;
}>;

// 결과 처리
export const result =
    ({ clock, hasher, repository, storage, privateStorage, diagnostic }: ResultDependencies) =>
    async (input: ResultInput): Promise<ResultResult> => {
        // 작업 결과 검증
        if (!UUID.test(input.jobId)) {
            // 작업 식별자 형식 오류 반환
            return { kind: "INVALID_INPUT", reason: "JOB_ID" };
        }

        // 작업자 식별자를 문자열로 한정하고 앞뒤 공백 제거
        const workerId = typeof input.workerId === "string" ? input.workerId.trim() : "";
        // 작업자 식별자가 비었거나 길이 제한을 넘으면 거부
        if (workerId.length === 0 || workerId.length > 128) {
            // 작업자 식별자 입력 오류 반환
            return { kind: "INVALID_INPUT", reason: "WORKER_ID" };
        }

        // 작업 판본이 양의 안전한 정수가 아니면 거부
        if (!Number.isSafeInteger(input.jobRevision) || input.jobRevision < 1) {
            // 작업 판본 입력 오류 반환
            return { kind: "INVALID_INPUT", reason: "REVISION" };
        }

        // 임대 토큰이 문자열이 아니거나 비었으면 거부
        if (typeof input.leaseToken !== "string" || input.leaseToken.trim().length === 0) {
            // 임대 토큰 입력 오류 반환
            return { kind: "INVALID_INPUT", reason: "LEASE" };
        }

        // 결과 종류별 자료 계약을 충족하지 못하면 거부
        if (!payload(input.payload)) {
            // 작업 결과 본문 형식 오류 반환
            return { kind: "INVALID_INPUT", reason: "PAYLOAD" };
        }

        // 검증된 식별자만 포함하는 단계별 예외 경계 구성
        const step = <T>(stage: ResultDiagnostic["stage"], operation: () => T | Promise<T>) =>
            boundary(
                { stage, jobId: input.jobId.toLowerCase(), jobRevision: input.jobRevision },
                diagnostic,
                operation
            );

        // 작업 임대 토큰 해시 생성
        const leaseTokenHash = Uint8Array.from(await hasher.sha256(input.leaseToken));
        // 승인된 로컬 관측 결과는 서버 측 원본과 증거 검사 경로로 분기
        if (
            input.payload.kind === "ANALYZED" &&
            ["video-local-observers-v1", "video-local-observers-av-v1"].includes(
                input.payload.pipelineVersion
            )
        ) {
            // 관측 자료나 사전 검사 또는 저장소 기능 누락 확인
            if (!input.payload.perception || !repository.preflight || !storage) {
                // 실제 파일 검증 수단이 없는 결과 거부 반환
                return { kind: "INVALID_RESULT", reason: "VERIFICATION_UNAVAILABLE" };
            }
            // 분기에서 확인한 분석 자료의 계약 보존
            const analysis = input.payload;
            // 시간이 걸리는 파일 검증 전 기준 시각 읽음
            const initialNow = clock.now().toISOString();
            // 파일 검사 전 권한 확인 및 필요 시 검증된 경기 문맥 연결
            const preflight = await step("PREFLIGHT", () => repository.preflight!({
                // 처리 작업의 식별자
                jobId: input.jobId.toLowerCase(),
                // 작업을 수행하는 실행자의 식별자
                workerId,
                // 재실행 이전 요청을 구분하는 작업 판본
                jobRevision: input.jobRevision,
                // 작업 임대 권한 비교용 토큰 해시
                leaseTokenHash,
                // 유효 기한 판단에 사용하는 현재 시각
                now: initialNow
            }));
            // 현재 작업 임대의 접근 권한을 얻지 못하면 검사 중단
            if (preflight.kind !== "AUTHORIZED") return preflight;
            // 사실 채택과 별개인 모델 관측 실행 자료 읽음
            const perception = input.payload.perception;
            // 업로드 원본과 분석 해시 및 관측 원본과 보존 기한 대조
            if (
                !verifiedHash(preflight.sourceSha256, perception.sourceSha256) ||
                !verifiedHash(preflight.analysisSourceSha256, perception.sourceSha256) ||
                !preflight.expiresAt
            ) {
                // 관측 자료와 분석 원본 불일치 거부 반환
                return { kind: "INVALID_RESULT", reason: "SOURCE" };
            }
            // 현재 작업 판본과 내용 해시에 묶인 비공개 관측 경로 생성
            const expectedArtifactKey = `perception/${preflight.analysisId}/${input.jobId.toLowerCase()}/${input.jobRevision}/${perception.artifact.contentSha256}.jsonl.gz`;
            // 비공개 관측 파일이 현재 작업 판본의 고정 경로인지 확인
            if (perception.artifact.objectKey !== expectedArtifactKey) {
                // 다른 경로의 비공개 관측 파일 참조 거부 반환
                return { kind: "INVALID_RESULT", reason: "ARTIFACT" };
            }
            // 실제 저장소 파일과 참조를 먼저 검증
            const verified = await step("OBJECTS", () =>
                objects(analysis, preflight, input.jobId, storage)
            );
            // 실제 객체 읽기 예외로 변환된 거부 결과만 비공개 기록
            if (verified.kind === "INVALID_RESULT" && verified.reason === "STORAGE") {
                // 검증된 식별자와 단계 외 자료를 제외한 진단 전송
                notice({
                    stage: "OBJECTS",
                    jobId: input.jobId.toLowerCase(),
                    jobRevision: input.jobRevision
                }, diagnostic);
            }
            // 파일 검증 실패는 기존 공개 거부 결과로 반환
            if (verified.kind !== "VERIFIED") return verified;
            // 검증 완료된 원문과 참조 목록 읽음
            const { artifact, references } = verified;
            // 원본 증거 규정 문맥을 대조하여 관측의 사실 채택 가능성 검사
            const admission = await step("ADMISSION", () => perceptionAdmission(perception, {
                // 서버 측 실제 파일 검증 수행 여부
                serverVerified: true,
                // 영상 처리 절차를 구별하는 버전
                pipelineVersion: analysis.pipelineVersion,
                // 분석한 원본 영상의 내용 해시
                sourceSha256: bytesHex(preflight.sourceSha256),
                // 비공개 관측 원문 파일의 메타데이터
                artifact: {
                    // 객체 저장소에서 파일을 찾는 경로
                    objectKey: perception.artifact.objectKey,
                    // 파일 내용의 동일성을 대조하는 해시
                    contentSha256: bytesHex(artifact.contentSha256),
                    // 파일의 바이트 크기
                    sizeBytes: artifact.sizeBytes
                },
                // 관측 또는 규정과 연결한 증거 참조 목록
                references,
                // 검증된 경기의 적용 규정 판본
                ruleEdition: preflight.ruleEdition
            }));
            // 기존 비공개 산출물을 별도 판본의 관측 색인으로 검증하며 사실 승인은 수행하지 않음
            const privateIncidents = privateStorage ? await step("OBSERVATIONS", async () => {
                const content = await privateStorage.body(perception.artifact.objectKey);
                const archive = await incidentArchive(content.body, {
                    sourceSha256: bytesHex(preflight.sourceSha256),
                    artifactSha256: perception.artifact.contentSha256,
                    artifactSizeBytes: perception.artifact.sizeBytes,
                    durationMs: preflight.durationMs ?? 0
                });
                return incidentBatch(archive, analysis, {
                    analysisId: preflight.analysisId, jobId: input.jobId.toLowerCase(), jobRevision: input.jobRevision,
                    ...(preflight.ruleEdition?.verificationStatus === "VERIFIED"
                        && preflight.ruleEdition.competition && preflight.ruleEdition.season && preflight.ruleEdition.matchDate
                        ? { match: { matchId: preflight.ruleEdition.matchId, competition: preflight.ruleEdition.competition,
                            season: preflight.ruleEdition.season, matchDate: preflight.ruleEdition.matchDate,
                            ifabVersionId: `ifab-${preflight.ruleEdition.ifabEdition}`, verification: "VERIFIED" as const } } : {})
                }, storage);
            }) : undefined;
            // 파일 검증 완료 후 유효 기한 재검사 시각 읽음
            const completedAt = clock.now();
            // 시간 소요가 큰 파일 검사 후 원본 보존 기한 재확인
            if (
                !Number.isFinite(new Date(preflight.expiresAt).getTime()) ||
                new Date(preflight.expiresAt).getTime() <= completedAt.getTime()
            ) {
                // 검사 중 만료된 원본의 결과 거부 반환
                return { kind: "INVALID_RESULT", reason: "SOURCE" };
            }
            // 자동 평가 실패를 저장소 읽기 실패와 분리
            const automatic = await step("EVALUATION", () =>
                review({ ...input, payload: analysis }, preflight, verified)
            );
            // 검증한 원본과 관측 채택 상태 및 자동 평가를 저장한 결과 반환
            return await step("PERSISTENCE", () => repository.result({
                // 처리 작업의 식별자
                jobId: input.jobId.toLowerCase(),
                // 작업을 수행하는 실행자의 식별자
                workerId,
                // 재실행 이전 요청을 구분하는 작업 판본
                jobRevision: input.jobRevision,
                // 작업 임대 권한 비교용 토큰 해시
                leaseTokenHash,
                // 유효 기한 판단에 사용하는 현재 시각
                now: completedAt.toISOString(),
                // 작업에 전달하거나 제출하는 자료
                payload: input.payload,
                // 후보별 자동 규정 평가의 내부 결과 묶음
                automaticReview: automatic,
                ...(privateIncidents ? { privateIncidents } : {}),
                // 원본과 증거 검증 및 사실 채택 검사 결과
                perceptionVerification: {
                    // 분석 기록의 식별자
                    analysisId: preflight.analysisId,
                    // 분석한 원본 영상의 내용 해시
                    sourceSha256: preflight.sourceSha256,
                    // 관측을 규정 사실로 채택할 수 있는지의 검사 결과
                    admission
                }
            }));
        }

        // 작업 결과 저장
        return await step("PERSISTENCE", () => repository.result({
            // 처리 작업의 식별자
            jobId: input.jobId.toLowerCase(),
            // 작업을 수행하는 실행자의 식별자
            workerId,
            // 재실행 이전 요청을 구분하는 작업 판본
            jobRevision: input.jobRevision,
            // 작업 임대 권한 비교용 토큰 해시
            leaseTokenHash,
            // 유효 기한 판단에 사용하는 현재 시각
            now: clock.now().toISOString(),
            // 작업에 전달하거나 제출하는 자료
            payload: input.payload
        }));
    };
