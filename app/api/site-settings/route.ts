import { NextResponse } from "next/server";

function publicCacheHeaders(seconds = 600) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}
import { requireAdmin } from "@/lib/adminSession";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SiteSettings = {
  siteName: string;
  siteSubtitle: string;
  logoUrl: string;
};

const filePath = path.join(process.cwd(), "data", "site-settings.json");

const defaultSettings: SiteSettings = {
  siteName: "PURE",
  siteSubtitle: "HAVEN BD",
  logoUrl: "",
};

async function ensureFile() {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify(defaultSettings, null, 2), "utf8");
  }
}

async function readSettings(): Promise<SiteSettings> {
  await ensureFile();
  try {
    const raw = await readFile(filePath, "utf8");
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json({ success: true, settings }, { headers: publicCacheHeaders() });
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();

    const settings: SiteSettings = {
      siteName: typeof body.siteName === "string" && body.siteName.trim() ? body.siteName.trim() : defaultSettings.siteName,
      siteSubtitle: typeof body.siteSubtitle === "string" ? body.siteSubtitle.trim() : "",
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl.trim() : "",
    };

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(settings, null, 2), "utf8");

    return NextResponse.json({ success: true, settings }, { headers: publicCacheHeaders() });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to save site settings." },
      { status: 500 }
    );
  }
}
