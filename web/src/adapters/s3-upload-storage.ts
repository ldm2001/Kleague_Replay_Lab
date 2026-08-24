import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CompleteUploadStorage, CreateUploadStorage, UploadGrant, UploadedObjectHead } from "@replay/application";

export type S3ObjectClient = Readonly<{
  send: (...args: any[]) => Promise<any>;
}>;

type Sign = (client: S3ObjectClient, command: unknown, expiresIn: number) => Promise<string>;

export type S3UploadStorageOptions = Readonly<{
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

const signer: Sign = (client, command, expiresIn) =>
  getSignedUrl(client as S3Client, command as PutObjectCommand, { expiresIn });

const prefix = (value: string | undefined): string => {
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "uploads";
  return normalized.length > 0 ? normalized : "uploads";
};

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "base64"));

export class S3UploadStorage implements CreateUploadStorage, CompleteUploadStorage {
  private readonly root: string;
  private readonly expiresIn: number;
  private readonly sign: Sign;

  public constructor(private readonly options: S3UploadStorageOptions) {
    this.root = prefix(options.prefix);
    this.expiresIn = options.expiresInSeconds ?? 900;
    this.sign = options.sign ?? signer;
  }

  public async grant(input: Parameters<CreateUploadStorage["grant"]>[0]): Promise<UploadGrant> {
    const objectKey = `${this.root}/${input.anonymousSessionId}/${randomUUID()}.upload`;
    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.expectedSizeBytes,
    });
    const uploadUrl = await this.sign(this.options.client, command, this.expiresIn);
    return { objectKey, uploadUrl, expiresAt: input.expiresAt };
  }

  public async head(objectKey: string): Promise<UploadedObjectHead | null> {
    try {
      const result = (await this.options.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
      )) as HeadResult;
      if (result.ContentLength === undefined || result.ChecksumSHA256 === undefined) {
        throw new Error("Object checksum is unavailable");
      }
      return { sizeBytes: result.ContentLength, contentSha256: bytes(result.ChecksumSHA256) };
    } catch (error) {
      if (error instanceof Error && "name" in error && (error as Error & { name?: string }).name === "NotFound") {
        return null;
      }
      throw error;
    }
  }

  public async cleanup(objectKey: string): Promise<void> {
    await this.options.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
    );
  }
}

export const s3 = (options: S3UploadStorageOptions): S3UploadStorage => new S3UploadStorage(options);
