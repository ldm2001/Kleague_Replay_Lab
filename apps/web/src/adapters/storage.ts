import { createHash as digest, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CompletionStorage, UploadStorage, EvidenceBody, EvidenceBodyStorage, EvidenceGrant, EvidenceGrantInput, EvidenceStorage, JobSourceStorage, UploadGrant, UploadedObjectHead } from "@replay/application";

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

type Body = AsyncIterable<Uint8Array>;

// 스트림 체크섬 계산
const checksum = async (body: Body): Promise<Uint8Array> => {
  // SHA-256 상태 생성
  const hash = digest("sha256");
  // 스트림 청크 순회
  for await (const chunk of body) hash.update(chunk);
  // 체크섬 바이트 반환
  return Uint8Array.from(hash.digest());
};

// 서명 URL 생성
const signer: Sign = (client, command, expiresIn) =>
  getSignedUrl(client as S3Client, command as PutObjectCommand, { expiresIn });

// Object Key 접두사 정규화
const prefix = (value: string | undefined): string => {
  // 접두사 공백과 슬래시 제거
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "uploads";
  // 기본 접두사 선택
  return normalized.length > 0 ? normalized : "uploads";
};

// Base64 바이트 변환
const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "base64"));

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

  public async head(objectKey: string): Promise<UploadedObjectHead | null> {
    // 객체 메타데이터 조회
    try {
      const result = (await this.options.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
      )) as HeadResult;
      // 객체 크기 확인
      if (result.ContentLength === undefined) {
        throw new Error("Object size is unavailable");
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
      )) as Readonly<{ Body?: Body }>;
      // 객체 본문 확인
      if (!downloaded.Body) throw new Error("Object checksum is unavailable");
      // 본문 체크섬 계산
      return { sizeBytes: result.ContentLength, contentSha256: await checksum(downloaded.Body) };
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
    return this.sign(
      this.options.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
      this.expiresIn,
    );
  }

  public async evidence(input: EvidenceGrantInput): Promise<EvidenceGrant> {
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

  public async body(objectKey: string): Promise<EvidenceBody> {
    const result = await this.options.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    ) as Readonly<{ Body?: Body }>;
    if (!result.Body) throw new Error("Evidence body is unavailable");
    return { body: result.Body };
  }

  public async cleanup(objectKey: string): Promise<void> {
    await this.options.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    );
  }
}

// S3 저장소 생성
export const s3 = (options: StorageOptions): S3Storage => new S3Storage(options);
