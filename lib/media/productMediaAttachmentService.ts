import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ConfiguredMediaDeliveryResolver,
  type MediaDeliveryResolver,
} from "./delivery";

export type MediaDbTransaction = Prisma.TransactionClient;

export interface ProductMediaAttachmentService {
  refreshCompatibilityMirrorsForMedia(
    tx: MediaDbTransaction,
    mediaId: string,
    compatibilityUrl: string
  ): Promise<void>;

  validateAndAttachMedia(
    tx: MediaDbTransaction,
    mediaId: string
  ): Promise<Readonly<{ compatibilityUrl: string }>>;

  handleDetachedMedia(
    tx: MediaDbTransaction,
    mediaIds: readonly string[],
    gracePeriodMs?: number
  ): Promise<void>;
}

export class DefaultProductMediaAttachmentService implements ProductMediaAttachmentService {
  constructor(
    private readonly prismaClient?: PrismaClient | MediaDbTransaction,
    private readonly deliveryResolver: MediaDeliveryResolver = new ConfiguredMediaDeliveryResolver(
      process.env.MEDIA_PUBLIC_ORIGIN || "http://localhost:3000/media"
    )
  ) {}

  private async getDb(tx?: MediaDbTransaction): Promise<PrismaClient | MediaDbTransaction> {
    if (tx) return tx;
    if (this.prismaClient) return this.prismaClient;
    const { prisma } = await import("@/lib/prisma");
    return prisma;
  }

  async refreshCompatibilityMirrorsForMedia(
    tx: MediaDbTransaction,
    mediaId: string,
    compatibilityUrl: string
  ): Promise<void> {
    const db = tx ?? (await this.getDb(tx));

    // 1. Update all ProductImage rows attached to this ManagedMedia
    const productImages = await db.productImage.findMany({
      where: { managedMediaId: mediaId },
      select: { id: true, productId: true, sortOrder: true },
    });

    if (productImages.length === 0) {
      return;
    }

    await db.productImage.updateMany({
      where: { managedMediaId: mediaId },
      data: { url: compatibilityUrl },
    });

    // 2. Identify unique products affected
    const productIds = Array.from(new Set(productImages.map((pi) => pi.productId)));

    for (const productId of productIds) {
      // Find the primary (first-ordered) image for this product
      const primaryImage = await db.productImage.findFirst({
        where: { productId },
        orderBy: { sortOrder: "asc" },
        select: { managedMediaId: true },
      });

      // Only mirror to Product.image if the primary image is this ManagedMedia
      if (primaryImage && primaryImage.managedMediaId === mediaId) {
        await db.product.update({
          where: { id: productId },
          data: { image: compatibilityUrl },
        });
      }
    }
  }

  async validateAndAttachMedia(
    tx: MediaDbTransaction,
    mediaId: string
  ): Promise<Readonly<{ compatibilityUrl: string }>> {
    const db = tx ?? (await this.getDb(tx));

    const media = await db.managedMedia.findUnique({
      where: { id: mediaId },
      include: {
        activeProcessingRun: {
          include: {
            mediaObjects: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    if (!media) {
      throw new Error("MEDIA_NOT_ATTACHABLE: Media not found");
    }

    if (media.deliveryDisabledAt !== null) {
      throw new Error("MEDIA_DELIVERY_DISABLED: Delivery is suspended for this media");
    }

    if (!["READY", "CLEANUP_PENDING"].includes(media.lifecycleState)) {
      throw new Error(`MEDIA_NOT_ATTACHABLE: Invalid lifecycle state ${media.lifecycleState}`);
    }

    if (!media.activeProcessingRunId || !media.activeProcessingRun || media.activeProcessingRun.state !== "COMPLETE") {
      throw new Error("RENDITION_SET_INCOMPLETE: No complete active processing run");
    }

    const publicWebpObjects = media.activeProcessingRun.mediaObjects.filter(
      (obj) => obj.role === "RENDITION" && obj.accessClass === "PUBLIC_DELIVERY" && obj.mimeType === "image/webp"
    );

    if (publicWebpObjects.length === 0) {
      throw new Error("RENDITION_SET_INCOMPLETE: Missing mandatory WebP delivery renditions");
    }

    if (media.lifecycleState === "CLEANUP_PENDING") {
      await db.managedMedia.update({
        where: { id: media.id },
        data: {
          lifecycleState: "READY",
          unreferencedAt: null,
          cleanupEligibleAt: null,
        },
      });
    }

    const primaryRendition = [...publicWebpObjects].sort((a, b) => b.width - a.width)[0];
    const compatibilityUrl = this.deliveryResolver.resolvePublicUrl(primaryRendition.objectKey);

    return { compatibilityUrl };
  }

  async handleDetachedMedia(
    tx: MediaDbTransaction,
    mediaIds: readonly string[],
    gracePeriodMs: number = 7 * 24 * 60 * 60 * 1000
  ): Promise<void> {
    const db = tx ?? (await this.getDb(tx));
    const now = new Date();
    const cleanupEligibleAt = new Date(now.getTime() + gracePeriodMs);

    for (const mediaId of mediaIds) {
      const refCount = await db.productImage.count({
        where: { managedMediaId: mediaId },
      });

      if (refCount === 0) {
        const media = await db.managedMedia.findUnique({
          where: { id: mediaId },
          select: { lifecycleState: true },
        });

        if (media && media.lifecycleState === "READY") {
          await db.managedMedia.update({
            where: { id: mediaId },
            data: {
              lifecycleState: "CLEANUP_PENDING",
              unreferencedAt: now,
              cleanupEligibleAt,
            },
          });
        }
      }
    }
  }
}

export const productMediaAttachmentService = new DefaultProductMediaAttachmentService();
