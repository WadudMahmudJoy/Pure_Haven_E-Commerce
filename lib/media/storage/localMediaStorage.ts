import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  type MediaStorage,
  type PutImmutableInput,
  type StoredObjectMetadata,
  MediaStorageError,
} from "./contracts";

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export class LocalMediaStorage implements MediaStorage {
  constructor(public readonly root: string) {}

  private resolveObjectPath(objectKey: string): string {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(objectKey) || objectKey.includes("..")) {
      throw new MediaStorageError("AUTHORIZATION", `Invalid object key: ${objectKey}`);
    }
    const resolvedRoot = path.resolve(this.root);
    const resolvedPath = path.resolve(this.root, objectKey);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
      throw new MediaStorageError("AUTHORIZATION", `Path escape detected: ${objectKey}`);
    }
    return resolvedPath;
  }

  async putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata> {
    const actualSha = sha256(input.bytes);
    if (actualSha !== input.checksumSha256) {
      throw new MediaStorageError("INTEGRITY_MISMATCH", "checksum mismatch");
    }

    const targetPath = this.resolveObjectPath(input.objectKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    try {
      const handle = await fs.open(targetPath, "wx");
      try {
        await handle.writeFile(input.bytes);
      } finally {
        await handle.close();
      }

      const meta: StoredObjectMetadata = {
        objectKey: input.objectKey,
        byteSize: BigInt(input.bytes.byteLength),
        contentType: input.contentType,
        checksumSha256: actualSha,
        ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
      };

      const metaPath = `${targetPath}.meta.json`;
      await fs.writeFile(
        metaPath,
        JSON.stringify({
          objectKey: meta.objectKey,
          byteSize: meta.byteSize.toString(),
          contentType: meta.contentType,
          checksumSha256: meta.checksumSha256,
          cacheControl: meta.cacheControl,
        }),
        "utf-8"
      );

      return meta;
    } catch (err: unknown) {
      if (err instanceof MediaStorageError) throw err;

      if (isErrnoException(err)) {
        if (err.code === "EEXIST") {
          const existingBytes = await fs.readFile(targetPath);
          const existingSha = sha256(existingBytes);
          if (existingSha !== actualSha) {
            throw new MediaStorageError(
              "CONFLICT",
              `Immutable key conflict at ${input.objectKey}: content mismatch`
            );
          }

          const existingMeta = await this.headObject(input.objectKey);
          if (existingMeta) return existingMeta;

          return {
            objectKey: input.objectKey,
            byteSize: BigInt(existingBytes.byteLength),
            contentType: input.contentType,
            checksumSha256: existingSha,
            ...(input.cacheControl ? { cacheControl: input.cacheControl } : {}),
          };
        }

        if (err.code === "ENOSPC" || err.code === "EACCES" || err.code === "EIO") {
          throw new MediaStorageError("UNAVAILABLE", `Filesystem error: ${err.message}`, err);
        }
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new MediaStorageError("UNKNOWN", `Unexpected filesystem error: ${message}`, err);
    }
  }

  async headObject(objectKey: string): Promise<StoredObjectMetadata | null> {
    const targetPath = this.resolveObjectPath(objectKey);

    try {
      const stat = await fs.stat(targetPath);
      const metaPath = `${targetPath}.meta.json`;
      try {
        const metaRaw = await fs.readFile(metaPath, "utf-8");
        const parsed = JSON.parse(metaRaw);
        return {
          objectKey,
          byteSize: BigInt(parsed.byteSize),
          contentType: parsed.contentType,
          checksumSha256: parsed.checksumSha256,
          ...(parsed.cacheControl ? { cacheControl: parsed.cacheControl } : {}),
        };
      } catch {
        const bytes = await fs.readFile(targetPath);
        return {
          objectKey,
          byteSize: BigInt(stat.size),
          contentType: "application/octet-stream",
          checksumSha256: sha256(bytes),
        };
      }
    } catch (err: unknown) {
      if (err instanceof MediaStorageError) throw err;
      if (isErrnoException(err) && err.code === "ENOENT") return null;
      const message = err instanceof Error ? err.message : String(err);
      throw new MediaStorageError("UNKNOWN", `Filesystem head error: ${message}`, err);
    }
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    const targetPath = this.resolveObjectPath(objectKey);

    try {
      const buffer = await fs.readFile(targetPath);
      return new Uint8Array(buffer);
    } catch (err: unknown) {
      if (err instanceof MediaStorageError) throw err;
      if (isErrnoException(err) && err.code === "ENOENT") {
        throw new MediaStorageError("NOT_FOUND", `Object not found: ${objectKey}`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new MediaStorageError("UNKNOWN", `Filesystem get error: ${message}`, err);
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    const targetPath = this.resolveObjectPath(objectKey);

    try {
      await fs.unlink(targetPath);
    } catch (err: unknown) {
      if (err instanceof MediaStorageError) throw err;
      if (isErrnoException(err) && err.code === "ENOENT") {
        // idempotent success
      } else {
        const message = err instanceof Error ? err.message : String(err);
        throw new MediaStorageError("UNKNOWN", `Filesystem delete error: ${message}`, err);
      }
    }

    try {
      await fs.unlink(`${targetPath}.meta.json`);
    } catch {
      // ignore missing sidecar
    }
  }
}
