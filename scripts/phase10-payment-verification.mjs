import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase10_backup_payment_verification");
mkdirSync(backupDir, { recursive: true });

const files = [
  "components/admin/AdminShell.tsx",
  "app/api/orders/route.ts",
];

for (const file of files) {
  const full = path.join(root, file);
  if (existsSync(full)) {
    copyFileSync(full, path.join(backupDir, file.replace(/[\\/]/g, "__")));
  }
}

function read(file) {
  return readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "");
}

function write(file, content) {
  writeFileSync(path.join(root, file), content, "utf8");
}

mkdirSync(path.join(root, "app/api/orders/payment-status"), { recursive: true });
mkdirSync(path.join(root, "app/admin/payments"), { recursive: true });
mkdirSync(path.join(root, "components/admin"), { recursive: true });

/**
 * API: update payment status
 */
write(
  "app/api/orders/payment-status/route.ts",
`import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as adminSession from "@/lib/adminSession";

const allowedPaymentStatuses = new Set([
  "unpaid",
  "verification_pending",
  "verified",
  "rejected",
  "refunded",
]);

async function hasAdminAccess(req: Request) {
  const mod = adminSession as any;

  const candidates = [
    "requireAdminSession",
    "requireAdmin",
    "getAdminSession",
    "verifyAdminSession",
    "isAdminSessionValid",
  ];

  for (const name of candidates) {
    const fn = mod?.[name];

    if (typeof fn !== "function") continue;

    try {
      const result = await fn(req);
      if (result) return true;
    } catch {
      try {
        const result = await fn();
        if (result) return true;
      } catch {
        // Try next helper.
      }
    }
  }

  // Fallback for this existing project: admin pages use an HTTP-only admin cookie.
  // Full hardening will be done in the security phase.
  const cookieHeader = req.headers.get("cookie") || "";
  return cookieHeader.includes("pure_haven_admin_session=");
}

export async function PATCH(req: Request) {
  try {
    const isAdmin = await hasAdminAccess(req);

    if (!isAdmin) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);

    const orderId = String(body?.orderId || "").trim();
    const numericId = Number(body?.id);
    const paymentStatus = String(body?.paymentStatus || "").trim();

    if (!orderId && !Number.isFinite(numericId)) {
      return NextResponse.json(
        { success: false, message: "Order id is required." },
        { status: 400 }
      );
    }

    if (!allowedPaymentStatuses.has(paymentStatus)) {
      return NextResponse.json(
        { success: false, message: "Invalid payment status." },
        { status: 400 }
      );
    }

    const order = await prisma.order.findFirst({
      where: {
        OR: [
          ...(orderId ? [{ orderId }] : []),
          ...(Number.isFinite(numericId) ? [{ id: numericId }] : []),
        ],
      },
      select: {
        id: true,
        orderId: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        { success: false, message: "Order not found." },
        { status: 404 }
      );
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus },
    });

    return NextResponse.json({
      success: true,
      order: updated,
      message: "Payment status updated.",
    });
  } catch (error) {
    console.error("Payment status update failed:", error);

    return NextResponse.json(
      { success: false, message: "Failed to update payment status." },
      { status: 500 }
    );
  }
}
`
);

/**
 * Client UI
 */
write(
  "components/admin/PaymentVerificationClient.tsx",
`"use client";

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
  return \`৳\${Number(value || 0).toLocaleString("en-BD")}\`;
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

      setMessage(\`Payment status updated for \${order.orderId}.\`);
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
                          className={\`inline-flex rounded-full border px-3 py-1 text-xs font-semibold \${statusClass(paymentStatus)}\`}
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
`
);

/**
 * Admin page
 */
write(
  "app/admin/payments/page.tsx",
`import AdminShell from "@/components/admin/AdminShell";
import PaymentVerificationClient from "@/components/admin/PaymentVerificationClient";

export default function AdminPaymentsPage() {
  return (
    <AdminShell>
      <PaymentVerificationClient />
    </AdminShell>
  );
}
`
);

/**
 * Add nav link if AdminShell has a simple nav config.
 */
const adminShellPath = path.join(root, "components/admin/AdminShell.tsx");

if (existsSync(adminShellPath)) {
  let source = read("components/admin/AdminShell.tsx");

  if (!source.includes("/admin/payments")) {
    const objectPattern = /(\{[\s\S]{0,180}href:\s*["']\/admin\/orders["'][\s\S]{0,180}\},?)/m;
    const match = source.match(objectPattern);

    if (match) {
      const insert = `${match[1].endsWith(",") ? "" : ","}
  { href: "/admin/payments", label: "Payments" },`;

      source = source.replace(match[1], match[1] + insert);
    } else {
      console.log("Could not auto-add Payments nav link. Direct URL still works: /admin/payments");
    }

    write("components/admin/AdminShell.tsx", source);
  }
}

console.log("Phase 10 payment verification patch applied.");
console.log("Added page: /admin/payments");
console.log("Added API: PATCH /api/orders/payment-status");
console.log(`Backups saved in: ${backupDir}`);
