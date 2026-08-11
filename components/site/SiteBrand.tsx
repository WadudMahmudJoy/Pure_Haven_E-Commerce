"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function splitBrandName(value: string) {
  const clean = value.trim() || "PURE HAVEN BD";
  const words = clean.split(/\s+/);

  if (words.length >= 3) {
    return {
      top: words[0],
      bottom: words.slice(1).join(" "),
    };
  }

  if (words.length === 2) {
    return {
      top: words[0],
      bottom: words[1],
    };
  }

  return {
    top: clean,
    bottom: "HAVEN BD",
  };
}

export default function SiteBrand() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadSettings() {
      try {
        const res = await fetch("/api/site-settings", { cache: "force-cache" });
        if (!res.ok) return;

        const data = await res.json();
        const nextSettings = data?.settings ?? data?.siteSettings ?? data;

        if (alive && nextSettings && typeof nextSettings === "object") {
          setSettings(nextSettings);
        }
      } catch {
        // Keep fallback branding.
      }
    }

    loadSettings();

    return () => {
      alive = false;
    };
  }, []);

  const brandName =
    settings?.siteName ||
    settings?.name ||
    settings?.title ||
    settings?.brandTitle ||
    "PURE HAVEN BD";

  const subtitle =
    settings?.siteSubtitle ||
    settings?.subtitle ||
    settings?.tagline ||
    settings?.brandSubtitle ||
    "";

  const logoUrl = normalizeImagePath(
    settings?.logoUrl || settings?.logo || settings?.logoImage || ""
  );

  const split = useMemo(() => splitBrandName(brandName), [brandName]);

  return (
    <Link href="/" className="flex min-w-[150px] items-center justify-center gap-3 text-center">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={brandName}
          className="h-12 w-auto max-w-[170px] object-contain"
          loading="eager"
          decoding="async"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <span className="flex flex-col items-center leading-none">
          <span className="text-[28px] font-bold tracking-[0.35em] text-[#161616]">
            {split.top}
          </span>
          <span className="mt-2 text-[13px] uppercase tracking-[0.42em] text-[#8b5a45]">
            {subtitle || split.bottom}
          </span>
        </span>
      )}
    </Link>
  );
}
