"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(Boolean(token));
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(token ? "" : "Verification link is missing or invalid.");

  useEffect(() => {
    if (!token) {
      return;
    }

    // Scrub sensitive bearer token from visible URL and browser history
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    let isMounted = true;
    async function autoVerify() {
      setLoading(true);
      setError("");

      try {
        const res = await fetch("/api/customer-auth/email-verification/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token!.trim() }),
        });

        const data = await res.json().catch(() => null);

        if (!isMounted) return;

        if (res.ok && data?.success) {
          setSuccess(true);
        } else {
          setError(data?.message || "Invalid or expired verification link.");
        }
      } catch {
        if (isMounted) setError("Network error. Please try again.");
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    autoVerify();

    return () => {
      isMounted = false;
    };
  }, [token]);

  return (
    <main className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-neutral-50 dark:bg-neutral-950">
      <div className="w-full max-w-md space-y-8 bg-white dark:bg-neutral-900 p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm text-center">
        <div>
          <span className="text-xs font-semibold tracking-wider text-amber-600 dark:text-amber-400 uppercase">
            EMAIL VERIFICATION
          </span>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mt-1">
            Verifying Your Email
          </h1>
        </div>

        {loading && (
          <div className="py-8 text-neutral-600 dark:text-neutral-400 text-sm">
            <div className="inline-block w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p>Please wait while we verify your email address...</p>
          </div>
        )}

        {error && !loading && (
          <div className="space-y-6">
            <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-xl text-sm text-red-700 dark:text-red-300">
              <p className="font-semibold mb-1">Verification Failed</p>
              <p>{error}</p>
            </div>
            <Link
              href="/customer/dashboard"
              className="block w-full py-3 px-4 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-sm hover:opacity-95 transition"
            >
              Go to Account Dashboard
            </Link>
          </div>
        )}

        {success && !loading && (
          <div className="space-y-6">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-sm text-emerald-800 dark:text-emerald-300">
              <p className="font-semibold mb-1">Email Verified Successfully!</p>
              <p>Your email address is now verified and eligible for account recovery.</p>
            </div>
            <Link
              href="/customer/dashboard"
              className="block w-full py-3 px-4 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-sm hover:opacity-95 transition"
            >
              Go to Dashboard
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-neutral-500">Loading...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
