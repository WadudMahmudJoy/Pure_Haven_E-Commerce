"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingBag, Phone, MessageCircle } from "lucide-react";
import { useCart } from "@/components/cart/CartContext";

type ProductPurchaseActionsProps = {
  id: number;
  name: string;
  price: number;
  image: string;
  category: string;
  stock?: number;
};

const ORDER_PHONE = "+8801977269164";
const WHATSAPP_PHONE = "8801977269164";

export default function ProductPurchaseActions({
  id,
  name,
  price,
  image,
  category,
  stock,
}: ProductPurchaseActionsProps) {
  const router = useRouter();
  const { addToCart, cartItems } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const existingItem = cartItems.find((item) => item.id === id);
  const currentQtyInCart = existingItem?.quantity ?? 0;

  const hasKnownStock = typeof stock === "number";
  const isOutOfStock = hasKnownStock && stock <= 0;

  const maxAllowedQty = useMemo(() => {
    if (!hasKnownStock) return 99;
    return Math.max(0, stock - currentQtyInCart);
  }, [hasKnownStock, stock, currentQtyInCart]);

  const disableAdd = isOutOfStock || maxAllowedQty <= 0;

  function decreaseQty() {
    setQuantity((prev) => Math.max(1, prev - 1));
  }

  function increaseQty() {
    setQuantity((prev) => {
      if (hasKnownStock) {
        return Math.min(maxAllowedQty || 1, prev + 1);
      }
      return prev + 1;
    });
  }

  function addSelectedQuantityToCart() {
    if (disableAdd) return;

    const finalQty = hasKnownStock ? Math.min(quantity, maxAllowedQty) : quantity;

    for (let i = 0; i < finalQty; i += 1) {
      addToCart({
        id,
        name,
        price,
        image,
        category,
        stock,
      });
    }
  }

  async function handleBuyNow() {
    if (disableAdd || isSubmitting) return;
    setIsSubmitting(true);
    addSelectedQuantityToCart();
    router.push("/checkout");
  }

  const whatsappText = encodeURIComponent(
    `Hello, I want to order:\nProduct: ${name}\nPrice: ৳${price}\nQuantity: ${quantity}\nCategory: ${category}`
  );

  return (
    <div className="mt-8 space-y-5">
      <div>
        <p className="mb-3 text-sm font-semibold text-[#2e221d]">Quantity</p>

        <div className="inline-flex items-center rounded-2xl border border-[#ead9d1] bg-white">
          <button
            type="button"
            onClick={decreaseQty}
            className="inline-flex h-11 w-11 items-center justify-center text-[#2e221d] transition hover:bg-[#f8f3ef]"
            aria-label="Decrease quantity"
          >
            <Minus className="h-4 w-4" />
          </button>

          <span className="inline-flex min-w-[52px] items-center justify-center text-base font-semibold text-[#2e221d]">
            {quantity}
          </span>

          <button
            type="button"
            onClick={increaseQty}
            disabled={hasKnownStock && quantity >= maxAllowedQty}
            className="inline-flex h-11 w-11 items-center justify-center text-[#2e221d] transition hover:bg-[#f8f3ef] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Increase quantity"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {hasKnownStock ? (
          <p className="mt-2 text-sm text-neutral-500">
            Available to add: {Math.max(0, maxAllowedQty)}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disableAdd}
          onClick={addSelectedQuantityToCart}
          className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#f4a024] px-3 py-3 text-center text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:text-sm"
        >
          <ShoppingBag className="h-4 w-4 shrink-0" />
          <span className="leading-tight">Add to Cart</span>
        </button>

        <button
          type="button"
          disabled={disableAdd || isSubmitting}
          onClick={handleBuyNow}
          className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#083a39] px-3 py-3 text-center text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:text-sm"
        >
          <span className="leading-tight">Buy Now</span>
        </button>

        <a
          href={`https://wa.me/${WHATSAPP_PHONE}?text=${whatsappText}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#16a34a] px-3 py-3 text-center text-[13px] font-semibold text-white transition hover:opacity-90 sm:px-5 sm:text-sm"
        >
          <MessageCircle className="h-4 w-4 shrink-0" />
          <span className="leading-tight">Order on WhatsApp</span>
        </a>

        <a
          href={`tel:${ORDER_PHONE}`}
          className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#2443a8] px-3 py-3 text-center text-[13px] font-semibold text-white transition hover:opacity-90 sm:px-5 sm:text-sm"
        >
          <Phone className="h-4 w-4 shrink-0" />
          <span className="leading-tight">Call for Order</span>
        </a>
      </div>

      {disableAdd ? (
        <p className="text-sm font-medium text-red-600">
          This product cannot be added right now.
        </p>
      ) : null}
    </div>
  );
}
