// 비밀 토큰과 파일 해시의 암호 기능 가져옴
import { createHash as digest, randomUUID } from "node:crypto";
// 객체 저장소 명령과 서명 기능 가져옴
import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    type S3Client
} from "@aws-sdk/client-s3";
// 객체 저장소 명령과 서명 기능 가져옴
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    CompletionStorage,
    UploadStorage,
    EvidenceBody,
    EvidenceBodyStorage,
    EvidenceGrant,
    EvidenceGrantInput,
    EvidenceStorage,
    JobSourceStorage,
    PerceptionGrantInput,
    UploadGrant,
    UploadedObjectHead
} from "@replay/application";

// 객체 저장소 명령 실행 인터페이스 정의
export type S3ObjectClient = Readonly<{
    // 객체 저장소에 명령을 전달하는 기능
    send: (...args: any[]) => Promise<any>;
}>;

// 저장소 접근 주소 서명 함수 정의
type Sign = (client: S3ObjectClient, command: unknown, expiresIn: number) => Promise<string>;

// 객체 저장소 연결과 서명 정책 정의
export type StorageOptions = Readonly<{
    // 외부 저장소와 통신하는 연결
    client: S3ObjectClient;
    // 파일을 저장하는 객체 저장소 영역
    bucket: string;
    // 다른 작업과 파일을 분리하는 경로 앞부분
    prefix?: string;
    // 서명 접근 권한의 유효 시간 초
    expiresInSeconds?: number;
    // 기한이 있는 저장소 접근 주소 발급 기능
    sign?: Sign;
}>;

// 저장 파일 크기와 해시 및 본문 조회 응답 정의
type HeadResult = Readonly<{
    // 객체 저장소에 신고하거나 조회한 바이트 길이
    ContentLength?: number;
    // 객체 저장소 형식으로 표현한 내용 해시
    ChecksumSHA256?: string;
}>;

// 본문 읽기와 종료에 필요한 저장소 스트림 계약 정의
type Body = AsyncIterable<Uint8Array> & Readonly<{ destroy?: () => void }>;

// 스트림 자원 정리
const disposal = async (body: Body, iterator?: AsyncIterator<Uint8Array>): Promise<void> => {
    // 읽기 반복자 종료 실패에도 본문 자원을 정리하는 예외 경계 설정
    try {
        // 반복자가 종료 기능을 제공하면 명시적으로 종료
        if (iterator?.return) await iterator.return();
    } finally {
        // 본문 연결이 제공하는 자원 정리 기능 실행
        body.destroy?.();
    }
};

// 스트림 체크섬 계산
const checksum = async (
    body: Body,
    expectedSizeBytes: number,
    maxSizeBytes?: number
): Promise<Uint8Array> => {
    // 보안 해시 상태 생성
    const hash = digest("sha256");
    // 저장 파일 본문을 조각 단위로 읽는 반복자 생성
    const iterator = body[Symbol.asyncIterator]();
    // 신고 크기와 서버 상한 중 작은 값으로 읽기 제한 계산
    const limit = Math.min(expectedSizeBytes, maxSizeBytes ?? expectedSizeBytes);
    // 실제로 읽은 파일 크기 합계 초기화
    let actualSizeBytes = 0;
    // 본문을 끝까지 읽었는지 추적할 상태 초기화
    let completed = false;
    // 파일 읽기 실패에도 스트림을 정리할 예외 경계 설정
    try {
        // 파일의 끝에 도달할 때까지 바이트 조각 읽기 반복
        while (true) {
            // 파일 본문의 다음 바이트 조각 읽음
            const item = await iterator.next();
            // 더 읽을 본문 조각이 없는지 확인
            if (item.done) {
                // 본문 전체 읽음 상태 기록
                completed = true;
                // 본문 끝에 도달한 읽기 반복 종료
                break;
            }
            // 해시에 사용할 수 없는 바이트 이외의 본문 조각 차단
            if (!(item.value instanceof Uint8Array))
                // 잘못된 파일 본문 조각 형식을 오류로 전달
                throw new Error("Object body chunk is invalid");
            // 실제 읽은 파일 바이트 수 누적
            actualSizeBytes += item.value.byteLength;
            // 안전한 정수 범위와 신고 크기 및 서버 읽기 상한 초과 확인
            if (
                !Number.isSafeInteger(actualSizeBytes) ||
                actualSizeBytes > limit ||
                actualSizeBytes > expectedSizeBytes
            ) {
                // 예상보다 큰 파일 읽기를 중단하는 오류 전달
                throw new Error("Object body exceeds the verification length limit");
            }
            // 현재 본문 조각을 파일 내용 해시 계산에 반영
            hash.update(item.value);
        }
        // 전체 읽기 후 신고 크기와 실제 길이 일치 확인
        if (actualSizeBytes !== expectedSizeBytes)
            // 메타데이터와 실제 본문 길이 불일치 오류 전달
            throw new Error("Object body length differs from HEAD");
        // 체크섬 바이트 반환
        return Uint8Array.from(hash.digest());
    } finally {
        // 본문을 끝까지 읽지 못했으면 남은 스트림 자원 정리
        if (!completed) await disposal(body, iterator);
    }
};

// 서명 주소 생성
const signer: Sign = (client, command, expiresIn) =>
    getSignedUrl(client as S3Client, command as PutObjectCommand, {
        // 서명 주소의 유효 시간 초
        expiresIn,
        // 서명 주소로 이동시키지 않고 요청에 남기는 헤더
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    });

// 객체 키 접두사 정규화
const prefix = (value: string | undefined): string => {
    // 접두사 공백과 슬래시 제거
    const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "uploads";
    // 기본 접두사 선택
    return normalized.length > 0 ? normalized : "uploads";
};

// 이진 자료 문자열 바이트 변환
const bytes = (value: string): Uint8Array => {
    // 저장소 체크섬 문자열을 바이트 배열로 변환
    const decoded = Buffer.from(value, "base64");
    // 체크섬을 되돌려 표현했을 때 원문과 일치하는지 확인
    if (decoded.length === 0 || decoded.toString("base64") !== value) {
        // 잘못된 체크섬 표현을 오류로 전달
        throw new Error("Object checksum is invalid");
    }
    // 확인된 체크섬 바이트 배열 반환
    return Uint8Array.from(decoded);
};

// 객체 저장소 어댑터
export class S3Storage
    implements
        UploadStorage,
        CompletionStorage,
        JobSourceStorage,
        EvidenceStorage,
        EvidenceBodyStorage
{
    // 파일 경로를 조립할 기준 접두 경로
    private readonly root: string;
    // 서명 주소의 유효 시간 초
    private readonly expiresIn: number;
    // 기한이 있는 저장소 접근 주소 발급 기능
    private readonly sign: Sign;

    // 객체 저장소 연결과 서명 정책 주입
    public constructor(private readonly options: StorageOptions) {
        // 저장소 접두사 초기화
        this.root = prefix(options.prefix);
        // 서명 만료 시간 초기화
        this.expiresIn = options.expiresInSeconds ?? 900;
        // 서명 구현 초기화
        this.sign = options.sign ?? signer;
    }

    // 미디어 업로드 권한 발급
    public async grant(input: Parameters<UploadStorage["grant"]>[0]): Promise<UploadGrant> {
        // 업로드 객체 키 생성
        const objectKey = `${this.root}/${input.anonymousSessionId}/${randomUUID()}.upload`;
        // 업로드 명령 생성
        const command = new PutObjectCommand({
            // 파일을 저장하는 객체 저장소 영역
            Bucket: this.options.bucket,
            // 객체 저장소 명령이 가리키는 파일 경로
            Key: objectKey,
            // 객체 저장소에 전달하는 콘텐츠 형식
            ContentType: input.contentType,
            // 객체 저장소에 신고하거나 조회한 바이트 길이
            ContentLength: input.expectedSizeBytes
        });
        // 서명 주소 발급
        const uploadUrl = await this.sign(this.options.client, command, this.expiresIn);
        // 업로드 권한 반환
        return { objectKey, uploadUrl, expiresAt: input.expiresAt };
    }

    // 저장된 파일 메타데이터 조회
    public async head(
        objectKey: string,
        maxSizeBytes?: number
    ): Promise<UploadedObjectHead | null> {
        // 객체 메타데이터 조회
        try {
            // 저장 파일의 실제 크기와 제공된 체크섬 조회
            const result = (await this.options.client.send(
                new HeadObjectCommand({
                    // 파일을 저장하는 객체 저장소 영역
                    Bucket: this.options.bucket,
                    // 객체 저장소 명령이 가리키는 파일 경로
                    Key: objectKey,
                    // 객체 조회에서 체크섬 반환을 요청하는 방식
                    ChecksumMode: "ENABLED"
                })
            )) as HeadResult;
            // 객체 크기 확인
            if (
                result.ContentLength === undefined ||
                !Number.isSafeInteger(result.ContentLength) ||
                result.ContentLength < 0
            ) {
                // 파일 크기를 확인할 수 없으면 검증 오류 전달
                throw new Error("Object size is unavailable");
            }
            // 메타데이터 크기가 서버의 검증 상한을 넘는지 확인
            if (maxSizeBytes !== undefined && result.ContentLength > maxSizeBytes) {
                // 허용 상한을 넘는 저장 파일의 검증 중단
                throw new Error("Object exceeds the verification limit");
            }
            // 저장소 체크섬 확인
            if (result.ChecksumSHA256 !== undefined) {
                // 헤더 체크섬 반환
                return {
                    // 파일의 바이트 크기
                    sizeBytes: result.ContentLength,
                    // 파일 내용의 동일성을 대조하는 해시
                    contentSha256: bytes(result.ChecksumSHA256)
                };
            }

            // 체크섬 헤더 누락 시 스트림 확인
            // 객체 본문 조회
            const downloaded = (await this.options.client.send(
                new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey })
            )) as Readonly<{ Body?: Body; ContentLength?: number }>;
            // 객체 본문 확인
            if (!downloaded.Body) throw new Error("Object checksum is unavailable");
            // 메타데이터 조회와 본문 읽기 사이 파일 길이 변경 확인
            if (
                downloaded.ContentLength !== undefined &&
                downloaded.ContentLength !== result.ContentLength
            ) {
                // 바뀐 파일 길이로 신뢰할 수 없는 본문 연결 정리
                await disposal(downloaded.Body);
                // 메타데이터와 다운로드 길이 불일치를 오류로 전달
                throw new Error("GET content length differs from HEAD");
            }
            // 본문 체크섬 계산
            return {
                // 파일의 바이트 크기
                sizeBytes: result.ContentLength,
                // 파일 내용의 동일성을 대조하는 해시
                contentSha256: await checksum(downloaded.Body, result.ContentLength, maxSizeBytes)
            };
        } catch (error) {
            // 객체 없음 결과 변환
            if (
                error instanceof Error &&
                "name" in error &&
                (error as Error & { name?: string }).name === "NotFound"
            ) {
                // 저장 파일 부재를 빈 조회 결과로 반환
                return null;
            }
            // 저장소 오류 전달
            throw error;
        }
    }

    // 저장된 파일 스트림 조회
    public async read(objectKey: string): Promise<string> {
        // 작업자가 읽을 원본 객체 주소 생성
        return this.sign(
            this.options.client,
            new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
            this.expiresIn
        );
    }

    // 증거 처리
    public async evidence(input: EvidenceGrantInput): Promise<EvidenceGrant> {
        // 증거 객체 업로드 주소 생성
        if (
            input.contentSha256 !== undefined &&
            (!/^[a-f0-9]{64}$/.test(input.contentSha256) ||
                !Number.isSafeInteger(input.jobRevision) ||
                input.jobRevision! < 1)
        ) {
            // 작업 판본과 내용 해시로 고정할 수 없는 증거 요청 거부
            throw new Error("invalid-immutable-evidence");
        }
        // 저장소 요청 규약에 맞게 파일 해시 표현 변환
        const checksum =
            input.contentSha256 === undefined
                ? null
                : Buffer.from(input.contentSha256, "hex").toString("base64");
        // 분석과 작업 및 내용 해시에 맞춰 저장 파일 경로 생성
        const objectKey =
            checksum === null
                ? `evidence/${input.analysisId}/${input.jobId}/${input.name}`
                : `evidence/${input.analysisId}/${input.jobId}/${input.jobRevision}/${input.contentSha256}/${input.name}`;
        // 파일 크기와 해시 조건을 포함한 업로드 서명 주소 생성
        const uploadUrl = await this.sign(
            this.options.client,
            new PutObjectCommand({
                // 파일을 저장하는 객체 저장소 영역
                Bucket: this.options.bucket,
                // 객체 저장소 명령이 가리키는 파일 경로
                Key: objectKey,
                // 객체 저장소에 전달하는 콘텐츠 형식
                ContentType: input.contentType,
                // 객체 저장소에 신고하거나 조회한 바이트 길이
                ContentLength: input.sizeBytes,
                ...(checksum === null ? {} : { ChecksumSHA256: checksum, IfNoneMatch: "*" })
            }),
            this.expiresIn
        );
        // 증거 업로드 경로와 서명 주소 및 필요한 보호 헤더 반환
        return {
            // 객체 저장소에서 파일을 찾는 경로
            objectKey,
            // 파일을 직접 전송할 기한부 서명 주소
            uploadUrl,
            ...(checksum === null
                ? {}
                : {
                      // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
                      headers: { "x-amz-checksum-sha256": checksum, "if-none-match": "*" }
                  })
        };
    }

    // 비공개 인식 산출물 업로드 권한 발급
    public async perception(input: PerceptionGrantInput): Promise<EvidenceGrant> {
        // 저장소 요청 규약에 맞게 파일 해시 표현 변환
        const checksum = Buffer.from(input.contentSha256, "hex").toString("base64");
        // 분석과 작업 및 내용 해시에 맞춰 저장 파일 경로 생성
        const objectKey = `perception/${input.analysisId}/${input.jobId}/${input.jobRevision}/${input.contentSha256}.jsonl.gz`;
        // 파일 크기와 해시 조건을 포함한 업로드 서명 주소 생성
        const uploadUrl = await this.sign(
            this.options.client,
            new PutObjectCommand({
                // 파일을 저장하는 객체 저장소 영역
                Bucket: this.options.bucket,
                // 객체 저장소 명령이 가리키는 파일 경로
                Key: objectKey,
                // 객체 저장소에 전달하는 콘텐츠 형식
                ContentType: "application/gzip",
                // 객체 저장소에 신고하거나 조회한 바이트 길이
                ContentLength: input.sizeBytes,
                // 객체 저장소 형식으로 표현한 내용 해시
                ChecksumSHA256: checksum,
                // 같은 경로의 기존 파일 덮어쓰기를 막는 조건
                IfNoneMatch: "*"
            }),
            this.expiresIn
        );
        // 비공개 관측 업로드 주소와 해시 및 덮어쓰기 방지 헤더 반환
        return {
            // 객체 저장소에서 파일을 찾는 경로
            objectKey,
            // 파일을 직접 전송할 기한부 서명 주소
            uploadUrl,
            // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
            headers: { "x-amz-checksum-sha256": checksum, "if-none-match": "*" }
        };
    }

    // 저장소 응답 본문 반환
    public async body(objectKey: string): Promise<EvidenceBody> {
        // 증거 객체 스트림 조회
        const result = (await this.options.client.send(
            new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey })
        )) as Readonly<{ Body?: Body }>;
        // 저장소 응답에 파일 본문이 없으면 읽기 실패 처리
        if (!result.Body) throw new Error("Evidence body is unavailable");
        // 확인한 저장 파일 본문 반환
        return { body: result.Body };
    }

    // 저장소 응답 자원 정리
    public async cleanup(objectKey: string): Promise<void> {
        // 미완료 업로드 객체 삭제
        await this.options.client.send(
            new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey })
        );
    }
}

// 객체 저장소 생성
export const s3 = (options: StorageOptions): S3Storage => new S3Storage(options);
