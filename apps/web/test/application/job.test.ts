import { describe, expect, it, vi } from "vitest";
// 자동 평가 예외 경계 검증 기능 가져옴
import * as automatic from "../../src/application/use-cases/evaluation/automatic";
// 관측 채택 예외 경계 검증 기능 가져옴
import * as rules from "@replay/rule-engine";
// 실제 작업 결과 응답 경계 가져옴
import { result as response } from "../../src/apis/job";
// 작업자 통신 계약 가져옴
import { WORKER_PROTOCOL } from "@replay/shared-types";
import {
    claim,
    progress,
    result,
    type Clock,
    type JobClaim,
    type JobClaimCommand,
    type JobProgress,
    type JobProgressCommand,
    type JobProgressStore,
    type JobStore,
    type JobResult,
    type JobResultCommand,
    type JobResultPreflight,
    type JobResultPreflightCommand,
    type JobResultStore
} from "@replay/application";
import {
    PERCEPTION_ANALYSIS_ID,
    PERCEPTION_ARTIFACT_SHA256,
    PERCEPTION_EVIDENCE_SHA256,
    PERCEPTION_JOB_ID,
    PERCEPTION_SOURCE_SHA256,
    avPerceptionPayload,
    perceptionPayload
} from "../fixtures/perception";

// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-08-29T00:00:00.000Z");
// 시계 시험 입력으로 현재시각 자료 생성
const clock: Clock = { now: () => NOW };

// 작업 선점 저장소 모형
class JobStoreFake implements JobStore {
    readonly commands: JobClaimCommand[] = [];
    result: JobClaim | null = {
        jobId: "11111111-1111-4111-8111-111111111111",
        jobType: "ANALYZE_VIDEO",
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

    // 검증용 선점 구성
    async claim(command: JobClaimCommand): Promise<JobClaim | null> {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 입력 조건 결과 반환
        return this.result;
    }
}

describe("claim", () => {
    it("creates a bounded lease command for a supported job type", async () => {
        // 지원 작업 선점 실행
        const repository = new JobStoreFake();
        // 작업선점 결과를 결과에 저장
        const result = await claim({
            clock,
            repository,
            leaseMs: 30_000,
            source: { read: async () => "http://minio.test/source" }
        })({
            workerId: "video-worker-1",
            jobType: "ANALYZE_VIDEO"
        });

        // 결과의 기존 항목 및 출처주소 원본 자료 기준 구조 일치 확인
        expect(result).toEqual({ ...repository.result, sourceUrl: "http://minio.test/source" });
        // 저장소 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.commands).toEqual([
            {
                workerId: "video-worker-1",
                jobType: "ANALYZE_VIDEO",
                now: "2026-08-29T00:00:00.000Z",
                leaseUntil: "2026-08-29T00:00:30.000Z"
            }
        ]);
    });

    it("rejects an unsupported worker or job type before the repository", async () => {
        // 잘못된 작업 선점 실행
        const repository = new JobStoreFake();
        // 작업 시험용 작업선점 결과 준비
        const operation = claim({
            clock,
            repository,
            leaseMs: 30_000,
            source: { read: async () => "http://minio.test/source" }
        });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(operation({ workerId: "", jobType: "ANALYZE_VIDEO" })).resolves.toEqual({
            kind: "INVALID_INPUT",
            reason: "WORKER_ID"
        });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({ workerId: "worker-1", jobType: "UNKNOWN" as never })
        ).resolves.toEqual({
            kind: "INVALID_INPUT",
            reason: "JOB_TYPE"
        });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });
});

class ProgressStoreFake implements JobProgressStore {
    readonly commands: JobProgressCommand[] = [];
    result: JobProgress = {
        kind: "UPDATED",
        stage: "DETECTING",
        progressPercent: 40,
        heartbeatAt: "2026-08-29T00:00:00.000Z",
        leaseUntil: "2026-08-29T00:00:30.000Z",
    };

    // 검증용 진행 구성
    async progress(command: JobProgressCommand): Promise<JobProgress> {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 입력 조건 결과 반환
        return this.result;
    }
}

describe("progress", () => {
    it("hashes the lease token and records a bounded progress update", async () => {
        // 진행 상태 저장 실행
        const repository = new ProgressStoreFake();
        // 해시계산기 시험 입력으로 해시 자료 생성
        const hasher = { sha256: async () => Uint8Array.from([1, 2, 3]) };
        // 진행률 결과를 결과에 저장
        const result = await progress({ clock, hasher, repository, leaseMs: 30_000 })({
            jobId: "11111111-1111-4111-8111-111111111111",
            workerId: "video-worker-1",
            jobRevision: 2,
            leaseToken: "lease-token",
            stage: "DETECTING",
            progressPercent: 40,
            message: "candidate scan",
        });

        // 결과의 저장소 결과 기준 구조 일치 확인
        expect(result).toEqual(repository.result);
        // 저장소 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.commands).toEqual([{
            jobId: "11111111-1111-4111-8111-111111111111",
            workerId: "video-worker-1",
            jobRevision: 2,
            leaseTokenHash: Uint8Array.from([1, 2, 3]),
            stage: "DETECTING",
            progressPercent: 40,
            now: "2026-08-29T00:00:00.000Z",
            leaseUntil: "2026-08-29T00:00:30.000Z",
            message: "candidate scan",
        }]);
    });

    it("rejects an invalid lease or progress before the repository", async () => {
        // 잘못된 진행 상태 실행
        const repository = new ProgressStoreFake();
        // 작업 시험용 진행률 결과 준비
        const operation = progress({
            clock,
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository,
            leaseMs: 30_000,
        });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(operation({
            jobId: "bad",
            workerId: "worker-1",
            jobRevision: 1,
            leaseToken: "token",
            stage: "DETECTING",
            progressPercent: 40,
        })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "JOB_ID" });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(operation({
            jobId: "11111111-1111-4111-8111-111111111111",
            workerId: "worker-1",
            jobRevision: 1,
            leaseToken: "token",
            stage: "DETECTING",
            progressPercent: 101,
        })).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PROGRESS" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });
});

class ResultStoreFake implements JobResultStore {
    readonly commands: JobResultCommand[] = [];
    response: JobResult = { kind: "ACCEPTED" };

    // 검증용 결과 구성
    async result(command: JobResultCommand): Promise<JobResult> {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 입력 조건 응답 반환
        return this.response;
    }
}

class PerceptionResultStore extends ResultStoreFake {
    readonly preflightCommands: JobResultPreflightCommand[] = [];
    preflightResponse: JobResultPreflight = {
        kind: "AUTHORIZED",
        analysisId: PERCEPTION_ANALYSIS_ID,
        sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
        analysisSourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
        expiresAt: "2026-09-04T00:00:00.000Z",
        // 경기와 연결된 규정 판본의 검증 맥락 구성
        ruleEdition: { id: "44444444-4444-4444-8444-444444444444", verificationStatus: "VERIFIED",
            matchId: "33333333-3333-4333-8333-333333333333", ifabEdition: "2026-27" },
    };

    // 검증용 제출 전 검사 구성
    async preflight(command: JobResultPreflightCommand): Promise<JobResultPreflight> {
        // 입력 조건 사전점검 명령목록 추가 결과 처리 수행
        this.preflightCommands.push(command);
        // 입력 조건 사전점검 응답객체 반환
        return this.preflightResponse;
    }
}

class ResultStorage {
    readonly calls: Array<{ objectKey: string; maxSizeBytes?: number }> = [];
    readonly heads = new Map([
        [
            `perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${PERCEPTION_ARTIFACT_SHA256}.jsonl.gz`,
            {
                sizeBytes: 1_024,
                contentSha256: Uint8Array.from(Buffer.from(PERCEPTION_ARTIFACT_SHA256, "hex"))
            }
        ],
        [
            `evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.jpg`,
            {
                sizeBytes: 2_048,
                contentSha256: Uint8Array.from(Buffer.from(PERCEPTION_EVIDENCE_SHA256, "hex"))
            }
        ],
        [
            `evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.mp4`,
            { sizeBytes: 4_096, contentSha256: Uint8Array.from(Buffer.from("d".repeat(64), "hex")) }
        ]
    ]);

    // 검증용 메타데이터 구성
    async head(objectKey: string, maxSizeBytes?: number) {
        // 입력 조건 호출기록 추가 결과 처리 수행
        this.calls.push({ objectKey, ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }) });
        // 입력 조건 메타정보목록 조회 결과 비교 조건 반환
        return this.heads.get(objectKey) ?? null;
    }
}

describe("result", () => {
    it.each(["ARTIFACT", "REFERENCE"])("does not record a normal %s rejection as an exception", async (reason) => {
        // 정상 파일 검증 거부와 진단 수집 준비
        const storage = new ResultStorage();
        const payload = perceptionPayload();
        const diagnostic = vi.fn();
        // 오류 발생 없이 파일 누락을 반환하는 저장소 구성
        storage.heads.delete(reason === "ARTIFACT"
            ? payload.perception!.artifact.objectKey
            : payload.evidence![0]!.objectKey);
        // 파일 누락은 기존 거부 사유로 반환되는지 확인
        await expect(result({
            clock,
            storage,
            repository: new PerceptionResultStore(),
            hasher: { sha256: async () => new Uint8Array(32) },
            diagnostic
        })({
            jobId: PERCEPTION_JOB_ID,
            workerId: "worker-1",
            jobRevision: 2,
            leaseToken: "private-token",
            payload
        })).resolves.toEqual({ kind: "INVALID_RESULT", reason });
        // 정상 거부에 내부 예외 진단이 생성되지 않는지 확인
        expect(diagnostic).not.toHaveBeenCalled();
    });

    it.each(["success", "throw", "reject", "pending"])(
        "records only safe metadata for storage exceptions when the diagnostic sink ends with %s",
        async (mode) => {
            // 실제 객체 읽기 예외와 진단 기능 준비
            const storage = new ResultStorage();
            storage.head = async () => { throw new Error("private-object-key-token"); };
            const diagnostic = vi.fn(() => {
                // 진단 전송 실패의 두 형태 구성
                if (mode === "throw") throw new Error("private-diagnostic");
                if (mode === "reject") return Promise.reject(new Error("private-diagnostic"));
                // 끝나지 않는 비동기 진단이 결과를 막지 않는지 확인
                if (mode === "pending") return new Promise<void>(() => {});
            });
            // 원본 저장소 실패의 공개 계약 유지 확인
            await expect(result({
                clock,
                storage,
                repository: new PerceptionResultStore(),
                hasher: { sha256: async () => new Uint8Array(32) },
                diagnostic
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "worker-1",
                jobRevision: 2,
                leaseToken: "private-token",
                payload: perceptionPayload()
            })).resolves.toEqual({ kind: "INVALID_RESULT", reason: "STORAGE" });
            // 원문과 파일 경로 및 오류를 제외한 진단 단일 호출 확인
            expect(diagnostic).toHaveBeenCalledExactlyOnceWith({
                stage: "OBJECTS",
                jobId: PERCEPTION_JOB_ID,
                jobRevision: 2
            });
        }
    );

    it.each(["PREFLIGHT", "ADMISSION", "EVALUATION", "PERSISTENCE", "ASYNC_PERSISTENCE"])(
        "preserves the original %s exception and records only private stage metadata",
        async (stage) => {
            // 단계별 실패와 비공개 진단 수집 준비
            const error = new Error("private token object key payload");
            const repository = new PerceptionResultStore();
            const storage = new ResultStorage();
            const diagnostic = vi.fn();
            const save = vi.spyOn(repository, "result");
            // 검사와 평가 및 저장 단계의 독립 예외 구성
            if (stage === "PREFLIGHT") {
                vi.spyOn(repository, "preflight").mockRejectedValue(error);
            }
            if (stage === "EVALUATION") {
                vi.spyOn(automatic, "automaticReview").mockImplementation(() => { throw error; });
            }
            // 관측 채택 단계의 실패 구성
            if (stage === "ADMISSION") {
                vi.spyOn(rules, "perceptionAdmission").mockImplementation(() => { throw error; });
            }
            if (stage === "PERSISTENCE") save.mockImplementation(() => { throw error; });
            if (stage === "ASYNC_PERSISTENCE") save.mockRejectedValue(error);
            // 실패 이전 원본 예외와 진단 자료 범위 확인
            try {
                await expect(result({
                    clock,
                    repository,
                    storage,
                    hasher: { sha256: async () => new Uint8Array(32) },
                    diagnostic
                })({
                    jobId: PERCEPTION_JOB_ID,
                    workerId: "worker-1",
                    jobRevision: 2,
                    leaseToken: "private-token",
                    payload: perceptionPayload()
                })).rejects.toBe(error);
                expect(diagnostic).toHaveBeenCalledExactlyOnceWith({
                    stage: stage === "ASYNC_PERSISTENCE" ? "PERSISTENCE" : stage,
                    jobId: PERCEPTION_JOB_ID,
                    jobRevision: 2
                });
                if (stage === "PREFLIGHT") expect(storage.calls).toHaveLength(0);
                if (["PREFLIGHT", "ADMISSION", "EVALUATION"].includes(stage)) {
                    expect(save).not.toHaveBeenCalled();
                }
            } finally {
                // 다른 시험에 영향을 주는 평가 교체 복원
                vi.restoreAllMocks();
            }
        }
    );

    it.each([false, true])("does not mask persistence errors when diagnostics fail asynchronously %s", async (asyncFailure) => {
        // 저장 실패와 진단 실패의 독립 예외 준비
        const error = new Error("persistence");
        const repository = new PerceptionResultStore();
        repository.result = async () => { throw error; };
        const diagnostic = vi.fn(() => {
            // 진단 전송 실패를 동기 및 비동기 형태로 재현
            if (asyncFailure) return Promise.reject(new Error("diagnostic"));
            throw new Error("diagnostic");
        });
        // 진단 예외보다 원래 저장 예외가 유지되는지 확인
        await expect(result({
            clock,
            repository,
            storage: new ResultStorage(),
            hasher: { sha256: async () => new Uint8Array(32) },
            diagnostic
        })({
            jobId: PERCEPTION_JOB_ID,
            workerId: "worker-1",
            jobRevision: 2,
            leaseToken: "private-token",
            payload: perceptionPayload()
        })).rejects.toBe(error);
        // 실제 호출된 진단 기능의 오류가 격리되었는지 확인
        expect(diagnostic).toHaveBeenCalledOnce();
    });

    it.each([perceptionPayload, avPerceptionPayload])("keeps successful commands and API responses private for %s", async (build) => {
        // 실제 유스케이스와 응답 계층을 연결할 자료 준비
        const repository = new PerceptionResultStore();
        const diagnostic = vi.fn();
        const payload = build();
        const original = structuredClone(payload);
        const operation = result({
            clock,
            repository,
            storage: new ResultStorage(),
            hasher: { sha256: async () => Uint8Array.from([1]) },
            diagnostic
        });
        // 실제 인증과 요청 변환을 통과한 결과 응답 생성
        const output = await response(new Request("http://localhost/internal/jobs/result", {
            method: "POST",
            headers: { "x-worker-key": "key", "x-worker-protocol": WORKER_PROTOCOL },
            body: JSON.stringify({ workerId: " worker-1 ", jobRevision: 2, leaseToken: "secret", payload })
        }), { jobId: PERCEPTION_JOB_ID }, {
            key: "key",
            result: operation,
            claim: async () => null,
            progress: async () => ({ kind: "NOT_FOUND" }),
            evidence: async () => ({ kind: "NOT_FOUND" })
        });
        // 공개 응답은 내부 단계와 자료 없이 기존 성공 계약 유지
        expect(output.status).toBe(200);
        expect(await output.json()).toEqual({ kind: "ACCEPTED" });
        expect(diagnostic).not.toHaveBeenCalled();
        // 저장 명령의 기본 식별자와 원본 자료 및 시간 계약 확인
        expect(repository.commands).toHaveLength(1);
        expect(repository.commands[0]).toMatchObject({
            jobId: PERCEPTION_JOB_ID,
            workerId: "worker-1",
            jobRevision: 2,
            leaseTokenHash: Uint8Array.from([1]),
            now: NOW.toISOString(),
            payload: original,
            perceptionVerification: { analysisId: PERCEPTION_ANALYSIS_ID }
        });
        expect(repository.commands[0]?.automaticReview).toBeDefined();
        expect(payload).toEqual(original);
    });

    it("automatically reviews verified local output without trusting Worker facts or completion claims", async () => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 전송자료 시험용 인식전송자료 결과 준비
        const payload = perceptionPayload();
        // 작업 시험용 결과 준비
        const operation = result({
            clock,
            repository,
            storage: new ResultStorage(),
            hasher: { sha256: async () => Uint8Array.from([1, 2, 3]) }
        });
        // 작업 결과의 종류 접수완료 자료 기준 구조 일치 확인
        expect(
            await operation({
                jobId: PERCEPTION_JOB_ID,
                workerId: "worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: { ...payload, automaticReview: { evaluatedCount: 999 } } as never
            })
        ).toEqual({ kind: "ACCEPTED" });
        // 저장소 명령목록 중 선택 항목의 자동규정평가 항목 존재 확인
        expect(repository.commands[0]).toHaveProperty("automaticReview");
        // 평가 보류 내용을 포함한 기대 결과 일치 확인
        expect(repository.commands[0]).toMatchObject({
            automaticReview: {
                analysisId: PERCEPTION_ANALYSIS_ID,
                jobId: PERCEPTION_JOB_ID,
                jobRevision: 2,
                sourceSha256: PERCEPTION_SOURCE_SHA256,
                evaluatedCount: 0,
                blockedCount: 1,
                rows: [{ status: "BLOCKED", facts: null, result: null }]
            }
        });
    });
    it("preflights and verifies both visual and audio-associated references for a v2 run", async () => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 저장공간 시험용 결과 저장공간 준비
        const storage = new ResultStorage();
        // 전송자료 시험용 인식 전송자료 결과 준비
        const payload = avPerceptionPayload();
        // 결과 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 저장공간 호출기록 항목변환 결과의 전송자료 근거 중 선택 항목 객체 키 포함 확인
        expect(storage.calls.map((item) => item.objectKey)).toContain(
            payload.evidence![1]!.objectKey
        );
        // 음향 단서 방법 미검증 및 시청각 연결 미검증 및 발화 미분석 조건을 포함한 기대 결과 일치 확인
        expect(repository.commands[0]?.perceptionVerification?.admission.reasons).toEqual(
            expect.arrayContaining([
                "AUDIO_CUE_METHOD_NOT_VERIFIED",
                "AUDIOVISUAL_ASSOCIATION_NOT_VERIFIED",
                "SPEECH_NOT_ANALYZED"
            ])
        );
    });

    it.each([
        [
            "v1 pipeline with v2 schema",
            () => ({ ...avPerceptionPayload(), pipelineVersion: "video-local-observers-v1" })
        ],
        [
            "v2 pipeline with v1 schema",
            () => ({ ...perceptionPayload(), pipelineVersion: "video-local-observers-av-v1" })
        ],
        [
            "v2 pipeline without audio",
            () => {
                // 전송자료 시험용 깊은복사 결과 준비
                const payload = structuredClone(avPerceptionPayload()) as any;
                // 입력 조건 처리 수행
                delete payload.perception.audio;
                // 전송자료 반환
                return payload;
            }
        ]
    ])("rejects %s before preflight", async (_name, build) => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage: new ResultStorage()
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: build()
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" });
        // 저장소 사전점검 명령목록의 항목 수 0 확인
        expect(repository.preflightCommands).toHaveLength(0);
    });

    it("rejects a wrong-hash audio clip before repository write", async () => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 저장공간 시험용 결과 저장공간 준비
        const storage = new ResultStorage();
        // 저장공간 메타정보목록 묶음 결과 처리 수행
        storage.heads.set(avPerceptionPayload().evidence![1]!.objectKey, {
            sizeBytes: 4_096,
            contentSha256: Uint8Array.from(Buffer.from("e".repeat(64), "hex"))
        });
        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: avPerceptionPayload()
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "REFERENCE" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });
    it("hashes the lease token and submits validated video metadata", async () => {
        // 검증 결과 저장 실행
        const repository = new ResultStoreFake();
        // 작업 시험용 결과 준비
        const operation = result({
            clock,
            hasher: { sha256: async () => Uint8Array.from([1, 2, 3]) },
            repository
        });

        // 작업 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: " video-worker-1 ",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: {
                    kind: "VALIDATED",
                    durationMs: 90_000,
                    width: 1920,
                    height: 1080
                }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 저장소 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.commands).toEqual([
            {
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseTokenHash: Uint8Array.from([1, 2, 3]),
                now: NOW.toISOString(),
                payload: {
                    kind: "VALIDATED",
                    durationMs: 90_000,
                    width: 1920,
                    height: 1080
                }
            }
        ]);
    });

    it("submits a nonretryable worker failure", async () => {
        // 저장소 시험용 결과 저장소 모의 준비
        const repository = new ResultStoreFake();
        // 작업 시험용 결과 준비
        const operation = result({
            clock,
            hasher: { sha256: async () => Uint8Array.from([4, 5, 6]) },
            repository
        });

        // 관측이나 처리 실패의 저장 접수 성공이며 파울 판정 승인과 별개임 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: {
                    kind: "FAILED",
                    failureCode: "UNSUPPORTED_CODEC",
                    retryable: false
                }
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 처리 실패 및 지원하지 않는 코덱 내용을 포함한 기대 결과 일치 확인
        expect(repository.commands[0]?.payload).toEqual({
            kind: "FAILED",
            failureCode: "UNSUPPORTED_CODEC",
            retryable: false
        });
    });

    it("submits baseline analysis shots and candidates", async () => {
        // 저장소 시험용 결과 저장소 모의 준비
        const repository = new ResultStoreFake();
        // 작업 시험용 결과 준비
        const operation = result({
            clock,
            hasher: { sha256: async () => Uint8Array.from([7, 8, 9]) },
            repository
        });
        // 전송자료 시험 입력으로 종류 및 파이프라인 버전 영상 기준자료 및 한계목록 및 샷목록 자료 생성
        const payload = {
            kind: "ANALYZED" as const,
            pipelineVersion: "video-baseline-v1",
            limitations: ["incident_category_classification_pending"],
            shots: [
                {
                    index: 0,
                    startMs: 0,
                    endMs: 4000,
                    playbackSpeed: "UNKNOWN" as const,
                    isReplay: false,
                    cameraAngle: null
                }
            ],
            candidates: [
                {
                    index: 1,
                    category: "OTHER" as const,
                    startMs: 500,
                    endMs: 1500,
                    anchorMs: 1000,
                    confidence: 0.42,
                    cameraSufficiency: "MEDIUM" as const,
                    reasons: ["motion-spike"],
                    shotIndices: [0]
                }
            ]
        };

        // 작업 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });
        // 저장소 명령목록 중 선택 항목 전송자료의 전송자료 기준 구조 일치 확인
        expect(repository.commands[0]?.payload).toEqual(payload);
    });

    it("requires a perception run from the local observers pipeline", async () => {
        // 저장소 시험용 결과 저장소 모의 준비
        const repository = new ResultStoreFake();
        // 작업 시험용 결과 준비
        const operation = result({
            clock,
            hasher: { sha256: async () => Uint8Array.from([7, 8, 9]) },
            repository
        });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: {
                    kind: "ANALYZED",
                    pipelineVersion: "video-local-observers-v1",
                    limitations: [],
                    shots: [],
                    candidates: [],
                    evidence: []
                }
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });

    it.each([
        [
            "shot index",
            (payload: any) => {
                // 전송자료 샷목록 추가 결과 처리 수행
                payload.shots.push({ ...payload.shots[0] });
            }
        ],
        [
            "candidate index",
            (payload: any) => {
                // 전송자료 후보목록 추가 결과 처리 수행
                payload.candidates.push({ ...payload.candidates[0] });
            }
        ],
        [
            "evidence object key",
            (payload: any) => {
                // 전송자료 근거 추가 결과 처리 수행
                payload.evidence.push({ ...payload.evidence[0] });
            }
        ]
    ])("rejects duplicate %s values before perception preflight", (_name, duplicate) => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 전송자료 시험용 깊은복사 결과 준비
        const payload = structuredClone(perceptionPayload()) as any;
        // 중복 제출 조건을 만들도록 전송자료 변경
        duplicate(payload);
        // 시험자료 결과 후속처리 결과 반환
        return expect(
            result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage: new ResultStorage()
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload
            })
        )
            .resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" })
            .then(() => {
                // 저장소 사전점검 명령목록의 항목 수 0 확인
                expect(repository.preflightCommands).toHaveLength(0);
            });
    });

    it.each([
        { expectedSamples: 0, processedSamples: 0, failedSamples: 0 },
        { expectedSamples: 3, processedSamples: 3, failedSamples: 0 }
    ])("rejects invalid observer sampling arithmetic before preflight %j", async (coverage) => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 전송자료 시험용 깊은복사 결과 준비
        const payload = structuredClone(perceptionPayload()) as any;
        // 객체 결과 처리 수행
        Object.assign(payload.perception.coverage, coverage);
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage: new ResultStorage()
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" });
        // 저장소 사전점검 명령목록의 항목 수 0 확인
        expect(repository.preflightCommands).toHaveLength(0);
    });

    it("preflights the lease and source, verifies private objects, refreshes the clock and submits no facts", async () => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 저장공간 시험용 결과 저장공간 준비
        const storage = new ResultStorage();
        // 시험자료 시험용 2개 항목 목록 준비
        const times = [new Date("2026-09-03T00:00:00.000Z"), new Date("2026-09-03T00:00:05.000Z")];
        // 작업 시험용 결과 준비
        const operation = result({
            clock: { now: () => times.shift()! },
            hasher: { sha256: async () => Uint8Array.from([7, 8, 9]) },
            repository,
            storage
        });

        // 작업 결과의 종류 접수완료 자료 기준 구조 일치 확인
        await expect(
            operation({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: perceptionPayload()
            })
        ).resolves.toEqual({ kind: "ACCEPTED" });

        // 저장소 사전점검 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.preflightCommands).toEqual([
            {
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseTokenHash: Uint8Array.from([7, 8, 9]),
                now: "2026-09-03T00:00:00.000Z"
            }
        ]);
        // 저장공간 호출기록의 2개 항목 목록 기준 구조 일치 확인
        expect(storage.calls).toEqual([
            {
                objectKey: `perception/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/2/${PERCEPTION_ARTIFACT_SHA256}.jsonl.gz`,
                maxSizeBytes: 128 * 1_024 * 1_024
            },
            {
                objectKey: `evidence/${PERCEPTION_ANALYSIS_ID}/${PERCEPTION_JOB_ID}/candidate-0001.jpg`,
                maxSizeBytes: 50 * 1_024 * 1_024
            }
        ]);
        // 규정 입력 채택 거부 조건을 포함한 기대 결과 일치 확인
        expect(repository.commands[0]).toMatchObject({
            now: "2026-09-03T00:00:05.000Z",
            perceptionVerification: {
                analysisId: PERCEPTION_ANALYSIS_ID,
                sourceSha256: Uint8Array.from(Buffer.from(PERCEPTION_SOURCE_SHA256, "hex")),
                admission: { status: "NOT_ADMITTED" }
            }
        });
        // 저장소 명령목록 중 선택 항목의 사실 항목 없음 확인
        expect(repository.commands[0]).not.toHaveProperty("facts");
    });

    it("returns INVALID_RESULT without object access when the authoritative source is unavailable or different", async () => {
        // 2개 항목 목록의 각 사례 순회
        for (const sourceSha256 of [
            Uint8Array.from([1]),
            Uint8Array.from(Buffer.from("d".repeat(64), "hex"))
        ]) {
            // 저장소 시험용 인식 결과 저장소 준비
            const repository = new PerceptionResultStore();
            // 저장소 사전점검 응답객체를 기존 항목 및 원본 해시 자료로 설정
            repository.preflightResponse = {
                ...repository.preflightResponse,
                sourceSha256
            } as JobResultPreflight;
            // 저장공간 시험용 결과 저장공간 준비
            const storage = new ResultStorage();
            // 작업 시험용 결과 준비
            const operation = result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage
            });
            // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
            await expect(
                operation({
                    jobId: PERCEPTION_JOB_ID,
                    workerId: "video-worker-1",
                    jobRevision: 2,
                    leaseToken: "lease-token",
                    payload: perceptionPayload()
                })
            ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
            // 저장공간 호출기록의 항목 수 0 확인
            expect(storage.calls).toHaveLength(0);
            // 저장소 명령목록의 항목 수 0 확인
            expect(repository.commands).toHaveLength(0);
        }
    });

    it("rejects missing, oversized, size-mismatched or hash-mismatched private objects without throwing", async () => {
        // 시험자료 시험용 6개 항목 목록 준비
        const cases = [
            [
                "artifact missing",
                (storage: ResultStorage) =>
                    storage.heads.delete(perceptionPayload().perception!.artifact.objectKey)
            ],
            [
                "artifact wrong size",
                (storage: ResultStorage) =>
                    storage.heads.set(perceptionPayload().perception!.artifact.objectKey, {
                        sizeBytes: 2_048,
                        contentSha256: Uint8Array.from(
                            Buffer.from(PERCEPTION_ARTIFACT_SHA256, "hex")
                        )
                    })
            ],
            [
                "artifact wrong hash",
                (storage: ResultStorage) =>
                    storage.heads.set(perceptionPayload().perception!.artifact.objectKey, {
                        sizeBytes: 1_024,
                        contentSha256: Uint8Array.from(Buffer.from("d".repeat(64), "hex"))
                    })
            ],
            [
                "artifact short checksum",
                (storage: ResultStorage) =>
                    storage.heads.set(perceptionPayload().perception!.artifact.objectKey, {
                        sizeBytes: 1_024,
                        contentSha256: Uint8Array.from([1, 2, 3])
                    })
            ],
            [
                "reference missing",
                (storage: ResultStorage) =>
                    storage.heads.delete(perceptionPayload().evidence![0]!.objectKey)
            ],
            [
                "reference wrong hash",
                (storage: ResultStorage) =>
                    storage.heads.set(perceptionPayload().evidence![0]!.objectKey, {
                        sizeBytes: 2_048,
                        contentSha256: Uint8Array.from(Buffer.from("d".repeat(64), "hex"))
                    })
            ]
        ] as const;
        // 시험자료의 각 사례 순회
        for (const [_name, change] of cases) {
            // 저장소 시험용 인식 결과 저장소 준비
            const repository = new PerceptionResultStore();
            // 저장공간 시험용 결과 저장공간 준비
            const storage = new ResultStorage();
            // 변경 결과 처리 수행
            change(storage);
            // 작업 시험용 결과 준비
            const operation = result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage
            });
            // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
            await expect(
                operation({
                    jobId: PERCEPTION_JOB_ID,
                    workerId: "video-worker-1",
                    jobRevision: 2,
                    leaseToken: "lease-token",
                    payload: perceptionPayload()
                })
            ).resolves.toMatchObject({ kind: "INVALID_RESULT" });
            // 저장소 명령목록의 항목 수 0 확인
            expect(repository.commands).toHaveLength(0);
        }

        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 저장공간 시험용 결과 저장공간 준비
        const storage = new ResultStorage();
        // 저장공간 메타정보를 시험 동작 함수 값으로 설정
        storage.head = async () => {
            // 오류객체 예외 전달
            throw new Error("object store unavailable");
        };
        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: perceptionPayload()
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "STORAGE" });
    });

    it("returns lease preflight failures before private object verification", async () => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 저장소 사전점검 응답객체를 종류 임대 자료로 설정
        repository.preflightResponse = { kind: "STALE_LEASE" };
        // 저장공간 시험용 결과 저장공간 준비
        const storage = new ResultStorage();
        // 만료되거나 교체된 작업 임대 내용을 포함한 기대 결과 일치 확인
        await expect(
            result({
                clock,
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: perceptionPayload()
            })
        ).resolves.toEqual({ kind: "STALE_LEASE" });
        // 저장공간 호출기록의 항목 수 0 확인
        expect(storage.calls).toHaveLength(0);
    });

    it("rejects a run whose private retention expires during object verification", async () => {
        // 저장소 시험용 인식 결과 저장소 준비
        const repository = new PerceptionResultStore();
        // 저장소 사전점검 응답객체를 기존 항목 및 만료시각 시점 2026 09 00 04 자료로 설정
        repository.preflightResponse = {
            ...repository.preflightResponse,
            expiresAt: "2026-09-03T00:00:04.000Z"
        } as JobResultPreflight;
        // 저장공간 시험용 결과 저장공간 준비
        const storage = new ResultStorage();
        // 시험자료 시험용 2개 항목 목록 준비
        const times = [new Date("2026-09-03T00:00:00.000Z"), new Date("2026-09-03T00:00:05.000Z")];
        // 결과 자료 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            result({
                clock: { now: () => times.shift()! },
                hasher: { sha256: async () => Uint8Array.from([1]) },
                repository,
                storage
            })({
                jobId: PERCEPTION_JOB_ID,
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: perceptionPayload()
            })
        ).resolves.toEqual({ kind: "INVALID_RESULT", reason: "SOURCE" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });

    it("rejects malformed completion data before the repository", async () => {
        // 저장소 시험용 결과 저장소 모의 준비
        const repository = new ResultStoreFake();
        // 작업 시험용 결과 준비
        const operation = result({
            clock,
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository
        });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                jobId: "bad",
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: {
                    kind: "VALIDATED",
                    durationMs: 0,
                    width: 1920,
                    height: 1080
                }
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "JOB_ID" });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "video-worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                payload: {
                    kind: "VALIDATED",
                    durationMs: 0,
                    width: 1920,
                    height: 1080
                }
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "PAYLOAD" });

        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });
});
