import { describe, expect, it } from "vitest";
import { createHash as digest } from "node:crypto";
import { s3, type S3ObjectClient } from "@replay/adapters";
import { S3Client } from "@aws-sdk/client-s3";

class TrackedBody implements AsyncIterable<Uint8Array> {
    destroyed = false;
    returned = false;
    exhausted = false;

    constructor(private readonly chunks: readonly Uint8Array[]) {}

    // 검증용 [비동기 반복자] 구성
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
        // 순번 시험용 0 준비
        let index = 0;
        // 지정 항목 및 지정 항목 자료 반환
        return {
            next: async () => {
                // 순번 비교 조건에 따른 처리 경로 분기
                if (index < this.chunks.length)
                    // 완료여부 거짓 및 값 자료 반환
                    return { done: false, value: this.chunks[index++]! };
                // 입력 조건 소진여부를 참 값으로 설정
                this.exhausted = true;
                // 완료여부 참 및 값 자료 반환
                return { done: true, value: undefined };
            },
            return: async () => {
                // 입력 조건 반환여부를 참 값으로 설정
                this.returned = true;
                // 완료여부 참 및 값 자료 반환
                return { done: true, value: undefined };
            }
        };
    }

    // 검증용 정리 구성
    destroy(): void {
        // 입력 조건 정리여부를 참 값으로 설정
        this.destroyed = true;
    }
}

class FakeS3 implements S3ObjectClient {
    readonly commands: unknown[] = [];
    headResult: unknown = { ContentLength: 128, ChecksumSHA256: "AQID" };
    objectBody: Uint8Array[] = [Uint8Array.from([4, 5, 6])];
    bodyOverride?: TrackedBody;
    getContentLength?: number;

    // 검증용 전송 구성
    async send(command: unknown) {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 이름 시험용 명령 () { [ ] } 이름 준비
        const name = command?.constructor?.name;
        // 이름 비교 조건에 따른 처리 경로 분기
        if (name === "HeadObjectCommand") {
            // 입력 조건 메타정보 결과 반환
            return this.headResult;
        }
        // 이름 비교 조건에 따른 처리 경로 분기
        if (name === "GetObjectCommand") {
            // 본문 및 기존 항목 자료 반환
            return {
                Body: this.bodyOverride ?? new TrackedBody(this.objectBody),
                ...(this.getContentLength === undefined
                    ? {}
                    : { ContentLength: this.getContentLength })
            };
        }
        // 자료 반환
        return {};
    }
}

describe("s3 upload storage", () => {
    it("binds new media evidence to a revision, checksum and first-write-only PUT", async () => {
        // 서명결과 보관 변수 생성
        let signed: any;
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({
            client: new FakeS3(),
            bucket: "replay-local",
            sign: async (_client, command) => {
                // 서명결과를 명령 값으로 설정
                signed = command;
                // 저장공간 불변여부 반환
                return "http://storage/immutable";
            }
        });
        // 해시 시험용 지정 문자열 반복문자열 결과 준비
        const sha256 = "a".repeat(64);
        // 저장공간 근거 결과를 업로드허가에 저장
        const grant = await storage.evidence({
            analysisId: "analysis",
            jobId: "job",
            jobRevision: 2,
            name: "clip.mp4",
            contentType: "video/mp4",
            sizeBytes: 128,
            contentSha256: sha256
        });
        // 업로드허가 객체 키의 기대값 지정 형식 문자열 일치 확인
        expect(grant.objectKey).toBe(`evidence/analysis/job/2/${sha256}/clip.mp4`);
        // 서명결과 입력의 체크섬 해시 및 경기 지정 문자열 자료의 필드 일치 확인
        expect(signed.input).toMatchObject({
            ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
            IfNoneMatch: "*"
        });
        // 업로드허가 응답헤더의 체크섬 해시 및 경기 지정 문자열 자료 기준 구조 일치 확인
        expect(grant.headers).toEqual({
            "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
            "if-none-match": "*"
        });
    });
    it("grants a private put URL and returns the object head", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({
            client,
            bucket: "replay-local",
            prefix: "uploads",
            sign: async () => "http://minio.test/upload-token"
        });

        // 저장공간 업로드허가 결과를 업로드허가에 저장
        const grant = await storage.grant({
            anonymousSessionId: "11111111-1111-4111-8111-111111111111",
            expectedSizeBytes: 128,
            contentType: "video/mp4",
            expiresAt: "2030-01-01T13:00:00.000Z"
        });
        // 저장공간 메타정보 결과를 메타정보에 저장
        const head = await storage.head(grant.objectKey);

        // 업로드허가의 업로드 주소 업로드 토큰 및 만료시각 시점 2030 01 00 00 자료의 필드 일치 확인
        expect(grant).toMatchObject({
            uploadUrl: "http://minio.test/upload-token",
            expiresAt: "2030-01-01T13:00:00.000Z"
        });
        // 업로드허가 객체 키의 지정 패턴 일치 확인
        expect(grant.objectKey).toMatch(
            /^uploads\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\.upload$/
        );
        // 메타정보의 크기 바이트 128 및 내용 해시 자료 기준 구조 일치 확인
        expect(head).toEqual({ sizeBytes: 128, contentSha256: Uint8Array.from([1, 2, 3]) });
        // 클라이언트 명령목록의 항목 수 1 확인
        expect(client.commands).toHaveLength(1);
        // 클라이언트 명령목록 중 선택 항목 입력의 체크섬 모드 지정 문자열 자료의 필드 일치 확인
        expect((client.commands[0] as any).input).toMatchObject({ ChecksumMode: "ENABLED" });
    });

    it("cleans up a staged object", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 저장공간 화면정리 결과 처리 수행
        await storage.cleanup("uploads/session/object.upload");

        // 클라이언트 명령목록의 항목 수 1 확인
        expect(client.commands).toHaveLength(1);
        // 클라이언트 명령목록 중 선택 항목 () { [ ] } 이름의 기대값 객체 명령 일치 확인
        expect(client.commands[0]?.constructor?.name).toBe("DeleteObjectCommand");
    });

    it("grants a private read URL for a claimed worker job", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 명령목록 시험용 0개 항목 목록 준비
        const commands: string[] = [];
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({
            client,
            bucket: "replay-local",
            sign: async (_client, command) => {
                // 명령목록 추가 결과 처리 수행
                commands.push(command?.constructor?.name ?? "unknown");
                // 읽기 토큰 반환
                return "http://minio.test/read-token";
            }
        });

        // 저장공간 읽기 결과의 기대값 읽기 토큰 일치 확인
        await expect(storage.read("uploads/session/object.upload")).resolves.toBe(
            "http://minio.test/read-token"
        );
        // 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(commands).toEqual(["GetObjectCommand"]);
    });

    it("grants a scoped evidence put URL", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 명령목록 시험용 0개 항목 목록 준비
        const commands: string[] = [];
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({
            client,
            bucket: "replay-local",
            sign: async (_client, command) => {
                // 명령목록 추가 결과 처리 수행
                commands.push(command?.constructor?.name ?? "unknown");
                // 근거 토큰 반환
                return "http://minio.test/evidence-token";
            }
        });

        // 저장공간 근거 결과의 객체 키 근거 22222222 2222 4222 8222 222222222222 11111111 1111 4111 8111 111111111111 후보 0001 및 업로드 주소 근거 토큰 자료 기준 구조 일치 확인
        await expect(
            storage.evidence({
                analysisId: "22222222-2222-4222-8222-222222222222",
                jobId: "11111111-1111-4111-8111-111111111111",
                name: "candidate-0001.jpg",
                contentType: "image/jpeg",
                sizeBytes: 128
            })
        ).resolves.toEqual({
            objectKey:
                "evidence/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/candidate-0001.jpg",
            uploadUrl: "http://minio.test/evidence-token"
        });
        // 명령목록의 1개 항목 목록 기준 구조 일치 확인
        expect(commands).toEqual(["PutObjectCommand"]);
    });

    it("signs an immutable checksum-bound perception put", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 서명결과 보관 변수 생성
        let signed: any;
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({
            client,
            bucket: "replay-local",
            sign: async (_client, command) => {
                // 서명결과를 명령 값으로 설정
                signed = command;
                // 인식 토큰 반환
                return "http://minio.test/perception-token";
            }
        });
        // 해시 시험용 지정 문자열 반복문자열 결과 준비
        const sha256 = "a".repeat(64);

        // 저장공간 인식 결과의 객체 키 및 업로드 주소 인식 토큰 및 응답헤더 자료 기준 구조 일치 확인
        await expect(
            storage.perception({
                analysisId: "22222222-2222-4222-8222-222222222222",
                jobId: "11111111-1111-4111-8111-111111111111",
                jobRevision: 2,
                contentSha256: sha256,
                sizeBytes: 1_024
            })
        ).resolves.toEqual({
            objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${sha256}.jsonl.gz`,
            uploadUrl: "http://minio.test/perception-token",
            headers: {
                "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
                "if-none-match": "*"
            }
        });
        // 서명결과 입력의 버킷 재생 로컬자료 및 내용 유형 지정 문자열 및 내용 길이 1_024 및 체크섬 해시 자료의 필드 일치 확인
        expect(signed?.input).toMatchObject({
            Bucket: "replay-local",
            ContentType: "application/gzip",
            ContentLength: 1_024,
            ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
            IfNoneMatch: "*"
        });
    });

    it("includes the checksum and conditional write headers in the AWS signature", async () => {
        // 클라이언트 시험용 의존성 모의객체 준비
        const client = new S3Client({
            endpoint: "http://127.0.0.1:9000",
            region: "us-east-1",
            forcePathStyle: true,
            credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" }
        });
        // 해시 시험용 지정 문자열 반복문자열 결과 준비
        const sha256 = "a".repeat(64);
        try {
            // 객체저장소 결과 인식 결과를 업로드허가에 저장
            const grant = await s3({ client, bucket: "replay-local" }).perception({
                analysisId: "22222222-2222-4222-8222-222222222222",
                jobId: "11111111-1111-4111-8111-111111111111",
                jobRevision: 2,
                contentSha256: sha256,
                sizeBytes: 1_024
            });
            // 서명결과 응답헤더 시험용 주소 인자목록 조회 결과 비교 조건 준비
            const signedHeaders =
                new URL(grant.uploadUrl).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
            // 서명결과 응답헤더의 시험자료 부분배열 결과 기준 구조 일치 확인
            expect(signedHeaders).toEqual(
                expect.arrayContaining(["if-none-match", "x-amz-checksum-sha256"])
            );
            // 업로드허가 응답헤더의 체크섬 해시 및 경기 지정 문자열 자료 기준 구조 일치 확인
            expect(grant.headers).toEqual({
                "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
                "if-none-match": "*"
            });
        } finally {
            // 클라이언트 정리 결과 처리 수행
            client.destroy();
        }
    });

    it("returns no head for a missing object and hashes a head without checksum", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 클라이언트 메타정보 결과를 비동기결과 결과 값으로 설정
        client.headResult = Promise.reject(
            Object.assign(new Error("missing"), { name: "NotFound" })
        );
        // 저장공간 메타정보 결과의 빈 값 확인
        await expect(storage.head("uploads/missing.upload")).resolves.toBeNull();

        // 클라이언트 메타정보 결과를 내용 길이 3 자료로 설정
        client.headResult = { ContentLength: 3 };
        // 기대값 시험용 바이트배열 변환 결과 준비
        const expected = Uint8Array.from(
            digest("sha256")
                .update(Buffer.from([4, 5, 6]))
                .digest()
        );
        // 저장공간 메타정보 결과의 크기 바이트 3 및 내용 해시 자료 기준 구조 일치 확인
        await expect(storage.head("uploads/no-checksum.upload")).resolves.toEqual({
            sizeBytes: 3,
            contentSha256: expected
        });
    });

    it("preserves a canonical short checksum for a legacy upload head", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 저장공간 메타정보 결과의 크기 바이트 128 및 내용 해시 자료 기준 구조 일치 확인
        await expect(storage.head("uploads/legacy.upload")).resolves.toEqual({
            sizeBytes: 128,
            contentSha256: Uint8Array.from([1, 2, 3])
        });
    });

    it("rejects malformed HEAD checksum metadata without downloading the object", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 클라이언트 메타정보 결과를 내용 길이 3 및 체크섬 해시 지정 문자열 자료로 설정
        client.headResult = { ContentLength: 3, ChecksumSHA256: "not-base64!" };
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 저장공간 메타정보 결과의 잘못된 입력의 예외 발생 확인
        await expect(storage.head("uploads/invalid-checksum.upload")).rejects.toThrow(
            "checksum is invalid"
        );
        // 클라이언트 명령목록 항목변환 결과의 1개 항목 목록 기준 구조 일치 확인
        expect(client.commands.map((command) => command?.constructor?.name)).toEqual([
            "HeadObjectCommand"
        ]);
    });

    it.each([
        { name: "size growth", declared: 1, chunks: [new Uint8Array(10_240)], max: 1_024 },
        { name: "underflow", declared: 4, chunks: [Uint8Array.from([1, 2, 3])], max: 1_024 },
        {
            name: "mid-stream overflow",
            declared: 5,
            chunks: [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])],
            max: 1_024
        }
    ])("bounds checksum fallback bytes for $name", async ({ declared, chunks, max }) => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 본문 시험용 본문 준비
        const body = new TrackedBody(chunks);
        // 클라이언트 메타정보 결과를 내용 길이 자료로 설정
        client.headResult = { ContentLength: declared };
        // 클라이언트 본문을 본문 값으로 설정
        client.bodyOverride = body;
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 저장공간 메타정보 결과의 잘못된 입력의 예외 발생 확인
        await expect(storage.head("uploads/changing.upload", max)).rejects.toThrow(
            /length|limit|changed/
        );
        // 본문 정리여부 비교 조건 비교 조건의 기대값 참 일치 확인
        expect(body.destroyed || body.returned || body.exhausted).toBe(true);
    });

    it("rejects a GET content length that differs from HEAD and releases the body", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 본문 시험용 본문 준비
        const body = new TrackedBody([Uint8Array.from([1, 2, 3])]);
        // 클라이언트 메타정보 결과를 내용 길이 3 자료로 설정
        client.headResult = { ContentLength: 3 };
        // 클라이언트 조회 내용 길이를 4 값으로 설정
        client.getContentLength = 4;
        // 클라이언트 본문을 본문 값으로 설정
        client.bodyOverride = body;
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 저장공간 메타정보 결과의 잘못된 입력의 예외 발생 확인
        await expect(storage.head("uploads/changing.upload", 1_024)).rejects.toThrow(
            "GET content length differs from HEAD"
        );
        // 본문 정리여부 비교 조건의 기대값 참 일치 확인
        expect(body.destroyed || body.returned).toBe(true);
    });

    it("rejects an oversized checksum fallback before downloading its body", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 클라이언트 메타정보 결과를 내용 길이 자료로 설정
        client.headResult = { ContentLength: 51 * 1_024 * 1_024 };
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 저장공간 메타정보 결과의 잘못된 입력의 예외 발생 확인
        await expect(
            storage.head("perception/oversized.jsonl.gz", 50 * 1_024 * 1_024)
        ).rejects.toThrow("exceeds the verification limit");
        // 클라이언트 명령목록 항목변환 결과의 1개 항목 목록 기준 구조 일치 확인
        expect(client.commands.map((command) => command?.constructor?.name)).toEqual([
            "HeadObjectCommand"
        ]);
    });

    it("returns a private evidence body", async () => {
        // 클라이언트 시험용 모의객체저장소 준비
        const client = new FakeS3();
        // 저장공간 시험용 객체저장소 결과 준비
        const storage = s3({ client, bucket: "replay-local", sign: async () => "unused" });

        // 저장공간 본문 결과를 객체에 저장
        const object = await storage.body("evidence/analysis/job/candidate.jpg");
        // 바이트조각목록 시험용 0개 항목 목록 준비
        const chunks: number[] = [];
        // 객체 본문의 각 사례 순회
        for await (const chunk of object.body) chunks.push(...chunk);

        // 바이트조각목록의 3개 항목 목록 기준 구조 일치 확인
        expect(chunks).toEqual([4, 5, 6]);
        // 클라이언트 명령목록 중 선택 항목 () { [ ] } 이름의 기대값 조회 객체 명령 일치 확인
        expect(client.commands[0]?.constructor?.name).toBe("GetObjectCommand");
    });
});
