"use client";

import { useEffect, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

export default function AdminSettingsPage() {
  const [email, setEmail] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryPhone, setRecoveryPhone] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      const res = await fetch("/api/admin-auth", { cache: "no-store" });
      const data = await res.json();

      if (res.ok && data?.success) {
        setEmail(data.email || "");
        setRecoveryEmail(data.recoveryEmail || "");
        setRecoveryPhone(data.recoveryPhone || "");
      }
    }

    loadSettings();
  }, []);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      if (newPassword && newPassword !== confirmPassword) {
        throw new Error("New password and confirm password do not match.");
      }

      const res = await fetch("/api/admin-auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          recoveryEmail,
          recoveryPhone,
          recoveryCode,
          newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Save failed.");
      }

      setNewPassword("");
      setConfirmPassword("");
      setRecoveryCode("");
      setMessage("Saved successfully.");
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
            Admin Login & Recovery Settings
          </h1>

          <p className="mt-2 text-sm text-neutral-600">
            Update admin email, recovery contact, recovery code, and password.
          </p>

          {message ? (
            <div className="mt-5 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]">
              {message}
            </div>
          ) : null}

          <form onSubmit={handleSave} className="mt-6 grid gap-5">
            <label className="grid gap-2">
              <span className="text-sm font-semibold">Admin Login Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none" required />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold">Recovery Email</span>
              <input value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none" />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold">Recovery Phone</span>
              <input value={recoveryPhone} onChange={(e) => setRecoveryPhone(e.target.value)} className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none" />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold">New Recovery Code</span>
              <input value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none" placeholder="Leave blank to keep old code" />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none" placeholder="New password" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none" placeholder="Confirm new password" />
            </div>

            <button type="submit" disabled={saving} className="w-fit rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
