import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { python } from "../../../../scripts/python.mjs";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3Storage } from "../../src/adapters/storage";

// 시험자료 시험용 실행환경 환경설정 재생 불변여부 저장공간 비교 조건 준비
const enabled = process.env.REPLAY_IMMUTABLE_STORAGE_TEST === "1";

describe.skipIf(!enabled)("real Python HTTP + immutable local object storage", () => {
    it("allows first PUT, rejects overwrite and wrong bytes, and returns the verified checksum", async () => {
        // 시험자료 시험용 실행환경 환경설정 저장공간 준비
        const endpoint = process.env.STORAGE_ENDPOINT!;
        // 2개 항목 목록 포함여부 결과 부정 조건에 따른 처리 경로 분기
        if (!["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname))
            // 오류객체 예외 전달
            throw new Error("loopback-storage-required");
        // 클라이언트 시험용 의존성 모의객체 준비
        const client = new S3Client({
            endpoint,
            region: "us-east-1",
            forcePathStyle: true,
            credentials: {
                accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
                secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!
            }
        });
        // 버킷 시험용 지정 형식 문자열 준비
        const bucket = `replay-auto-${randomUUID()}`;
        // 클라이언트 전송 결과 처리 수행
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        // 저장공간 시험용 의존성 모의객체 준비
        const storage = new S3Storage({ client, bucket, expiresInSeconds: 120 });
        // 시험자료 결과를 시험자료에 저장
        const root = await mkdtemp(join(tmpdir(), "replay-immutable-media-"));
        try {
            // 본문 시험용 바이트버퍼 변환 결과 준비
            const body = Buffer.from("test media bytes");
            // 원본 시험용 경로결합 결과 준비
            const source = join(root, "clip.mp4");
            // 쓰기 결과 처리 수행
            await writeFile(source, body);
            // 해시 시험용 해시 결과 갱신 결과 해시 결과 준비
            const hash = createHash("sha256").update(body).digest("hex");
            // 옵션 시험 입력으로 분석 식별자 및 작업 식별자 및 작업 개정번호 2 및 이름 영상조각 자료 생성
            const options = {
                analysisId: randomUUID(),
                jobId: randomUUID(),
                jobRevision: 2,
                name: "clip.mp4",
                contentType: "video/mp4" as const,
                sizeBytes: body.length,
                contentSha256: hash
            };
            // 저장공간 근거 결과를 업로드허가에 저장
            const grant = await storage.evidence(options);

            // 검증용 업로드 구성
            const put = (value: typeof grant) => {
                // 실행환경 시험용 시험자료 결과 준비
                const process = spawnSync(
                    python(),
                    [
                        "-c",
                        [
                            "import json, sys",
                            "from pathlib import Path",
                            "from replay_video.http import Api, HttpError",
                            "value = json.load(sys.stdin)",
                            "try:",
                            "    Api('http://unused', 'unused', 'test').put(value['url'], Path(value['path']), 'video/mp4', value['headers'])",
                            "    print(json.dumps({'ok': True}))",
                            "except HttpError as error:",
                            "    print(json.dumps({'ok': False, 'error': str(error)}))"
                        ].join("\n")
                    ],
                    {
                        cwd: resolve("apps/video-worker"),
                        env: { ...globalThis.process.env, PYTHONPATH: "src" },
                        input: JSON.stringify({
                            url: value.uploadUrl,
                            path: source,
                            headers: value.headers
                        }),
                        encoding: "utf8",
                        timeout: 30_000
                    }
                );
                // 실행환경 상태의 기대값 0 일치 확인
                expect(process.status, process.stderr).toBe(0);
                // 응답본문 해석 결과 반환
                return JSON.parse(process.stdout);
            };
            // 시험자료 결과의 지정 항목 참 자료 기준 구조 일치 확인
            expect(put(grant)).toEqual({ ok: true });
            // 시험자료 결과의 지정 항목 거짓 및 오류 근거 412 자료 기준 구조 일치 확인
            expect(put(grant)).toEqual({ ok: false, error: "evidence-412" });
            // 저장공간 메타정보 결과의 크기 바이트 및 내용 해시 자료 기준 구조 일치 확인
            expect(await storage.head(grant.objectKey)).toEqual({
                sizeBytes: body.length,
                contentSha256: Uint8Array.from(Buffer.from(hash, "hex"))
            });
            // 저장공간 근거 결과를 오류자료에 저장
            const bad = await storage.evidence({ ...options, name: "bad.mp4" });
            // 쓰기 결과 처리 수행
            await writeFile(source, Buffer.alloc(body.length, 42));
            // 시험자료 결과의 지정 항목 거짓 및 오류 근거 400 자료 기준 구조 일치 확인
            expect(put(bad)).toEqual({ ok: false, error: "evidence-400" });
            // 저장공간 메타정보 결과의 빈 값 확인
            expect(await storage.head(bad.objectKey)).toBeNull();
        } finally {
            // 클라이언트 정리 결과 처리 수행
            client.destroy();
            // 시험용 임시 저장 디렉터리 정리
            await rm(root, { recursive: true, force: true });
        }
    });
});
