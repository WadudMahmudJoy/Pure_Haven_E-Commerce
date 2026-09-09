import type { MediaDeliveryResolver } from "./publicMediaDto";

export function assertPublicObjectKey(objectKey: string): void {
  if (!objectKey || !/^[a-zA-Z0-9/_\-.]+$/.test(objectKey) || objectKey.includes("..")) {
    throw new Error(`INVALID_OBJECT_KEY: invalid or unsafe key: ${objectKey}`);
  }
}

export class ConfiguredMediaDeliveryResolver implements MediaDeliveryResolver {
  private readonly baseUrl: string;

  constructor(mediaOrigin: string) {
    if (!mediaOrigin) {
      throw new Error("MEDIA_ORIGIN_REQUIRED: Media delivery resolver requires a configured origin");
    }
    this.baseUrl = mediaOrigin.endsWith("/") ? mediaOrigin : `${mediaOrigin}/`;
  }

  resolvePublicUrl(objectKey: string): string {
    assertPublicObjectKey(objectKey);
    // Pure URL resolution without network I/O
    return new URL(objectKey, this.baseUrl).toString();
  }
}
