import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicResponsiveImageDto,
  type DeliveryReadyManagedMediaInput,
  type MediaDeliveryResolver,
} from "../lib/media/publicMediaDto";
import { ConfiguredMediaDeliveryResolver } from "../lib/media/delivery";

describe("MediaDeliveryResolver & Public Responsive DTOs (Task 12)", () => {
  const origin = "https://media.purehavenbd.com";
  const resolver: MediaDeliveryResolver = new ConfiguredMediaDeliveryResolver(origin);

  const sampleRenditions = [
    {
      variantKey: "webp-320",
      role: "RENDITION" as const,
      accessClass: "PUBLIC_DELIVERY" as const,
      mimeType: "image/webp",
      width: 320,
      height: 320,
      byteSize: BigInt(12000),
      objectKey: "renditions/uuid-1/w320.webp",
      deletedAt: null,
    },
    {
      variantKey: "webp-640",
      role: "RENDITION" as const,
      accessClass: "PUBLIC_DELIVERY" as const,
      mimeType: "image/webp",
      width: 640,
      height: 640,
      byteSize: BigInt(24000),
      objectKey: "renditions/uuid-1/w640.webp",
      deletedAt: null,
    },
    {
      variantKey: "avif-320",
      role: "RENDITION" as const,
      accessClass: "PUBLIC_DELIVERY" as const,
      mimeType: "image/avif",
      width: 320,
      height: 320,
      byteSize: BigInt(9000),
      objectKey: "renditions/uuid-1/w320.avif",
      deletedAt: null,
    },
    {
      variantKey: "avif-640",
      role: "RENDITION" as const,
      accessClass: "PUBLIC_DELIVERY" as const,
      mimeType: "image/avif",
      width: 640,
      height: 640,
      byteSize: BigInt(18000),
      objectKey: "renditions/uuid-1/w640.avif",
      deletedAt: null,
    },
    {
      variantKey: "master",
      role: "MASTER" as const,
      accessClass: "PRIVATE_SOURCE" as const,
      mimeType: "image/webp",
      width: 1200,
      height: 1200,
      byteSize: BigInt(150000),
      objectKey: "masters/uuid-1/canonical.webp",
      deletedAt: null,
    },
    {
      variantKey: "webp-deleted",
      role: "RENDITION" as const,
      accessClass: "PUBLIC_DELIVERY" as const,
      mimeType: "image/webp",
      width: 960,
      height: 960,
      byteSize: BigInt(45000),
      objectKey: "renditions/uuid-1/w960-deleted.webp",
      deletedAt: new Date(),
    },
  ];

  const readyInputWithAvif: DeliveryReadyManagedMediaInput = {
    mediaId: "uuid-media-1",
    lifecycleState: "READY",
    deliveryDisabledAt: null,
    activeProfileVersion: "product-image-v1",
    width: 1200,
    height: 1200,
    objects: sampleRenditions,
  };

  const readyInputWebpOnly: DeliveryReadyManagedMediaInput = {
    mediaId: "uuid-media-2",
    lifecycleState: "READY",
    deliveryDisabledAt: null,
    activeProfileVersion: "product-image-v1",
    width: 1200,
    height: 1200,
    objects: sampleRenditions.filter((r) => r.mimeType === "image/webp"),
  };

  // 1. Pure Resolver Contract
  describe("ConfiguredMediaDeliveryResolver", () => {
    it("purely resolves public URL from configured media origin and object key", () => {
      const url = resolver.resolvePublicUrl("renditions/uuid-1/w320.webp");
      assert.strictEqual(
        url,
        "https://media.purehavenbd.com/renditions/uuid-1/w320.webp"
      );
    });

    it("normalizes origin trailing slashes safely", () => {
      const trailingSlashResolver = new ConfiguredMediaDeliveryResolver("https://cdn.example.com/");
      const url = trailingSlashResolver.resolvePublicUrl("images/test.webp");
      assert.strictEqual(url, "https://cdn.example.com/images/test.webp");
    });

    it("rejects path traversal attempts in objectKey", () => {
      assert.throws(
        () => resolver.resolvePublicUrl("../escape/file.webp"),
        /INVALID_OBJECT_KEY/
      );
    });
  });

  // 2. DTO Builder & Source Order Authority
  describe("buildPublicResponsiveImageDto", () => {
    it("authoritatively orders sources: AVIF first, WebP second when AVIF is present", () => {
      const dto = buildPublicResponsiveImageDto(readyInputWithAvif, resolver);
      assert.strictEqual(dto.mediaId, "uuid-media-1");
      assert.strictEqual(dto.width, 1200);
      assert.strictEqual(dto.height, 1200);

      assert.strictEqual(dto.sources.length, 2);
      assert.strictEqual(dto.sources[0].type, "image/avif");
      assert.strictEqual(dto.sources[1].type, "image/webp");

      // Verify width ordering inside srcSet
      assert.ok(dto.sources[0].srcSet.includes("w320.avif 320w"));
      assert.ok(dto.sources[0].srcSet.includes("w640.avif 640w"));
    });

    it("emits only WebP when AVIF is absent", () => {
      const dto = buildPublicResponsiveImageDto(readyInputWebpOnly, resolver);
      assert.strictEqual(dto.sources.length, 1);
      assert.strictEqual(dto.sources[0].type, "image/webp");
    });

    it("always uses WebP as fallbackSrc", () => {
      const dto = buildPublicResponsiveImageDto(readyInputWithAvif, resolver);
      assert.ok(dto.fallbackSrc.endsWith(".webp"));
      assert.ok(dto.fallbackSrc.startsWith("https://media.purehavenbd.com/"));
    });

    it("fails closed when WebP fallback rendition is missing", () => {
      const noWebpInput: DeliveryReadyManagedMediaInput = {
        ...readyInputWithAvif,
        objects: sampleRenditions.filter((r) => r.mimeType !== "image/webp"),
      };
      assert.throws(
        () => buildPublicResponsiveImageDto(noWebpInput, resolver),
        /WEBP_FALLBACK_REQUIRED/
      );
    });
  });

  // 3. Security, Suspension & Negative Invariants
  describe("Security & Suspension Hard Guards", () => {
    it("rejects DTO generation when deliveryDisabledAt is set (suspended)", () => {
      const suspendedInput: DeliveryReadyManagedMediaInput = {
        ...readyInputWithAvif,
        deliveryDisabledAt: new Date(),
      };
      assert.throws(
        () => buildPublicResponsiveImageDto(suspendedInput, resolver),
        /MEDIA_DELIVERY_DISABLED/
      );
    });

    it("rejects non-deliverable lifecycle states (FAILED, PENDING, DELETED)", () => {
      const failedInput: DeliveryReadyManagedMediaInput = {
        ...readyInputWithAvif,
        lifecycleState: "FAILED" as unknown as DeliveryReadyManagedMediaInput["lifecycleState"],
      };
      assert.throws(
        () => buildPublicResponsiveImageDto(failedInput, resolver),
        /INVALID_LIFECYCLE_STATE/
      );
    });

    it("NEVER exposes canonical master or PRIVATE_SOURCE in DTO sources or fallback", () => {
      const dto = buildPublicResponsiveImageDto(readyInputWithAvif, resolver);
      const json = JSON.stringify(dto);
      assert.strictEqual(json.includes("canonical.webp"), false);
      assert.strictEqual(json.includes("MASTER"), false);
      assert.strictEqual(json.includes("PRIVATE_SOURCE"), false);
    });

    it("NEVER includes deleted renditions", () => {
      const dto = buildPublicResponsiveImageDto(readyInputWithAvif, resolver);
      const json = JSON.stringify(dto);
      assert.strictEqual(json.includes("w960-deleted.webp"), false);
    });

    it("contains zero provider/cloud vendor identifiers", () => {
      const dto = buildPublicResponsiveImageDto(readyInputWithAvif, resolver);
      const json = JSON.stringify(dto);
      assert.strictEqual(/r2Bucket|awsS3Key|Cloudflare.*Account/i.test(json), false);
    });
  });
});
