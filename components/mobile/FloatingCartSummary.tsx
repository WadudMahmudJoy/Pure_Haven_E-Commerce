"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/components/cart/CartContext";

export default function FloatingCartSummary() {
  const { cartCount, cartTotal } = useCart();

  return (
    <Link
      href="/cart"
      aria-label="Open cart summary"
      className="fixed right-2 top-1/2 z-[79] flex -translate-y-1/2 overflow-hidden rounded-xl border border-[#ead9d1] bg-white shadow-[0_8px_20px_rgba(46,34,29,0.10)] lg:hidden"
    >
      <div className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-1.5 bg-[#f4a024] px-2.5 py-2 text-white">
          <ShoppingBag className="h-4 w-4" />
          <span className="text-xs font-semibold">{cartCount} Items</span>
        </div>

        <div className="bg-white px-2.5 py-2 text-[#2e221d]">
          <span className="text-xs font-semibold">৳{cartTotal.toFixed(2)}</span>
        </div>
      </div>
    </Link>
  );
}
