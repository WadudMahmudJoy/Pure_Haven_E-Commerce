"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/customer-auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setSubmitted(true);
        setMessage(
          data.message ||
            "If an eligible recovery method is available, recovery instructions will be sent."
        );
      } else {
        setError(data?.message || "Unable to request password reset. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-md space-y-8 bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
        <div>
          <Link
            href="/user-login"
            className="text-sm font-medium text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 flex items-center gap-1 mb-6"
          >
            ← Back to Login
          </Link>
          <span className="text-xs font-semibold tracking-wider text-amber-600 dark:text-amber-400 uppercase">
            ACCOUNT RECOVERY
          </span>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mt-1">
            Forgot Password
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
            Enter your verified account email or phone number to receive recovery instructions.
          </p>
        </div>

        {error && (
          <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-xl text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {submitted ? (
          <div className="space-y-6">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-sm text-emerald-800 dark:text-emerald-300">
              <p className="font-semibold mb-1">Recovery Request Received</p>
              <p>{message}</p>
            </div>
            <Link
              href="/user-login"
              className="block w-full text-center py-3 px-4 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-sm hover:opacity-95 transition"
            >
              Return to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="identifier"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
              >
                Email or Phone Number
              </label>
              <input
                id="identifier"
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="name@example.com or 01711223344"
                className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-sm hover:opacity-95 transition disabled:opacity-50"
            >
              {loading ? "Sending Instructions..." : "Send Recovery Instructions"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
