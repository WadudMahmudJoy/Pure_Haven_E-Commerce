"use client";

import { useEffect, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

type SiteSettings = {
  siteName: string;
  siteSubtitle: string;
  logoUrl: string;
};

const emptySettings: SiteSettings = {
  siteName: "",
  siteSubtitle: "",
  logoUrl: "",
};

export default function AdminSiteSettingsPage() {
  const [form, setForm] = useState<SiteSettings>(emptySettings);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const res = await fetch("/api/site-settings", { cache: "no-store" });
      const data = await res.json();

      if (res.ok && data?.success && data.settings) {
        setForm(data.settings);
      }
    }

    loadSettings();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function uploadLogo(file: File) {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: fd,
    });

    const data = await res.json();

    if (!res.ok || !data?.imagePath) {
      throw new Error(data?.message || "Logo upload failed.");
    }

    return data.imagePath as string;
  }

  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const logoUrl = logoFile ? await uploadLogo(logoFile) : form.logoUrl;

      const payload = {
        ...form,
        logoUrl,
      };

      const res = await fetch("/api/site-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to save site settings.");
      }

      setForm(data.settings);
      setLogoFile(null);
      setMessage("Website logo and name updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-3xl font-semibold text-[#2e221d]">
            Website Logo & Name
          </h1>

          <p className="mt-2 text-sm text-neutral-600">
            Change the logo and website name shown in the navbar.
          </p>

          {message ? (
            <div className="mt-5 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]">
              {message}
            </div>
          ) : null}

          <form onSubmit={saveSettings} className="mt-6 grid gap-5">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[#2e221d]">
                Website Main Name
              </span>
              <input
                name="siteName"
                value={form.siteName}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="PURE"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[#2e221d]">
                Website Subtitle
              </span>
              <input
                name="siteSubtitle"
                value={form.siteSubtitle}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="HAVEN BD"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[#2e221d]">
                Logo URL / Path
              </span>
              <input
                name="logoUrl"
                value={form.logoUrl}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="/uploads/products/logo.png"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[#2e221d]">
                Upload Logo Image
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
              />
            </label>

            {form.logoUrl ? (
              <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4">
                <p className="mb-3 text-sm font-semibold text-[#2e221d]">
                  Current Logo Preview
                </p>
                <img
                  src={form.logoUrl}
                  alt={form.siteName}
                  className="h-20 w-auto object-contain"
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4">
                <p className="text-sm text-neutral-600">
                  No logo uploaded. Navbar will show text logo.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-fit rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Website Settings"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}