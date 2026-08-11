"use client";

import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";

type Burst = {
  id: number;
  x: number;
  y: number;
};

export default function CartBurstProvider() {
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button") as HTMLButtonElement | null;

      if (!button || button.disabled) return;

      const text = (button.textContent || "").toLowerCase();

      if (!text.includes("add to cart")) return;

      const rect = button.getBoundingClientRect();
      const id = Date.now() + Math.random();

      setBursts((current) => [
        ...current,
        {
          id,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        },
      ]);

      window.setTimeout(() => {
        setBursts((current) => current.filter((item) => item.id !== id));
      }, 950);
    }

    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[99999]">
        {bursts.map((burst) => (
          <span
            key={burst.id}
            className="cart-burst-bag"
            style={{
              left: burst.x,
              top: burst.y,
            }}
          >
            <ShoppingBag className="h-7 w-7" />
          </span>
        ))}
      </div>

      <style jsx>{`
        .cart-burst-bag {
          position: fixed;
          display: inline-flex;
          height: 44px;
          width: 44px;
          align-items: center;
          justify-content: center;
          border-radius: 9999px;
          background: #ffffff;
          color: #2e221d;
          border: 1px solid #ead9d1;
          box-shadow: 0 16px 35px rgba(46, 34, 29, 0.22);
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.72);
          animation: cartBurstFloat 0.9s ease-out forwards;
          will-change: transform, opacity;
        }

        @keyframes cartBurstFloat {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.72);
          }

          18% {
            opacity: 1;
          }

          100% {
            opacity: 0;
            transform: translate(-50%, -165%) scale(1.08);
          }
        }
      `}</style>
    </>
  );
}