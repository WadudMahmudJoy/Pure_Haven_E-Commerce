import { prisma as defaultPrisma } from "@/lib/prisma";
import { canAttachManagedMedia, type ManagedMediaLifecycleState } from "./domain";
import {
  buildPublicResponsiveImageDto,
  type DeliveryReadyManagedMediaInput,
  type MediaDeliveryResolver,
} from "./publicMediaDto";
import { ConfiguredMediaDeliveryResolver } from "./delivery";

export type ManagedMediaUploadStatusResponse = Readonly<{
  mediaId: string;
  state: ManagedMediaLifecycleState;
  attachable: boolean;
  previewUrl?: string;
  failureCode?: string;
}>;

export interface MediaUploadStatusService {
  getProductImageUploadStatus(mediaId: string): Promise<ManagedMediaUploadStatusResponse | null>;
}

export class DefaultMediaUploadStatusService implements MediaUploadStatusService {
  constructor(
    private readonly client: typeof defaultPrisma = defaultPrisma,
    private readonly deliveryResolver: MediaDeliveryResolver = new ConfiguredMediaDeliveryResolver(
      process.env.MEDIA_PUBLIC_ORIGIN || "https://media.purehavenbd.com"
    )
  ) {}

  async getProductImageUploadStatus(
    mediaId: string
  ): Promise<ManagedMediaUploadStatusResponse | null> {
    const media = await this.client.managedMedia.findUnique({
      where: { id: mediaId },
      include: {
        activeProcessingRun: {
          include: {
            mediaObjects: true,
          },
        },
      },
    });

    if (!media) {
      return null;
    }

    const attachable = canAttachManagedMedia(media.lifecycleState, media.deliveryDisabledAt);
    let previewUrl: string | undefined;

    if (attachable && media.activeProcessingRun && media.activeProcessingRun.mediaObjects.length > 0) {
      try {
        const deliveryInput: DeliveryReadyManagedMediaInput = {
          mediaId: media.id,
          lifecycleState: media.lifecycleState as "READY" | "CLEANUP_PENDING",
          deliveryDisabledAt: media.deliveryDisabledAt,
          activeProfileVersion: media.activeProcessingRun.profileVersion,
          width: media.sourceWidth ?? 1200,
          height: media.sourceHeight ?? 900,
          objects: media.activeProcessingRun.mediaObjects.map((o) => ({
            variantKey: o.variantKey,
            role: o.role as "MASTER" | "RENDITION",
            accessClass: o.accessClass as "PRIVATE_SOURCE" | "PUBLIC_DELIVERY",
            mimeType: o.mimeType,
            width: o.width,
            height: o.height,
            byteSize: o.byteSize,
            objectKey: o.objectKey,
            deletedAt: o.deletedAt,
          })),
        };

        const dto = buildPublicResponsiveImageDto(deliveryInput, this.deliveryResolver);
        previewUrl = dto.fallbackSrc;
      } catch {
        previewUrl = undefined;
      }
    }

    return {
      mediaId: media.id,
      state: media.lifecycleState,
      attachable,
      ...(previewUrl ? { previewUrl } : {}),
      ...(media.failureCode ? { failureCode: media.failureCode } : {}),
    };
  }
}

export const defaultMediaUploadStatusService = new DefaultMediaUploadStatusService();

let _activeStatusService: MediaUploadStatusService | null = null;

export function getMediaUploadStatusService(): MediaUploadStatusService {
  return _activeStatusService ?? defaultMediaUploadStatusService;
}

export function setMediaUploadStatusService(service: MediaUploadStatusService | null): void {
  _activeStatusService = service;
}
