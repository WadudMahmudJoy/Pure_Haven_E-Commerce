"use client";

import { useState } from "react";

function getSafeNextPath() {
  if (typeof window === "undefined") return "/admin";

  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");

  if (!next) return "/admin";

  if (
    next.startsWith("/admin") &&
    !next.startsWith("/admin/login") &&
    !next.startsWith("//")
  ) {
    return next;
  }

  return "/admin";
}

export default function AdminLoginForm() {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function clearOldFakeAdminStorage() {
    localStorage.removeItem("pure_haven_admin");
    localStorage.removeItem("pure_haven_admin_logged_in");
    localStorage.removeItem("adminLoggedIn");
    localStorage.removeItem("isAdminLoggedIn");
    localStorage.removeItem("pure_haven_admin_email");
  }

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      clearOldFakeAdminStorage();

      const res = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Login failed.");
      }

      window.location.href = getSafeNextPath();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      clearOldFakeAdminStorage();

      if (newPassword !== confirmPassword) {
        throw new Error("New password and confirm password do not match.");
      }

      const res = await fetch("/api/admin-auth", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim(),
          recoveryCode,
          newPassword,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Password reset failed.");
      }

      window.location.href = getSafeNextPath();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password reset failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-8">
      <section className="mx-auto w-full max-w-md rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm">
        <a
          href="/"
          className="mb-5 inline-flex rounded-full border border-[#ead9d1] px-4 py-2 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
        >
          ← Back to Home
        </a>

        <h1 className="text-3xl font-semibold text-[#2e221d]">
          {mode === "login" ? "Admin Login" : "Forgot Password"}
        </h1>

        <p className="mt-2 text-sm text-neutral-600">
          {mode === "login"
            ? "Login with admin email and password."
            : "Reset password using recovery code."}
        </p>

        {message ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {message}
          </div>
        ) : null}

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="mt-6 grid gap-4">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[#2e221d]">
                Admin Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 text-base outline-none"
                placeholder="Admin email"
                autoComplete="username"
                required
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-[#2e221d]">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 text-base outline-none"
                placeholder="Password"
                autoComplete="current-password"
                required
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Logging in..." : "Login"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setMessage("");
              }}
              className="text-sm font-semibold text-[#7a5244] underline"
            >
              Forgot password?
            </button>

            <a
              href="/user-login"
              className="mt-1 rounded-full border border-[#ead9d1] px-6 py-3 text-center text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
            >
              User Login / Register
            </a>
          </form>
        ) : (
          <form onSubmit={handleForgot} className="mt-6 grid gap-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 text-base outline-none"
              placeholder="Admin email"
              autoComplete="username"
              required
            />

            <input
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 text-base outline-none"
              placeholder="Recovery code"
              required
            />

            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 text-base outline-none"
              placeholder="New password"
              autoComplete="new-password"
              required
            />

            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 text-base outline-none"
              placeholder="Confirm new password"
              autoComplete="new-password"
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Resetting..." : "Reset Password"}
            </button>

            <button
              type="button"
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
              className="text-sm font-semibold text-[#7a5244] underline"
            >
              Back to login
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
