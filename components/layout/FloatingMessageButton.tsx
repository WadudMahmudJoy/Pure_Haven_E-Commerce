"use client";

import { useState } from "react";

export default function FloatingMessageButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    subject: "",
    message: "",
  });

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function submitMessage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setNotice("");

    try {
      const res = await fetch("/api/customer-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to submit message.");
      }

      setForm({ name: "", phone: "", email: "", subject: "", message: "" });
      setNotice("Your message has been sent. We will contact you soon.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to submit message.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-[80] grid h-14 w-14 place-items-center rounded-full bg-[#2e221d] text-2xl text-white shadow-lg transition hover:scale-105 md:bottom-6 md:right-6"
        aria-label="Send message"
      >
        💬
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] bg-black/40 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto mt-10 max-w-md rounded-[28px] bg-white p-5 shadow-xl md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-[#2e221d]">
                  Send a Message
                </h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Ask your query. Admin will review and respond.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full border border-[#ead9d1] text-lg"
              >
                ×
              </button>
            </div>

            {notice ? (
              <div className="mt-4 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-3 text-sm text-[#2e221d]">
                {notice}
              </div>
            ) : null}

            <form onSubmit={submitMessage} className="mt-5 grid gap-3">
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Your name"
              />

              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                required
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Phone number"
              />

              <input
                name="email"
                value={form.email}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Email optional"
              />

              <input
                name="subject"
                value={form.subject}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Subject optional"
              />

              <textarea
                name="message"
                value={form.message}
                onChange={handleChange}
                required
                rows={4}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Write your query"
              />

              <button
                type="submit"
                disabled={loading}
                className="rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {loading ? "Sending..." : "Send Message"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}