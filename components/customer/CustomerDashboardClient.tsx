"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  isOrderActive,
  getOrderStatusLabel,
  getOrderStatusBadgeClass,
} from "@/lib/orderPresentation";

type CustomerUser = {
  id: string;
  name: string;
  email?: string | null;
  normalizedPhone?: string | null;
  phone?: string | null;
  emailVerifiedAt?: string | Date | null;
  phoneVerifiedAt?: string | Date | null;
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

function itemCount(order: Order) {
  return (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 1), 0);
}

export default function CustomerDashboardClient() {
  const router = useRouter();
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [resendStatus, setResendStatus] = useState("");
  const [resending, setResending] = useState(false);

  // Identity Mutation State
  const [showIdentityModal, setShowIdentityModal] = useState<"EMAIL" | "PHONE" | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newIdentifierValue, setNewIdentifierValue] = useState("");
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [identitySuccess, setIdentitySuccess] = useState("");

  const [reloadIndex, setReloadIndex] = useState(0);

  const loadDashboard = useCallback(() => {
    setLoading(true);
    setReloadIndex((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function startFetching() {
      try {
        const authRes = await fetch("/api/customer-auth/session", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const authData = await authRes.json().catch(() => null);

        if (!authRes.ok || !authData?.authenticated) {
          if (!ignore) router.push("/user-login?returnTo=/customer/dashboard");
          return;
        }

        if (!ignore) setUser(authData.user);

        const ordersRes = await fetch("/api/customer-orders", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const ordersData = await ordersRes.json().catch(() => null);

        if (!ordersRes.ok || !ordersData?.success) {
          throw new Error(ordersData?.message || "Could not load order history.");
        }

        if (!ignore) setOrders(Array.isArray(ordersData.orders) ? ordersData.orders : []);
      } catch (error) {
        if (!ignore) setMessage(error instanceof Error ? error.message : "Dashboard load failed.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    startFetching();

    return () => {
      ignore = true;
    };
  }, [router, reloadIndex]);

  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const delivered = orders.filter((order) => order.status === "delivered").length;
    const pending = orders.filter((order) => isOrderActive(order.status)).length;

    const totalSpent = orders
      .filter((order) => order.status !== "cancelled")
      .reduce((sum, order) => sum + Number(order.total || 0), 0);

    return { totalOrders, delivered, pending, totalSpent };
  }, [orders]);

  async function handleResendVerification() {
    setResending(true);
    setResendStatus("");
    try {
      const res = await fetch("/api/customer-auth/email-verification/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setResendStatus("Verification link sent! Please check your inbox.");
      } else {
        setResendStatus(data?.message || "Failed to send verification link.");
      }
    } catch {
      setResendStatus("Network error. Please try again.");
    } finally {
      setResending(false);
    }
  }

  async function handleIdentityMutation(e: React.FormEvent) {
    e.preventDefault();
    setIdentityLoading(true);
    setIdentityError("");
    setIdentitySuccess("");

    const action =
      showIdentityModal === "EMAIL"
        ? user?.email
          ? "CHANGE_EMAIL"
          : "ADD_EMAIL"
        : user?.normalizedPhone || user?.phone
          ? "CHANGE_PHONE"
          : "ADD_PHONE";

    const payload: {
      action: "ADD_EMAIL" | "CHANGE_EMAIL" | "ADD_PHONE" | "CHANGE_PHONE";
      currentPassword: string;
      newEmail?: string;
      newPhone?: string;
    } = {
      action,
      currentPassword,
    };

    if (showIdentityModal === "EMAIL") {
      payload.newEmail = newIdentifierValue.trim();
    } else {
      payload.newPhone = newIdentifierValue.trim();
    }

    try {
      const res = await fetch("/api/customer-auth/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        setIdentitySuccess(data.message || "Account updated successfully.");
        setCurrentPassword("");
        setNewIdentifierValue("");
        setTimeout(() => {
          setShowIdentityModal(null);
          setIdentitySuccess("");
          loadDashboard();
        }, 1200);
      } else {
        setIdentityError(data?.message || "Update failed. Please try again.");
      }
    } catch {
      setIdentityError("Network error. Please try again.");
    } finally {
      setIdentityLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/customer-auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
    } finally {
      localStorage.removeItem("pure_haven_customer_logged_in");
      localStorage.removeItem("pure_haven_customer_name");
      localStorage.removeItem("pure_haven_customer_email");
      localStorage.removeItem("pure_haven_customer_phone");
      router.push("/user-login");
      router.refresh();
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
          <Link className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/">
            Home
          </Link>
          <Link className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/shop">
            Shop
          </Link>
          <Link className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/cart">
            Cart
          </Link>
          <Link className="rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed]" href="/track-order">
            Track Order
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Logout
          </button>
        </nav>

        {/* Non-blocking Phone-Only Recovery Notice */}
        {!user?.email && (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-sm">Add an email address to enable password recovery.</p>
              <p className="text-xs text-amber-800 mt-0.5">
                Accounts registered with only a phone number require a verified email to use automated password recovery.
              </p>
            </div>
            <button
              onClick={() => {
                setShowIdentityModal("EMAIL");
                setIdentityError("");
                setIdentitySuccess("");
              }}
              className="px-4 py-2 rounded-full bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold whitespace-nowrap transition"
            >
              Add Email Address
            </button>
          </div>
        )}

        <section className="rounded-[30px] border border-[#ead8cf] bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-[#8b5a45]">
                Customer Account
              </p>
              <h1 className="mt-2 text-3xl font-bold">
                Welcome{user?.name ? `, ${user.name}` : ""}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[#6f5d54]">
                {/* Email Section */}
                <div className="flex items-center gap-2">
                  <span>{user?.email || "No email"}</span>
                  {user?.email ? (
                    user.emailVerifiedAt ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        Not verified
                      </span>
                    )
                  ) : null}
                  <button
                    onClick={() => {
                      setShowIdentityModal("EMAIL");
                      setIdentityError("");
                      setIdentitySuccess("");
                    }}
                    className="text-xs text-amber-700 hover:underline font-medium"
                  >
                    {user?.email ? "Change" : "Add"}
                  </button>
                </div>

                <span>·</span>

                {/* Phone Section */}
                <div className="flex items-center gap-2">
                  <span>{user?.normalizedPhone || user?.phone || "No phone"}</span>
                  <button
                    onClick={() => {
                      setShowIdentityModal("PHONE");
                      setIdentityError("");
                      setIdentitySuccess("");
                    }}
                    className="text-xs text-amber-700 hover:underline font-medium"
                  >
                    {user?.normalizedPhone || user?.phone ? "Change" : "Add"}
                  </button>
                </div>
              </div>

              {/* Resend Verification Action if Unverified */}
              {user?.email && !user.emailVerifiedAt && (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={handleResendVerification}
                    disabled={resending}
                    className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline disabled:opacity-50"
                  >
                    {resending ? "Sending verification email..." : "Resend verification link"}
                  </button>
                  {resendStatus && <span className="text-xs text-emerald-700">{resendStatus}</span>}
                </div>
              )}
            </div>

            <Link
              href="/shop"
              className="rounded-full bg-[#8b5a45] px-6 py-3 text-sm font-semibold text-white hover:bg-[#6f4032]"
            >
              Continue Shopping
            </Link>
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

        {/* Identity Mutation Modal */}
        {showIdentityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md bg-white rounded-3xl p-6 md:p-8 shadow-xl border border-[#ead8cf]">
              <h3 className="text-xl font-bold text-[#2d1f1a]">
                {showIdentityModal === "EMAIL"
                  ? user?.email
                    ? "Change Email Address"
                    : "Add Email Address"
                  : user?.normalizedPhone || user?.phone
                    ? "Change Phone Number"
                    : "Add Phone Number"}
              </h3>
              <p className="text-xs text-[#6f5d54] mt-1.5 mb-5">
                {showIdentityModal === "EMAIL"
                  ? "You'll need to verify your new email before it can be used for password recovery."
                  : "Enter a valid Bangladeshi phone number (e.g. 017XXXXXXXX)."}
              </p>

              {identityError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 mb-4">
                  {identityError}
                </div>
              )}

              {identitySuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 mb-4">
                  {identitySuccess}
                </div>
              )}

              <form onSubmit={handleIdentityMutation} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2d1f1a] mb-1">
                    {showIdentityModal === "EMAIL" ? "New Email Address" : "New Phone Number"}
                  </label>
                  <input
                    type={showIdentityModal === "EMAIL" ? "email" : "tel"}
                    required
                    value={newIdentifierValue}
                    onChange={(e) => setNewIdentifierValue(e.target.value)}
                    placeholder={
                      showIdentityModal === "EMAIL" ? "user@example.com" : "01711223344"
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#ead8cf] text-sm focus:outline-none focus:ring-2 focus:ring-[#8b5a45]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2d1f1a] mb-1">
                    Current Password (Required for confirmation)
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#ead8cf] text-sm focus:outline-none focus:ring-2 focus:ring-[#8b5a45]"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowIdentityModal(null);
                      setIdentityError("");
                      setIdentitySuccess("");
                    }}
                    className="flex-1 py-2.5 rounded-full border border-[#ead8cf] text-xs font-semibold text-[#2d1f1a] hover:bg-[#f8f1ed]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={identityLoading}
                    className="flex-1 py-2.5 rounded-full bg-[#8b5a45] text-white text-xs font-semibold hover:bg-[#6f4032] disabled:opacity-50"
                  >
                    {identityLoading ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}


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
                          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getOrderStatusBadgeClass(status)}`}>
                            {getOrderStatusLabel(status)}
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
