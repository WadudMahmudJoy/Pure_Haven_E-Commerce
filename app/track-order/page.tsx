"use client";

import { useState } from "react";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

type TrackedOrder = {
  orderId?: string;
  customer: {
    name: string;
    phone: string;
    city?: string;
    address: string;
  };
  items: Array<{
    id: number;
    name: string;
    price: number;
    quantity: number;
    category: string;
  }>;
  subtotal?: number;
  deliveryFee?: number;
  total?: number;
  status: string;
  paymentMethod?: string;
  paymentStatus?: string;
  createdAt: string;
};

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "delivered":
      return "border-green-200 bg-green-50 text-green-700";
    case "cancelled":
      return "border-red-200 bg-red-50 text-red-700";
    case "pending":
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function paymentBadge(status: string) {
  switch (status) {
    case "paid":
      return "border-green-200 bg-green-50 text-green-700";
    case "rejected":
      return "border-red-200 bg-red-50 text-red-700";
    case "awaiting_verification":
      return "border-purple-200 bg-purple-50 text-purple-700";
    case "pending":
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

export default function TrackOrderPage() {
  const [orderId, setOrderId] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<TrackedOrder | null>(null);

  async function handleTrackOrder(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOrder(null);

    if (!orderId.trim() || !phone.trim()) {
      setError("Order ID and phone number are required.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `/api/orders?track=1&orderId=${encodeURIComponent(
          orderId.trim()
        )}&phone=${encodeURIComponent(phone.trim())}`,
        { cache: "no-store" }
      );

      const data = await res.json();

      if (!res.ok || !data.success || !data.order) {
        throw new Error(data.message || "No matching order found.");
      }

      setOrder(data.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to track order.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <TopBar />
      <Navbar />

      <section className="container-ph section-gap">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
            <p className="text-sm uppercase tracking-[0.18em] text-[#7a5244]">
              Order Tracking
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[#2e221d] sm:text-4xl">
              Track Your Order
            </h1>
            <p className="mt-2 text-sm text-neutral-600">
              Enter your order ID and phone number to check the latest order
              status.
            </p>

            <form onSubmit={handleTrackOrder} className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <input
                type="text"
                placeholder="Order ID"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
              />

              <input
                type="text"
                placeholder="Phone Number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
              />

              <button
                type="submit"
                disabled={loading}
                className="rounded-full bg-[#2e221d] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#7a5244] disabled:opacity-60"
              >
                {loading ? "Checking..." : "Track Order"}
              </button>
            </form>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </div>

          {order ? (
            <div className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-[#2e221d]">
                    {order.orderId || "[not available]"}
                  </h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    {order.customer.name} • {order.customer.phone}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {order.customer.city || "[not available]"} •{" "}
                    {order.customer.address}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge(
                      order.status
                    )}`}
                  >
                    Order: {order.status}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${paymentBadge(
                      order.paymentStatus || "pending"
                    )}`}
                  >
                    Payment: {order.paymentStatus || "pending"}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-[#f1e4de] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">
                    Payment Method
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[#2e221d]">
                    {order.paymentMethod || "Cash on Delivery"}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#f1e4de] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">
                    Items Total
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[#2e221d]">
                    {Number(order.subtotal || 0)} BDT
                  </p>
                </div>

                <div className="rounded-2xl border border-[#f1e4de] p-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-neutral-500">
                    Grand Total
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[#2e221d]">
                    {Number(order.total || 0)} BDT
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-[#f1e4de] p-4">
                <h3 className="mb-3 font-semibold text-[#2e221d]">
                  Ordered Items
                </h3>

                <div className="space-y-3">
                  {(order.items || []).map((item, index) => (
                    <div
                      key={`${item.id}-${index}`}
                      className="flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[#2e221d]">{item.name}</p>
                        <p className="text-sm text-neutral-500">
                          {item.category} • Qty: {item.quantity}
                        </p>
                      </div>

                      <p className="shrink-0 text-sm font-medium text-[#2e221d]">
                        {item.price * item.quantity} BDT
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <Footer />
    </main>
  );
}