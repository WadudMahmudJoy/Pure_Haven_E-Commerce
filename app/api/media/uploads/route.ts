import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAdmin, getAdminSessionFromRequest } from "@/lib/adminSession";
import { isManagedMediaIngestionEnabled } from "@/lib/media/config";
import { validateProductImageUploadEnvelope } from "@/lib/media/imageProcessor";
import { getMediaIngestService } from "@/lib/media/mediaIngestService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: Request) {
  // 1. Ingestion feature gate
  if (!isManagedMediaIngestionEnabled()) {
    return NextResponse.json(
      { success: false, message: "Managed media ingestion is currently disabled." },
      { status: 403 }
    );
  }

  // 2. Admin authorization gate
  const unauthorized = requireAdmin(req);
  if (unauthorized) {
    return unauthorized;
  }

  // 3. Early Content-Length bound
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { success: false, message: "Upload payload exceeds 5 MB limit." },
      { status: 413 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        { success: false, message: "A non-empty image file is required." },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { success: false, message: "Image must be 5 MB or smaller." },
        { status: 413 }
      );
    }

    const purpose = formData.get("purpose") || "PRODUCT_IMAGE";
    if (purpose !== "PRODUCT_IMAGE") {
      return NextResponse.json(
        { success: false, message: "Only PRODUCT_IMAGE purpose is currently supported." },
        { status: 400 }
      );
    }

    const session = getAdminSessionFromRequest(req);
    const actorScope = session ? session.email : "admin";
    const idempotencyKey =
      formData.get("idempotencyKey")?.toString() ||
      req.headers.get("idempotency-key") ||
      randomUUID();

    const bytes = new Uint8Array(await file.arrayBuffer());
    const declaredMimeType = file.type;
    const originalFilename = file.name;

    // 4. Inexpensive preliminary envelope admission
    let envelope;
    try {
      envelope = validateProductImageUploadEnvelope({ bytes, declaredMimeType });
    } catch (err: unknown) {
      return NextResponse.json(
        { success: false, message: (err as Error).message },
        { status: 400 }
      );
    }

    // 5. Durable ingest allocation and staging
    const ingestService = getMediaIngestService();
    const result = await ingestService.startProductImageIngest({
      actorScope,
      idempotencyKey,
      bytes,
      declaredMimeType: envelope.normalizedMimeType,
      originalFilename,
    });

    return NextResponse.json({
      mediaId: result.mediaId,
      state: result.lifecycleState,
      attachable: result.attachable,
    });
  } catch (err: unknown) {
    const msg = (err as Error).message || "Upload processing error";
    if (msg.includes("CONFLICT")) {
      return NextResponse.json({ success: false, message: msg }, { status: 409 });
    }
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
