"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type OrderItem = {
  id?: number | string;
  name?: string;
  productName?: string;
  title?: string;
  quantity?: number;
  price?: number;
  total?: number;
};

type Order = {
  id: number | string;
  orderId?: string;
  customerName?: string;
  name?: string;
  customerPhone?: string;
  phone?: string;
  customerAddress?: string;
  address?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  subtotal?: number;
  deliveryCharge?: number;
  deliveryFee?: number;
  total?: number;
  totalAmount?: number;
  createdAt?: string;
  items?: OrderItem[] | string;
  orderItems?: OrderItem[] | string;
};

function money(value: unknown) {
  const n = Number(value || 0);
  return "\u09F3" + n.toLocaleString("en-BD");
}

function formatDate(value?: string) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function normalizeItems(value: unknown): OrderItem[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getCustomerInfo(order: any) {
  const customer = order?.customer || {};

  return {
    name:
      order?.customerName ||
      order?.name ||
      customer?.name ||
      customer?.customerName ||
      "N/A",

    phone:
      order?.customerPhone ||
      order?.phone ||
      customer?.phone ||
      customer?.customerPhone ||
      "N/A",

    address:
      order?.customerAddress ||
      order?.address ||
      order?.deliveryAddress ||
      customer?.address ||
      customer?.customerAddress ||
      customer?.deliveryAddress ||
      "N/A",
  };
}

export default function OrderVoucherPage() {
  const params = useParams();
  const orderId = String(params?.id || "");
const [order, setOrder] = useState<Order | null>(null);

  const customerInfo = getCustomerInfo(order);
  const [message, setMessage] = useState("Loading voucher...");

  useEffect(() => {
    async function loadOrder() {
      try {
        let found: Order | null = null;

        const singleRes = await fetch(`/api/orders?id=${orderId}`, {
          cache: "no-store",
        });

        if (singleRes.ok) {
          const singleData = await singleRes.json();
          found = singleData?.order || singleData?.data || null;
        }

        if (!found) {
          const listRes = await fetch("/api/orders", { cache: "no-store" });
          const listData = await listRes.json();
          const orders: Order[] = Array.isArray(listData?.orders)
            ? listData.orders
            : Array.isArray(listData)
              ? listData
              : [];
found = orders.find((item) => String(item.id) === orderId || String(item.orderId || '') === orderId) || null;
        }

        if (!found) {
          setMessage("Order not found.");
          return;
        }

        setOrder(found);
        setMessage("");
      } catch {
        setMessage("Failed to load voucher.");
      }
    }

    loadOrder();
  }, [orderId]);

  const items = useMemo(() => {
    return normalizeItems(order?.items).length > 0
      ? normalizeItems(order?.items)
      : normalizeItems(order?.orderItems);
  }, [order]);

  const subtotal = useMemo(() => {
    if (typeof order?.subtotal === "number") return order.subtotal;

    return items.reduce((sum, item) => {
      const qty = Number(item.quantity || 1);
      const price = Number(item.price || 0);
      return sum + qty * price;
    }, 0);
  }, [items, order]);

  const deliveryCharge = Number(order?.deliveryCharge || 0);
  const total =
    Number(order?.totalAmount || order?.total || 0) || subtotal + deliveryCharge;

  if (!order) {
    return (
      <main className="min-h-screen bg-[#fcf8f6] p-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-[#ead9d1] bg-white p-6">
          {message}
        </div>
      </main>
    );
  }

  return (
    <main className="voucher-page bg-[#fcf8f6] p-4 text-[#2e221d]">
      <style>{`
        @page {
          size: A4;
          margin: 8mm;
        }

        @media print {
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .no-print {
            display: none !important;
          }

          .voucher-page {
            background: white !important;
            padding: 0 !important;
          }

          .voucher-paper {
            width: 100% !important;
            min-height: auto !important;
            box-shadow: none !important;
            border: 1px solid #111 !important;
            padding: 10mm !important;
            margin: 0 !important;
            font-size: 11px !important;
            line-height: 1.35 !important;
          }

          .voucher-title {
            font-size: 19px !important;
          }

          .voucher-table th,
          .voucher-table td {
            padding: 5px 4px !important;
            font-size: 10.5px !important;
          }

          .compact-gap {
            margin-top: 8px !important;
          }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between">
        <Link
          href="/admin/orders"
          className="rounded-full border border-[#ead9d1] bg-white px-4 py-2 text-sm"
        >
          Back Orders
        </Link>

        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-[#2e221d] px-5 py-2 text-sm font-semibold text-white"
        >
          Print Voucher
        </button>
      </div>

      <section className="voucher-paper mx-auto max-w-3xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between border-b border-[#2e221d] pb-3">
          <div>
            <h1 className="voucher-title text-2xl font-bold tracking-[0.18em]">
              PURE
            </h1>
            <p className="text-[10px] tracking-[0.35em] text-neutral-500">
              HAVEN BD
            </p>
            <p className="mt-1 text-xs">Order Voucher / Invoice</p>
          </div>

          <div className="text-right text-xs">
            <p><b>Voucher:</b> {order.orderId || `PH-${order.id}`}</p>
            <p><b>Date:</b> {formatDate(order.createdAt)}</p>
            <p><b>Order:</b> {order.status || "Pending"}</p>
            <p><b>Payment:</b> {order.paymentStatus || order.paymentMethod || "N/A"}</p>
          </div>
        </div>

        <div className="compact-gap grid gap-3 border-b border-[#ead9d1] pb-3 text-xs md:grid-cols-2">
          <div>
            <h2 className="mb-1 font-semibold">Customer</h2>
            <p><b>Name:</b> {customerInfo.name}</p>
            <p><b>Phone:</b> {customerInfo.phone}</p>
            <p><b>Address:</b> {customerInfo.address}</p>
          </div>

          <div>
            <h2 className="mb-1 font-semibold">Store</h2>
            <p><b>Shop:</b> Pure Haven BD</p>
            <p><b>Type:</b> Online Beauty & Lifestyle Store</p>
            <p><b>Contact:</b> [not available]</p>
          </div>
        </div>

        <table className="voucher-table compact-gap w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#2e221d] text-left">
              <th className="py-2">SL</th>
              <th className="py-2">Product</th>
              <th className="py-2 text-center">Qty</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>

          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-neutral-500">
                  No item data found.
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                const qty = Number(item.quantity || 1);
                const price = Number(item.price || 0);
                const lineTotal = Number(item.total || qty * price);

                return (
                  <tr key={item.id || index} className="border-b border-[#f1e4de]">
                    <td className="py-2">{index + 1}</td>
                    <td className="py-2">
                      {item.name || item.productName || item.title || `Item ${index + 1}`}
                    </td>
                    <td className="py-2 text-center">{qty}</td>
                    <td className="py-2 text-right">{money(price)}</td>
                    <td className="py-2 text-right">{money(lineTotal)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="compact-gap ml-auto w-full max-w-xs space-y-1 text-xs">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>

          <div className="flex justify-between">
            <span>Delivery</span>
            <span>{money(deliveryCharge)}</span>
          </div>

          <div className="flex justify-between border-t border-[#2e221d] pt-2 text-sm font-bold">
            <span>Grand Total</span>
            <span>{money(total)}</span>
          </div>
        </div>

        <div className="compact-gap grid gap-8 pt-8 text-xs md:grid-cols-2">
          <div>
            <div className="border-t border-[#2e221d] pt-1">
              Customer Signature
            </div>
          </div>

          <div>
            <div className="border-t border-[#2e221d] pt-1">
              Authorized Signature
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-[10px] text-neutral-500">
          Thank you for shopping with Pure Haven BD.
        </p>
      </section>
    </main>
  );
}




