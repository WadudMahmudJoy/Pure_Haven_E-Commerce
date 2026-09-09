import type { Prisma } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";

export type MediaDbTransaction = Prisma.TransactionClient;

export interface ProductMediaAttachmentService {
  refreshCompatibilityMirrorsForMedia(
    tx: MediaDbTransaction,
    mediaId: string,
    compatibilityUrl: string
  ): Promise<void>;
}

export class DefaultProductMediaAttachmentService implements ProductMediaAttachmentService {
  constructor(private readonly prismaClient: typeof defaultPrisma = defaultPrisma) {}

  async refreshCompatibilityMirrorsForMedia(
    tx: MediaDbTransaction,
    mediaId: string,
    compatibilityUrl: string
  ): Promise<void> {
    const db = tx ?? this.prismaClient;

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
}

export const productMediaAttachmentService = new DefaultProductMediaAttachmentService();
