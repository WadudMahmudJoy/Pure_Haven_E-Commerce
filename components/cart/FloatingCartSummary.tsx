"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { useCart } from "@/components/cart/CartContext";

function useAnimatedNumber(value: number) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    if (displayValue === value) return;

    const direction = value > displayValue ? 1 : -1;
    const timer = window.setInterval(() => {
      setDisplayValue((current) => {
        if (current === value) {
          window.clearInterval(timer);
          return current;
        }

        const next = current + direction;

        if (direction > 0) return Math.min(next, value);
        return Math.max(next, value);
      });
    }, 90);

    return () => window.clearInterval(timer);
  }, [value, displayValue]);

  return displayValue;
}

function formatPrice(value: number) {
  const amount = Number.isFinite(value) ? value : 0;

  return "\u09F3" + amount.toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function FloatingCartSummary() {
  const pathname = usePathname();

  if (
    pathname.startsWith("/admin") ||
    pathname === "/login" ||
    pathname === "/admin/login"
  ) {
    return null;
  }

  const { cartCount, cartTotal } = useCart();
  const animatedCount = useAnimatedNumber(cartCount);

  if (cartCount <= 0) return null;

  return (
    <Link
      href="/cart"
      aria-label="View cart"
      className="fixed right-2 top-1/2 z-[140] flex -translate-y-1/2 flex-col overflow-hidden rounded-l-2xl shadow-2xl transition hover:scale-[1.02]"
    >
      <div className="flex min-h-[88px] w-[82px] flex-col items-center justify-center bg-[#2e221d] px-2 text-center text-white">
        <ShoppingBag className="mb-2 h-6 w-6" />
        <span className="text-[13px] font-bold leading-4">
          {animatedCount} Item{animatedCount > 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex min-h-[44px] w-[82px] items-center justify-center bg-[#fffaf7] px-2 text-center text-[13px] font-bold text-[#7a5244]">
        {formatPrice(cartTotal)}
      </div>
    </Link>
  );
}
