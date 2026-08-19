"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";
import {
  ORDER_STATUSES,
  CANCELLATION_REASONS,
  DELIVERY_FAILURE_REASONS,
  canCancelOrder,
  type OrderStatus,
  type CancellationReason,
  type DeliveryFailureReason,
} from "@/lib/orderLifecycle";
import {
  getOrderStatusLabel,
  getCancellationReasonLabel,
  getDeliveryFailureReasonLabel,
  getAdminNextStatusOptions,
  getOrderStatusBadgeClass,
  validateCancellationInput,
  validateDeliveryFailureInput,
  CANCELLATION_REASON_LABELS,
  DELIVERY_FAILURE_REASON_LABELS,
} from "@/lib/orderPresentation";

type OrderItem = {
  id?: number | string;
  name?: string;
  productName?: string;
  variantId?: number | null;
  variantLabel?: string | null;
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
  cancelledBy?: string | null;
  cancellationReason?: string | null;
  cancellationNote?: string | null;
  cancelledAt?: string | null;
  deliveryFailureReason?: string | null;
  deliveryFailureNote?: string | null;
  deliveryFailedAt?: string | null;
  subtotal?: number;
  deliveryFee?: number;
  deliveryCharge?: number;
  total?: number;
  totalAmount?: number;
  createdAt?: string;
  items?: OrderItem[];
  orderItems?: OrderItem[];
};

const filterStatuses = ["all", ...ORDER_STATUSES];

function currentStatus(order: Order): OrderStatus | string {
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

function dateText(value?: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-BD");
}

function canPrintVoucher(order: Order) {
  const status = currentStatus(order);
  return ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"].includes(status);
}

function paymentBadgeClass(status: string) {
  if (status === "verified" || status === "paid") return "border-green-200 bg-green-50 text-green-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-yellow-200 bg-yellow-50 text-yellow-700";
}

type ModalState =
  | {
      type: "cancel";
      order: Order;
      reason: CancellationReason | "";
      note: string;
      error?: string;
    }
  | {
      type: "delivery_failed";
      order: Order;
      reason: DeliveryFailureReason | "";
      note: string;
      error?: string;
    }
  | null;

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [draftStatusById, setDraftStatusById] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<ModalState>(null);

  useEffect(() => {
    async function loadOrders() {
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
          const allowed = getAdminNextStatusOptions(order.status);
          nextDrafts[String(order.id)] = allowed[0] || currentStatus(order);
        }
        setDraftStatusById(nextDrafts);
      } catch {
        setMessage("Failed to load orders.");
      }
    }

    void loadOrders();
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

  async function updateOrderStatus(
    order: Order,
    status: string,
    extra?: {
      cancellationReason?: string;
      cancellationNote?: string | null;
      deliveryFailureReason?: string;
      deliveryFailureNote?: string | null;
    }
  ) {
    const orderKey = String(order.id);
    const oldStatus = currentStatus(order);

    if (oldStatus === status && !extra) {
      setMessage(`Order ${orderNumber(order)} is already ${getOrderStatusLabel(status)}.`);
      return;
    }

    setBusyOrderId(orderKey);
    setMessage("");

    try {
      const payload: Record<string, unknown> = {
        id: order.id,
        status,
        ...extra,
      };

      const res = await fetch("/api/orders", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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

      const nextAllowed = getAdminNextStatusOptions(status);
      setDraftStatusById((prev) => ({
        ...prev,
        [orderKey]: nextAllowed[0] || status,
      }));

      setModalState(null);

      setMessage(
        status === "cancelled"
          ? `Order ${orderNumber(order)} cancelled.`
          : `Order ${orderNumber(order)} updated to ${getOrderStatusLabel(status)}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order update failed.");
      const allowed = getAdminNextStatusOptions(oldStatus);
      setDraftStatusById((prev) => ({
        ...prev,
        [orderKey]: allowed[0] || oldStatus,
      }));
    } finally {
      setBusyOrderId(null);
    }
  }

  function handleInitiateTransition(order: Order, targetStatus: string) {
    if (targetStatus === "cancelled") {
      setModalState({
        type: "cancel",
        order,
        reason: "",
        note: "",
      });
      return;
    }

    if (targetStatus === "delivery_failed") {
      setModalState({
        type: "delivery_failed",
        order,
        reason: "",
        note: "",
      });
      return;
    }

    updateOrderStatus(order, targetStatus);
  }

  function handleConfirmModal() {
    if (!modalState) return;

    if (modalState.type === "cancel") {
      const validation = validateCancellationInput(modalState.reason, modalState.note);
      if (!validation.valid) {
        setModalState({ ...modalState, error: validation.error });
        return;
      }
      updateOrderStatus(modalState.order, "cancelled", {
        cancellationReason: validation.reason,
        cancellationNote: validation.note,
      });
    } else if (modalState.type === "delivery_failed") {
      const validation = validateDeliveryFailureInput(modalState.reason, modalState.note);
      if (!validation.valid) {
        setModalState({ ...modalState, error: validation.error });
        return;
      }
      updateOrderStatus(modalState.order, "delivery_failed", {
        deliveryFailureReason: validation.reason,
        deliveryFailureNote: validation.note,
      });
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10 text-[#2e221d]">
      <div className="mx-auto max-w-7xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-3xl font-semibold">Orders</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Manage delivery lifecycle, audit evidence, payment verification, and printable vouchers.
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
                    : getOrderStatusLabel(status)}
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
              const allowedOptions = getAdminNextStatusOptions(status);
              const draftStatus = draftStatusById[orderKey] || allowedOptions[0] || status;
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
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${getOrderStatusBadgeClass(status)}`}
                        >
                          Order: {getOrderStatusLabel(status)}
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

                      {/* Audit Evidence Display for Cancelled / Failed Orders */}
                      {status === "cancelled" && (order.cancellationReason || order.cancelledBy) ? (
                        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/70 p-4 text-xs text-red-900 space-y-1">
                          <p className="font-semibold uppercase tracking-wider text-red-800">
                            Cancellation Audit Evidence
                          </p>
                          <p>
                            <span className="font-medium">Reason:</span>{" "}
                            {getCancellationReasonLabel(order.cancellationReason)}
                          </p>
                          {order.cancellationNote ? (
                            <p>
                              <span className="font-medium">Note:</span> {order.cancellationNote}
                            </p>
                          ) : null}
                          <p>
                            <span className="font-medium">Cancelled By:</span>{" "}
                            {order.cancelledBy || "Admin"}
                          </p>
                          {order.cancelledAt ? (
                            <p>
                              <span className="font-medium">Cancelled At:</span>{" "}
                              {dateText(order.cancelledAt)}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {status === "delivery_failed" && order.deliveryFailureReason ? (
                        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/70 p-4 text-xs text-red-900 space-y-1">
                          <p className="font-semibold uppercase tracking-wider text-red-800">
                            Delivery Failure Audit Evidence
                          </p>
                          <p>
                            <span className="font-medium">Reason:</span>{" "}
                            {getDeliveryFailureReasonLabel(order.deliveryFailureReason)}
                          </p>
                          {order.deliveryFailureNote ? (
                            <p>
                              <span className="font-medium">Note:</span> {order.deliveryFailureNote}
                            </p>
                          ) : null}
                          {order.deliveryFailedAt ? (
                            <p>
                              <span className="font-medium">Failed At:</span>{" "}
                              {dateText(order.deliveryFailedAt)}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
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

                        {/* Contextual Action Buttons based on server lifecycle */}
                        {status === "pending" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInitiateTransition(order, "confirmed")}
                            className="rounded-full bg-green-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Confirm Order
                          </button>
                        ) : null}

                        {status === "confirmed" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInitiateTransition(order, "processing")}
                            className="rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Mark Processing
                          </button>
                        ) : null}

                        {status === "processing" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInitiateTransition(order, "shipped")}
                            className="rounded-full bg-purple-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Mark Shipped
                          </button>
                        ) : null}

                        {status === "shipped" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInitiateTransition(order, "out_for_delivery")}
                            className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Out for Delivery
                          </button>
                        ) : null}

                        {status === "out_for_delivery" ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleInitiateTransition(order, "delivered")}
                              className="rounded-full bg-green-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              Mark Delivered
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleInitiateTransition(order, "delivery_failed")}
                              className="rounded-full bg-red-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              Delivery Failed
                            </button>
                          </>
                        ) : null}

                        {status === "delivery_failed" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInitiateTransition(order, "return_in_transit")}
                            className="rounded-full bg-orange-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Return in Transit
                          </button>
                        ) : null}

                        {status === "return_in_transit" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInitiateTransition(order, "return_received")}
                            className="rounded-full bg-neutral-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            Return Received
                          </button>
                        ) : null}

                        {/* Pre-dispatch Cancellation Button */}
                        {canCancelOrder(status as OrderStatus) ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleInitiateTransition(order, "cancelled")}
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

                        {allowedOptions.length > 0 ? (
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
                              {allowedOptions.map((option) => (
                                <option key={option} value={option}>
                                  {getOrderStatusLabel(option)}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              disabled={isBusy || draftStatus === status}
                              onClick={() => handleInitiateTransition(order, draftStatus)}
                              className="rounded-2xl bg-[#2d1f1a] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Update Status
                            </button>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] px-4 py-3 text-sm">
                            Final status: {getOrderStatusLabel(status)}
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

      {/* Cancellation / Delivery-Failure Dialog Modal */}
      {modalState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-xl sm:p-8">
            <h3 className="text-xl font-bold text-[#2e221d]">
              {modalState.type === "cancel"
                ? `Cancel Order ${orderNumber(modalState.order)}`
                : `Record Delivery Failure for ${orderNumber(modalState.order)}`}
            </h3>

            <p className="mt-2 text-sm text-neutral-600">
              {modalState.type === "cancel"
                ? "Please specify a cancellation reason to cancel this order."
                : "Please specify why delivery could not be completed to transition to return workflow."}
            </p>

            {modalState.error ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {modalState.error}
              </div>
            ) : null}

            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#8b5a45]">
                  Reason
                </label>
                <select
                  value={modalState.reason}
                  onChange={(e) => {
                    if (modalState.type === "cancel") {
                      setModalState({
                        ...modalState,
                        reason: e.target.value as CancellationReason | "",
                        error: undefined,
                      });
                    } else {
                      setModalState({
                        ...modalState,
                        reason: e.target.value as DeliveryFailureReason | "",
                        error: undefined,
                      });
                    }
                  }}
                  className="mt-1 w-full rounded-xl border border-[#ead9d1] px-4 py-2.5 text-sm outline-none"
                >
                  <option value="">Select a reason</option>
                  {modalState.type === "cancel"
                    ? CANCELLATION_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {CANCELLATION_REASON_LABELS[r]}
                        </option>
                      ))
                    : DELIVERY_FAILURE_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {DELIVERY_FAILURE_REASON_LABELS[r]}
                        </option>
                      ))}
                </select>
              </div>

              {modalState.reason === "other" ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#8b5a45]">
                    Note (Required for &apos;Other&apos;)
                  </label>
                  <textarea
                    value={modalState.note}
                    onChange={(e) =>
                      setModalState({ ...modalState, note: e.target.value, error: undefined })
                    }
                    placeholder="Provide specific details for this reason..."
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-[#ead9d1] p-3 text-sm outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#8b5a45]">
                    Optional Note
                  </label>
                  <input
                    type="text"
                    value={modalState.note}
                    onChange={(e) =>
                      setModalState({ ...modalState, note: e.target.value })
                    }
                    placeholder="Additional context (optional)..."
                    className="mt-1 w-full rounded-xl border border-[#ead9d1] px-4 py-2.5 text-sm outline-none"
                  />
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalState(null)}
                className="rounded-full border border-[#ead9d1] px-5 py-2.5 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmModal}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold text-white ${
                  modalState.type === "cancel" ? "bg-red-600 hover:bg-red-700" : "bg-[#2d1f1a] hover:bg-[#1a120f]"
                }`}
              >
                {modalState.type === "cancel" ? "Confirm Cancellation" : "Confirm Delivery Failure"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
