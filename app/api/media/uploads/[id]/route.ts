import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { getMediaUploadStatusService } from "@/lib/media/mediaUploadStatusService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Admin authorization gate (independent of ingestion feature gate)
  const unauthorized = requireAdmin(req);
  if (unauthorized) {
    return unauthorized;
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { success: false, message: "Media ID is required." },
      { status: 400 }
    );
  }

  const statusService = getMediaUploadStatusService();
  const status = await statusService.getProductImageUploadStatus(id);
  if (!status) {
    return NextResponse.json(
      { success: false, message: "Media not found." },
      { status: 404 }
    );
  }

  return NextResponse.json(status);
}
