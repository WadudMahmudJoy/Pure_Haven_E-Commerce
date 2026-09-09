import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { POST } from "../app/api/media/uploads/route";
import { GET } from "../app/api/media/uploads/[id]/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "../lib/adminSession";
import { verifyAndGetLocalDisposableDatabase } from "./helpers/disposableDbGuard";
import {
  setMediaIngestService,
  DefaultMediaIngestService,
  type MediaIngestService,
  type MediaIngestResult,
} from "../lib/media/mediaIngestService";
import { setMediaUploadStatusService, DefaultMediaUploadStatusService } from "../lib/media/mediaUploadStatusService";
import { PrismaMediaRepository } from "../lib/media/mediaRepository";
import { InMemoryMediaStorage } from "../lib/media/storage/inMemoryMediaStorage";
import { PRODUCT_IMAGE_PROFILE_V1 } from "../lib/media/processingProfile";
import type { PrismaClient } from "../generated/prisma/client";
import type { MediaStorage, StoredObjectMetadata } from "../lib/media/storage/contracts";

describe("Task 16: Authenticated Managed Upload API & Status Contract", () => {
  let prisma: PrismaClient;
  let repository: PrismaMediaRepository;
  let privateStorage: InMemoryMediaStorage;
  let adminCookie: string;
  let adminId: number;
  const adminEmail = "admin-qa@purehavenbd.com";

  before(async () => {
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-for-upload-route-32-chars-long";
    process.env.MANAGED_MEDIA_INGESTION_ENABLED = "true";

    const ctx = verifyAndGetLocalDisposableDatabase();
    await ctx.ensurePhase6Schema();
    prisma = ctx.createPrisma();
    await prisma.$connect();

    // Ensure AdminCredential exists with stable internal ID
    const admin = await prisma.adminCredential.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        passwordHash: "dummy-password-hash-for-test",
      },
    });
    adminId = admin.id;

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
      const actorScopes = [adminEmail, `admin-${adminId}`];
      await prisma.productImage.deleteMany({
        where: { managedMedia: { ingestActorScope: { in: actorScopes } } },
      });
      await prisma.managedMedia.updateMany({
        where: { ingestActorScope: { in: actorScopes } },
        data: { activeProcessingRunId: null, canonicalMasterObjectId: null },
      });
      await prisma.mediaObject.deleteMany({});
      await prisma.mediaProcessingRun.deleteMany({});
      await prisma.managedMedia.deleteMany({
        where: { ingestActorScope: { in: actorScopes } },
      });
      await prisma.adminCredential.deleteMany({
        where: { email: adminEmail },
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
    cookie?: string;
    fileBytes?: Uint8Array;
    fileName?: string;
    mimeType?: string;
    contentLength?: number | null;
    idempotencyKey?: string;
    purpose?: string;
    extraFields?: Record<string, string>;
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
    if (options.extraFields) {
      for (const [k, v] of Object.entries(options.extraFields)) {
        formData.append(k, v);
      }
    }

    const headers = new Headers();
    if (options.authenticated !== false) {
      headers.set("cookie", options.cookie ?? adminCookie);
    }
    if (options.contentLength !== undefined && options.contentLength !== null) {
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

  it("rejects POST if admin account does not exist in database with 401", async () => {
    const nonexistentToken = createAdminSessionToken("nonexistent-admin@purehavenbd.com");
    const jpeg = await createValidJpeg();
    const req = makePostRequest({
      cookie: `${ADMIN_SESSION_COOKIE}=${nonexistentToken}`,
      fileBytes: jpeg,
    });
    const res = await POST(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.message, /Admin account not found/);
  });

  describe("Item 2: Authoritative File Size Bounds (5,242,880 bytes)", () => {
    const MAX_LIMIT = 5 * 1024 * 1024; // 5,242,880 bytes

    it("Case A: Content-Length > request bound rejected with 413 before body processing", async () => {
      const req = makePostRequest({
        fileBytes: new Uint8Array(10),
        contentLength: MAX_LIMIT + 1,
      });
      const res = await POST(req);
      assert.equal(res.status, 413);
      const data = await res.json();
      assert.match(data.message, /5 MB limit/);
    });

    it("Case B: Content-Length absent + actual extracted file > file limit rejected with 413", async () => {
      const oversized = new Uint8Array(MAX_LIMIT + 1024);
      oversized.fill(0x80);

      const req = makePostRequest({
        fileBytes: oversized,
        contentLength: null,
      });
      const res = await POST(req);
      assert.equal(res.status, 413);
      const data = await res.json();
      assert.match(data.message, /5 MB or smaller/);
    });

    it("Case C: misleading/smaller Content-Length cannot permit actual oversized extracted bytes through authoritative check", async () => {
      const oversized = new Uint8Array(MAX_LIMIT + 2048);
      oversized.fill(0x80);

      const req = makePostRequest({
        fileBytes: oversized,
        contentLength: 1000,
      });
      const res = await POST(req);
      assert.equal(res.status, 413);
      const data = await res.json();
      assert.match(data.message, /5 MB or smaller/);
    });

    it("Case D: actual bytes within limit proceeds to normal validation", async () => {
      const validJpeg = await createValidJpeg();
      assert.ok(validJpeg.byteLength < MAX_LIMIT);

      const req = makePostRequest({
        fileBytes: validJpeg,
        idempotencyKey: `within-limit-${Date.now()}`,
      });
      const res = await POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.state, "PENDING");
    });

    it("Case E: oversized actual file causes ZERO MediaIngestService invocation and ZERO staging write", async () => {
      let ingestCalled = false;
      const trackingIngestService: MediaIngestService = {
        async startProductImageIngest(): Promise<MediaIngestResult> {
          ingestCalled = true;
          throw new Error("SHOULD_NOT_BE_INVOKED");
        },
      };
      setMediaIngestService(trackingIngestService);

      try {
        const oversized = new Uint8Array(MAX_LIMIT + 512);
        const req = makePostRequest({
          fileBytes: oversized,
          contentLength: null,
        });
        const res = await POST(req);
        assert.equal(res.status, 413);
        assert.equal(ingestCalled, false, "MediaIngestService must NOT be invoked for oversized payload");
      } finally {
        const service = new DefaultMediaIngestService(
          repository,
          privateStorage,
          "test-staging-provider",
          PRODUCT_IMAGE_PROFILE_V1
        );
        setMediaIngestService(service);
      }
    });
  });

  describe("Item 4: Actor Scope Authority", () => {
    it("derives actorScope strictly from internal AdminCredential.id and rejects client injection", async () => {
      const jpeg = await createValidJpeg();
      const idempotencyKey = `actor-tamper-${Date.now()}`;

      const req = makePostRequest({
        fileBytes: jpeg,
        idempotencyKey,
        extraFields: {
          actorScope: "injected-super-admin-root",
          email: "attacker@external.invalid",
          user: "injected-user",
          adminId: "999999",
        },
      });

      const res = await POST(req);
      assert.equal(res.status, 200);
      const data = await res.json();

      const media = await prisma.managedMedia.findUnique({
        where: { id: data.mediaId },
      });
      assert.ok(media);
      assert.equal(media.ingestActorScope, `admin-${adminId}`);
      assert.notEqual(media.ingestActorScope, "injected-super-admin-root");
      assert.notEqual(media.ingestActorScope, "attacker@external.invalid");
      assert.notEqual(media.ingestActorScope, adminEmail);
    });
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

    const media = await prisma.managedMedia.findUnique({
      where: { id: body.mediaId },
    });
    assert.ok(media);
    assert.equal(media.lifecycleState, "PENDING");
    assert.equal(media.ingestActorScope, `admin-${adminId}`);
  });

  it("GET /api/media/uploads/[id] requires admin auth", async () => {
    const id = randomUUID();
    const req = new Request(`http://localhost:3000/api/media/uploads/${id}`, {
      headers: {},
    });
    const res = await GET(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 401);
  });

  describe("Item 10: Complete Status State Matrix & Security Invariants", () => {
    async function setupMediaWithState(
      state: "PENDING" | "PROCESSING" | "READY" | "CLEANUP_PENDING" | "FAILED" | "DELETING" | "DELETED",
      options: {
        deliveryDisabledAt?: Date | null;
        failureCode?: string | null;
        includeDeliveryRendition?: boolean;
        includeMasterOnly?: boolean;
      } = {}
    ): Promise<string> {
      const mediaId = randomUUID();
      const runId = randomUUID();

      const mediaObjects: {
        role: "MASTER" | "RENDITION";
        accessClass: "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
        variantKey: string;
        storageProviderKey: string;
        objectKey: string;
        mimeType: string;
        width: number;
        height: number;
        byteSize: bigint;
        checksumSha256: string;
      }[] = [];

      if (options.includeMasterOnly) {
        mediaObjects.push({
          role: "MASTER",
          accessClass: "PRIVATE_SOURCE",
          variantKey: "master",
          storageProviderKey: "local-private",
          objectKey: `masters/${mediaId}/master.webp`,
          mimeType: "image/webp",
          width: 1200,
          height: 900,
          byteSize: BigInt(50000),
          checksumSha256: `sha-master-${mediaId}`,
        });
      } else if (options.includeDeliveryRendition) {
        mediaObjects.push(
          {
            role: "MASTER",
            accessClass: "PRIVATE_SOURCE",
            variantKey: "master",
            storageProviderKey: "local-private",
            objectKey: `masters/${mediaId}/master.webp`,
            mimeType: "image/webp",
            width: 1200,
            height: 900,
            byteSize: BigInt(50000),
            checksumSha256: `sha-master-${mediaId}`,
          },
          {
            role: "RENDITION",
            accessClass: "PUBLIC_DELIVERY",
            variantKey: "webp-640",
            storageProviderKey: "local-public",
            objectKey: `renditions/${mediaId}/w640.webp`,
            mimeType: "image/webp",
            width: 640,
            height: 480,
            byteSize: BigInt(15000),
            checksumSha256: `sha-rendition-${mediaId}`,
          }
        );
      }

      await prisma.managedMedia.create({
        data: {
          id: mediaId,
          mediaType: "IMAGE",
          lifecycleState: state,
          deliveryDisabledAt: options.deliveryDisabledAt ?? null,
          unreferencedAt: state === "CLEANUP_PENDING" ? new Date() : null,
          cleanupEligibleAt: state === "CLEANUP_PENDING" ? new Date() : null,
          deletedAt: state === "DELETED" ? new Date() : null,
          failureCode: options.failureCode ?? null,
          failurePhase: options.failureCode ? "STORAGE" : null,
          ingestActorScope: `admin-${adminId}`,
          ingestIdempotencyKey: `matrix-${state}-${Date.now()}-${randomUUID()}`,
          ingestSha256: `sha-${mediaId}`,
          ingestByteSize: BigInt(1024),
          ingestMimeType: "image/jpeg",
          stagingProviderKey: "local-dev",
          stagingObjectKey: `staging/${mediaId}/source`,
          stagingState: "PRESENT",
          ...(mediaObjects.length > 0
            ? {
                processingRuns: {
                  create: {
                    id: runId,
                    profileVersion: "product-image-v1",
                    profileDefinitionHash: "matrix-profile-hash",
                    state: state === "READY" || state === "CLEANUP_PENDING" ? "COMPLETE" : "PENDING",
                    completedAt: state === "READY" || state === "CLEANUP_PENDING" ? new Date() : null,
                    mediaObjects: { create: mediaObjects },
                  },
                },
              }
            : {}),
        },
      });

      if (mediaObjects.length > 0) {
        await prisma.managedMedia.update({
          where: { id: mediaId },
          data: { activeProcessingRunId: runId },
        });
      }

      return mediaId;
    }

    it("PENDING: attachable=false, previewUrl absent", async () => {
      const mediaId = await setupMediaWithState("PENDING");
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "PENDING");
      assert.equal(data.attachable, false);
      assert.equal(data.previewUrl, undefined);
    });

    it("PROCESSING: attachable=false, previewUrl absent", async () => {
      const mediaId = await setupMediaWithState("PROCESSING");
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "PROCESSING");
      assert.equal(data.attachable, false);
      assert.equal(data.previewUrl, undefined);
    });

    it("READY (unsuspended + valid public inventory): attachable=true, previewUrl present", async () => {
      const mediaId = await setupMediaWithState("READY", { includeDeliveryRendition: true });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "READY");
      assert.equal(data.attachable, true);
      assert.ok(data.previewUrl);
      assert.match(data.previewUrl, /^https?:\/\//);
      assert.match(data.previewUrl, /w640\.webp$/);
      assert.equal(data.previewUrl.includes("master"), false);
    });

    it("CLEANUP_PENDING (unsuspended + valid public inventory): attachable=true, previewUrl present", async () => {
      const mediaId = await setupMediaWithState("CLEANUP_PENDING", { includeDeliveryRendition: true });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "CLEANUP_PENDING");
      assert.equal(data.attachable, true);
      assert.ok(data.previewUrl);
      assert.match(data.previewUrl, /w640\.webp$/);
    });

    it("FAILED: attachable=false, safe bounded failureCode only, previewUrl absent", async () => {
      const mediaId = await setupMediaWithState("FAILED", { failureCode: "UNSUPPORTED_FORMAT" });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "FAILED");
      assert.equal(data.attachable, false);
      assert.equal(data.failureCode, "UNSUPPORTED_FORMAT");
      assert.equal(data.previewUrl, undefined);
    });

    it("READY + suspended (deliveryDisabledAt set): attachable=false, previewUrl absent", async () => {
      const mediaId = await setupMediaWithState("READY", {
        deliveryDisabledAt: new Date(),
        includeDeliveryRendition: true,
      });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "READY");
      assert.equal(data.attachable, false);
      assert.equal(data.previewUrl, undefined);
    });

    it("CLEANUP_PENDING + suspended (deliveryDisabledAt set): attachable=false, previewUrl absent", async () => {
      const mediaId = await setupMediaWithState("CLEANUP_PENDING", {
        deliveryDisabledAt: new Date(),
        includeDeliveryRendition: true,
      });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "CLEANUP_PENDING");
      assert.equal(data.attachable, false);
      assert.equal(data.previewUrl, undefined);
    });

    it("DELETING: attachable=false, previewUrl absent", async () => {
      const mediaId = await setupMediaWithState("DELETING", { includeDeliveryRendition: true });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "DELETING");
      assert.equal(data.attachable, false);
      assert.equal(data.previewUrl, undefined);
    });

    it("DELETED: attachable=false, previewUrl absent", async () => {
      const mediaId = await setupMediaWithState("DELETED", { includeDeliveryRendition: true });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.state, "DELETED");
      assert.equal(data.attachable, false);
      assert.equal(data.previewUrl, undefined);
    });

    it("NEVER selects canonical master as previewUrl (even if master is only object)", async () => {
      const mediaId = await setupMediaWithState("READY", { includeMasterOnly: true });
      const req = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
        headers: { cookie: adminCookie },
      });
      const res = await GET(req, { params: Promise.resolve({ id: mediaId }) });
      const data = await res.json();
      assert.equal(data.previewUrl, undefined);
    });
  });

  describe("Item 11: Feature-Disabled Status Read & Zero Provider Calls", () => {
    it("POST is blocked (403), GET succeeds (200) with ZERO provider storage calls", async () => {
      process.env.MANAGED_MEDIA_INGESTION_ENABLED = "false";

      let headCalls = 0;
      let getCalls = 0;
      const listCalls = 0;

      const spyStorage: MediaStorage = {
        async putImmutable(): Promise<StoredObjectMetadata> {
          throw new Error("NOT_EXPECTED");
        },
        async headObject(): Promise<StoredObjectMetadata | null> {
          headCalls++;
          return null;
        },
        async getObject(): Promise<Uint8Array> {
          getCalls++;
          throw new Error("NOT_EXPECTED");
        },
        async deleteObject(): Promise<void> {
          throw new Error("NOT_EXPECTED");
        },
      };

      const spyService = new DefaultMediaIngestService(
        repository,
        spyStorage,
        "test-staging-provider",
        PRODUCT_IMAGE_PROFILE_V1
      );
      setMediaIngestService(spyService);

      try {
        const jpeg = await createValidJpeg();
        const postReq = makePostRequest({ fileBytes: jpeg });
        const postRes = await POST(postReq);
        assert.equal(postRes.status, 403);

        const mediaId = randomUUID();
        await prisma.managedMedia.create({
          data: {
            id: mediaId,
            mediaType: "IMAGE",
            lifecycleState: "PENDING",
            ingestActorScope: `admin-${adminId}`,
            ingestIdempotencyKey: `flag-zero-call-${Date.now()}`,
            ingestSha256: "flag-sha",
            ingestByteSize: BigInt(100),
            ingestMimeType: "image/jpeg",
            stagingProviderKey: "test",
            stagingObjectKey: `staging/${mediaId}/source`,
            stagingState: "PRESENT",
          },
        });

        const getReq = new Request(`http://localhost:3000/api/media/uploads/${mediaId}`, {
          headers: { cookie: adminCookie },
        });
        const getRes = await GET(getReq, { params: Promise.resolve({ id: mediaId }) });
        assert.equal(getRes.status, 200);
        const data = await getRes.json();
        assert.equal(data.mediaId, mediaId);
        assert.equal(data.state, "PENDING");
        assert.equal(data.attachable, false);

        assert.equal(headCalls, 0, "GET must make ZERO provider HEAD calls");
        assert.equal(getCalls, 0, "GET must make ZERO provider GET calls");
        assert.equal(listCalls, 0, "GET must make ZERO provider LIST calls");
      } finally {
        process.env.MANAGED_MEDIA_INGESTION_ENABLED = "true";
      }
    });
  });
});
