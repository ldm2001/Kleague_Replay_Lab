import { describe, expect, it } from "vitest";
import {
    evidence,
    type Clock,
    type EvidenceAccess,
    type EvidenceAccessCommand,
    type EvidenceStore,
    type EvidenceGrant,
    type EvidenceGrantInput,
    type EvidenceStorage
} from "@replay/application";

// 현재시각 시험용 날짜 준비
const NOW = new Date("2026-08-31T00:00:00.000Z");

// 증거 권한 저장소 모형
class EvidenceStoreFake implements EvidenceStore {
    commands: EvidenceAccessCommand[] = [];
    response: EvidenceAccess = {
        kind: "AUTHORIZED",
        analysisId: "22222222-2222-4222-8222-222222222222",
    };

    // 검증용 접근 구성
    async access(command: EvidenceAccessCommand): Promise<EvidenceAccess> {
        // 입력 조건 명령목록 추가 결과 처리 수행
        this.commands.push(command);
        // 입력 조건 응답 반환
        return this.response;
    }
}

class Storage implements EvidenceStorage {
    inputs: EvidenceGrantInput[] = [];
    perceptionInputs: Parameters<NonNullable<EvidenceStorage["perception"]>>[0][] = [];

    // 검증용 증거 구성
    async evidence(input: EvidenceGrantInput): Promise<EvidenceGrant> {
        // 입력 조건 입력목록 추가 결과 처리 수행
        this.inputs.push(input);
        // 객체 키 및 업로드 주소 자료 반환
        return {
            objectKey: `evidence/${input.analysisId}/${input.jobId}/${input.name}`,
            uploadUrl: `http://storage.test/${input.name}`
        };
    }

    // 검증용 인식 구성
    async perception(
        input: Parameters<NonNullable<EvidenceStorage["perception"]>>[0]
    ): Promise<EvidenceGrant> {
        // 입력 조건 인식 입력목록 추가 결과 처리 수행
        this.perceptionInputs.push(input);
        // 객체 키 및 업로드 주소 저장공간 인식 및 응답헤더 자료 반환
        return {
            objectKey: `perception/${input.analysisId}/${input.jobId}/${input.jobRevision}/${input.contentSha256}.jsonl.gz`,
            uploadUrl: "http://storage.test/perception",
            headers: {
                "x-amz-checksum-sha256": Buffer.from(input.contentSha256, "hex").toString("base64"),
                "if-none-match": "*"
            }
        };
    }
}

describe("evidence grants", () => {
    it("passes verified-format media hash and revision into an immutable grant", async () => {
        // 저장공간 시험용 저장공간 준비
        const storage = new Storage();
        // 근거 결과를 값에 저장
        const value = await evidence({
            clock: { now: () => NOW },
            hasher: { sha256: async () => new Uint8Array(32) },
            repository: new EvidenceStoreFake(),
            storage
        })({
            jobId: "11111111-1111-4111-8111-111111111111",
            workerId: "worker",
            jobRevision: 2,
            leaseToken: "lease",
            items: [
                {
                    name: "clip.mp4",
                    contentType: "video/mp4",
                    sizeBytes: 128,
                    contentSha256: "c".repeat(64)
                }
            ]
        });
        // 값 종류의 기대값 지정 문자열 일치 확인
        expect(value.kind).toBe("GRANTED");
        // 저장공간 입력목록 중 선택 항목의 작업 개정번호 2 및 내용 해시 자료의 필드 일치 확인
        expect(storage.inputs[0]).toMatchObject({ jobRevision: 2, contentSha256: "c".repeat(64) });
    });
    it("authorizes a lease and grants only bounded evidence files", async () => {
        // 유효한 작업 임대 증거 권한 실행
        const repository = new EvidenceStoreFake();
        // 저장공간 시험용 저장공간 준비
        const storage = new Storage();
        // 근거 결과를 결과에 저장
        const result = await evidence({
            clock: { now: () => NOW } satisfies Clock,
            hasher: { sha256: async () => Uint8Array.from([1, 2, 3]) },
            repository,
            storage
        })({
            jobId: "11111111-1111-4111-8111-111111111111",
            workerId: "worker-1",
            jobRevision: 2,
            leaseToken: "lease-token",
            items: [{ name: "candidate-0001.jpg", contentType: "image/jpeg", sizeBytes: 128 }]
        });

        // 결과의 종류 지정 문자열 및 항목목록 자료 기준 구조 일치 확인
        expect(result).toEqual({
            kind: "GRANTED",
            items: [
                {
                    name: "candidate-0001.jpg",
                    objectKey:
                        "evidence/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/candidate-0001.jpg",
                    uploadUrl: "http://storage.test/candidate-0001.jpg"
                }
            ]
        });
        // 저장소 명령목록 중 선택 항목의 작업 식별자 11111111 1111 4111 8111 111111111111 및 임대 토큰 해시 자료의 필드 일치 확인
        expect(repository.commands[0]).toMatchObject({
            jobId: "11111111-1111-4111-8111-111111111111",
            leaseTokenHash: Uint8Array.from([1, 2, 3])
        });
    });

    it("rejects unsupported evidence before storage", async () => {
        // 지원하지 않는 증거 요청 실행
        const repository = new EvidenceStoreFake();
        // 저장공간 시험용 저장공간 준비
        const storage = new Storage();
        // 작업 시험용 근거 결과 준비
        const operation = evidence({
            clock: { now: () => NOW },
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository,
            storage
        });

        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                items: [
                    {
                        name: "payload.exe",
                        contentType: "application/octet-stream" as never,
                        sizeBytes: 128
                    }
                ]
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
        // 저장공간 입력목록의 항목 수 0 확인
        expect(storage.inputs).toHaveLength(0);
    });

    it("accepts evidence for every baseline candidate", async () => {
        // 후보 전체 증거 권한 실행
        const repository = new EvidenceStoreFake();
        // 저장공간 시험용 저장공간 준비
        const storage = new Storage();
        // 작업 시험용 근거 결과 준비
        const operation = evidence({
            clock: { now: () => NOW },
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository,
            storage
        });
        // 항목목록 시험용 배열 변환 결과 준비
        const items = Array.from({ length: 48 }, (_, index) => ({
            name: `candidate-${String(index + 1).padStart(4, "0")}.jpg`,
            contentType: "image/jpeg" as const,
            sizeBytes: 128
        }));

        // 작업 결과의 종류 지정 문자열 및 항목목록 자료의 필드 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                items
            })
        ).resolves.toMatchObject({
            kind: "GRANTED",
            items: items.map((item) => ({ name: item.name }))
        });
        // 저장공간 입력목록의 항목 수 48 확인
        expect(storage.inputs).toHaveLength(48);
    });

    it("grants one immutable checksum-bound gzip diagnostic", async () => {
        // 저장소 시험용 근거 저장소 모의 준비
        const repository = new EvidenceStoreFake();
        // 저장공간 시험용 저장공간 준비
        const storage = new Storage();
        // 해시 시험용 지정 문자열 반복문자열 결과 준비
        const sha256 = "a".repeat(64);
        // 근거 결과를 결과에 저장
        const result = await evidence({
            clock: { now: () => NOW },
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository,
            storage
        })({
            jobId: "11111111-1111-4111-8111-111111111111",
            workerId: "worker-1",
            jobRevision: 2,
            leaseToken: "lease-token",
            items: [
                {
                    name: "observations.jsonl.gz",
                    contentType: "application/gzip",
                    sizeBytes: 1_024,
                    contentSha256: sha256
                }
            ]
        });

        // 결과의 종류 지정 문자열 및 항목목록 자료 기준 구조 일치 확인
        expect(result).toEqual({
            kind: "GRANTED",
            items: [
                {
                    name: "observations.jsonl.gz",
                    objectKey: `perception/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111/2/${sha256}.jsonl.gz`,
                    uploadUrl: "http://storage.test/perception",
                    headers: {
                        "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
                        "if-none-match": "*"
                    }
                }
            ]
        });
        // 저장공간 인식 입력목록의 1개 항목 목록 기준 구조 일치 확인
        expect(storage.perceptionInputs).toEqual([
            {
                analysisId: "22222222-2222-4222-8222-222222222222",
                jobId: "11111111-1111-4111-8111-111111111111",
                jobRevision: 2,
                contentSha256: sha256,
                sizeBytes: 1_024
            }
        ]);
        // 저장공간 입력목록의 항목 수 0 확인
        expect(storage.inputs).toHaveLength(0);
    });

    it("allows a 128 MiB gzip while preserving the 50 MiB media and 200 MiB request limits", async () => {
        // 저장소 시험용 근거 저장소 모의 준비
        const repository = new EvidenceStoreFake();
        // 저장공간 시험용 저장공간 준비
        const storage = new Storage();
        // 작업 시험용 근거 결과 준비
        const operation = evidence({
            clock: { now: () => NOW },
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository,
            storage
        });
        // 시험자료 시험 입력으로 작업 식별자 11111111 1111 4111 8111 111111111111 및 작업자 식별자 작업자 1 및 작업 개정번호 2 및 임대 토큰 임대 토큰 자료 생성
        const common = {
            jobId: "11111111-1111-4111-8111-111111111111",
            workerId: "worker-1",
            jobRevision: 2,
            leaseToken: "lease-token"
        };
        // 작업 결과의 종류 지정 문자열 자료의 필드 일치 확인
        await expect(
            operation({
                ...common,
                items: [
                    {
                        name: "observations.jsonl.gz",
                        contentType: "application/gzip",
                        sizeBytes: 128 * 1_024 * 1_024,
                        contentSha256: "a".repeat(64)
                    }
                ]
            })
        ).resolves.toMatchObject({ kind: "GRANTED" });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                ...common,
                items: [
                    {
                        name: "observations.jsonl.gz",
                        contentType: "application/gzip",
                        sizeBytes: 128 * 1_024 * 1_024 + 1,
                        contentSha256: "a".repeat(64)
                    }
                ]
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                ...common,
                items: [
                    {
                        name: "candidate.mp4",
                        contentType: "video/mp4",
                        sizeBytes: 50 * 1_024 * 1_024 + 1
                    }
                ]
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                ...common,
                items: [
                    {
                        name: "observations.jsonl.gz",
                        contentType: "application/gzip",
                        sizeBytes: 128 * 1_024 * 1_024,
                        contentSha256: "a".repeat(64)
                    },
                    {
                        name: "candidate.mp4",
                        contentType: "video/mp4",
                        sizeBytes: 50 * 1_024 * 1_024
                    },
                    {
                        name: "candidate.jpg",
                        contentType: "image/jpeg",
                        sizeBytes: 23 * 1_024 * 1_024
                    }
                ]
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
    });

    it.each([
        [[{ name: "observations.jsonl.gz", contentType: "application/gzip", sizeBytes: 1_024 }]],
        [
            [
                {
                    name: "observations.jsonl.gz",
                    contentType: "application/gzip",
                    sizeBytes: 1_024,
                    contentSha256: "A".repeat(64)
                }
            ]
        ],
        [
            Array.from({ length: 2 }, (_, index) => ({
                name: `observations-${index}.jsonl.gz`,
                contentType: "application/gzip",
                sizeBytes: 1_024,
                contentSha256: `${index}`.repeat(64)
            }))
        ]
    ])("rejects malformed or repeated gzip diagnostic items %#", async (items) => {
        // 저장소 시험용 근거 저장소 모의 준비
        const repository = new EvidenceStoreFake();
        // 저장공간 시험용 저장공간 준비
        const storage = new Storage();
        // 작업 시험용 근거 결과 준비
        const operation = evidence({
            clock: { now: () => NOW },
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository,
            storage
        });
        // 입력 오류 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                items: items as never
            })
        ).resolves.toEqual({ kind: "INVALID_INPUT", reason: "ITEMS" });
        // 저장소 명령목록의 항목 수 0 확인
        expect(repository.commands).toHaveLength(0);
    });

    it("fails closed when gzip storage support is unavailable", async () => {
        // 저장소 시험용 근거 저장소 모의 준비
        const repository = new EvidenceStoreFake();
        // 기존형식 저장공간 시험 입력으로 근거 자료 생성
        const legacyStorage = {
            evidence: async () => ({ objectKey: "unused", uploadUrl: "unused" })
        };
        // 작업 시험용 근거 결과 준비
        const operation = evidence({
            clock: { now: () => NOW },
            hasher: { sha256: async () => Uint8Array.from([1]) },
            repository,
            storage: legacyStorage
        });
        // 사용 불가 내용을 포함한 기대 결과 일치 확인
        await expect(
            operation({
                jobId: "11111111-1111-4111-8111-111111111111",
                workerId: "worker-1",
                jobRevision: 2,
                leaseToken: "lease-token",
                items: [
                    {
                        name: "observations.jsonl.gz",
                        contentType: "application/gzip",
                        sizeBytes: 1_024,
                        contentSha256: "a".repeat(64)
                    }
                ]
            })
        ).resolves.toEqual({ kind: "UNAVAILABLE" });
    });
});
