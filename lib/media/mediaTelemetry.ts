export type MediaOperationalEvent = Readonly<{
  event: string;
  mediaId?: string;
  processingRunId?: string;
  productId?: number;
  failureCode?: string;
  durationMs?: number;
  byteSize?: string;
  count?: number;
}>;

export type MediaOperationalEventInput = Omit<Partial<MediaOperationalEvent>, "byteSize"> & {
  byteSize?: string | bigint | number;
  [key: string]: unknown;
};

export interface MediaTelemetry {
  record(event: MediaOperationalEventInput): void;
  getEvents(): readonly MediaOperationalEvent[];
  clear(): void;
}

export function toSafeOperationalEvent(
  input?: MediaOperationalEventInput | null
): MediaOperationalEvent {
  const safe: {
    event: string;
    mediaId?: string;
    processingRunId?: string;
    productId?: number;
    failureCode?: string;
    durationMs?: number;
    byteSize?: string;
    count?: number;
  } = {
    event: String(input?.event ?? "UNKNOWN_EVENT"),
  };

  if (typeof input?.mediaId === "string") safe.mediaId = input.mediaId;
  if (typeof input?.processingRunId === "string") safe.processingRunId = input.processingRunId;
  if (typeof input?.productId === "number" && Number.isFinite(input.productId)) safe.productId = input.productId;
  if (typeof input?.failureCode === "string") safe.failureCode = input.failureCode;
  if (typeof input?.durationMs === "number" && Number.isFinite(input.durationMs)) safe.durationMs = input.durationMs;

  if (typeof input?.byteSize === "string") {
    safe.byteSize = input.byteSize;
  } else if (typeof input?.byteSize === "bigint") {
    safe.byteSize = input.byteSize.toString(10);
  } else if (typeof input?.byteSize === "number" && Number.isFinite(input.byteSize)) {
    safe.byteSize = input.byteSize.toString(10);
  }

  if (typeof input?.count === "number" && Number.isFinite(input.count)) safe.count = input.count;

  return Object.freeze(safe);
}

class DefaultMediaTelemetry implements MediaTelemetry {
  private events: MediaOperationalEvent[] = [];

  record(event: MediaOperationalEventInput): void {
    const safeEvent = toSafeOperationalEvent(event);
    this.events.push(safeEvent);
  }

  getEvents(): readonly MediaOperationalEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }
}

export const mediaTelemetry: MediaTelemetry = new DefaultMediaTelemetry();

export function capturedTelemetryJson(): string {
  return JSON.stringify(mediaTelemetry.getEvents());
}
