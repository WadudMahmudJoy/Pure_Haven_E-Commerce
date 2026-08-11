"use client";

import { useEffect, useMemo, useState } from "react";

type Order = {
  id?: number;
  orderId: string;
  customerName?: string;
  customerPhone?: string;
  total?: number;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentProvider?: string | null;
  paymentSenderNumber?: string | null;
  paymentTrxId?: string | null;
  createdAt?: string;
};

const statusLabels: Record<string, string> = {
  unpaid: "Unpaid",
  verification_pending: "Pending Verification",
  verified: "Verified",
  rejected: "Rejected",
  refunded: "Refunded",
};

function money(value?: number) {
  return `৳${Number(value || 0).toLocaleString("en-BD")}`;
}

function normalizeStatus(value?: string | null) {
  return value || "unpaid";
}

function statusClass(status: string) {
  if (status === "verified") return "border-green-200 bg-green-50 text-green-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  if (status === "verification_pending") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-stone-200 bg-stone-50 text-stone-700";
}

export default function PaymentVerificationClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function loadOrders() {
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      const data = await res.json();

      const nextOrders = Array.isArray(data)
        ? data
        : Array.isArray(data?.orders)
          ? data.orders
          : [];

      setOrders(nextOrders);
    } catch {
      setMessage("Could not load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  const paymentOrders = useMemo(() => {
    return orders.filter((order) => {
      const method = String(order.paymentMethod || "").toLowerCase();
      const status = normalizeStatus(order.paymentStatus);

      return (
        method.includes("bkash") ||
        method.includes("nagad") ||
        Boolean(order.paymentTrxId) ||
        status === "verification_pending" ||
        status === "verified" ||
        status === "rejected"
      );
    });
  }, [orders]);

  async function updatePaymentStatus(order: Order, paymentStatus: string) {
    setBusyOrderId(order.orderId);
    setMessage("");

    try {
      const res = await fetch("/api/orders/payment-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: order.id,
          orderId: order.orderId,
          paymentStatus,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Update failed.");
      }

      setOrders((current) =>
        current.map((item) =>
          item.orderId === order.orderId ? { ...item, paymentStatus } : item
        )
      );

      setMessage(`Payment status updated for ${order.orderId}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment update failed.");
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <section className="rounded-[28px] border border-[#ead8cf] bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[#8b5a45]">
            Manual Payment
          </p>
          <h1 className="mt-2 text-3xl font-bold text-[#171717]">
            Payment Verification
          </h1>
          <p className="mt-2 text-sm text-[#6f5d54]">
            Verify bKash/Nagad transaction details submitted during checkout.
          </p>
        </div>

        <button
          type="button"
          onClick={loadOrders}
          className="rounded-full border border-[#ead8cf] px-5 py-2 text-sm font-semibold text-[#2d1f1a] transition hover:bg-[#f8f1ed]"
        >
          Refresh
        </button>
      </div>

      {message ? (
        <div className="mb-5 rounded-2xl border border-[#ead8cf] bg-[#fbf7f4] px-4 py-3 text-sm text-[#5a4035]">
          {message}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[#6f5d54]">Loading payment orders...</p>
      ) : paymentOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#ead8cf] p-8 text-center text-sm text-[#6f5d54]">
          No manual payment orders found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#ead8cf]">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[#ead8cf] text-sm">
              <thead className="bg-[#fbf7f4] text-left text-xs uppercase tracking-[0.18em] text-[#8b5a45]">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Transaction</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#ead8cf] bg-white">
                {paymentOrders.map((order) => {
                  const paymentStatus = normalizeStatus(order.paymentStatus);
                  const isBusy = busyOrderId === order.orderId;

                  return (
                    <tr key={order.orderId} className="align-top">
                      <td className="px-4 py-4">
                        <div className="font-semibold text-[#171717]">
                          {order.orderId}
                        </div>
                        <div className="mt-1 text-xs text-[#8b5a45]">
                          Order: {order.status || "pending"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="font-medium text-[#171717]">
                          {order.customerName || "Customer"}
                        </div>
                        <div className="mt-1 text-xs text-[#6f5d54]">
                          {order.customerPhone || "No phone"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="font-medium text-[#171717]">
                          {order.paymentProvider || order.paymentMethod || "Manual"}
                        </div>
                        <div className="mt-1 text-xs text-[#6f5d54]">
                          Sender: {order.paymentSenderNumber || "Not provided"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <code className="rounded-lg bg-[#fbf7f4] px-2 py-1 text-xs text-[#2d1f1a]">
                          {order.paymentTrxId || "No trx id"}
                        </code>
                      </td>

                      <td className="px-4 py-4 font-semibold text-[#171717]">
                        {money(order.total)}
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(paymentStatus)}`}
                        >
                          {statusLabels[paymentStatus] || paymentStatus}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              updatePaymentStatus(order, "verified")
                            }
                            className="rounded-full bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Verify
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              updatePaymentStatus(order, "verification_pending")
                            }
                            className="rounded-full bg-amber-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Pending
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              updatePaymentStatus(order, "rejected")
                            }
                            className="rounded-full bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
