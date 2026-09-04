"use client";

import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/products/add", label: "Add Product" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/payments", label: "Payment Verification" },
  { href: "/admin/messages", label: "Messages", isMessage: true },
  { href: "/admin/home-promos", label: "Home Slider" },
  { href: "/admin/footer", label: "Footer" },
  { href: "/admin/site-settings", label: "Site Settings" },
  { href: "/admin/settings", label: "Login Settings" },
];

export default function AdminNav() {
  const [newMessages, setNewMessages] = useState(0);

  useEffect(() => {
    async function loadCount() {
      try {
        const res = await fetch("/api/customer-messages", {
          cache: "no-store",
          credentials: "include",
        });
        const data = await res.json();
        if (res.ok && data?.success && Array.isArray(data.messages)) {
          setNewMessages(data.messages.filter((m: { status?: string }) => m.status === "new").length);
        }
      } catch {}
    }

    loadCount();
    const timer = window.setInterval(loadCount, 20000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/admin-auth", {
        method: "DELETE",
        credentials: "include",
      });
    } finally {
      localStorage.removeItem("pure_haven_admin");
      localStorage.removeItem("pure_haven_admin_logged_in");
      localStorage.removeItem("adminLoggedIn");
      localStorage.removeItem("isAdminLoggedIn");
      localStorage.removeItem("pure_haven_admin_email");
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/admin/login";
    }
  }

  return (
    <nav className="rounded-[28px] border border-[#ead9d1] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="relative rounded-full border border-[#ead9d1] px-4 py-2 text-sm font-semibold text-[#2e221d] hover:bg-[#f8f3ef]"
          >
            {link.label}
            {link.isMessage && newMessages > 0 ? (
              <span className="absolute -right-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white">
                {newMessages}
              </span>
            ) : null}
          </a>
        ))}

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
        >
          Logout
        </button>
      </div>
    </nav>
  );
}
