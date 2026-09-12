import { createHash as digest, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CompletionStorage, UploadStorage, EvidenceBody, EvidenceBodyStorage, EvidenceGrant, EvidenceGrantInput, EvidenceStorage, JobSourceStorage, PerceptionGrantInput, UploadGrant, UploadedObjectHead } from "@replay/application";

export type S3ObjectClient = Readonly<{
  send: (...args: any[]) => Promise<any>;
}>;

type Sign = (client: S3ObjectClient, command: unknown, expiresIn: number) => Promise<string>;

export type StorageOptions = Readonly<{
  client: S3ObjectClient;
  bucket: string;
  prefix?: string;
  expiresInSeconds?: number;
  sign?: Sign;
}>;

type HeadResult = Readonly<{
  ContentLength?: number;
  ChecksumSHA256?: string;
}>;

type Body = AsyncIterable<Uint8Array> & Readonly<{ destroy?: () => void }>;

const release = async (body: Body, iterator?: AsyncIterator<Uint8Array>): Promise<void> => {
  try {
    if (iterator?.return) await iterator.return();
  } finally {
    body.destroy?.();
  }
};

// 스트림 체크섬 계산
const checksum = async (body: Body, expectedSizeBytes: number, maxSizeBytes?: number): Promise<Uint8Array> => {
  // SHA-256 상태 생성
  const hash = digest("sha256");
  const iterator = body[Symbol.asyncIterator]();
  const limit = Math.min(expectedSizeBytes, maxSizeBytes ?? expectedSizeBytes);
  let actualSizeBytes = 0;
  let completed = false;
  try {
    while (true) {
      const item = await iterator.next();
      if (item.done) {
        completed = true;
        break;
      }
      if (!(item.value instanceof Uint8Array)) throw new Error("Object body chunk is invalid");
      actualSizeBytes += item.value.byteLength;
      if (!Number.isSafeInteger(actualSizeBytes) || actualSizeBytes > limit || actualSizeBytes > expectedSizeBytes) {
        throw new Error("Object body exceeds the verification length limit");
      }
      hash.update(item.value);
    }
    if (actualSizeBytes !== expectedSizeBytes) throw new Error("Object body length differs from HEAD");
    // 체크섬 바이트 반환
    return Uint8Array.from(hash.digest());
  } finally {
    if (!completed) await release(body, iterator);
  }
};

// 서명 URL 생성
const signer: Sign = (client, command, expiresIn) =>
  getSignedUrl(client as S3Client, command as PutObjectCommand, {
    expiresIn,
    unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
  });

// Object Key 접두사 정규화
const prefix = (value: string | undefined): string => {
  // 접두사 공백과 슬래시 제거
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "uploads";
  // 기본 접두사 선택
  return normalized.length > 0 ? normalized : "uploads";
};

// Base64 바이트 변환
const bytes = (value: string): Uint8Array => {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw new Error("Object checksum is invalid");
  }
  return Uint8Array.from(decoded);
};

// S3 저장소 어댑터
export class S3Storage implements UploadStorage, CompletionStorage, JobSourceStorage, EvidenceStorage, EvidenceBodyStorage {
  private readonly root: string;
  private readonly expiresIn: number;
  private readonly sign: Sign;

  public constructor(private readonly options: StorageOptions) {
    // 저장소 접두사 초기화
    this.root = prefix(options.prefix);
    // 서명 만료 시간 초기화
    this.expiresIn = options.expiresInSeconds ?? 900;
    // 서명 구현 초기화
    this.sign = options.sign ?? signer;
  }

  public async grant(input: Parameters<UploadStorage["grant"]>[0]): Promise<UploadGrant> {
    // 업로드 객체 키 생성
    const objectKey = `${this.root}/${input.anonymousSessionId}/${randomUUID()}.upload`;
    // 업로드 명령 생성
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.expectedSizeBytes,
    });
    // 서명 URL 발급
    const uploadUrl = await this.sign(this.options.client, command, this.expiresIn);
    // 업로드 권한 반환
    return { objectKey, uploadUrl, expiresAt: input.expiresAt };
  }

  public async head(objectKey: string, maxSizeBytes?: number): Promise<UploadedObjectHead | null> {
    // 객체 메타데이터 조회
    try {
      const result = (await this.options.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey, ChecksumMode: "ENABLED" }),
      )) as HeadResult;
      // 객체 크기 확인
      if (result.ContentLength === undefined || !Number.isSafeInteger(result.ContentLength) || result.ContentLength < 0) {
        throw new Error("Object size is unavailable");
      }
      if (maxSizeBytes !== undefined && result.ContentLength > maxSizeBytes) {
        throw new Error("Object exceeds the verification limit");
      }
      // 저장소 체크섬 확인
      if (result.ChecksumSHA256 !== undefined) {
        // 헤더 체크섬 반환
        return { sizeBytes: result.ContentLength, contentSha256: bytes(result.ChecksumSHA256) };
      }

      // 체크섬 헤더 누락 시 스트림 확인
      // 객체 본문 조회
      const downloaded = (await this.options.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
      )) as Readonly<{ Body?: Body; ContentLength?: number }>;
      // 객체 본문 확인
      if (!downloaded.Body) throw new Error("Object checksum is unavailable");
      if (downloaded.ContentLength !== undefined && downloaded.ContentLength !== result.ContentLength) {
        await release(downloaded.Body);
        throw new Error("GET content length differs from HEAD");
      }
      // 본문 체크섬 계산
      return {
        sizeBytes: result.ContentLength,
        contentSha256: await checksum(downloaded.Body, result.ContentLength, maxSizeBytes),
      };
    } catch (error) {
      // 객체 없음 결과 변환
      if (error instanceof Error && "name" in error && (error as Error & { name?: string }).name === "NotFound") {
        return null;
      }
      // 저장소 오류 전달
      throw error;
    }
  }

  public async read(objectKey: string): Promise<string> {
    // Worker가 읽을 원본 객체 주소 생성
    return this.sign(
      this.options.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
      this.expiresIn,
    );
  }

  public async evidence(input: EvidenceGrantInput): Promise<EvidenceGrant> {
    // 증거 객체 업로드 주소 생성
    const objectKey = `evidence/${input.analysisId}/${input.jobId}/${input.name}`;
    const uploadUrl = await this.sign(
      this.options.client,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      this.expiresIn,
    );
    return { objectKey, uploadUrl };
  }

  public async perception(input: PerceptionGrantInput): Promise<EvidenceGrant> {
    const checksum = Buffer.from(input.contentSha256, "hex").toString("base64");
    const objectKey = `perception/${input.analysisId}/${input.jobId}/${input.jobRevision}/${input.contentSha256}.jsonl.gz`;
    const uploadUrl = await this.sign(
      this.options.client,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: objectKey,
        ContentType: "application/gzip",
        ContentLength: input.sizeBytes,
        ChecksumSHA256: checksum,
        IfNoneMatch: "*",
      }),
      this.expiresIn,
    );
    return {
      objectKey,
      uploadUrl,
      headers: { "x-amz-checksum-sha256": checksum, "if-none-match": "*" },
    };
  }

  public async body(objectKey: string): Promise<EvidenceBody> {
    // 증거 객체 스트림 조회
    const result = await this.options.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    ) as Readonly<{ Body?: Body }>;
    if (!result.Body) throw new Error("Evidence body is unavailable");
    return { body: result.Body };
  }

  public async cleanup(objectKey: string): Promise<void> {
    // 미완료 업로드 객체 삭제
    await this.options.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    );
  }
}

// S3 저장소 생성
export const s3 = (options: StorageOptions): S3Storage => new S3Storage(options);
