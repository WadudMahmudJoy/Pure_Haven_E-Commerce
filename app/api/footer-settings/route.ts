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

type FooterSettings = {
  brandTitle: string;
  brandSubtitle: string;
  description: string;
  address: string;
  phone: string;
  email: string;
  facebookUrl: string;
  instagramUrl: string;
  paymentNote: string;
  copyright: string;
  quickLinksText: string;
  categoryLinksText: string;
  policyLinksText: string;
};

const filePath = path.join(process.cwd(), "data", "footer-settings.json");

const defaultSettings: FooterSettings = {
  brandTitle: "PURE",
  brandSubtitle: "HAVEN BD",
  description:
    "Beauty, skincare, perfume, and daily essentials curated for a softer, confident everyday routine.",
  address: "Dhaka, Bangladesh",
  phone: "[not available]",
  email: "[not available]",
  facebookUrl: "#",
  instagramUrl: "#",
  paymentNote: "Cash on Delivery Â· bKash/Nagad later",
  copyright: "Pure Haven BD. All rights reserved.",
  quickLinksText: "Shop|/shop\nTrack Order|/track-order\nWishlist|/wishlist\nCart|/cart",
  categoryLinksText:
    "Cosmetics|/shop?category=cosmetics\nSkincare|/shop?category=skincare\nHaircare|/shop?category=haircare\nPerfume|/shop?category=perfume",
  policyLinksText:
    "Privacy Policy|/privacy-policy\nTerms & Conditions|/terms-conditions\nContact|/contact",
};

async function ensureFile() {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, JSON.stringify(defaultSettings, null, 2), "utf8");
  }
}

async function readSettings(): Promise<FooterSettings> {
  await ensureFile();

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return defaultSettings;
  }
}

function clean(value: unknown) {
  return typeof value === "string" ? value : "";
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

    const settings: FooterSettings = {
      brandTitle: clean(body.brandTitle) || defaultSettings.brandTitle,
      brandSubtitle: clean(body.brandSubtitle) || defaultSettings.brandSubtitle,
      description: clean(body.description),
      address: clean(body.address),
      phone: clean(body.phone),
      email: clean(body.email),
      facebookUrl: clean(body.facebookUrl) || "#",
      instagramUrl: clean(body.instagramUrl) || "#",
      paymentNote: clean(body.paymentNote),
      copyright: clean(body.copyright) || defaultSettings.copyright,
      quickLinksText: clean(body.quickLinksText),
      categoryLinksText: clean(body.categoryLinksText),
      policyLinksText: clean(body.policyLinksText),
    };

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(settings, null, 2), "utf8");

    return NextResponse.json({ success: true, settings }, { headers: publicCacheHeaders() });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to save footer settings.",
      },
      { status: 500 }
    );
  }
}
