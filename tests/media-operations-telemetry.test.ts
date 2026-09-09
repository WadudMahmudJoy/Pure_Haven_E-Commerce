import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  mediaTelemetry,
  toSafeOperationalEvent,
  capturedTelemetryJson,
  type MediaOperationalEventInput,
} from "../lib/media/mediaTelemetry";
import {
  runDeliveryControl,
  canPerformMediaEmergencyOperation,
  type MediaOperatorActor,
} from "../scripts/phase6-media-delivery-control";
import type { MediaLifecycleService } from "../lib/media/mediaLifecycleService";

describe("Task 23: Safe Operational Telemetry + Delivery Suspension/Recovery + Operations", () => {
  beforeEach(() => {
    mediaTelemetry.clear?.();
  });

  // ---------------------------------------------------------------------------
  // 1. Telemetry Redaction & Safe Serialization
  // ---------------------------------------------------------------------------
  it("1. Redacts sensitive credentials, URLs, tokens, GPS, and provider body from telemetry", () => {
    const forbiddenSecret = "AKIAIOSFODNN7EXAMPLE_SECRET_KEY";
    const forbiddenSignedUrl = "https://r2.cloudflarestorage.com/staging/bucket?X-Amz-Signature=abc123def456";
    const forbiddenAuthHeader = "Bearer secret-jwt-session-token-xyz";
    const forbiddenCookie = "pure_haven_admin_session=sensitive-cookie-value";
    const forbiddenGps = "40.7128N,74.0060W";
    const forbiddenPrivateMaster = "s3://private-source/canonical-master/master.png";
    const forbiddenRawBody = "<Error><Code>AccessDenied</Code><Message>Secret Bucket</Message></Error>";

    // Unsafe input with sensitive fields leaked by raw caller
    const unsafeEvent: MediaOperationalEventInput = {
      event: "PROCESSING_FAILED",
      mediaId: "media-uuid-101",
      processingRunId: "run-uuid-202",
      failureCode: "STORAGE_UNAVAILABLE",
      durationMs: 420,
      byteSize: "1048576",
      count: 1,
      // Leaked sensitive fields
      secretKey: forbiddenSecret,
      signedUrl: forbiddenSignedUrl,
      authorization: forbiddenAuthHeader,
      cookies: forbiddenCookie,
      exifGps: forbiddenGps,
      masterUrl: forbiddenPrivateMaster,
      rawProviderResponse: forbiddenRawBody,
    };

    mediaTelemetry.record(unsafeEvent);
    const jsonOutput = capturedTelemetryJson();

    // Positive assertions: safe fields preserved
    assert.ok(jsonOutput.includes("PROCESSING_FAILED"), "event name must be present");
    assert.ok(jsonOutput.includes("media-uuid-101"), "mediaId must be present");
    assert.ok(jsonOutput.includes("run-uuid-202"), "processingRunId must be present");
    assert.ok(jsonOutput.includes("STORAGE_UNAVAILABLE"), "failureCode must be present");
    assert.ok(jsonOutput.includes("1048576"), "byteSize must be present");

    // Negative assertions: all sensitive fields stripped
    for (const forbidden of [
      forbiddenSecret,
      forbiddenSignedUrl,
      forbiddenAuthHeader,
      forbiddenCookie,
      forbiddenGps,
      forbiddenPrivateMaster,
      forbiddenRawBody,
    ]) {
      assert.strictEqual(
        jsonOutput.includes(forbidden),
        false,
        `Telemetry must not leak sensitive value: ${forbidden}`
      );
    }
  });

  it("2. Byte size exposed to telemetry is converted to decimal string, never raw BigInt", () => {
    const rawBigIntSize = BigInt(5242880);
    const safe = toSafeOperationalEvent({
      event: "INGEST_COMPLETED",
      mediaId: "media-uuid-102",
      byteSize: rawBigIntSize,
    });

    assert.strictEqual(typeof safe.byteSize, "string");
    assert.strictEqual(safe.byteSize, "5242880");

    mediaTelemetry.record({
      event: "INGEST_COMPLETED",
      mediaId: "media-uuid-102",
      byteSize: rawBigIntSize,
    });

    const json = capturedTelemetryJson();
    assert.ok(json.includes('"byteSize":"5242880"'));
  });

  // ---------------------------------------------------------------------------
  // 2. Privileged Suspension / Recovery Authorization & Execution
  // ---------------------------------------------------------------------------
  it("3. Ordinary editor actor is rejected with FORBIDDEN for emergency control", async () => {
    const editorActor: MediaOperatorActor = {
      id: "admin-editor-5",
      role: "EDITOR",
    };

    assert.strictEqual(canPerformMediaEmergencyOperation(editorActor), false);

    await assert.rejects(
      runDeliveryControl(editorActor, {
        action: "suspend",
        mediaId: "media-uuid-103",
        reasonCode: "DMCA_TAKEDOWN",
      }),
      /FORBIDDEN/
    );
  });

  it("4. Privileged admin actor invokes lifecycle suspend and records telemetry", async () => {
    const adminActor: MediaOperatorActor = {
      id: "admin-super-1",
      role: "SUPER_ADMIN",
    };

    assert.strictEqual(canPerformMediaEmergencyOperation(adminActor), true);

    let suspendedMediaId = "";
    let suspendedActorScope = "";
    let suspendedReason = "";

    const mockLifecycle: MediaLifecycleService = {
      suspendDelivery: async (mediaId, actorScope, reasonCode) => {
        suspendedMediaId = mediaId;
        suspendedActorScope = actorScope;
        suspendedReason = reasonCode;
      },
      recoverDelivery: async () => {},
      claimCleanupBatch: async () => [],
      cleanupClaimedMedia: async () => {},
      cleanupInactiveProfile: async () => {},
      replaceCanonicalMaster: async () => {},
    };

    await runDeliveryControl(
      adminActor,
      {
        action: "suspend",
        mediaId: "media-uuid-104",
        reasonCode: "LEGAL_REVIEW",
      },
      mockLifecycle
    );

    assert.strictEqual(suspendedMediaId, "media-uuid-104");
    assert.strictEqual(suspendedActorScope, "admin-super-1");
    assert.strictEqual(suspendedReason, "LEGAL_REVIEW");

    const json = capturedTelemetryJson();
    assert.ok(json.includes("DELIVERY_SUSPENDED"));
    assert.ok(json.includes("media-uuid-104"));
  });

  it("5. Privileged admin actor invokes lifecycle recovery and records telemetry", async () => {
    const adminActor: MediaOperatorActor = {
      id: "admin-super-1",
      role: "ADMIN",
    };

    let recoveredMediaId = "";
    let recoveredActorScope = "";
    let recoveredCandidateRunId: string | undefined;

    const mockLifecycle: MediaLifecycleService = {
      suspendDelivery: async () => {},
      recoverDelivery: async (mediaId, actorScope, candidateProcessingRunId) => {
        recoveredMediaId = mediaId;
        recoveredActorScope = actorScope;
        recoveredCandidateRunId = candidateProcessingRunId;
      },
      claimCleanupBatch: async () => [],
      cleanupClaimedMedia: async () => {},
      cleanupInactiveProfile: async () => {},
      replaceCanonicalMaster: async () => {},
    };

    await runDeliveryControl(
      adminActor,
      {
        action: "recover",
        mediaId: "media-uuid-105",
        candidateProcessingRunId: "run-uuid-303",
      },
      mockLifecycle
    );

    assert.strictEqual(recoveredMediaId, "media-uuid-105");
    assert.strictEqual(recoveredActorScope, "admin-super-1");
    assert.strictEqual(recoveredCandidateRunId, "run-uuid-303");

    const json = capturedTelemetryJson();
    assert.ok(json.includes("DELIVERY_RECOVERED"));
    assert.ok(json.includes("media-uuid-105"));
  });
});
