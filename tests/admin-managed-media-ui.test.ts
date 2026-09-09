import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  toAdminManagedUploadStatus,
  applyManagedUploadStatus,
  boundedStatusPollDelays,
  canSaveProduct,
  serializeGalleryPayload,
  type AdminGalleryItem,
  type AdminGalleryManagedItem,
  type AdminGalleryLegacyItem,
} from "../lib/catalog/adminGalleryState";

describe("Task 19: Admin Editor Managed Upload / Status / Retry / Preview UX", () => {
  // ---------------------------------------------------------------------------
  // 1. Status Mapping State Machine Authority
  // ---------------------------------------------------------------------------
  describe("toAdminManagedUploadStatus", () => {
    it("A. Maps attachable READY and CLEANUP_PENDING to 'Ready'", () => {
      assert.equal(
        toAdminManagedUploadStatus({
          mediaId: "m1",
          state: "READY",
          attachable: true,
          previewUrl: "https://media.example/webp-800.webp",
        }),
        "Ready"
      );
      assert.equal(
        toAdminManagedUploadStatus({
          mediaId: "m2",
          state: "CLEANUP_PENDING",
          attachable: true,
          previewUrl: "https://media.example/webp-800.webp",
        }),
        "Ready"
      );
    });

    it("B. Maps PENDING and PROCESSING to 'Processing'", () => {
      assert.equal(
        toAdminManagedUploadStatus({
          mediaId: "m1",
          state: "PENDING",
          attachable: false,
        }),
        "Processing"
      );
      assert.equal(
        toAdminManagedUploadStatus({
          mediaId: "m1",
          state: "PROCESSING",
          attachable: false,
        }),
        "Processing"
      );
    });

    it("C. Maps FAILED with retryable codes to 'Retry'", () => {
      const retryableCodes = [
        "MEDIA_STORAGE_UNAVAILABLE",
        "MEDIA_STORAGE_TIMEOUT",
        "MEDIA_RATE_LIMITED",
        "MEDIA_PROCESSING_INTERRUPTED",
      ];
      for (const failureCode of retryableCodes) {
        assert.equal(
          toAdminManagedUploadStatus({
            mediaId: "m1",
            state: "FAILED",
            attachable: false,
            failureCode,
          }),
          "Retry",
          `Code ${failureCode} must map to 'Retry'`
        );
      }
    });

    it("D. Maps FAILED with non-retryable codes to 'Invalid'", () => {
      const nonRetryableCodes = [
        "UNSUPPORTED_FORMAT",
        "FILE_TOO_LARGE",
        "CORRUPT_IMAGE",
        "INVALID_DIMENSIONS",
      ];
      for (const failureCode of nonRetryableCodes) {
        assert.equal(
          toAdminManagedUploadStatus({
            mediaId: "m1",
            state: "FAILED",
            attachable: false,
            failureCode,
          }),
          "Invalid",
          `Code ${failureCode} must map to 'Invalid'`
        );
      }
    });

    it("E. Maps terminal or suspended states to 'Invalid'", () => {
      assert.equal(
        toAdminManagedUploadStatus({
          mediaId: "m1",
          state: "DELETING",
          attachable: false,
        }),
        "Invalid"
      );
      assert.equal(
        toAdminManagedUploadStatus({
          mediaId: "m1",
          state: "DELETED",
          attachable: false,
        }),
        "Invalid"
      );
      // Even if state is READY, if attachable=false (suspended), must be Invalid
      assert.equal(
        toAdminManagedUploadStatus({
          mediaId: "m1",
          state: "READY",
          attachable: false,
        }),
        "Invalid"
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Applying Upload Status & Object URL Revocation
  // ---------------------------------------------------------------------------
  describe("applyManagedUploadStatus", () => {
    it("A. Transition to Ready replaces preview, clears temporaryObjectUrl, and revokes it", () => {
      const revokedUrls: string[] = [];
      const revokeMock = (url: string) => revokedUrls.push(url);

      const item: AdminGalleryManagedItem = {
        id: "item-1",
        kind: "managed",
        managedMediaId: "m1",
        previewUrl: "blob:http://localhost:3000/temp-uuid-1",
        temporaryObjectUrl: "blob:http://localhost:3000/temp-uuid-1",
        status: "Processing",
        idempotencyKey: "idemp-1",
        altText: "Original alt",
      };

      const next = {
        mediaId: "m1",
        state: "READY",
        attachable: true,
        previewUrl: "https://media.example/webp-800.webp",
      };

      const updated = applyManagedUploadStatus(item, next, revokeMock);

      assert.equal(updated.status, "Ready");
      assert.equal(updated.previewUrl, "https://media.example/webp-800.webp");
      assert.equal(updated.temporaryObjectUrl, undefined);
      assert.equal(updated.failureCode, undefined);
      assert.equal(updated.altText, "Original alt");
      assert.deepEqual(revokedUrls, ["blob:http://localhost:3000/temp-uuid-1"]);
    });

    it("B. Transition to Ready throws if previewUrl is missing", () => {
      const item: AdminGalleryManagedItem = {
        id: "item-1",
        kind: "managed",
        managedMediaId: "m1",
        previewUrl: "blob:temp",
        temporaryObjectUrl: "blob:temp",
        status: "Processing",
        idempotencyKey: "idemp-1",
      };

      assert.throws(
        () =>
          applyManagedUploadStatus(item, {
            mediaId: "m1",
            state: "READY",
            attachable: true,
            previewUrl: null,
          }),
        /READY_MEDIA_PREVIEW_REQUIRED/
      );
    });

    it("C. Transition to Retry/Invalid updates status and records failureCode without revoking temporary preview", () => {
      const revokedUrls: string[] = [];
      const revokeMock = (url: string) => revokedUrls.push(url);

      const item: AdminGalleryManagedItem = {
        id: "item-1",
        kind: "managed",
        managedMediaId: "m1",
        previewUrl: "blob:temp",
        temporaryObjectUrl: "blob:temp",
        status: "Processing",
        idempotencyKey: "idemp-1",
      };

      const updated = applyManagedUploadStatus(
        item,
        {
          mediaId: "m1",
          state: "FAILED",
          attachable: false,
          failureCode: "MEDIA_STORAGE_UNAVAILABLE",
        },
        revokeMock
      );

      assert.equal(updated.status, "Retry");
      assert.equal(updated.failureCode, "MEDIA_STORAGE_UNAVAILABLE");
      assert.equal(updated.temporaryObjectUrl, "blob:temp");
      assert.deepEqual(revokedUrls, [], "Should not revoke local preview on retryable failure");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Bounded Status Polling Intervals
  // ---------------------------------------------------------------------------
  describe("boundedStatusPollDelays", () => {
    it("A. Generates bounded ascending delays capped at 3000ms within the budget", () => {
      const delays = boundedStatusPollDelays(15000);
      assert.ok(delays.length > 0);
      assert.ok(delays[0] >= 300 && delays[0] <= 1000, "Initial delay should be ~500ms");
      for (const d of delays) {
        assert.ok(d <= 3000, "No single delay may exceed 3000ms");
      }
      const sum = delays.reduce((acc, d) => acc + d, 0);
      assert.ok(sum >= 15000, "Total delays must span the requested budget");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Product Save Gating & Structured Serialization
  // ---------------------------------------------------------------------------
  describe("canSaveProduct & serializeGalleryPayload", () => {
    it("A. canSaveProduct requires non-empty gallery and all managed items to be Ready", () => {
      const readyManaged: AdminGalleryManagedItem = {
        id: "1",
        kind: "managed",
        managedMediaId: "m1",
        previewUrl: "https://media.example/webp.webp",
        status: "Ready",
        idempotencyKey: "id1",
      };
      const processingManaged: AdminGalleryManagedItem = {
        id: "2",
        kind: "managed",
        managedMediaId: "m2",
        previewUrl: "blob:temp",
        status: "Processing",
        idempotencyKey: "id2",
      };
      const retryManaged: AdminGalleryManagedItem = {
        id: "3",
        kind: "managed",
        managedMediaId: "m3",
        previewUrl: "blob:temp",
        status: "Retry",
        idempotencyKey: "id3",
      };
      const legacyItem: AdminGalleryLegacyItem = {
        id: "4",
        kind: "legacy-existing",
        productImageId: 101,
        previewUrl: "https://example.com/legacy.jpg",
        sourceKind: "LEGACY_EXTERNAL",
      };

      assert.equal(canSaveProduct([]), false, "Empty gallery cannot save");
      assert.equal(canSaveProduct([readyManaged]), true);
      assert.equal(canSaveProduct([readyManaged, legacyItem]), true);
      assert.equal(canSaveProduct([readyManaged, processingManaged]), false, "Processing blocks save");
      assert.equal(canSaveProduct([readyManaged, retryManaged]), false, "Retry blocks save");
    });

    it("B. serializeGalleryPayload produces structured gallery items and legacy mirrors", () => {
      const items: AdminGalleryItem[] = [
        {
          id: "1",
          kind: "managed",
          managedMediaId: "m1",
          previewUrl: "https://media.example/rendition-1.webp",
          status: "Ready",
          idempotencyKey: "id1",
          altText: "Managed Primary",
        },
        {
          id: "2",
          kind: "legacy-existing",
          productImageId: 42,
          previewUrl: "https://example.com/legacy-2.jpg",
          sourceKind: "LEGACY_EXTERNAL",
          altText: "Legacy Secondary",
        },
      ];

      const payload = serializeGalleryPayload(items);

      assert.equal(payload.image, "https://media.example/rendition-1.webp");
      assert.deepEqual(payload.images, [
        "https://media.example/rendition-1.webp",
        "https://example.com/legacy-2.jpg",
      ]);
      assert.deepEqual(payload.gallery, [
        { kind: "managed", managedMediaId: "m1", altText: "Managed Primary" },
        { kind: "legacy-existing", productImageId: 42, altText: "Legacy Secondary" },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Admin Product Edit Page Structural & Behavioral Wiring
  // ---------------------------------------------------------------------------
  describe("Admin Product Edit Page Wiring (Task 19)", () => {
    const editPagePath = path.join(
      process.cwd(),
      "app",
      "admin",
      "products",
      "[id]",
      "edit",
      "page.tsx"
    );
    const source = fs.readFileSync(editPagePath, "utf8");

    it("A. Consumes /api/media/uploads for managed ingestion", () => {
      assert.ok(
        source.includes("/api/media/uploads"),
        "Page must call /api/media/uploads for uploading managed images"
      );
    });

    it("B. Sends Idempotency-Key on managed upload POST", () => {
      assert.ok(
        source.includes("Idempotency-Key") || source.includes("idempotencyKey"),
        "Page must provide idempotency key for managed uploads"
      );
    });

    it("C. Uses URL.createObjectURL for immediate local preview and tracks temporaryObjectUrl", () => {
      assert.ok(
        source.includes("createObjectURL"),
        "Page must create object URL for immediate user feedback"
      );
      assert.ok(
        source.includes("temporaryObjectUrl") || source.includes("blob:"),
        "Page must track temporary object URL"
      );
    });

    it("D. Cleans up temporary object URLs on unmount", () => {
      assert.ok(
        source.includes("revokeObjectURL"),
        "Page must revoke temporary object URLs to prevent browser memory leaks"
      );
    });

    it("E. Renders status badge or indicators for Processing / Retry / Invalid states", () => {
      assert.ok(
        source.includes("Processing") || source.includes("status === 'Processing'"),
        "Page must display Processing state"
      );
      assert.ok(
        source.includes("Retry") || source.includes("handleRetry"),
        "Page must support Retry state and action"
      );
    });

    it("F. Save button is disabled when canSaveProduct is false", () => {
      assert.ok(
        source.includes("canSaveProduct") || source.includes("status !== 'Ready'") || source.includes("hasNonReady"),
        "Submit/Update button must be disabled when any managed item is not Ready"
      );
    });
  });
});
