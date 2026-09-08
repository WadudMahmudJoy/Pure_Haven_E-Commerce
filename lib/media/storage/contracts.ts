export type MediaStorageErrorCode =
  | "AUTHORIZATION"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "CONFLICT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTEGRITY_MISMATCH"
  | "UNKNOWN";

export class MediaStorageError extends Error {
  constructor(
    public readonly code: MediaStorageErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "MediaStorageError";
  }
}

export type PutImmutableInput = Readonly<{
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  cacheControl?: string;
  checksumSha256: string;
}>;

export type StoredObjectMetadata = Readonly<{
  objectKey: string;
  byteSize: bigint;
  contentType: string;
  checksumSha256: string;
  cacheControl?: string;
}>;

export interface MediaStorage {
  putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata>;
  headObject(objectKey: string): Promise<StoredObjectMetadata | null>;
  getObject(objectKey: string): Promise<Uint8Array>;
  deleteObject(objectKey: string): Promise<void>;
}
