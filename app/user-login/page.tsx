"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function UserLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [name, setName] = useState("");
  const [registerIdentifier, setRegisterIdentifier] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/customer-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          identifier: loginIdentifier,
          password: loginPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Email/phone or password is incorrect.");
      }

      // Clear legacy localStorage identity keys
      localStorage.removeItem("pure_haven_customer_logged_in");
      localStorage.removeItem("pure_haven_customer_name");
      localStorage.removeItem("pure_haven_customer_email");
      localStorage.removeItem("pure_haven_customer_phone");

      router.push("/customer/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/customer-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          identifier: registerIdentifier,
          password: registerPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Registration failed.");
      }

      // Registration immediately creates an active session
      router.push("/customer/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-8 md:py-14">
      <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-[34px] border border-[#ead9d1] bg-white shadow-sm">
        <div className="grid md:grid-cols-[0.92fr_1.08fr]">
          {/* Left Info Panel */}
          <section className="hidden bg-[#2e221d] p-10 text-white md:flex md:flex-col md:justify-between">
            <div>
              <Link
                href="/"
                className="inline-flex rounded-full border border-white/20 px-4 py-2 text-sm font-semibold transition hover:bg-white/10"
              >
                ← Back to Home
              </Link>

              <p className="mt-10 text-xs font-bold uppercase tracking-[0.35em] text-white/65">
                Pure Haven BD
              </p>

              <h2 className="mt-4 text-4xl font-semibold leading-tight">
                Your account,
                <br />
                your beauty journey.
              </h2>

              <p className="mt-5 max-w-sm text-sm leading-7 text-white/75">
                Log in or create an account with your email or phone number to view your order history and manage your profile.
              </p>
            </div>

            <div className="mt-10 grid gap-3 text-sm text-white/85">
              <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
                Unified email or phone login
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
                Secure persistent session
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3">
                Designed for Pure Haven BD customers
              </div>
            </div>
          </section>

          {/* Form Panel */}
          <section className="p-5 sm:p-7 md:p-10">
            <Link
              href="/"
              className="mb-6 inline-flex rounded-full border border-[#ead9d1] px-4 py-2 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef] md:hidden"
            >
              ← Back to Home
            </Link>

            <div className="max-w-xl">
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#7a5244]">
                Customer Account
              </p>

              <h1 className="mt-3 text-3xl font-semibold text-[#2e221d] md:text-4xl">
                {mode === "login" ? "User Login" : "Create User Account"}
              </h1>

              <p className="mt-3 text-sm leading-6 text-neutral-600">
                {mode === "login"
                  ? "Login to your Pure Haven BD customer account."
                  : "Register to create your Pure Haven BD customer account."}
              </p>

              {message ? (
                <div
                  role="alert"
                  className="mt-5 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]"
                >
                  {message}
                </div>
              ) : null}

              <div className="mt-7 grid grid-cols-2 overflow-hidden rounded-full border border-[#ead9d1] bg-[#fffaf7]">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setMessage("");
                  }}
                  className={`px-4 py-3 text-sm font-semibold transition ${
                    mode === "login"
                      ? "bg-[#2e221d] text-white"
                      : "text-[#2e221d] hover:bg-[#f8f3ef]"
                  }`}
                >
                  Login
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setMessage("");
                  }}
                  className={`px-4 py-3 text-sm font-semibold transition ${
                    mode === "register"
                      ? "bg-[#2e221d] text-white"
                      : "text-[#2e221d] hover:bg-[#f8f3ef]"
                  }`}
                >
                  Register
                </button>
              </div>

              {mode === "login" ? (
                <form onSubmit={handleLogin} className="mt-7 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-[#2e221d]">
                      Email or Phone Number
                    </span>
                    <input
                      type="text"
                      name="identifier"
                      autoComplete="username"
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 text-base outline-none transition focus:border-[#7a5244]"
                      placeholder="e.g. user@example.com or 01711223344"
                      required
                    />
                  </label>

                  <label className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#2e221d]">
                        Password
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((prev) => !prev)}
                        className="text-xs font-semibold text-[#7a5244] hover:underline"
                      >
                        {showLoginPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <input
                      type={showLoginPassword ? "text" : "password"}
                      name="password"
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 text-base outline-none transition focus:border-[#7a5244]"
                      placeholder="Enter your password"
                      required
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#5e3d32] disabled:opacity-60"
                  >
                    {loading ? "Logging in..." : "Login"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="mt-7 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-[#2e221d]">
                      Full Name
                    </span>
                    <input
                      type="text"
                      name="name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 text-base outline-none transition focus:border-[#7a5244]"
                      placeholder="Your name"
                      required
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-[#2e221d]">
                      Email or Phone Number
                    </span>
                    <input
                      type="text"
                      name="identifier"
                      autoComplete="username"
                      value={registerIdentifier}
                      onChange={(e) => setRegisterIdentifier(e.target.value)}
                      className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 text-base outline-none transition focus:border-[#7a5244]"
                      placeholder="e.g. user@example.com or 01711223344"
                      required
                    />
                  </label>

                  <label className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#2e221d]">
                        Password
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRegisterPassword((prev) => !prev)}
                        className="text-xs font-semibold text-[#7a5244] hover:underline"
                      >
                        {showRegisterPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <input
                      type={showRegisterPassword ? "text" : "password"}
                      name="new-password"
                      autoComplete="new-password"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 text-base outline-none transition focus:border-[#7a5244]"
                      placeholder="Minimum 8 characters"
                      required
                      minLength={8}
                      maxLength={128}
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#5e3d32] disabled:opacity-60"
                  >
                    {loading ? "Creating account..." : "Register"}
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
