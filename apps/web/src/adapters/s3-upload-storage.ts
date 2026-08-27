import { createHash as digest, randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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

type Body = AsyncIterable<Uint8Array>;

const checksum = async (body: Body): Promise<Uint8Array> => {
  const hash = digest("sha256");
  for await (const chunk of body) hash.update(chunk);
  return Uint8Array.from(hash.digest());
};

const signer: Sign = (client, command, expiresIn) =>
  getSignedUrl(client as S3Client, command as PutObjectCommand, { expiresIn });

const prefix = (value: string | undefined): string => {
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "uploads";
  return normalized.length > 0 ? normalized : "uploads";
};

const bytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "base64"));

export class S3Storage implements CreateUploadStorage, CompleteUploadStorage {
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
      if (result.ContentLength === undefined) {
        throw new Error("Object size is unavailable");
      }
      if (result.ChecksumSHA256 !== undefined) {
        return { sizeBytes: result.ContentLength, contentSha256: bytes(result.ChecksumSHA256) };
      }

      // Some S3-compatible servers omit checksum headers. Stream the object instead
      // of buffering it so completion remains bounded by the hash state and chunk size.
      const downloaded = (await this.options.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: objectKey }),
      )) as Readonly<{ Body?: Body }>;
      if (!downloaded.Body) throw new Error("Object checksum is unavailable");
      return { sizeBytes: result.ContentLength, contentSha256: await checksum(downloaded.Body) };
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

export const s3 = (options: S3UploadStorageOptions): S3Storage => new S3Storage(options);
