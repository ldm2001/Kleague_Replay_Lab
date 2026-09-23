import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { delimiter, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { JobStore, S3Storage, Sha256, StatusStore } from "@replay/adapters";
import { client } from "@replay/database";
import { evidence, report, result, status, type AnalysisPayload } from "@replay/application";
import { perceptionRunData } from "@replay/shared-types";
import {
    evidence as evidenceRoute,
    result as resultRoute,
    type JobApiDependencies
} from "../../src/apis/job";
import { knownVideoSource } from "../../src/adapters/sources";
import type { AutomaticReviewBatch } from "@replay/shared-types";

// 시험자료 시험용 실행환경 환경설정 재생 로컬자료 저장공간 비교 조건 준비
const enabled = process.env.REPLAY_LOCAL_STORAGE_TEST === "1";
// 보고서 시험용 실행환경 환경설정 재생 보고서 준비
const reportPath = process.env.REPLAY_OPERATING_REPORT;
// 원본 시험용 실행환경 환경설정 재생 원본 준비
const sourcePath = process.env.REPLAY_OPERATING_SOURCE;
// 데이터베이스 주소 시험용 실행환경 환경설정 데이터베이스 주소 준비
const databaseUrl = process.env.DATABASE_URL;

// 검증용 로컬 주소 구성
const localHost = (value: string): boolean =>
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname);

// 검증용 실행 환경 구성
const environment = (name: string): string => {
    // 값 시험용 실행환경 환경설정 중 선택 항목 준비
    const value = process.env[name];
    // 값 부정 조건에 따른 처리 경로 분기
    if (!value)
        // 오류객체 예외 전달
        throw new Error(`${name} is required for an explicitly enabled local integration test`);
    // 값 반환
    return value;
};

// 저장소 접근 구성
function storage() {
    // 시험자료 시험용 시험자료 결과 준비
    const endpoint = environment("STORAGE_ENDPOINT");
    // 로컬자료 결과 부정 조건에 따른 처리 경로 분기
    if (!localHost(endpoint))
        // 오류객체 예외 전달
        throw new Error("Live storage tests are restricted to loopback endpoints");
    // 클라이언트 시험용 의존성 모의객체 준비
    const client = new S3Client({
        endpoint,
        region: process.env.STORAGE_REGION ?? "us-east-1",
        forcePathStyle: true,
        credentials: {
            accessKeyId: environment("STORAGE_ACCESS_KEY_ID"),
            secretAccessKey: environment("STORAGE_SECRET_ACCESS_KEY")
        }
    });
    // 클라이언트 및 어댑터 자료 반환
    return {
        client,
        adapter: new S3Storage({
            client,
            bucket: environment("STORAGE_BUCKET"),
            expiresInSeconds: 120
        })
    };
}

// 검증용 원본 해시 구성
async function hashSource(path: string): Promise<Buffer> {
    // 해시 시험용 해시 결과 준비
    const hash = createHash("sha256");
    // 읽기 결과의 각 사례 순회
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    // 해시 해시 결과 반환
    return hash.digest();
}

// 검증용 예상 미디어 키 구성
const expectedMediaKey = (
    analysisId: string,
    jobId: string,
    input: Parameters<S3Storage["evidence"]>[0]
): string => {
    // 입력 작업 개정번호 비교 조건 비교 조건에 따른 처리 경로 분기
    if (input.jobRevision !== 1 || !/^[a-f0-9]{64}$/.test(input.contentSha256 ?? ""))
        // 오류객체 예외 전달
        throw new Error("Invalid test evidence provenance");
    // 지정 형식 문자열 반환
    return `evidence/${analysisId}/${jobId}/1/${input.contentSha256}/${input.name}`;
};

describe.skipIf(!enabled)("explicit local operating storage integration", () => {
    it("checks the real-report harness against the current immutable media grant contract", async () => {
        // 클라이언트 어댑터 시험용 저장공간 결과 준비
        const { client, adapter } = storage();
        // 입력 시험 입력으로 분석 식별자 및 작업 식별자 및 작업 개정번호 1 및 내용 해시 자료 생성
        const input = {
            analysisId: randomUUID(),
            jobId: randomUUID(),
            jobRevision: 1,
            contentSha256: "a".repeat(64),
            name: "frame.jpg",
            contentType: "image/jpeg" as const,
            sizeBytes: 128
        };
        try {
            // 어댑터 근거 결과를 업로드허가에 저장
            const grant = await adapter.evidence(input);
            // 업로드허가 객체 키의 기대값 기대값 키 결과 일치 확인
            expect(grant.objectKey).toBe(expectedMediaKey(input.analysisId, input.jobId, input));
        } finally {
            // 클라이언트 정리 결과 처리 수행
            client.destroy();
        }
    });
    it("enforces signed checksum and conditional first-write semantics on real local storage", async () => {
        // 클라이언트 어댑터 시험용 저장공간 결과 준비
        const { client, adapter } = storage();
        // 분석 식별자 및 작업 식별자 시험용 무작위식별자 결과 준비
        const analysisId = randomUUID(),
            jobId = randomUUID();
        // 바이트 시험용 시험자료 결과 준비
        const bytes = gzipSync(Buffer.from('{"kind":"HEADER","test":true}\n'));
        // 해시 시험용 해시 결과 갱신 결과 해시 결과 준비
        const digest = createHash("sha256").update(bytes).digest("hex");
        // 해시 시험용 0 반복문자열 결과 준비
        const wrongDigest = "0".repeat(64);
        // 기대값 키목록 시험용 2개 항목 목록 항목변환 결과 준비
        const expectedKeys = [digest, wrongDigest].map(
            (sha) => `perception/${analysisId}/${jobId}/1/${sha}.jsonl.gz`
        );
        try {
            // 어댑터 인식 결과를 업로드허가에 저장
            const grant = await adapter.perception({
                analysisId,
                jobId,
                jobRevision: 1,
                contentSha256: digest,
                sizeBytes: bytes.length
            });
            // 업로드허가 객체 키의 기대값 기대값 키목록 중 선택 항목 일치 확인
            expect(grant.objectKey).toBe(expectedKeys[0]);
            // 옵션 시험 입력으로 방법 지정 문자열 및 응답헤더 및 본문 자료 생성
            const options = {
                method: "PUT",
                headers: {
                    ...grant.headers,
                    "content-type": "application/gzip",
                    "content-length": String(bytes.length)
                },
                body: Uint8Array.from(bytes).buffer
            };
            // 통신함수 결과를 시험자료에 저장
            const accepted = await fetch(grant.uploadUrl, options);
            // 시험자료 상태의 기대값 200 일치 확인
            expect(accepted.status).toBe(200);
            // 시험자료 바이트버퍼 결과 처리 수행
            await accepted.arrayBuffer();
            // 통신함수 결과를 시험자료에 저장
            const repeated = await fetch(grant.uploadUrl, options);
            // 시험자료 상태의 기대값 412 일치 확인
            expect(repeated.status).toBe(412);
            // 시험자료 바이트버퍼 결과 처리 수행
            await repeated.arrayBuffer();
            // 어댑터 메타정보 결과를 실제값에 저장
            const actual = await adapter.head(grant.objectKey, 128 * 1024 * 1024);
            // 실제값 크기 바이트의 기대값 바이트 길이 일치 확인
            expect(actual?.sizeBytes).toBe(bytes.length);
            // 바이트버퍼 변환 결과 문자열변환 결과의 기대값 해시 일치 확인
            expect(Buffer.from(actual!.contentSha256).toString("hex")).toBe(digest);

            // 어댑터 인식 결과를 오류자료에 저장
            const bad = await adapter.perception({
                analysisId,
                jobId,
                jobRevision: 1,
                contentSha256: wrongDigest,
                sizeBytes: bytes.length
            });
            // 오류자료 객체 키의 기대값 기대값 키목록 중 선택 항목 일치 확인
            expect(bad.objectKey).toBe(expectedKeys[1]);
            // 통신함수 결과를 시험자료에 저장
            const rejected = await fetch(bad.uploadUrl, {
                ...options,
                headers: { ...options.headers, ...bad.headers }
            });
            // 시험자료 상태의 기대값 400 일치 확인
            expect(rejected.status).toBe(400);
            // 시험자료 바이트버퍼 결과 처리 수행
            await rejected.arrayBuffer();
            // 어댑터 메타정보 결과의 빈 값 확인
            expect(await adapter.head(bad.objectKey, 128 * 1024 * 1024)).toBeNull();
        } finally {
            // 시험에서 생성한 정확한 두 임의 키만 삭제하며 접두사 일괄 삭제 제외
            for (const key of expectedKeys) await adapter.cleanup(key);
            // 클라이언트 정리 결과 처리 수행
            client.destroy();
        }
    }, 30_000);

    it.skipIf(!reportPath || !sourcePath || !databaseUrl)(
        "submits the actual Python Worker report through real storage, API, DB and public rules filtering",
        async () => {
            // 보고서 부정 조건 비교 조건 비교 조건에 따른 처리 경로 분기
            if (!reportPath || !sourcePath || !databaseUrl) return;
            // 이름 시험용 주소 결과 준비
            const name = new URL(databaseUrl).pathname.slice(1);
            // 로컬자료 결과 부정 조건 비교 조건에 따른 처리 경로 분기
            if (!localHost(databaseUrl) || !/(?:^|_)test(?:_|$)/.test(name)) {
                // 오류객체 예외 전달
                throw new Error(
                    "Actual report integration requires an explicitly named local test database"
                );
            }
            // 로컬자료 시험용 응답본문 해석 결과 준비
            const local = JSON.parse(readFileSync(reportPath, "utf8"));
            // 2개 항목 목록의 로컬자료 파이프라인 버전 포함 확인
            expect(["video-local-observers-v1", "video-local-observers-av-v1"]).toContain(
                local.pipeline_version
            );
            // 로컬자료 인식 스키마 버전의 기대값 입력 조건 일치 확인
            expect(local.perception.schemaVersion).toBe(
                local.pipeline_version === "video-local-observers-av-v1"
                    ? "perception-run-v2"
                    : "perception-run-v1"
            );
            // 해시 원본 결과를 원본에 저장
            const sourceSha = await hashSource(sourcePath);
            // 로컬자료 인식 원본 해시의 기대값 원본 문자열변환 결과 일치 확인
            expect(local.perception.sourceSha256).toBe(sourceSha.toString("hex"));
            // 클라이언트 저장공간 클라이언트 어댑터 객체 저장공간 시험용 저장공간 결과 준비
            const { client: storageClient, adapter: objectStorage } = storage();
            // 데이터베이스 시험용 클라이언트 결과 준비
            const database = client(databaseUrl);
            // 세션 식별자 및 영상 식별자 및 분석 식별자 및 작업 식별자 시험용 무작위식별자 결과 준비
            const sessionId = randomUUID(),
                videoId = randomUUID(),
                analysisId = randomUUID(),
                jobId = randomUUID();
            // 임대 토큰 및 키 시험용 무작위바이트 결과 문자열변환 결과 준비
            const leaseToken = randomBytes(24).toString("hex"),
                key = randomBytes(24).toString("hex");
            // 시험자료 및 현재시각 시험용 날짜 준비
            const started = new Date(),
                now = started.toISOString();
            // 만료시각 시험용 날짜 표준시각문자열 결과 준비
            const expires = new Date(started.getTime() + 24 * 60 * 60 * 1000).toISOString();
            // 임대 종료시각 시험용 날짜 표준시각문자열 결과 준비
            const leaseUntil = new Date(started.getTime() + 5 * 60 * 1000).toISOString();
            // 해시계산기 및 시계 시험용 해시 준비
            const hasher = new Sha256(),
                clock = { now: () => new Date() };
            // 저장소 시험용 작업 저장소 준비
            const repository = new JobStore(database);
            // 키목록 시험용 집합 준비
            const uploadedKeys = new Set<string>();
            // 저장공간 시험 입력으로 근거 및 인식 자료 생성
            const trackedStorage = {
                evidence: async (input: Parameters<S3Storage["evidence"]>[0]) => {
                    // 객체 저장공간 근거 결과를 업로드허가에 저장
                    const grant = await objectStorage.evidence(input);
                    // 기대값 시험용 기대값 키 결과 준비
                    const expected = expectedMediaKey(analysisId, jobId, input);
                    // 업로드허가 객체 키 비교 조건에 따른 처리 경로 분기
                    if (grant.objectKey !== expected)
                        // 오류객체 예외 전달
                        throw new Error("Unexpected test evidence scope");
                    // 키목록 결과 처리 수행
                    uploadedKeys.add(expected);
                    // 업로드허가 반환
                    return grant;
                },
                perception: async (input: Parameters<S3Storage["perception"]>[0]) => {
                    // 객체 저장공간 인식 결과를 업로드허가에 저장
                    const grant = await objectStorage.perception(input);
                    // 기대값 시험용 지정 형식 문자열 준비
                    const expected = `perception/${analysisId}/${jobId}/1/${input.contentSha256}.jsonl.gz`;
                    // 업로드허가 객체 키 비교 조건에 따른 처리 경로 분기
                    if (grant.objectKey !== expected)
                        // 오류객체 예외 전달
                        throw new Error("Unexpected test diagnostic scope");
                    // 키목록 결과 처리 수행
                    uploadedKeys.add(expected);
                    // 업로드허가 반환
                    return grant;
                }
            };
            // 의존성 시험용 키 및 근거 및 결과 자료 준비
            const dependencies = {
                key,
                evidence: evidence({ clock, hasher, repository, storage: trackedStorage }),
                result: result({ clock, hasher, repository, storage: objectStorage })
            } as JobApiDependencies;
            // 시험자료 시험용 시험자료 결과 준비
            const server = createServer(async (incoming, outgoing) => {
                try {
                    // 바이트조각목록 시험용 0개 항목 목록 준비
                    const chunks: Buffer[] = [];
                    // 길이 시험용 0 준비
                    let length = 0;
                    // 시험자료의 각 사례 순회
                    for await (const chunk of incoming) {
                        // 길이를 바이트조각 길이 값으로 설정
                        length += chunk.length;
                        // 길이 비교 조건에 따른 처리 경로 분기
                        if (length > 2 * 1024 * 1024)
                            // 오류객체 예외 전달
                            throw new Error("Test API request exceeds bound");
                        // 바이트조각목록 추가 결과 처리 수행
                        chunks.push(Buffer.from(chunk));
                    }
                    // 응답헤더 시험용 응답헤더 준비
                    const headers = new Headers();
                    // 객체 항목목록 결과의 각 사례 순회
                    for (const [name, value] of Object.entries(incoming.headers)) {
                        // 입력 조건 비교 조건에 따른 처리 경로 분기
                        if (typeof value === "string") headers.set(name, value);
                    }
                    // 요청 시험용 요청객체 준비
                    const request = new Request(`http://127.0.0.1${incoming.url}`, {
                        method: "POST",
                        headers,
                        body: Uint8Array.from(Buffer.concat(chunks)).buffer
                    });
                    // 응답 시험용 입력 조건 준비
                    const response =
                        incoming.url === `/api/internal/jobs/${jobId}/evidence`
                            ? await evidenceRoute(request, { jobId }, dependencies)
                            : incoming.url === `/api/internal/jobs/${jobId}/result`
                              ? await resultRoute(request, { jobId }, dependencies)
                              : new Response(null, { status: 404 });
                    // 시험자료 쓰기 메타정보 결과 처리 수행
                    outgoing.writeHead(response.status, { "content-type": "application/json" });
                    // 시험자료 종료 결과 처리 수행
                    outgoing.end(await response.text());
                } catch {
                    // 시험자료 쓰기 메타정보 결과 처리 수행
                    outgoing.writeHead(500);
                    // 시험자료 종료 결과 처리 수행
                    outgoing.end('{"kind":"TEST_SERVER_ERROR"}');
                }
            });
            try {
                // 익명 세션 삽입
                await database.sql`insert into anonymous_sessions(id, token_hash, created_at, expires_at)
        values (${sessionId}, ${randomBytes(32)}, ${now}, ${expires})`;
                // 영상 자산 삽입
                await database.sql`insert into video_assets(id, anonymous_session_id, object_key, content_sha256, content_type,
        size_bytes, status, rights_confirmed_at, created_at, expires_at, duration_ms, width, height)
        values (${videoId}, ${sessionId}, ${`tests/${videoId}.mp4`}, ${sourceSha}, 'video/mp4',
        ${statSync(sourcePath).size}, 'VALID', ${now}, ${now}, ${expires},
        ${local.video.duration_ms}, ${local.video.width}, ${local.video.height})`;
                // 분석 삽입
                await database.sql`insert into analyses(id, anonymous_session_id, video_asset_id, status, retention_class,
        source_fingerprint, pipeline_version, media_policy_version, created_at, expires_at)
        values (${analysisId}, ${sessionId}, ${videoId}, 'QUEUED', 'TEMPORARY', ${sourceSha},
        ${local.pipeline_version}, 'media-v1', ${now}, ${expires})`;
                // 영상 처리 작업 삽입
                await database.sql`insert into processing_jobs(id, analysis_id, job_type, status, payload_version, job_revision,
        attempt, max_attempts, lease_owner, lease_token_hash, lease_until, created_at, updated_at)
        values (${jobId}, ${analysisId}, 'ANALYZE_VIDEO', 'PROCESSING', 1, 1, 1, 3, 'live-test-worker',
        ${Buffer.from(await hasher.sha256(leaseToken))}, ${leaseUntil}, ${now}, ${now})`;
                // 비동기결과 처리 수행
                await new Promise<void>((resolve, reject) => {
                    // 시험 서버의 시작 오류 처리 등록
                    server.once("error", reject);
                    // 임의 포트에서 로컬 시험 서버 시작
                    server.listen(0, "127.0.0.1", resolve);
                });
                // 시험자료 시험용 시험자료 결과 준비
                const address = server.address();
                // 시험자료 부정 조건 비교 조건에 따른 처리 경로 분기
                if (!address || typeof address === "string")
                    // 오류객체 예외 전달
                    throw new Error("Test API address unavailable");
                // 코드 시험용 지정 형식 문자열 준비
                const code = `import json,os,sys
from pathlib import Path
from replay_video.http import Api
from replay_video.runner import report
item=json.loads(os.environ['REPLAY_TEST_CLAIM'])
api=Api(os.environ['REPLAY_TEST_API'],os.environ['REPLAY_TEST_KEY'],'live-test-worker')
payload=report(api,item,Path(sys.argv[1]))
ack=api.result(item,payload)
print(json.dumps({'payload':payload,'ack':ack}))`;
                // 비동기결과를 시험자료에 저장
                const stdout = await new Promise<string>((resolveOutput, reject) => {
                    // 승인된 로컬 인식 실증 실행
                    execFile(
                        resolve("experiments/perception/.venv-referee/bin/python"),
                        ["-c", code, reportPath],
                        {
                            env: {
                                PATH: process.env.PATH,
                                NODE_ENV: "test",
                                PYTHONDONTWRITEBYTECODE: "1",
                                PYTHONPATH: [
                                    resolve("apps/video-worker/src"),
                                    resolve("experiments/perception/src")
                                ].join(delimiter),
                                REPLAY_TEST_API: `http://127.0.0.1:${address.port}`,
                                REPLAY_TEST_KEY: key,
                                REPLAY_TEST_CLAIM: JSON.stringify({
                                    analysisId,
                                    jobId,
                                    jobRevision: 1,
                                    leaseToken
                                })
                            },
                            encoding: "utf8",
                            timeout: 120_000,
                            maxBuffer: 8 * 1024 * 1024
                        },
                        (error, stdout, stderr) =>
                            error
                                ? reject(new Error(`Python report submission failed: ${stderr}`))
                                : resolveOutput(stdout)
                    );
                });
                // 제출값 시험용 응답본문 해석 결과 준비
                const submitted = JSON.parse(stdout) as {
                    payload: AnalysisPayload;
                    ack: { kind: string };
                };
                // 제출값의 종류 접수완료 자료 기준 구조 일치 확인
                expect(submitted.ack).toEqual({ kind: "ACCEPTED" });
                // 인식실행자료 결과의 기대값 참 일치 확인
                expect(perceptionRunData(submitted.payload.perception)).toBe(true);
                // 제출값 전송자료 인식 산출물 객체 키의 지정 패턴 일치 확인
                expect(submitted.payload.perception?.artifact.objectKey).toMatch(
                    new RegExp(`^perception/${analysisId}/${jobId}/1/`)
                );
                // 분석 인식 실행 기록 조회
                const [saved] = await database.sql<
                    { summary: Record<string, any>; artifact_object_key: string }[]
                >`
        select summary, artifact_object_key from analysis_perception_runs where analysis_id = ${analysisId}`;
                // 결과가 규정 입력 채택 거부 상태로 유지됨 확인
                expect(saved?.summary.admission.status).toBe("NOT_ADMITTED");
                // 규정 판본 미검증 값이 결과에 포함됨 확인
                expect(saved?.summary.admission.reasons).toContain("RULE_EDITION_UNVERIFIED");
                // 저장결과 요약 분석범위의 로컬자료 인식 분석범위 기준 구조 일치 확인
                expect(saved?.summary.coverage).toEqual(local.perception.coverage);
                // 저장결과 요약 사건목록의 제출값 전송자료 인식 사건목록 기준 구조 일치 확인
                expect(saved?.summary.incidents).toEqual(submitted.payload.perception?.incidents);
                // 자동 규정 평가 기록 조회
                const [automatic] = await database.sql<{ summary: AutomaticReviewBatch }[]>`
        select summary from analysis_automatic_reviews where analysis_id = ${analysisId}`;
                // 자동평가 요약의 버전 자동평가 및 원본 해시 및 평가완료 개수 0 및 보류 개수 자료의 필드 일치 확인
                expect(automatic?.summary).toMatchObject({
                    version: "automatic-review-v1",
                    sourceSha256: sourceSha.toString("hex"),
                    evaluatedCount: 0,
                    blockedCount: submitted.payload.candidates.length
                });
                // 자동평가 요약 행목록의 항목 수 제출값 전송자료 후보목록 길이 확인
                expect(automatic?.summary.rows).toHaveLength(submitted.payload.candidates.length);
                // 자동평가 요약 행목록 전체충족 결과의 기대값 참 일치 확인
                expect(
                    automatic?.summary.rows.every(
                        (row) =>
                            row.status === "BLOCKED" && row.facts === null && row.result === null
                    )
                ).toBe(true);
                // 자동평가 사유목록 시험 입력으로 자료 생성
                const automaticReasons: Record<string, number> = {};
                // 자동평가 요약 행목록의 각 사례 순회
                for (const row of automatic!.summary.rows) {
                    // 행 사유코드목록의 각 사례 순회
                    for (const reason of row.reasonCodes)
                        // 자동평가 사유목록 중 선택 항목을 자동평가 사유목록 중 선택 항목 비교 조건 비교 조건 값으로 설정
                        automaticReasons[reason] = (automaticReasons[reason] ?? 0) + 1;
                }
                // 제출값 전송자료 인식 스키마 버전 비교 조건에 따른 처리 경로 분기
                if (submitted.payload.perception?.schemaVersion === "perception-run-v2") {
                    // 저장결과 요약 음향의 제출값 전송자료 인식 음향 기준 구조 일치 확인
                    expect(saved?.summary.audio).toEqual(submitted.payload.perception.audio);
                } else {
                    // 저장결과 요약의 음향 항목 없음 확인
                    expect(saved?.summary).not.toHaveProperty("audio");
                }
                // 시험자료 시험용 상태 저장소 준비
                const views = new StatusStore(database);
                // 보고서 결과를 공개보고서에 저장
                const publicReport = await report({ clock, repository: views })({
                    anonymousSessionId: sessionId,
                    analysisId
                });
                // 상태 결과를 공개 상태에 저장
                const publicStatus = await status({ clock, repository: views })({
                    anonymousSessionId: sessionId,
                    videoAssetId: videoId
                });
                // 2개 항목 목록의 각 사례 순회
                for (const view of [publicReport, publicStatus]) {
                    // 응답본문 직렬화 결과의 인식 미포함 확인
                    expect(JSON.stringify(view)).not.toContain("perception/");
                    // 응답본문 직렬화 결과의 원본 해시 미포함 확인
                    expect(JSON.stringify(view)).not.toContain("sourceFilesSha256");
                    // 응답본문 직렬화 결과의 지정 문자열 미포함 확인
                    expect(JSON.stringify(view)).not.toContain("roleHypotheses");
                    // 응답본문 직렬화 결과의 음향 관측목록 미포함 확인
                    expect(JSON.stringify(view)).not.toContain("audio-observations-v1");
                    // 응답본문 직렬화 결과의 자동평가 요약 미포함 확인
                    expect(JSON.stringify(view)).not.toContain("automaticReviewSummary");
                    // 응답본문 직렬화 결과의 사실 서명 입력 미포함 확인
                    expect(JSON.stringify(view)).not.toContain("factSignatureInput");
                    // 제출값 전송자료 인식 스키마 버전 비교 조건에 따른 처리 경로 분기
                    if (submitted.payload.perception?.schemaVersion === "perception-run-v2") {
                        // 응답본문 직렬화 결과의 응답본문 직렬화 결과 미포함 확인
                        expect(JSON.stringify(view)).not.toContain(
                            JSON.stringify(submitted.payload.perception.audio)
                        );
                    }
                }
                // 미평가 조건을 포함한 기대 결과 일치 확인
                expect(publicReport).toMatchObject({
                    resultPolicy: "COMPLETED_ONLY",
                    evaluatedCount: 0,
                    judgmentStatus: "NOT_EVALUATED"
                });
                // 영상 원본 결과 비교 조건에 따른 처리 경로 분기
                if (
                    knownVideoSource(sourceSha.toString("hex")) &&
                    submitted.payload.candidates.some((candidate) => candidate.broadcastCue)
                ) {
                    // 공개보고서 완료 적용범위 개수의 0 초과 확인
                    expect((publicReport as any).completedScopeCount).toBeGreaterThan(0);
                }
                // 근거 자산 조회
                const [counts] = await database.sql<
                    { count: number }[]
                >`select count(*)::int as count
        from evidence_assets where analysis_id = ${analysisId} and object_key like 'perception/%'`;
                // 집계 개수의 기대값 0 일치 확인
                expect(counts?.count).toBe(0);
                // 실행환경 환경설정 재생 검증에 따른 처리 경로 분기
                if (process.env.REPLAY_OPERATING_VERIFICATION_OUT) {
                    // 쓰기 결과 처리 수행
                    writeFileSync(
                        process.env.REPLAY_OPERATING_VERIFICATION_OUT,
                        JSON.stringify(
                            {
                                sourceSha256: sourceSha.toString("hex"),
                                pipelineVersion: submitted.payload.pipelineVersion,
                                sourceHashIndependentlyVerified: true,
                                storageAndApiResult: submitted.ack.kind,
                                processingStatus: submitted.payload.perception?.processingStatus,
                                // 영상의 처리 시간 범위와 표본 누락 여부를 검증할 집계 구성
                                coverage: submitted.payload.perception?.coverage,
                                observationCounts: submitted.payload.perception?.summary,
                                candidateCount: submitted.payload.candidates.length,
                                evidenceCount: submitted.payload.evidence?.length,
                                privateAdmission: saved?.summary.admission,
                                automaticReview: {
                                    version: automatic!.summary.version,
                                    videoCoverage: automatic!.summary.videoCoverage,
                                    summaryTruncated: automatic!.summary.summaryTruncated,
                                    evaluatedCount: automatic!.summary.evaluatedCount,
                                    blockedCount: automatic!.summary.blockedCount,
                                    reasonCounts: automaticReasons
                                },
                                publicResult: {
                                    status: (publicReport as any)?.status,
                                    resultPolicy: (publicReport as any)?.resultPolicy,
                                    completedScopeCount: (publicReport as any)?.completedScopeCount,
                                    evaluatedCount: (publicReport as any)?.evaluatedCount,
                                    judgmentStatus: (publicReport as any)?.judgmentStatus,
                                    candidateCount: (publicReport as any)?.candidates.length
                                }
                            },
                            null,
                            2
                        ),
                        { flag: "wx" }
                    );
                }
                // 실행환경 환경설정 재생 공개에 따른 처리 경로 분기
                if (process.env.REPLAY_OPERATING_PUBLIC_OUT) {
                    // 쓰기 결과 처리 수행
                    writeFileSync(
                        process.env.REPLAY_OPERATING_PUBLIC_OUT,
                        JSON.stringify(publicReport, null, 2),
                        { flag: "wx" }
                    );
                }
            } finally {
                // 시험자료 연결종료 전체 결과 처리 수행
                server.closeAllConnections();
                // 시험자료에 따른 처리 경로 분기
                if (server.listening)
                    // 비동기결과 처리 수행
                    await new Promise<void>((resolve) => server.close(() => resolve()));
                // 분석 인식 실행 기록 삭제
                await database.sql`delete from analysis_perception_runs where analysis_id = ${analysisId}`;
                // 근거 자산 삭제
                await database.sql`delete from evidence_assets where analysis_id = ${analysisId}`;
                // 인식 후보 사건 삭제
                await database.sql`delete from incident_candidates where analysis_id = ${analysisId}`;
                // 영상 샷 삭제
                await database.sql`delete from shots where analysis_id = ${analysisId}`;
                // 작업 상태 이력 삭제
                await database.sql`delete from processing_job_events where job_id = ${jobId}`;
                // 영상 처리 작업 삭제
                await database.sql`delete from processing_jobs where id = ${jobId}`;
                // 분석 삭제
                await database.sql`delete from analyses where id = ${analysisId}`;
                // 영상 자산 삭제
                await database.sql`delete from video_assets where id = ${videoId}`;
                // 익명 세션 삭제
                await database.sql`delete from anonymous_sessions where id = ${sessionId}`;
                // 데이터베이스 연결종료 결과 처리 수행
                await database.close();
                // 키목록의 각 사례 순회
                for (const key of uploadedKeys) await objectStorage.cleanup(key);
                // 저장공간 클라이언트 정리 결과 처리 수행
                storageClient.destroy();
            }
        },
        180_000
    );
});
