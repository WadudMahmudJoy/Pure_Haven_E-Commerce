"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

const fallback: FooterSettings = {
  brandTitle: "PURE",
  brandSubtitle: "HAVEN BD",
  description:
    "Beauty, skincare, perfume, and daily essentials curated for a softer, confident everyday routine.",
  address: "Dhaka, Bangladesh",
  phone: "[not available]",
  email: "[not available]",
  facebookUrl: "#",
  instagramUrl: "#",
  paymentNote: "Cash on Delivery · bKash/Nagad later",
  copyright: "Pure Haven BD. All rights reserved.",
  quickLinksText: "Shop|/shop\nTrack Order|/track-order\nWishlist|/wishlist\nCart|/cart",
  categoryLinksText:
    "Cosmetics|/shop?category=cosmetics\nSkincare|/shop?category=skincare\nHaircare|/shop?category=haircare\nPerfume|/shop?category=perfume",
  policyLinksText:
    "Privacy Policy|/privacy-policy\nTerms & Conditions|/terms-conditions\nContact|/contact",
};

function parseLinks(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, href] = line.split("|").map((part) => part.trim());
      return {
        label: label || "Link",
        href: href || "#",
      };
    });
}

type FooterProps = {
  initialSettings?: Partial<FooterSettings> | null;
  disableSelfFetch?: boolean;
};

export default function Footer({
  initialSettings,
  disableSelfFetch = false,
}: FooterProps = {}) {
  const [settings, setSettings] = useState<FooterSettings>(() => ({
    ...fallback,
    ...(initialSettings ?? {}),
  }));

  useEffect(() => {
    if (initialSettings) {
      setSettings({ ...fallback, ...initialSettings });
    }
  }, [initialSettings]);

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadFooter() {
      try {
        const res = await fetch("/api/footer-settings", { cache: "no-store" });
        const data = await res.json();

        if (res.ok && data?.success && data.settings) {
          setSettings({ ...fallback, ...data.settings });
        }
      } catch {}
    }

    loadFooter();
  }, [disableSelfFetch]);

  const quickLinks = useMemo(
    () => parseLinks(settings.quickLinksText),
    [settings.quickLinksText]
  );

  const categoryLinks = useMemo(
    () => parseLinks(settings.categoryLinksText),
    [settings.categoryLinksText]
  );

  const policyLinks = useMemo(
    () => parseLinks(settings.policyLinksText),
    [settings.policyLinksText]
  );

  return (
    <footer className="mt-14 border-t border-[#ead9d1] bg-[#2e221d] text-white">
      <div className="container-ph py-12">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1fr]">
          <div>
            <Link href="/" className="inline-flex flex-col">
              <span className="text-3xl font-semibold tracking-[0.32em]">
                {settings.brandTitle}
              </span>
              <span className="mt-1 text-xs tracking-[0.42em] text-white/60">
                {settings.brandSubtitle}
              </span>
            </Link>

            <p className="mt-5 max-w-sm text-sm leading-7 text-white/70">
              {settings.description}
            </p>

            <div className="mt-6 flex gap-3">
              <Link
                href={settings.facebookUrl || "#"}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/5 text-sm font-bold text-white transition hover:bg-white hover:text-[#2e221d]"
                aria-label="Facebook"
              >
                f
              </Link>

              <Link
                href={settings.instagramUrl || "#"}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-white/5 text-sm font-bold text-white transition hover:bg-white hover:text-[#2e221d]"
                aria-label="Instagram"
              >
                IG
              </Link>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.28em] text-white/80">
              Quick Links
            </h3>

            <div className="mt-5 grid gap-3">
              {quickLinks.map((item) => (
                <Link
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  className="text-sm text-white/65 transition hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.28em] text-white/80">
              Categories
            </h3>

            <div className="mt-5 grid gap-3">
              {categoryLinks.map((item) => (
                <Link
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  className="text-sm text-white/65 transition hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.28em] text-white/80">
              Contact
            </h3>

            <div className="mt-5 space-y-4 text-sm text-white/70">
              <p>📍 {settings.address}</p>
              <p>☎ {settings.phone}</p>
              <p>✉ {settings.email}</p>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-white/50">
                Payment
              </p>
              <p className="mt-2 text-sm font-semibold text-white">
                {settings.paymentNote}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-6 text-sm text-white/55 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {settings.copyright}</p>

          <div className="flex flex-wrap items-center gap-4">
            {policyLinks.map((item) => (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className="hover:text-white"
              >
                {item.label}
              </Link>
            ))}
            <span className="text-white/20" aria-hidden="true">·</span>
            <Link
              href="/admin/login"
              className="text-white/35 transition hover:text-white/75"
            >
              Admin Login
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}