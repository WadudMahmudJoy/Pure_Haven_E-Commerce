"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SiteSettings = {
  siteName: string;
  siteSubtitle: string;
  logoUrl: string;
};

const fallback: SiteSettings = {
  siteName: "PURE",
  siteSubtitle: "HAVEN BD",
  logoUrl: "",
};

export default function SiteLogo() {
  const [settings, setSettings] = useState<SiteSettings>(fallback);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/site-settings", { cache: "no-store" });
        const data = await res.json();

        if (res.ok && data?.success && data.settings) {
          setSettings({ ...fallback, ...data.settings });
        }
      } catch {}
    }

    loadSettings();
  }, []);

  return (
    <Link href="/" className="inline-flex items-center justify-center">
      {settings.logoUrl ? (
        <img
          src={settings.logoUrl}
          alt={settings.siteName}
          className="h-12 w-auto object-contain md:h-14"
        />
      ) : (
        <span className="inline-flex flex-col items-center leading-none">
          <span className="text-2xl font-semibold tracking-[0.32em] text-[#2e221d] md:text-3xl">
            {settings.siteName}
          </span>
          {settings.siteSubtitle ? (
            <span className="mt-1 text-[10px] tracking-[0.42em] text-[#7a5244] md:text-xs">
              {settings.siteSubtitle}
            </span>
          ) : null}
        </span>
      )}
    </Link>
  );
}