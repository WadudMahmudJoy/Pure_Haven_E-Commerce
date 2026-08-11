"use client";

import { useEffect, useMemo, useState } from "react";

type CustomerUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt?: string;
};

type OrderItem = {
  id: number;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  category?: string;
};

type Order = {
  id: string;
  orderId: string;
  customer?: {
    name?: string;
    phone?: string;
    city?: string;
    address?: string;
  };
  items?: OrderItem[];
  subtotal?: number;
  deliveryFee?: number;
  total?: number;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentDetails?: {
    provider?: string;
    senderNumber?: string;
    trxId?: string;
  } | null;
  createdAt?: string;
};

function money(value?: number) {
  return `৳${Number(value || 0).toLocaleString("en-BD")}`;
}

function dateText(value?: string) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-BD");
}

function statusClass(status?: string) {
  const value = String(status || "pending").toLowerCase();

  if (value === "delivered") return "border-green-200 bg-green-50 text-green-700";
  if (value === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  if (value === "processing") return "border-blue-200 bg-blue-50 text-blue-700";
  if (value === "confirmed") return "border-amber-200 bg-amber-50 text-amber-700";

  return "border-yellow-200 bg-yellow-50 text-yellow-700";
}

function itemCount(order: Order) {
  return (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 1), 0);
}

export default function CustomerDashboardClient() {
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadDashboard() {
    setLoading(true);
    setMessage("");

    try {
      const authRes = await fetch("/api/customer-auth", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const authData = await authRes.json().catch(() => null);

      if (!authRes.ok || !authData?.authenticated) {
        window.location.href = "/user-login";
        return;
      }

      setUser(authData.user);

      const ordersRes = await fetch("/api/customer-orders", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const ordersData = await ordersRes.json().catch(() => null);

      if (!ordersRes.ok || !ordersData?.success) {
        throw new Error(ordersData?.message || "Could not load order history.");
      }

      setOrders(Array.isArray(ordersData.orders) ? ordersData.orders : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dashboard load failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const delivered = orders.filter((order) => order.status === "delivered").length;
    const pending = orders.filter((order) =>
      ["pending", "confirmed", "processing"].includes(String(order.status || "pending"))
    ).length;

    const totalSpent = orders
      .filter((order) => order.status !== "cancelled")
      .reduce((sum, order) => sum + Number(order.total || 0), 0);

    return { totalOrders, delivered, pending, totalSpent };
  }, [orders]);

  async function logout() {
    try {
      await fetch("/api/customer-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode: "logout" }),
      });
    } finally {
      localStorage.removeItem("pure_haven_customer_logged_in");
      localStorage.removeItem("pure_haven_customer_name");
      localStorage.removeItem("pure_haven_customer_email");
      localStorage.removeItem("pure_haven_customer_phone");
      window.location.href = "/user-login";
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fbf7f4] px-4 py-10">
        <div className="mx-auto max-w-6xl rounded-[28px] border border-[#ead8cf] bg-white p-8 text-center">
          Loading your account...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fbf7f4] px-4 py-8 text-[#171717] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <nav className="flex flex-wrap gap-3 rounded-[24px] border border-[#ead8cf] bg-white p-4 shadow-sm">
          <a className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/">
            Home
          </a>
          <a className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/shop">
            Shop
          </a>
          <a className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/cart">
            Cart
          </a>
          <a className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/track-order">
            Track Order
          </a>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Logout
          </button>
        </nav>

        <section className="rounded-[30px] border border-[#ead8cf] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-[#8b5a45]">
                Customer Account
              </p>
              <h1 className="mt-2 text-3xl font-bold">
                Welcome{user?.name ? `, ${user.name}` : ""}
              </h1>
              <p className="mt-2 text-sm text-[#6f5d54]">
                {user?.email || "No email"} · {user?.phone || "No phone"}
              </p>
            </div>

            <a
              href="/shop"
              className="rounded-full bg-[#8b5a45] px-6 py-3 text-sm font-semibold text-white hover:bg-[#6f4032]"
            >
              Continue Shopping
            </a>
          </div>

          {message ? (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {message}
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-[#ead8cf] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-[#8b5a45]">Orders</p>
              <p className="mt-2 text-2xl font-bold">{stats.totalOrders}</p>
            </div>
            <div className="rounded-2xl border border-[#ead8cf] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-[#8b5a45]">Active</p>
              <p className="mt-2 text-2xl font-bold">{stats.pending}</p>
            </div>
            <div className="rounded-2xl border border-[#ead8cf] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-[#8b5a45]">Delivered</p>
              <p className="mt-2 text-2xl font-bold">{stats.delivered}</p>
            </div>
            <div className="rounded-2xl border border-[#ead8cf] p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-[#8b5a45]">Total Spent</p>
              <p className="mt-2 text-2xl font-bold">{money(stats.totalSpent)}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[30px] border border-[#ead8cf] bg-white p-6 shadow-sm md:p-8">
          <div className="mb-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-[#8b5a45]">
                Order History
              </p>
              <h2 className="mt-2 text-2xl font-bold">My Orders</h2>
            </div>

            <button
              type="button"
              onClick={loadDashboard}
              className="rounded-full border border-[#ead8cf] bg-white px-5 py-2 text-sm font-semibold text-[#2d1f1a] hover:bg-[#f8f1ed]"
            >
              Refresh
            </button>
          </div>

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#ead8cf] p-8 text-center">
              <p className="font-semibold">No orders found for this account.</p>
              <p className="mt-2 text-sm text-[#6f5d54]">
                Orders are matched by your registered phone number.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const status = String(order.status || "pending").toLowerCase();

                return (
                  <article
                    key={order.id}
                    className="rounded-2xl border border-[#ead8cf] p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-bold">{order.orderId}</h3>
                          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(status)}`}>
                            {status}
                          </span>
                          <span className="rounded-full border border-yellow-200 bg-yellow-50 px-3 py-1 text-xs font-semibold text-yellow-700">
                            Payment: {order.paymentStatus || "pending"}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-[#6f5d54]">
                          {dateText(order.createdAt)} · {order.paymentMethod || "Cash on Delivery"}
                        </p>
                        <p className="mt-1 text-sm text-[#6f5d54]">
                          Items: {itemCount(order)} · Total: {money(order.total)}
                        </p>
                      </div>

                      <a
                        href={`/track-order?orderId=${encodeURIComponent(order.orderId)}&phone=${encodeURIComponent(user?.phone || "")}`}
                        className="rounded-full border border-[#ead8cf] bg-white px-5 py-2 text-sm font-semibold text-[#2d1f1a] hover:bg-[#f8f1ed]"
                      >
                        Track
                      </a>
                    </div>

                    {order.items && order.items.length > 0 ? (
                      <div className="mt-4 divide-y divide-[#ead8cf] rounded-xl border border-[#ead8cf]">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex justify-between gap-4 px-4 py-3 text-sm">
                            <div>
                              <p className="font-semibold">{item.name}</p>
                              <p className="text-[#6f5d54]">
                                Qty: {item.quantity} · {item.category || "Product"}
                              </p>
                            </div>
                            <p className="font-semibold">{money(item.price * item.quantity)}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
