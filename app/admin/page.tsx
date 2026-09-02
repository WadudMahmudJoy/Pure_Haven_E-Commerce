"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

type Order = {
  id: string | number;
  customerName?: string;
  name?: string;
  phone?: string;
  status?: string;
  orderStatus?: string;
  total?: number;
  grandTotal?: number;
  totalAmount?: number;
};

type CustomerMessage = {
  id: string | number;
  status?: string;
};

function normalizeArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as Record<string, unknown>)[key])
  ) {
    return (data as Record<string, unknown>)[key] as T[];
  }
  return [];
}

export default function AdminDashboardPage() {
  const [totalProducts, setTotalProducts] = useState(0);
  const [hotDealsTotal, setHotDealsTotal] = useState(0);
  const [lowStockTotal, setLowStockTotal] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [messages, setMessages] = useState<CustomerMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function loadDashboard() {
      try {
        const [allProductsRes, hotDealsRes, lowStockRes, orderRes, messageRes] =
          await Promise.all([
            fetch("/api/products?view=admin&page=1&pageSize=1&filter=all", {
              cache: "no-store",
            }),
            fetch("/api/products?view=admin&page=1&pageSize=1&filter=hot", {
              cache: "no-store",
            }),
            fetch("/api/products?view=admin&metric=low-stock", {
              cache: "no-store",
            }),
            fetch("/api/orders", { cache: "no-store" }),
            fetch("/api/customer-messages", { cache: "no-store" }),
          ]);

        const allProductsData = await allProductsRes.json().catch(() => null);
        const hotDealsData = await hotDealsRes.json().catch(() => null);
        const lowStockData = await lowStockRes.json().catch(() => null);
        const orderData = await orderRes.json().catch(() => null);
        const messageData = await messageRes.json().catch(() => null);

        if (!alive) return;

        setTotalProducts(
          typeof allProductsData?.totalItems === "number"
            ? allProductsData.totalItems
            : 0
        );
        setHotDealsTotal(
          typeof hotDealsData?.totalItems === "number"
            ? hotDealsData.totalItems
            : 0
        );
        setLowStockTotal(
          typeof lowStockData?.totalItems === "number"
            ? lowStockData.totalItems
            : 0
        );
        setOrders(normalizeArray(orderData, "orders"));
        setMessages(normalizeArray(messageData, "messages"));
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    const totalSales = orders.reduce((sum, order) => {
      const status = String(order.status || order.orderStatus || "").toLowerCase();

      if (status.includes("cancel")) return sum;

      const amount =
        Number(order.grandTotal ?? 0) ||
        Number(order.totalAmount ?? 0) ||
        Number(order.total ?? 0) ||
        0;

      return sum + amount;
    }, 0);

    return {
      totalProducts,
      totalOrders: orders.length,
      pendingOrders: orders.filter((order) =>
        String(order.status || order.orderStatus || "").toLowerCase().includes("pending")
      ).length,
      newMessages: messages.filter((message) => message.status === "new").length,
      lowStock: lowStockTotal,
      hotDeals: hotDealsTotal,
      totalSales,
    };
  }, [totalProducts, hotDealsTotal, lowStockTotal, orders, messages]);

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#7a5244]">
            Admin Panel
          </p>

          <h1 className="mt-2 text-3xl font-semibold text-[#2e221d] md:text-4xl">
            Dashboard
          </h1>

          <p className="mt-2 text-sm text-neutral-600">
            Store overview, products, orders, messages, and quick actions.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Products" value={stats.totalProducts} href="/admin/products" />
          <StatCard label="Total Orders" value={stats.totalOrders} href="/admin/orders" />
          <StatCard label="Pending Orders" value={stats.pendingOrders} href="/admin/orders" />
          <StatCard label="New Messages" value={stats.newMessages} href="/admin/messages" />
          <StatCard label="Low Stock" value={stats.lowStock} href="/admin/products" />
          <StatCard label="Hot Deals" value={stats.hotDeals} href="/admin/products" />
          <StatCard label="Total Sales" value={`৳${stats.totalSales.toLocaleString()}`} href="/admin/orders" />
          <StatCard label="Status" value={loading ? "Loading" : "Ready"} href="/admin" />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-[#2e221d]">
              Quick Actions
            </h2>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/"
                className="rounded-full border border-[#ead9d1] px-5 py-3 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
              >
                Go to Home Page
              </Link>

              <a
                href="/admin/products/add"
                className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#2e221d] hover:bg-[#5e3d32]"
              >
                Add Product
              </a>

              <a
                href="/admin/orders"
                className="rounded-full border border-[#ead9d1] px-5 py-3 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
              >
                View Orders
              </a>

              <a
                href="/admin/messages"
                className="rounded-full border border-[#ead9d1] px-5 py-3 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
              >
                Customer Messages
              </a>

              <a
                href="/admin/home-promos"
                className="rounded-full border border-[#ead9d1] px-5 py-3 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
              >
                Home Slider
              </a>
            </div>
          </div>

          <div className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-[#2e221d]">
              Recent Orders
            </h2>

            <div className="mt-5 grid gap-3">
              {orders.slice(0, 5).map((order) => (
                <a
                  key={order.id}
                  href="/admin/orders"
                  className="rounded-2xl border border-[#ead9d1] p-4 text-sm hover:bg-[#fffaf7]"
                >
                  <div className="font-semibold text-[#2e221d]">
                    Order #{order.id}
                  </div>

                  <div className="text-neutral-600">
                    {order.customerName || order.name || "Customer"} ·{" "}
                    {order.phone || "No phone"}
                  </div>
                </a>
              ))}

              {orders.length === 0 ? (
                <p className="text-sm text-neutral-500">No orders yet.</p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string | number;
  href: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-[24px] border border-[#ead9d1] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:bg-[#fffaf7] hover:shadow-md"
    >
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#7a5244]">
        {label}
      </p>

      <div className="mt-3 text-3xl font-semibold text-[#2e221d]">
        {value}
      </div>
    </a>
  );
}




