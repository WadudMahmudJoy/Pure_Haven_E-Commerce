import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { POST } from "../app/api/media/uploads/route";
import { GET } from "../app/api/media/uploads/[id]/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "../lib/adminSession";
import { verifyAndGetLocalDisposableDatabase } from "./helpers/disposableDbGuard";
import { setMediaIngestService, DefaultMediaIngestService } from "../lib/media/mediaIngestService";
import { setMediaUploadStatusService, DefaultMediaUploadStatusService } from "../lib/media/mediaUploadStatusService";
import { PrismaMediaRepository } from "../lib/media/mediaRepository";
import { InMemoryMediaStorage } from "../lib/media/storage/inMemoryMediaStorage";
import { PRODUCT_IMAGE_PROFILE_V1 } from "../lib/media/processingProfile";
import type { PrismaClient } from "../generated/prisma/client";

describe("Task 16: Authenticated Managed Upload API & Status Contract", () => {
  let prisma: PrismaClient;
  let repository: PrismaMediaRepository;
  let privateStorage: InMemoryMediaStorage;
  let adminCookie: string;
  const adminEmail = "admin-qa@purehavenbd.com";

  before(async () => {
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-for-upload-route-32-chars-long";
    process.env.MANAGED_MEDIA_INGESTION_ENABLED = "true";

    const ctx = verifyAndGetLocalDisposableDatabase();
    await ctx.ensurePhase6Schema();
    prisma = ctx.createPrisma();
    await prisma.$connect();

    repository = new PrismaMediaRepository(prisma);
    privateStorage = new InMemoryMediaStorage();
    const service = new DefaultMediaIngestService(
      repository,
      privateStorage,
      "test-staging-provider",
      PRODUCT_IMAGE_PROFILE_V1
    );
    setMediaIngestService(service);

    const statusService = new DefaultMediaUploadStatusService(prisma);
    setMediaUploadStatusService(statusService);

    const token = createAdminSessionToken(adminEmail);
    adminCookie = `${ADMIN_SESSION_COOKIE}=${token}`;
  });

  after(async () => {
    setMediaIngestService(null);
    setMediaUploadStatusService(null);
    if (prisma) {
      await prisma.productImage.deleteMany({
        where: { managedMedia: { ingestActorScope: adminEmail } },
      });
      await prisma.managedMedia.updateMany({
        where: { ingestActorScope: adminEmail },
        data: { activeProcessingRunId: null, canonicalMasterObjectId: null },
      });
      await prisma.mediaObject.deleteMany({});
      await prisma.mediaProcessingRun.deleteMany({});
      await prisma.managedMedia.deleteMany({
        where: { ingestActorScope: adminEmail },
      });
      await prisma.$disconnect();
    }
  });

  async function createValidJpeg(): Promise<Uint8Array> {
    const buf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 180, g: 120, b: 60 } },
    }).jpeg().toBuffer();
    return new Uint8Array(buf);
  }

  function makePostRequest(options: {
    authenticated?: boolean;
    fileBytes?: Uint8Array;
    fileName?: string;
    mimeType?: string;
    contentLength?: number;
    idempotencyKey?: string;
    purpose?: string;
  }): Request {
    const formData = new FormData();
    if (options.fileBytes !== undefined) {
      const blob = new Blob([Buffer.from(options.fileBytes)], { type: options.mimeType ?? "image/jpeg" });
      formData.append("file", blob, options.fileName ?? "product.jpg");
    }
    if (options.purpose !== undefined) {
      formData.append("purpose", options.purpose);
    }
    if (options.idempotencyKey !== undefined) {
      formData.append("idempotencyKey", options.idempotencyKey);
    }

    const headers = new Headers();
    if (options.authenticated !== false) {
      headers.set("cookie", adminCookie);
    }
    if (options.contentLength !== undefined) {
      headers.set("content-length", options.contentLength.toString());
    }

    return new Request("http://localhost:3000/api/media/uploads", {
      method: "POST",
      headers,
      body: formData,
    });
  }

  it("rejects unauthenticated POST requests with 401", async () => {
    const req = makePostRequest({ authenticated: false });
    const res = await POST(req);
    assert.equal(res.status, 401);
  });

  it("rejects POST when managed ingestion is disabled with 403", async () => {
    process.env.MANAGED_MEDIA_INGESTION_ENABLED = "false";
    try {
      const jpeg = await createValidJpeg();
      const req = makePostRequest({ fileBytes: jpeg });
      const res = await POST(req);
      assert.equal(res.status, 403);
    } finally {
      process.env.MANAGED_MEDIA_INGESTION_ENABLED = "true";
    }
  });

  it("rejects payload exceeding 5 MB limit with 413 based on Content-Length", async () => {
    const req = makePostRequest({
      fileBytes: new Uint8Array(10),
      contentLength: 6 * 1024 * 1024,
    });
    const res = await POST(req);
    assert.equal(res.status, 413);
  });

  it("rejects unsupported container format before ingest with 400", async () => {
    const gifBytes = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;");
    const req = makePostRequest({
      fileBytes: new Uint8Array(gifBytes),
      mimeType: "image/jpeg",
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /UNSUPPORTED_FORMAT|FORMAT_MISMATCH/);
  });

  it("successfully ingests valid JPEG and returns durable PENDING state", async () => {
    const jpeg = await createValidJpeg();
    const key = `key-upload-route-${Date.now()}`;
    const req = makePostRequest({
      fileBytes: jpeg,
      idempotencyKey: key,
    });

    const res = await POST(req);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(body.mediaId);
    assert.equal(body.state, "PENDING");
    assert.equal(body.attachable, false);

    // Verify record in DB
    const media = await prisma.managedMedia.findUnique({
      where: { id: body.mediaId },
    });
    assert.ok(media);
    assert.equal(media.lifecycleState, "PENDING");
  });

  it("GET /api/media/uploads/[id] requires admin auth", async () => {
    const id = randomUUID();
    const req = new Request(`http://localhost:3000/api/media/uploads/${id}`, {
      headers: {},
    });
    const res = await GET(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 401);
  });

  it("GET works even when managed ingestion feature flag is disabled", async () => {
    process.env.MANAGED_MEDIA_INGESTION_ENABLED = "false";
    try {
      // Create a media record to query
      const id = randomUUID();
      await prisma.managedMedia.create({
        data: {
          id,
          mediaType: "IMAGE",
          lifecycleState: "PENDING",
          ingestActorScope: adminEmail,
          ingestIdempotencyKey: `flag-test-${Date.now()}`,
          ingestSha256: "dummy-sha",
          ingestByteSize: BigInt(100),
          ingestMimeType: "image/jpeg",
          stagingProviderKey: "test",
          stagingObjectKey: `staging/${id}/source`,
          stagingState: "PRESENT",
        },
      });

      const req = new Request(`http://localhost:3000/api/media/uploads/${id}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id }) });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.mediaId, id);
      assert.equal(data.state, "PENDING");
      assert.equal(data.attachable, false);
    } finally {
      process.env.MANAGED_MEDIA_INGESTION_ENABLED = "true";
    }
  });

  it("GET status returns safe previewUrl for READY media without leaking secrets", async () => {
    const mediaId = randomUUID();
    const runId = randomUUID();

    // Create a READY media record with active run and delivery renditions
    await prisma.managedMedia.create({
      data: {
        id: mediaId,
        mediaType: "IMAGE",
        lifecycleState: "READY",
        ingestActorScope: adminEmail,
        ingestIdempotencyKey: `ready-test-${Date.now()}`,
        ingestSha256: "ready-sha",
        ingestByteSize: BigInt(500),
        ingestMimeType: "image/jpeg",
        stagingProviderKey: "local-dev",
        stagingObjectKey: `staging/${mediaId}/source`,
        stagingState: "PRESENT",
        processingRuns: {
          create: {
            id: runId,
            profileVersion: "product-image-v1",
            profileDefinitionHash: "test-hash",
            state: "COMPLETE",
            completedAt: new Date(),
            mediaObjects: {
              create: [
                {
                  role: "RENDITION",
                  accessClass: "PUBLIC_DELIVERY",
                  variantKey: "webp-640",
                  storageProviderKey: "local-public",
                  objectKey: `renditions/${mediaId}/w640.webp`,
                  mimeType: "image/webp",
                  width: 640,
                  height: 480,
                  byteSize: BigInt(20000),
                  checksumSha256: "sha-webp-640",
                },
                {
                  role: "MASTER",
                  accessClass: "PRIVATE_SOURCE",
                  variantKey: "master",
                  storageProviderKey: "local-private",
                  objectKey: `masters/${mediaId}/master.webp`,
                  mimeType: "image/webp",
                  width: 1200,
                  height: 900,
                  byteSize: BigInt(100000),
                  checksumSha256: "sha-master",
                },
              ],
            },
          },
        },
      },
    });

    // Set activeProcessingRunId
    await prisma.managedMedia.update({
      where: { id: mediaId },
      data: { activeProcessingRunId: runId },
    });

    const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
      headers: { cookie: adminCookie },
    });
    const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.mediaId, mediaId);
    assert.equal(body.state, "READY");
    assert.equal(body.attachable, true);
    assert.ok(body.previewUrl, "Must have previewUrl");
    assert.match(body.previewUrl, /^https?:\/\//);

    // CRITICAL SECURITY ASSERTION: Zero provider secrets, objectKeys, or master info leaked
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("storageProviderKey"), false);
    assert.equal(serialized.includes("objectKey"), false);
    assert.equal(serialized.includes("masters/"), false);
    assert.equal(serialized.includes("local-private"), false);
    assert.equal(serialized.includes("local-public"), false);
  });

  it("GET status returns sanitized failureCode for FAILED media", async () => {
    const mediaId = randomUUID();
    await prisma.managedMedia.create({
      data: {
        id: mediaId,
        mediaType: "IMAGE",
        lifecycleState: "FAILED",
        failurePhase: "STORAGE",
        failureCode: "MEDIA_STORAGE_UNAVAILABLE",
        ingestActorScope: adminEmail,
        ingestIdempotencyKey: `failed-test-${Date.now()}`,
        ingestSha256: "failed-sha",
        ingestByteSize: BigInt(100),
        ingestMimeType: "image/jpeg",
        stagingProviderKey: "test",
        stagingObjectKey: `staging/${mediaId}/source`,
        stagingState: "PRESENT",
      },
    });

    const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
      headers: { cookie: adminCookie },
    });
    const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.mediaId, mediaId);
    assert.equal(body.state, "FAILED");
    assert.equal(body.attachable, false);
    assert.equal(body.failureCode, "MEDIA_STORAGE_UNAVAILABLE");
    assert.equal(body.previewUrl, undefined);
  });
});
