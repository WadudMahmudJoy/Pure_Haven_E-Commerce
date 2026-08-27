import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicCacheHeaders(seconds = 600) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}

type SiteSettings = {
  siteName: string;
  siteSubtitle: string;
  logoUrl: string;
};

const defaultSettings: SiteSettings = {
  siteName: "PURE",
  siteSubtitle: "HAVEN BD",
  logoUrl: "",
};

async function readSettings(): Promise<SiteSettings> {
  try {
    const branding = await prisma.siteBranding.findUnique({
      where: { singletonKey: "PRIMARY" },
    });
    if (branding) {
      return {
        siteName: branding.siteName || defaultSettings.siteName,
        siteSubtitle: branding.siteSubtitle || defaultSettings.siteSubtitle,
        logoUrl: branding.logoUrl || "",
      };
    }
  } catch (error) {
    console.error("Failed to read site branding:", error);
  }
  return defaultSettings;
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

    const siteName =
      typeof body.siteName === "string" && body.siteName.trim()
        ? body.siteName.trim()
        : defaultSettings.siteName;
    const siteSubtitle =
      typeof body.siteSubtitle === "string" ? body.siteSubtitle.trim() : "";
    const logoUrl = typeof body.logoUrl === "string" ? body.logoUrl.trim() : "";

    const branding = await prisma.siteBranding.upsert({
      where: { singletonKey: "PRIMARY" },
      update: { siteName, siteSubtitle, logoUrl },
      create: { singletonKey: "PRIMARY", siteName, siteSubtitle, logoUrl },
    });

    const settings: SiteSettings = {
      siteName: branding.siteName,
      siteSubtitle: branding.siteSubtitle,
      logoUrl: branding.logoUrl || "",
    };

    return NextResponse.json({ success: true, settings }, { headers: publicCacheHeaders() });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to save site settings." },
      { status: 500 }
    );
  }
}
