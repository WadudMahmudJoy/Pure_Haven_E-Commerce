/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SiteSettings = {
  siteName?: string;
  name?: string;
  title?: string;
  brandTitle?: string;
  siteSubtitle?: string;
  subtitle?: string;
  tagline?: string;
  brandSubtitle?: string;
  logoUrl?: string;
  logo?: string;
  logoImage?: string;
};

function normalizeImagePath(value?: string | null) {
  const src = typeof value === "string" ? value.trim() : "";

  if (!src) return "";
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (src.startsWith("/")) return src;
  if (src.startsWith("public/")) return src.slice("public".length);
  if (src.startsWith("uploads/") || src.startsWith("images/")) return `/${src}`;

  return `/uploads/products/${src}`;
}

export default function SiteBrand() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadSettings() {
      try {
        const res = await fetch("/api/site-settings", { cache: "no-store" });
        const data = await res.json();

        if (alive && res.ok && data?.success && data?.data) {
          setSettings(data.data);
        }
      } catch {
        // Fallback gracefully to default brand presentation
      }
    }

    loadSettings();

    return () => {
      alive = false;
    };
  }, []);

  const logoUrl = normalizeImagePath(
    settings?.logoUrl || settings?.logo || settings?.logoImage || ""
  );

  return (
    <Link
      href="/"
      className="inline-flex items-center justify-center gap-2 text-center transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5244] rounded-lg"
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt="PURE HAVEN BD"
          className="h-8 sm:h-9 w-auto max-w-[120px] object-contain"
          loading="eager"
          decoding="async"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <span className="text-xs sm:text-base lg:text-lg font-bold tracking-[0.14em] sm:tracking-[0.24em] text-[#161616] uppercase whitespace-nowrap">
        PURE HAVEN BD
      </span>
    </Link>
  );
}
