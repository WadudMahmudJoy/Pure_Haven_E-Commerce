"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

type OrderItem = {
  id?: number | string;
  name?: string;
  productName?: string;
  quantity?: number;
  price?: number;
  total?: number;
};

type Order = {
  id: number | string;
  orderId?: string;
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    city?: string;
  };
  customerName?: string;
  name?: string;
  phone?: string;
  customerPhone?: string;
  address?: string;
  customerAddress?: string;
  customerCity?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentDetails?: {
    provider?: string;
    senderNumber?: string;
    trxId?: string;
  } | null;
  paymentProvider?: string | null;
  paymentSenderNumber?: string | null;
  paymentTrxId?: string | null;
  trxId?: string;
  subtotal?: number;
  deliveryFee?: number;
  deliveryCharge?: number;
  total?: number;
  totalAmount?: number;
  createdAt?: string;
  items?: OrderItem[];
  orderItems?: OrderItem[];
};

const statuses = ["pending", "confirmed", "processing", "delivered"];
const filterStatuses = ["all", "pending", "confirmed", "processing", "delivered", "cancelled"];

function currentStatus(order: Order) {
  return String(order.status || "pending").toLowerCase();
}

function paymentStatus(order: Order) {
  return String(order.paymentStatus || "pending").toLowerCase();
}

function orderNumber(order: Order) {
  return order.orderId || `PH-${order.id}`;
}

function customerName(order: Order) {
  return order.customer?.name || order.customerName || order.name || "Customer";
}

function customerPhone(order: Order) {
  return order.customer?.phone || order.customerPhone || order.phone || "No phone";
}

function customerAddress(order: Order) {
  return (
    order.customer?.address ||
    order.customerAddress ||
    order.address ||
    "N/A"
  );
}

function money(value: unknown) {
  const n = Number(value || 0);
  return `${n.toLocaleString("en-BD")} BDT`;
}

function orderItems(order: Order) {
  return order.items || order.orderItems || [];
}

function itemCount(order: Order) {
  return orderItems(order).reduce((sum, item) => {
    const qty = Number(item.quantity || 1);
    return sum + qty;
  }, 0);
}

function subtotal(order: Order) {
  if (typeof order.subtotal === "number") return order.subtotal;

  return orderItems(order).reduce((sum, item) => {
    const qty = Number(item.quantity || 1);
    const price = Number(item.price || 0);
    return sum + qty * price;
  }, 0);
}

function grandTotal(order: Order) {
  return (
    Number(order.totalAmount || order.total || 0) ||
    subtotal(order) + Number(order.deliveryFee || order.deliveryCharge || 0)
  );
}

function dateText(value?: string) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-BD");
}

function canPrintVoucher(order: Order) {
  const status = currentStatus(order);
  return status === "confirmed" || status === "processing" || status === "delivered";
}

function canCancel(order: Order) {
  const status = currentStatus(order);
  return status !== "cancelled" && status !== "delivered";
}

function canUpdateStatus(order: Order) {
  const status = currentStatus(order);
  return status !== "cancelled" && status !== "delivered";
}

function nextStatusOptions(order: Order) {
  const status = currentStatus(order);

  if (status === "cancelled") return ["cancelled"];
  if (status === "delivered") return ["delivered"];

  return statuses;
}

function statusBadgeClass(status: string) {
  if (status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  if (status === "delivered") return "border-green-200 bg-green-50 text-green-700";
  if (status === "processing") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "confirmed") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-yellow-200 bg-yellow-50 text-yellow-700";
}

function paymentBadgeClass(status: string) {
  if (status === "verified") return "border-green-200 bg-green-50 text-green-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-yellow-200 bg-yellow-50 text-yellow-700";
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [draftStatusById, setDraftStatusById] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  async function loadOrders() {
    setMessage("");

    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      const data = await res.json();

      const list: Order[] = Array.isArray(data?.orders)
        ? data.orders
        : Array.isArray(data)
          ? data
          : [];

      setOrders(list);

      const nextDrafts: Record<string, string> = {};
      for (const order of list) {
        nextDrafts[String(order.id)] = currentStatus(order);
      }
      setDraftStatusById(nextDrafts);
    } catch {
      setMessage("Failed to load orders.");
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  const filteredOrders = useMemo(() => {
    const clean = query.trim().toLowerCase();

    return orders.filter((order) => {
      const text = [
        order.id,
        order.orderId,
        order.customer?.name,
        order.customer?.phone,
        order.customer?.address,
        order.customerName,
        order.name,
        order.phone,
        order.customerPhone,
        order.paymentMethod,
        order.paymentStatus,
        order.paymentProvider,
        order.paymentSenderNumber,
        order.paymentTrxId,
        order.trxId,
        order.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchQuery = !clean || text.includes(clean);
      const matchStatus =
        statusFilter === "all" || currentStatus(order) === statusFilter;

      return matchQuery && matchStatus;
    });
  }, [orders, query, statusFilter]);

  async function updateOrderStatus(order: Order, status: string, confirmCancel = false) {
    const orderKey = String(order.id);
    const oldStatus = currentStatus(order);

    if (oldStatus === status) {
      setMessage(`Order ${orderNumber(order)} is already ${status}.`);
      return;
    }

    if (status === "cancelled" && confirmCancel) {
      const ok = window.confirm(
        `Cancel order ${orderNumber(order)}? Product stock will be restored once.`
      );

      if (!ok) return;
    }

    setBusyOrderId(orderKey);
    setMessage("");

    try {
      const res = await fetch("/api/orders", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: order.id,
          status,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Order status update failed.");
      }

      const updatedOrder = data.order || { ...order, status };

      setOrders((prev) =>
        prev.map((item) =>
          String(item.id) === String(order.id)
            ? { ...item, ...updatedOrder, status }
            : item
        )
      );

      setDraftStatusById((prev) => ({
        ...prev,
        [orderKey]: status,
      }));

      setMessage(
        status === "cancelled"
          ? `Order ${orderNumber(order)} cancelled. Product stock should be restored.`
          : `Order ${orderNumber(order)} updated to ${status}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order update failed.");
      setDraftStatusById((prev) => ({
        ...prev,
        [orderKey]: oldStatus,
      }));
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10 text-[#2e221d]">
      <div className="mx-auto max-w-7xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-3xl font-semibold">Orders</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Manage delivery status, payment verification, and printable vouchers.
          </p>

          {message ? (
            <div className="mt-4 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm">
              {message}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_260px]">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
              placeholder="Search by order ID, customer, phone, payment, trxID..."
            />

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
            >
              {filterStatuses.map((status) => (
                <option key={status} value={status}>
                  {status === "all"
                    ? "All statuses"
                    : status[0].toUpperCase() + status.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="space-y-5">
          {filteredOrders.length === 0 ? (
            <div className="rounded-[28px] border border-[#ead9d1] bg-white p-8 text-center text-neutral-600">
              No orders found.
            </div>
          ) : (
            filteredOrders.map((order) => {
              const status = currentStatus(order);
              const payment = paymentStatus(order);
              const orderKey = String(order.id);
              const draftStatus = draftStatusById[orderKey] || status;
              const isBusy = busyOrderId === orderKey;
              const voucherLabel =
                status === "delivered" ? "Print Invoice" : "Print Voucher";

              return (
                <div
                  key={orderKey}
                  className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm"
                >
                  <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-xl font-semibold">
                          {orderNumber(order)}
                        </h2>

                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(status)}`}
                        >
                          Order: {status}
                        </span>

                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${paymentBadgeClass(payment)}`}
                        >
                          Payment: {payment}
                        </span>
                      </div>

                      <div className="mt-4 space-y-1 text-sm">
                        <p>
                          {customerName(order)} · {customerPhone(order)}
                        </p>
                        <p>{customerAddress(order)}</p>
                        <p>Method: {order.paymentMethod || "Cash on Delivery"}</p>
                        <p>{dateText(order.createdAt)}</p>
                      </div>

                      <div className="mt-6 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-[#ead9d1] p-4">
                          <p className="text-xs uppercase tracking-[0.28em] text-[#8b5a45]">
                            Items
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {itemCount(order)}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-[#ead9d1] p-4">
                          <p className="text-xs uppercase tracking-[0.28em] text-[#8b5a45]">
                            Subtotal
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {money(subtotal(order))}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-[#ead9d1] p-4">
                          <p className="text-xs uppercase tracking-[0.28em] text-[#8b5a45]">
                            Grand Total
                          </p>
                          <p className="mt-2 text-2xl font-semibold">
                            {money(grandTotal(order))}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="flex flex-wrap justify-end gap-2">
                        {canPrintVoucher(order) ? (
                          <Link
                            href={`/admin/orders/${order.id}/voucher`}
                            className="rounded-full bg-[#8b5a45] px-6 py-3 text-sm font-semibold !text-white shadow-sm transition hover:bg-[#6f4032] hover:!text-white"
                          >
                            {voucherLabel}
                          </Link>
                        ) : null}

                        {status === "cancelled" ? (
                          <span className="rounded-full border border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">
                            Cancelled — No Voucher
                          </span>
                        ) : null}

                        {status === "pending" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => updateOrderStatus(order, "confirmed")}
                            className="rounded-full bg-green-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Confirm Order
                          </button>
                        ) : null}

                        {status === "confirmed" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => updateOrderStatus(order, "processing")}
                            className="rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Mark Processing
                          </button>
                        ) : null}

                        {status === "processing" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => updateOrderStatus(order, "delivered")}
                            className="rounded-full bg-green-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Mark Delivered
                          </button>
                        ) : null}

                        {canCancel(order) ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              updateOrderStatus(order, "cancelled", true)
                            }
                            className="rounded-full bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Cancel Order
                          </button>
                        ) : null}
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-[#8b5a45]">
                          Order Status
                        </p>

                        {canUpdateStatus(order) ? (
                          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                            <select
                              value={draftStatus}
                              onChange={(e) =>
                                setDraftStatusById((prev) => ({
                                  ...prev,
                                  [orderKey]: e.target.value,
                                }))
                              }
                              className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                            >
                              {nextStatusOptions(order).map((option) => (
                                <option key={option} value={option}>
                                  {option[0].toUpperCase() + option.slice(1)}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              disabled={isBusy || draftStatus === status}
                              onClick={() =>
                                updateOrderStatus(
                                  order,
                                  draftStatus,
                                  draftStatus === "cancelled"
                                )
                              }
                              className="rounded-2xl bg-[#2d1f1a] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Update Status
                            </button>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] px-4 py-3 text-sm">
                            Final status: {status}
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-[#8b5a45]">
                          Payment Verification
                        </p>

                        {String(order.paymentMethod || "").toLowerCase().includes("bkash") ||
                        String(order.paymentMethod || "").toLowerCase().includes("nagad") ||
                        order.paymentTrxId ||
                        order.paymentDetails?.trxId ? (
                          <div className="space-y-2 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] px-4 py-3 text-sm">
                            <p>Status: {payment}</p>
                            <p>
                              TrxID:{" "}
                              {order.paymentTrxId ||
                                order.paymentDetails?.trxId ||
                                order.trxId ||
                                "Not provided"}
                            </p>
                            <Link
                              href="/admin/payments"
                              className="inline-flex rounded-full border border-[#ead9d1] bg-white px-4 py-2 text-xs font-semibold text-[#2d1f1a] hover:bg-[#f8f1ed]"
                            >
                              Open Payment Verification
                            </Link>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] px-4 py-3 text-sm">
                            No manual payment verification needed.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
