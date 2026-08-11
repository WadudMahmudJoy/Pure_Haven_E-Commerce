"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

function OrderSuccessContent() {
  const searchParams = useSearchParams();

  const orderId = searchParams.get("orderId") || "PH-[not available]";
  const paymentMethod =
    searchParams.get("paymentMethod") || "Cash on Delivery";

  const normalizedPaymentMethod = paymentMethod.toLowerCase();
  const isBkash = normalizedPaymentMethod.includes("bkash");
  const isNagad = normalizedPaymentMethod.includes("nagad");

  return (
    <section className="container-ph section-gap">
      <div className="mx-auto max-w-3xl rounded-[32px] border border-[#ead9d1] bg-white p-6 shadow-sm sm:p-8 lg:p-10">
        <div className="text-center">
          <p className="text-sm uppercase tracking-[0.18em] text-[#7a5244]">
            Order Confirmed
          </p>

          <h1 className="mt-2 text-3xl font-semibold text-[#2e221d] sm:text-4xl">
            Thank you for your order
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-600 sm:text-base">
            Your order has been placed successfully.
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
              {paymentMethod}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[22px] border border-[#ead9d1] bg-[#fffaf6] p-5 text-sm text-neutral-700">
          <p className="font-semibold text-[#2e221d]">
            {isBkash ? "bKash payment submitted" : isNagad ? "Nagad payment submitted" : "Cash on Delivery selected"}
          </p>
          <p className="mt-2">
            {isBkash
              ? "Your payment is waiting for manual verification."
              : "Our team may call you before dispatching the order."}
          </p>
        </div>

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
