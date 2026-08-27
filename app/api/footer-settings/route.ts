import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";
import { FooterLinkGroup } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicCacheHeaders(seconds = 600) {
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`,
  };
}

type FooterSettingsDTO = {
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

const defaultSettings: FooterSettingsDTO = {
  brandTitle: "PURE",
  brandSubtitle: "HAVEN BD",
  description:
    "Beauty, skincare, perfume, and daily essentials curated for a softer, confident everyday routine.",
  address: "Dhaka, Bangladesh",
  phone: "01977269164",
  email: "purehaven@gmail.com",
  facebookUrl: "#",
  instagramUrl: "#",
  paymentNote: "Payment Options: Cash on Delivery · bKash · Nagad · Rocket · Upay",
  copyright: "Pure Haven BD. All rights reserved.",
  quickLinksText: "Shop|/shop\nTrack Order|/track-order\nWishlist|/wishlist\nCart|/cart",
  categoryLinksText:
    "Cosmetics|/shop?category=cosmetics\nSkincare|/shop?category=skincare\nHaircare|/shop?category=haircare\nPerfume|/shop?category=perfume",
  policyLinksText:
    "Privacy Policy|/privacy-policy\nTerms & Conditions|/terms-conditions\nContact|/contact",
};

function formatLinks(links: Array<{ label: string; url: string; isActive: boolean }>) {
  return links
    .filter((l) => l.isActive)
    .map((l) => `${l.label}|${l.url}`)
    .join("\n");
}

function parseLines(text: string, group: FooterLinkGroup) {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const [label, url] = line.split("|").map((p) => p.trim());
      return {
        group,
        label: label || "Link",
        url: url || "#",
        sortOrder: idx + 1,
        isActive: true,
      };
    });
}

function clean(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function readFooter(): Promise<FooterSettingsDTO> {
  try {
    const footer = await prisma.footerSettings.findUnique({
      where: { singletonKey: "PRIMARY" },
      include: {
        links: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (footer) {
      const quickLinks = footer.links.filter(
        (l) => l.group === FooterLinkGroup.QUICK_LINKS
      );
      const categoryLinks = footer.links.filter(
        (l) => l.group === FooterLinkGroup.CATEGORY_LINKS
      );
      const policyLinks = footer.links.filter(
        (l) => l.group === FooterLinkGroup.POLICY_LINKS
      );

      return {
        brandTitle: footer.brandTitle || defaultSettings.brandTitle,
        brandSubtitle: footer.brandSubtitle || defaultSettings.brandSubtitle,
        description: footer.description ?? defaultSettings.description,
        address: footer.address ?? defaultSettings.address,
        phone: footer.phone ?? defaultSettings.phone,
        email: footer.email ?? defaultSettings.email,
        facebookUrl: footer.facebookUrl ?? defaultSettings.facebookUrl,
        instagramUrl: footer.instagramUrl ?? defaultSettings.instagramUrl,
        paymentNote: footer.paymentNote ?? defaultSettings.paymentNote,
        copyright: footer.copyright ?? defaultSettings.copyright,
        quickLinksText: quickLinks.length > 0 ? formatLinks(quickLinks) : defaultSettings.quickLinksText,
        categoryLinksText: categoryLinks.length > 0 ? formatLinks(categoryLinks) : defaultSettings.categoryLinksText,
        policyLinksText: policyLinks.length > 0 ? formatLinks(policyLinks) : defaultSettings.policyLinksText,
      };
    }
  } catch (error) {
    console.error("Failed to read footer settings from DB:", error);
  }

  return defaultSettings;
}

export async function GET() {
  const settings = await readFooter();
  return NextResponse.json({ success: true, settings }, { headers: publicCacheHeaders() });
}

export async function PUT(req: Request) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();

    const brandTitle = clean(body.brandTitle) || defaultSettings.brandTitle;
    const brandSubtitle = clean(body.brandSubtitle) || defaultSettings.brandSubtitle;
    const description = clean(body.description);
    const address = clean(body.address);
    const phone = clean(body.phone);
    const email = clean(body.email);
    const facebookUrl = clean(body.facebookUrl) || "#";
    const instagramUrl = clean(body.instagramUrl) || "#";
    const paymentNote = clean(body.paymentNote);
    const copyright = clean(body.copyright) || defaultSettings.copyright;

    const quickLinksText = clean(body.quickLinksText);
    const categoryLinksText = clean(body.categoryLinksText);
    const policyLinksText = clean(body.policyLinksText);

    const linksToCreate = [
      ...parseLines(quickLinksText, FooterLinkGroup.QUICK_LINKS),
      ...parseLines(categoryLinksText, FooterLinkGroup.CATEGORY_LINKS),
      ...parseLines(policyLinksText, FooterLinkGroup.POLICY_LINKS),
    ];

    const footer = await prisma.$transaction(async (tx) => {
      const root = await tx.footerSettings.upsert({
        where: { singletonKey: "PRIMARY" },
        update: {
          brandTitle,
          brandSubtitle,
          description,
          address,
          phone,
          email,
          facebookUrl,
          instagramUrl,
          paymentNote,
          copyright,
        },
        create: {
          singletonKey: "PRIMARY",
          brandTitle,
          brandSubtitle,
          description,
          address,
          phone,
          email,
          facebookUrl,
          instagramUrl,
          paymentNote,
          copyright,
        },
      });

      await tx.footerLink.deleteMany({
        where: { footerSettingsId: root.id },
      });

      if (linksToCreate.length > 0) {
        await tx.footerLink.createMany({
          data: linksToCreate.map((l) => ({
            footerSettingsId: root.id,
            group: l.group,
            label: l.label,
            url: l.url,
            sortOrder: l.sortOrder,
            isActive: l.isActive,
          })),
        });
      }

      return tx.footerSettings.findUniqueOrThrow({
        where: { id: root.id },
        include: { links: { orderBy: { sortOrder: "asc" } } },
      });
    });

    const settings: FooterSettingsDTO = {
      brandTitle: footer.brandTitle,
      brandSubtitle: footer.brandSubtitle,
      description: footer.description,
      address: footer.address,
      phone: footer.phone,
      email: footer.email,
      facebookUrl: footer.facebookUrl,
      instagramUrl: footer.instagramUrl,
      paymentNote: footer.paymentNote,
      copyright: footer.copyright,
      quickLinksText,
      categoryLinksText,
      policyLinksText,
    };

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
