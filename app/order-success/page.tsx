"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

function OrderSuccessContent() {
  const searchParams = useSearchParams();

  const orderId = searchParams.get("orderId") || "PH-[not available]";
  const paymentMethod = searchParams.get("paymentMethod") || "Cash on Delivery";
  const phone = searchParams.get("phone") || "";
  const total = searchParams.get("total") || "";

  const normalizedPaymentMethod = paymentMethod.toLowerCase();
  const isBkash = normalizedPaymentMethod.includes("bkash");
  const isNagad = normalizedPaymentMethod.includes("nagad");
  const isPrepaid = isBkash || isNagad;

  const [senderNumber, setSenderNumber] = useState(phone);
  const [trxId, setTrxId] = useState("");
  const [evidenceSubmitted, setEvidenceSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");

  async function handleEvidenceSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setEvidenceError("");

    try {
      const res = await fetch("/api/orders/payment-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          customerPhone: phone || senderNumber,
          provider: isBkash ? "bKash" : "Nagad",
          senderNumber: senderNumber.trim(),
          trxId: trxId.trim(),
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Failed to submit payment evidence.");
      }

      setEvidenceSubmitted(true);
    } catch (err) {
      setEvidenceError(err instanceof Error ? err.message : "Failed to submit evidence.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="container-ph section-gap">
      <div className="mx-auto max-w-3xl rounded-[32px] border border-[#ead9d1] bg-white p-6 shadow-sm sm:p-8 lg:p-10">
        <div className="text-center">
          <p className="text-sm uppercase tracking-[0.18em] text-[#7a5244]">
            Order Placed
          </p>

          <h1 className="mt-2 text-3xl font-semibold text-[#2e221d] sm:text-4xl">
            Thank you for your order
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-600 sm:text-base">
            Your order has been registered and inventory reserved.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[22px] border border-[#ead9d1] bg-[#fffdfb] p-5">
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">
              Order ID
            </p>
            <p className="mt-2 text-lg font-semibold text-[#2e221d]">
              {orderId}
            </p>
          </div>

          <div className="rounded-[22px] border border-[#ead9d1] bg-[#fffdfb] p-5">
            <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">
              Payment Method
            </p>
            <p className="mt-2 text-lg font-semibold text-[#2e221d]">
              {paymentMethod} {total ? `(৳${total})` : ""}
            </p>
          </div>
        </div>

        {isPrepaid ? (
          <div className="mt-6 rounded-[24px] border border-[#ead9d1] bg-[#fffaf6] p-6 text-sm text-neutral-700">
            <h2 className="text-base font-semibold text-[#2e221d]">
              Stage 2: {isBkash ? "bKash" : "Nagad"} Payment Verification
            </h2>

            <p className="mt-2 leading-relaxed text-neutral-600">
              Please send the total amount to our {isBkash ? "bKash" : "Nagad"} number:
              <strong className="ml-1 text-[#2e221d]">01977269164</strong> (Personal / Send Money) within 15 minutes to confirm your reservation.
            </p>

            {evidenceSubmitted ? (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4 font-medium text-green-800">
                ✓ Payment evidence submitted successfully. Your order is pending verification by our team.
              </div>
            ) : (
              <form onSubmit={handleEvidenceSubmit} className="mt-4 space-y-3">
                {evidenceError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {evidenceError}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-600">
                      Sender Phone Number
                    </label>
                    <input
                      type="text"
                      required
                      value={senderNumber}
                      onChange={(e) => setSenderNumber(e.target.value)}
                      placeholder="01XXXXXXXXX"
                      className="mt-1 w-full rounded-xl border border-[#ead9d1] bg-white px-3 py-2 text-sm outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-600">
                      Transaction ID (TrxID)
                    </label>
                    <input
                      type="text"
                      required
                      value={trxId}
                      onChange={(e) => setTrxId(e.target.value)}
                      placeholder="e.g. 9J8A7B6C5D"
                      className="mt-1 w-full rounded-xl border border-[#ead9d1] bg-white px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 inline-flex items-center rounded-full bg-[#2e221d] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#7a5244] disabled:opacity-60"
                >
                  {loading ? "Submitting Evidence..." : "Submit Payment Evidence"}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="mt-5 rounded-[22px] border border-[#ead9d1] bg-[#fffaf6] p-5 text-sm text-neutral-700">
            <p className="font-semibold text-[#2e221d]">
              Cash on Delivery selected
            </p>
            <p className="mt-2">
              Our team will prepare your order. Please keep the exact amount ready upon delivery.
            </p>
          </div>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Link
            href="/shop"
            className="inline-flex items-center justify-center rounded-full border border-[#ead9d1] px-5 py-3 text-sm font-medium text-[#2e221d] transition hover:bg-[#f8f3ef]"
          >
            Continue Shopping
          </Link>

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-[#ead9d1] px-5 py-3 text-sm font-medium text-[#2e221d] transition hover:bg-[#f8f3ef]"
          >
            Back to Home
          </Link>

          <a
            href={`https://wa.me/8801977269164?text=${encodeURIComponent(
              `Hello, I placed an order.\nOrder ID: ${orderId}`
            )}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-[#ead9d1] px-5 py-3 text-sm font-medium text-[#2e221d] transition hover:bg-[#f8f3ef]"
          >
            WhatsApp Support
          </a>
        </div>
      </div>
    </section>
  );
}

export default function OrderSuccessPage() {
  return (
    <main>
      <TopBar />
      <Navbar />

      <Suspense
        fallback={
          <section className="container-ph section-gap">
            <div className="rounded-[28px] border border-[#ead9d1] bg-white p-6 text-center">
              Loading order confirmation...
            </div>
          </section>
        }
      >
        <OrderSuccessContent />
      </Suspense>

      <Footer />
    </main>
  );
}
