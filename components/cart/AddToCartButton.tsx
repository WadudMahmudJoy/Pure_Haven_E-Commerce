"use client";

import { useCart } from "@/components/cart/CartContext";

type AddToCartButtonProps = {
  id: number;
  name: string;
  price: number;
  image: string;
  category: string;
  stock?: number;
};

export default function AddToCartButton({
  id,
  name,
  price,
  image,
  category,
  stock,
}: AddToCartButtonProps) {
  const { addToCart, cartItems } = useCart();

  const existingItem = cartItems.find((item) => item.id === id);
  const currentQty = existingItem?.quantity ?? 0;

  const isOutOfStock = typeof stock === "number" && stock <= 0;
  const reachedStockLimit =
    typeof stock === "number" && stock > 0 && currentQty >= stock;

  const disabled = isOutOfStock || reachedStockLimit;

  const buttonText = isOutOfStock
    ? "Out of Stock"
    : reachedStockLimit
    ? "Stock Limit Reached"
    : "Add to Cart";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => addToCart({ id, name, price, image, category, stock })}
      className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      {buttonText}
    </button>
  );
}