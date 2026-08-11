"use client";

import { useEffect, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

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

const emptySettings: FooterSettings = {
  brandTitle: "",
  brandSubtitle: "",
  description: "",
  address: "",
  phone: "",
  email: "",
  facebookUrl: "",
  instagramUrl: "",
  paymentNote: "",
  copyright: "",
  quickLinksText: "",
  categoryLinksText: "",
  policyLinksText: "",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-[#2e221d]">{label}</span>
      {children}
    </label>
  );
}

export default function AdminFooterPage() {
  const [form, setForm] = useState<FooterSettings>(emptySettings);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const res = await fetch("/api/footer-settings", { cache: "no-store" });
      const data = await res.json();

      if (res.ok && data?.success && data.settings) {
        setForm(data.settings);
      }
    }

    loadSettings();
  }, []);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function saveFooter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch("/api/footer-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to save footer.");
      }

      setMessage("Footer updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-3xl font-semibold text-[#2e221d]">
            Footer Settings
          </h1>

          <p className="mt-2 text-sm text-neutral-600">
            Manage footer brand text, links, contact, social links, and payment note.
          </p>

          {message ? (
            <div className="mt-5 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]">
              {message}
            </div>
          ) : null}

          <form onSubmit={saveFooter} className="mt-6 grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Brand Main Text">
                <input
                  name="brandTitle"
                  value={form.brandTitle}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder="PURE"
                />
              </Field>

              <Field label="Brand Subtitle">
                <input
                  name="brandSubtitle"
                  value={form.brandSubtitle}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder="HAVEN BD"
                />
              </Field>
            </div>

            <Field label="Footer Short Description">
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={3}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="Write short brand description"
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Shop Address">
                <input
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder="Dhaka, Bangladesh"
                />
              </Field>

              <Field label="Phone Number">
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder="01XXXXXXXXX"
                />
              </Field>

              <Field label="Email Address">
                <input
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder="support@example.com"
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Facebook Page Link">
                <input
                  name="facebookUrl"
                  value={form.facebookUrl}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder="https://facebook.com/..."
                />
              </Field>

              <Field label="Instagram Page Link">
                <input
                  name="instagramUrl"
                  value={form.instagramUrl}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder="https://instagram.com/..."
                />
              </Field>
            </div>

            <Field label="Payment Note">
              <input
                name="paymentNote"
                value={form.paymentNote}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="Cash on Delivery · bKash/Nagad"
              />
            </Field>

            <Field label="Copyright Text">
              <input
                name="copyright"
                value={form.copyright}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="Pure Haven BD. All rights reserved."
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Quick Links">
                <textarea
                  name="quickLinksText"
                  value={form.quickLinksText}
                  onChange={handleChange}
                  rows={7}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder={"Shop|/shop\nTrack Order|/track-order\nCart|/cart"}
                />
              </Field>

              <Field label="Category Links">
                <textarea
                  name="categoryLinksText"
                  value={form.categoryLinksText}
                  onChange={handleChange}
                  rows={7}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder={"Cosmetics|/shop?category=cosmetics\nSkincare|/shop?category=skincare"}
                />
              </Field>

              <Field label="Bottom Policy Links">
                <textarea
                  name="policyLinksText"
                  value={form.policyLinksText}
                  onChange={handleChange}
                  rows={7}
                  className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                  placeholder={"Privacy Policy|/privacy-policy\nTerms & Conditions|/terms-conditions"}
                />
              </Field>
            </div>

            <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-neutral-600">
              Link format: <b>Label|URL</b>. Example: <b>Shop|/shop</b>. One link per line.
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-fit rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Footer"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}