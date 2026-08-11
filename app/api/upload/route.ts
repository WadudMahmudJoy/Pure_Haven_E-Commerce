import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadDir = path.join(process.cwd(), "public", "uploads", "products");
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const allowedMimeToExt: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function hasJpegSignature(buffer: Buffer) {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function hasPngSignature(buffer: Buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => buffer[index] === value);
}

function hasWebpSignature(buffer: Buffer) {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function isValidImageBuffer(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return hasJpegSignature(buffer);
  }

  if (mimeType === "image/png") {
    return hasPngSignature(buffer);
  }

  if (mimeType === "image/webp") {
    return hasWebpSignature(buffer);
  }

  return false;
}

function getSafeFileName(ext: string) {
  return `product-${Date.now()}-${randomUUID()}.${ext}`;
}

export async function POST(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "No file uploaded." },
        { status: 400 }
      );
    }

    if (!file.size || file.size <= 0) {
      return NextResponse.json(
        { success: false, message: "Uploaded file is empty." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, message: "Image must be 5 MB or smaller." },
        { status: 400 }
      );
    }

    const ext = allowedMimeToExt[file.type];

    if (!ext) {
      return NextResponse.json(
        {
          success: false,
          message: "Only JPG, PNG, and WEBP images are allowed.",
        },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (!isValidImageBuffer(buffer, file.type)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid image file. Please upload a real JPG, PNG, or WEBP image.",
        },
        { status: 400 }
      );
    }

    await fs.mkdir(uploadDir, { recursive: true });

    const fileName = getSafeFileName(ext);
    const fullPath = path.join(uploadDir, fileName);

    if (!fullPath.startsWith(uploadDir)) {
      return NextResponse.json(
        { success: false, message: "Invalid upload path." },
        { status: 400 }
      );
    }

    await fs.writeFile(fullPath, buffer, { flag: "wx" });

    const imagePath = `/uploads/products/${fileName}`;

    return NextResponse.json(
      {
        success: true,
        message: "Upload successful.",
        imagePath,
        fileName,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("POST /api/upload error:", error);

    return NextResponse.json(
      { success: false, message: "Image upload failed." },
      { status: 500 }
    );
  }
}
