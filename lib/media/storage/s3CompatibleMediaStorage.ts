import * as crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type HeadObjectOutput,
  type GetObjectOutput,
} from "@aws-sdk/client-s3";
import {
  type MediaStorage,
  type PutImmutableInput,
  type StoredObjectMetadata,
  MediaStorageError,
} from "./contracts";

export type S3CompatibleStorageOptions = Readonly<{
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle?: boolean;
  credentials?: Readonly<{ accessKeyId: string; secretAccessKey: string }>;
}>;

export interface AtomicS3Client {
  send<TOutput = unknown>(command: unknown): Promise<TOutput>;
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "PreconditionFailed" ||
    e.name === "AtLeastOnePreconditionFailed" ||
    e.$metadata?.httpStatusCode === 412
  );
}

function normalizeS3Error(error: unknown): MediaStorageError {
  if (error instanceof MediaStorageError) return error;
  if (!error || typeof error !== "object") {
    return new MediaStorageError("UNKNOWN", "Storage operation failed");
  }
  const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const name = e.name || "";
  const status = e.$metadata?.httpStatusCode;

  if (name === "AccessDenied" || name === "Forbidden" || status === 403) {
    return new MediaStorageError("AUTHORIZATION", "Storage authorization failed");
  }
  if (name === "SlowDown" || name === "TooManyRequestsException" || status === 429) {
    return new MediaStorageError("RATE_LIMITED", "Storage rate limited");
  }
  if (name === "TimeoutError" || name === "RequestTimeout" || status === 408) {
    return new MediaStorageError("TIMEOUT", "Storage request timed out");
  }
  if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
    return new MediaStorageError("NOT_FOUND", "Storage object not found");
  }
  if (name === "ServiceUnavailable" || status === 503) {
    return new MediaStorageError("UNAVAILABLE", "Storage service unavailable");
  }
  return new MediaStorageError("UNKNOWN", "Storage operation failed");
}

export class S3CompatibleMediaStorage implements MediaStorage {
  private readonly client: AtomicS3Client;

  constructor(
    public readonly options: S3CompatibleStorageOptions,
    client?: AtomicS3Client
  ) {
    this.client =
      client ??
      (new S3Client({
        region: options.region,
        endpoint: options.endpoint,
        forcePathStyle: options.forcePathStyle,
        credentials: options.credentials,
      }) as unknown as AtomicS3Client);
  }

  async putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata> {
    const actualSha = sha256(input.bytes);
    if (actualSha !== input.checksumSha256) {
      throw new MediaStorageError("INTEGRITY_MISMATCH", "input checksum mismatch");
    }

    const command = new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: input.objectKey,
      Body: input.bytes,
      ContentType: input.contentType,
      CacheControl: input.cacheControl,
      Metadata: { sha256: actualSha },
      IfNoneMatch: "*",
    });

    try {
      await this.client.send(command);

      return {
        objectKey: input.objectKey,
        byteSize: BigInt(input.bytes.byteLength),
        contentType: input.contentType,
        checksumSha256: actualSha,
        ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
      };
    } catch (error: unknown) {
      if (!isPreconditionFailed(error)) {
        throw normalizeS3Error(error);
      }

      const existing = await this.headObject(input.objectKey);
      if (
        !existing ||
        existing.checksumSha256 !== actualSha ||
        existing.byteSize !== BigInt(input.bytes.byteLength)
      ) {
        throw new MediaStorageError(
          "INTEGRITY_MISMATCH",
          `Immutable object conflict at ${input.objectKey}: content mismatch`
        );
      }

      return existing;
    }
  }

  async headObject(objectKey: string): Promise<StoredObjectMetadata | null> {
    try {
      const output = await this.client.send<HeadObjectOutput>(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
        })
      );

      return {
        objectKey,
        byteSize: BigInt(output.ContentLength ?? 0),
        contentType: output.ContentType ?? "application/octet-stream",
        checksumSha256: output.Metadata?.sha256 ?? "",
        ...(output.CacheControl ? { cacheControl: output.CacheControl } : {}),
      };
    } catch (error: unknown) {
      if (isNotFound(error)) return null;
      throw normalizeS3Error(error);
    }
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    try {
      const output = await this.client.send<GetObjectOutput>(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
        })
      );

      if (!output.Body) {
        throw new MediaStorageError("NOT_FOUND", `Object body not found for: ${objectKey}`);
      }

      const body = output.Body as {
        transformToByteArray?: () => Promise<Uint8Array>;
        [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
      };

      if (typeof body.transformToByteArray === "function") {
        const bytes = await body.transformToByteArray();
        return new Uint8Array(bytes);
      }

      if (body[Symbol.asyncIterator]) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }

      throw new MediaStorageError("UNKNOWN", "Unreadable S3 response stream");
    } catch (error: unknown) {
      if (error instanceof MediaStorageError) throw error;
      if (isNotFound(error)) {
        throw new MediaStorageError("NOT_FOUND", `Object not found: ${objectKey}`);
      }
      throw normalizeS3Error(error);
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.options.bucket,
          Key: objectKey,
        })
      );
    } catch (error: unknown) {
      if (!isNotFound(error)) {
        throw normalizeS3Error(error);
      }
    }
  }
}
