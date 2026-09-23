import { describe, expect, it } from "vitest";
import {
    analysis,
    type Clock,
    type Hasher,
    type AnalysisCommand,
    type AnalysisInput,
    type AnalysisPolicy,
    type AnalysisStore,
    type AnalysisResult
} from "@replay/application";

// 익명 세션 식별자 시험용 11111111 1111 4111 8111 111111111111 준비
const ANONYMOUS_SESSION_ID = "11111111-1111-4111-8111-111111111111";
// 영상 자산 식별자 시험용 22222222 2222 4222 8222 222222222222 준비
const VIDEO_ASSET_ID = "22222222-2222-4222-8222-222222222222";
// 경기 식별자 시험용 33333333 3333 4333 8333 333333333333 준비
const MATCH_ID = "33333333-3333-4333-8333-333333333333";
// 분석 식별자 시험용 44444444 4444 4444 8444 444444444444 준비
const ANALYSIS_ID = "44444444-4444-4444-8444-444444444444";
// 현재시각 시험용 날짜 준비
const FIXED_NOW = new Date("2026-08-23T00:00:00.000Z");

// 키 해시 시험용 바이트배열 변환 결과 준비
const KEY_HASH = Uint8Array.from([1, 2, 3]);
// 요청 해시 시험용 바이트배열 변환 결과 준비
const REQUEST_HASH = Uint8Array.from([4, 5, 6]);

// 정책 시험용 입력 조건 준비
const POLICY = {
    retentionMs: 86_400_000,
    pipelineVersion: "pipeline-v3",
    mediaPolicyVersion: "media-v2",
    jobPayloadVersion: 7,
    maxJobAttempts: 4,
} satisfies AnalysisPolicy;

// 유효 입력 시험용 입력 조건 준비
const VALID_INPUT = {
    anonymousSessionId: ANONYMOUS_SESSION_ID,
    videoAssetId: VIDEO_ASSET_ID,
    matchId: MATCH_ID,
    idempotencyKey: "raw-idempotency-key",
    sourceUrl: "https://example.com/replay.mp4",
    sourcePlatform: "Example Sports",
} satisfies AnalysisInput;

class HashFake implements Hasher {
    readonly inputs: string[] = [];

    constructor(private readonly outputs: readonly Uint8Array[] = [KEY_HASH, REQUEST_HASH]) {}

    // 검증용 보안 해시 구성
    async sha256(value: string): Promise<Uint8Array> {
        // 출력 시험용 입력 조건 중 선택 항목 준비
        const output = this.outputs[this.inputs.length];
        // 입력 조건 입력목록 추가 결과 처리 수행
        this.inputs.push(value);

        // 출력 비교 조건에 따른 처리 경로 분기
        if (output === undefined) {
            // 오류객체 예외 전달
            throw new Error("No hash output configured for input");
        }

        // 출력 반환
        return output;
    }
}

class AnalysisStoreFake implements AnalysisStore {
    readonly commands: AnalysisCommand[] = [];

    constructor(private readonly result: AnalysisResult) {}

    // 검증용 제출 구성
    async submission(command: AnalysisCommand): Promise<AnalysisResult> {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 입력 조건 결과 반환
        return this.result;
    }
}

// 검증용 시험 환경 구성
const harness = (
    repositoryResult: AnalysisResult = { kind: "CREATED", analysisId: ANALYSIS_ID },
) => {
    // 저장소 시험용 분석 저장소 모의 준비
    const repository = new AnalysisStoreFake(repositoryResult);
    // 해시계산기 시험용 해시 모의 준비
    const hasher = new HashFake();
    // 시계 시험 입력으로 현재시각 자료 생성
    const clock: Clock = { now: () => FIXED_NOW };
    // 분석 실행 시험용 분석 결과 준비
    const analysisRun = analysis({ repository, hasher, clock, policy: POLICY });

    // 해시계산기 및 저장소 및 분석 실행 자료 반환
    return { hasher, repository, analysisRun };
};

describe("analysis", () => {
    it("builds the complete repository command with the current time and retention expiry", async () => {
        // 저장소 분석 실행 시험용 시험자료 결과 준비
        const { repository, analysisRun } = harness();

        // 분석 실행 결과를 결과에 저장
        const result = await analysisRun(VALID_INPUT);

        // 결과의 종류 생성완료 및 분석 식별자 자료 기준 구조 일치 확인
        expect(result).toEqual({ kind: "CREATED", analysisId: ANALYSIS_ID });
        // 저장소 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.commands).toEqual([
            {
                anonymousSessionId: ANONYMOUS_SESSION_ID,
                videoAssetId: VIDEO_ASSET_ID,
                matchId: MATCH_ID,
                sourceUrl: "https://example.com/replay.mp4",
                sourcePlatform: "Example Sports",
                keyHash: KEY_HASH,
                requestHash: REQUEST_HASH,
                createdAt: "2026-08-23T00:00:00.000Z",
                expiresAt: "2026-08-24T00:00:00.000Z",
                pipelineVersion: "pipeline-v3",
                mediaPolicyVersion: "media-v2",
                jobPayloadVersion: 7,
                maxJobAttempts: 4
            }
        ]);
        // 저장소 명령목록 중 선택 항목 키 해시의 바이트배열 자료형 일치 확인
        expect(repository.commands[0]?.keyHash).toBeInstanceOf(Uint8Array);
        // 저장소 명령목록 중 선택 항목 요청해시의 바이트배열 자료형 일치 확인
        expect(repository.commands[0]?.requestHash).toBeInstanceOf(Uint8Array);
    });

    it("hashes the raw key and exact fixed-order normalized request JSON", async () => {
        // 해시계산기 분석 실행 시험용 시험자료 결과 준비
        const { hasher, analysisRun } = harness();

        // 분석 실행 결과 처리 수행
        await analysisRun({
            ...VALID_INPUT,
            sourceUrl: "  https://example.com/source  ",
            sourcePlatform: "   "
        });

        // 해시계산기 입력목록의 2개 항목 목록 기준 구조 일치 확인
        expect(hasher.inputs).toEqual([
            "raw-idempotency-key",
            '{"anonymousSessionId":"11111111-1111-4111-8111-111111111111","videoAssetId":"22222222-2222-4222-8222-222222222222","matchId":"33333333-3333-4333-8333-333333333333","sourceUrl":"https://example.com/source","sourcePlatform":null,"pipelineVersion":"pipeline-v3","mediaPolicyVersion":"media-v2"}'
        ]);
    });

    it("canonicalizes uppercase UUID inputs before hashing and repository submission", async () => {
        // 해시계산기 저장소 분석 실행 시험용 시험자료 결과 준비
        const { hasher, repository, analysisRun } = harness();

        // 분석 실행 결과 처리 수행
        await analysisRun({
            ...VALID_INPUT,
            anonymousSessionId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
            videoAssetId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDE0",
            matchId: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDE1"
        });

        // 저장소 명령목록 중 선택 항목의 익명 세션 식별자 지정 문자열 및 영상 자산 식별자 지정 문자열 및 경기 식별자 지정 문자열 자료의 필드 일치 확인
        expect(repository.commands[0]).toMatchObject({
            anonymousSessionId: "abcdefab-cdef-4abc-8def-abcdefabcdef",
            videoAssetId: "abcdefab-cdef-4abc-8def-abcdefabcde0",
            matchId: "abcdefab-cdef-4abc-8def-abcdefabcde1"
        });
        // 해시계산기 입력목록 중 선택 항목의 기대값 익명 세션 식별자 영상 자산 식별자 경기 식별자 원본 주소 재생 원본 파이프라인 버전 파이프라인 정책 버전 일치 확인
        expect(hasher.inputs[1]).toBe(
            '{"anonymousSessionId":"abcdefab-cdef-4abc-8def-abcdefabcdef","videoAssetId":"abcdefab-cdef-4abc-8def-abcdefabcde0","matchId":"abcdefab-cdef-4abc-8def-abcdefabcde1","sourceUrl":"https://example.com/replay.mp4","sourcePlatform":"Example Sports","pipelineVersion":"pipeline-v3","mediaPolicyVersion":"media-v2"}'
        );
    });

    it("uses one input and policy snapshot when dependencies mutate during hashing", async () => {
        // 변경가능 입력 시험 입력으로 기존 항목 자료 생성
        const mutableInput: {
            anonymousSessionId: string;
            videoAssetId: string;
            matchId: string;
            idempotencyKey: string;
            sourceUrl?: string;
            sourcePlatform?: string;
        } = { ...VALID_INPUT };
        // 변경가능 정책 시험 입력으로 기존 항목 자료 생성
        const mutablePolicy: {
            retentionMs: number;
            pipelineVersion: string;
            mediaPolicyVersion: string;
            jobPayloadVersion: number;
            maxJobAttempts: number;
        } = { ...POLICY };
        // 저장소 시험용 분석 저장소 모의 준비
        const repository = new AnalysisStoreFake({
            kind: "CREATED",
            analysisId: ANALYSIS_ID
        });
        // 해시 입력목록 시험용 0개 항목 목록 준비
        const hashInputs: string[] = [];
        // 해시 개수 시험용 0 준비
        let hashCallCount = 0;
        // 해시계산기 시험 입력으로 해시 자료 생성
        const hasher: Hasher = {
            sha256: async (value) => {
                // 해시 입력목록 추가 결과 처리 수행
                hashInputs.push(value);
                // 해시 개수를 1 값으로 설정
                hashCallCount += 1;

                // 해시 개수 비교 조건에 따른 처리 경로 분기
                if (hashCallCount === 1) {
                    // 비동기결과 경로해결 결과 처리 수행
                    await Promise.resolve();
                    // 변경가능 입력 익명 세션 식별자를 지정 문자열 값으로 설정
                    mutableInput.anonymousSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
                    // 변경가능 입력 영상 자산 식별자를 지정 문자열 값으로 설정
                    mutableInput.videoAssetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
                    // 변경가능 입력 경기 식별자를 지정 문자열 값으로 설정
                    mutableInput.matchId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
                    // 변경가능 입력 멱등성 키를 키 값으로 설정
                    mutableInput.idempotencyKey = "mutated-key";
                    // 변경가능 입력 출처주소를 원본 값으로 설정
                    mutableInput.sourceUrl = "https://mutated.example/source";
                    // 변경가능 입력 원본을 지정 문자열 값으로 설정
                    mutableInput.sourcePlatform = "Mutated Platform";
                    // 변경가능 정책 시각을 1 값으로 설정
                    mutablePolicy.retentionMs = 1;
                    // 변경가능 정책 파이프라인 버전을 파이프라인 값으로 설정
                    mutablePolicy.pipelineVersion = "mutated-pipeline";
                    // 변경가능 정책 정책 버전을 정책 값으로 설정
                    mutablePolicy.mediaPolicyVersion = "mutated-media-policy";
                    // 변경가능 정책 작업 전송자료 버전을 99 값으로 설정
                    mutablePolicy.jobPayloadVersion = 99;
                    // 변경가능 정책 작업을 99 값으로 설정
                    mutablePolicy.maxJobAttempts = 99;
                }

                // 입력 조건 반환
                return hashCallCount === 1 ? KEY_HASH : REQUEST_HASH;
            }
        };
        // 분석 실행 시험용 분석 결과 준비
        const analysisRun = analysis({
            repository,
            hasher,
            clock: { now: () => FIXED_NOW },
            policy: mutablePolicy
        });

        // 분석 실행 결과 처리 수행
        await analysisRun(mutableInput);

        // 해시 입력목록의 2개 항목 목록 기준 구조 일치 확인
        expect(hashInputs).toEqual([
            "raw-idempotency-key",
            '{"anonymousSessionId":"11111111-1111-4111-8111-111111111111","videoAssetId":"22222222-2222-4222-8222-222222222222","matchId":"33333333-3333-4333-8333-333333333333","sourceUrl":"https://example.com/replay.mp4","sourcePlatform":"Example Sports","pipelineVersion":"pipeline-v3","mediaPolicyVersion":"media-v2"}'
        ]);
        // 저장소 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(repository.commands).toEqual([
            {
                anonymousSessionId: ANONYMOUS_SESSION_ID,
                videoAssetId: VIDEO_ASSET_ID,
                matchId: MATCH_ID,
                sourceUrl: "https://example.com/replay.mp4",
                sourcePlatform: "Example Sports",
                keyHash: KEY_HASH,
                requestHash: REQUEST_HASH,
                createdAt: "2026-08-23T00:00:00.000Z",
                expiresAt: "2026-08-24T00:00:00.000Z",
                pipelineVersion: "pipeline-v3",
                mediaPolicyVersion: "media-v2",
                jobPayloadVersion: 7,
                maxJobAttempts: 4
            }
        ]);
    });

    it("owns independent digest bytes when the hasher reuses its output buffer", async () => {
        // 저장소 시험용 분석 저장소 모의 준비
        const repository = new AnalysisStoreFake({
            kind: "CREATED",
            analysisId: ANALYSIS_ID
        });
        // 해시 시험용 바이트배열 준비
        const sharedDigest = new Uint8Array(3);
        // 해시 개수 시험용 0 준비
        let hashCallCount = 0;
        // 해시계산기 시험 입력으로 해시 자료 생성
        const hasher: Hasher = {
            sha256: async () => {
                // 해시 개수를 1 값으로 설정
                hashCallCount += 1;
                // 해시 묶음 결과 처리 수행
                sharedDigest.set(hashCallCount === 1 ? [1, 2, 3] : [4, 5, 6]);
                // 해시 반환
                return sharedDigest;
            }
        };
        // 분석 실행 시험용 분석 결과 준비
        const analysisRun = analysis({
            repository,
            hasher,
            clock: { now: () => FIXED_NOW },
            policy: POLICY
        });

        // 분석 실행 결과 처리 수행
        await analysisRun(VALID_INPUT);

        // 명령 시험용 저장소 명령목록 중 선택 항목 준비
        const command = repository.commands[0];
        // 명령 키 해시의 바이트배열 변환 결과 기준 구조 일치 확인
        expect(command?.keyHash).toEqual(Uint8Array.from([1, 2, 3]));
        // 명령 요청해시의 바이트배열 변환 결과 기준 구조 일치 확인
        expect(command?.requestHash).toEqual(Uint8Array.from([4, 5, 6]));
        // 명령 키 해시의 기대값 명령 요청해시 불일치 확인
        expect(command?.keyHash).not.toBe(command?.requestHash);

        // 해시 결과 처리 수행
        sharedDigest.fill(9);
        // 명령 키 해시의 바이트배열 변환 결과 기준 구조 일치 확인
        expect(command?.keyHash).toEqual(Uint8Array.from([1, 2, 3]));
        // 명령 요청해시의 바이트배열 변환 결과 기준 구조 일치 확인
        expect(command?.requestHash).toEqual(Uint8Array.from([4, 5, 6]));
    });

    it("trims optional strings and normalizes empty values to null", async () => {
        // 저장소 분석 실행 시험용 시험자료 결과 준비
        const { repository, analysisRun } = harness();

        // 분석 실행 결과 처리 수행
        await analysisRun({
            ...VALID_INPUT,
            sourceUrl: "  https://example.com/source  ",
            sourcePlatform: "   "
        });

        // 저장소 명령목록 중 선택 항목의 출처주소 원본 및 원본 빈 값 자료의 필드 일치 확인
        expect(repository.commands[0]).toMatchObject({
            sourceUrl: "https://example.com/source",
            sourcePlatform: null
        });
    });

    it("normalizes omitted optional strings to null", async () => {
        // 저장소 분석 실행 시험용 시험자료 결과 준비
        const { repository, analysisRun } = harness();
        // 입력 원본 시험용 입력 조건 준비
        const inputWithoutSource = {
            anonymousSessionId: ANONYMOUS_SESSION_ID,
            videoAssetId: VIDEO_ASSET_ID,
            matchId: MATCH_ID,
            idempotencyKey: "raw-idempotency-key"
        } satisfies AnalysisInput;

        // 분석 실행 결과 처리 수행
        await analysisRun(inputWithoutSource);

        // 저장소 명령목록 중 선택 항목의 출처주소 빈 값 및 원본 빈 값 자료의 필드 일치 확인
        expect(repository.commands[0]).toMatchObject({ sourceUrl: null, sourcePlatform: null });
    });

    it("rejects an empty idempotency key before calling the repository", async () => {
        // 저장소 분석 실행 시험용 시험자료 결과 준비
        const { repository, analysisRun } = harness();

        // 분석 실행 결과를 결과에 저장
        const result = await analysisRun({ ...VALID_INPUT, idempotencyKey: "" });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "INVALID_INPUT", reason: "IDEMPOTENCY_KEY_REQUIRED" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });

    it("rejects an idempotency key longer than 200 UTF-8 bytes before calling the repository", async () => {
        // 저장소 분석 실행 시험용 시험자료 결과 준비
        const { repository, analysisRun } = harness();
        // 키 시험용 가 반복문자열 결과 준비
        const keyWith201Utf8Bytes = "가".repeat(67);
        // 문구 결과의 항목 수 201 확인
        expect(new TextEncoder().encode(keyWith201Utf8Bytes)).toHaveLength(201);

        // 분석 실행 결과를 결과에 저장
        const result = await analysisRun({ ...VALID_INPUT, idempotencyKey: keyWith201Utf8Bytes });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "INVALID_INPUT", reason: "IDEMPOTENCY_KEY_TOO_LONG" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });

    it.each(["anonymousSessionId", "videoAssetId", "matchId"] as const)(
        "rejects an invalid %s before calling the repository",
        async (field) => {
            // 저장소 분석 실행 시험용 시험자료 결과 준비
            const { repository, analysisRun } = harness();
            // 무효 입력 시험용 입력 조건 준비
            const invalidInput = { ...VALID_INPUT, [field]: "not-a-uuid" } satisfies AnalysisInput;

            // 분석 실행 결과를 결과에 저장
            const result = await analysisRun(invalidInput);

            // 입력 오류 및 식별자 오류 내용을 포함한 기대 결과 일치 확인
            expect(result).toEqual({ kind: "INVALID_INPUT", reason: "INVALID_ID" });
            // 저장소 명령목록의 항목 수 0 확인
            expect(repository.commands).toHaveLength(0);
        }
    );

    // 저장소 시험용 입력 조건 준비
    const repositoryResults = [
        { kind: "CREATED", analysisId: ANALYSIS_ID },
        { kind: "REPLAYED", analysisId: ANALYSIS_ID },
        { kind: "IDEMPOTENCY_KEY_REUSED" },
        { kind: "VIDEO_ASSET_UNAVAILABLE" },
        { kind: "VIDEO_ASSET_ALREADY_SUBMITTED" },
        { kind: "MATCH_UNAVAILABLE" },
        { kind: "RULE_VERSION_UNAVAILABLE" }
    ] satisfies readonly AnalysisResult[];

    it.each(repositoryResults)(
        "returns the repository's $kind result unchanged",
        async (repositoryResult) => {
            // 분석 실행 시험용 시험자료 결과 준비
            const { analysisRun } = harness(repositoryResult);

            // 분석 실행 결과를 결과에 저장
            const result = await analysisRun(VALID_INPUT);

            // 결과의 기대값 저장소 결과 일치 확인
            expect(result).toBe(repositoryResult);
        }
    );
});
