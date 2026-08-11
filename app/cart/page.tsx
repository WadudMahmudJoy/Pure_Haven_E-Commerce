"use client";

import Link from "next/link";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { useCart } from "@/components/cart/CartContext";

const SHIPPING_FEE = 80;

export default function CartPage() {
  const {
    cartItems,
    cartTotal,
    increaseQuantity,
    decreaseQuantity,
    removeFromCart,
  } = useCart();

  const hasInvalidStockItem = cartItems.some((item) => {
    const currentStock = typeof item.stock === "number" ? item.stock : null;
    if (currentStock === null) return false;
    if (currentStock <= 0) return true;
    if (item.quantity > currentStock) return true;
    return false;
  });

  return (
    <main>
      <TopBar />
      <Navbar />

      <section className="container-ph section-gap">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-4xl font-semibold">My Cart</h1>

          <Link
            href="/shop"
            className="rounded-full border border-[#ead9d1] px-5 py-2 text-sm hover:bg-[#f8f3ef]"
          >
            Continue Shopping
          </Link>
        </div>

        {cartItems.length === 0 ? (
          <div className="rounded-[24px] border border-[#ead9d1] bg-white p-10 text-center">
            <h2 className="text-2xl font-semibold">Your cart is empty</h2>
            <p className="mt-3 text-neutral-600">
              Add some products to continue shopping.
            </p>

            <Link href="/shop" className="btn-primary mt-6 inline-block">
              Go to Shop
            </Link>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              {cartItems.map((item) => {
                const currentStock = typeof item.stock === "number" ? item.stock : null;
                const hasKnownStock = currentStock !== null;
                const isOutOfStock = currentStock !== null && currentStock <= 0;
                const reachedStockLimit =
                  currentStock !== null &&
                  currentStock > 0 &&
                  item.quantity >= currentStock;

                const quantityExceeded =
                  currentStock !== null &&
                  currentStock > 0 &&
                  item.quantity > currentStock;

                const disableIncrease = isOutOfStock || reachedStockLimit;

                return (
                  <div
                    key={item.id}
                    className="grid gap-4 rounded-[24px] border border-[#ead9d1] bg-white p-4 md:grid-cols-[120px_1fr_auto]"
                  >
                    <div
                      className="h-[120px] rounded-[16px] bg-[#f8f3ef] bg-cover bg-center"
                      style={{ backgroundImage: `url('${item.image}')` }}
                    />

                    <div>
                      <p className="text-sm text-[#7a5244]">{item.category}</p>
                      <h3 className="mt-1 text-xl font-semibold">{item.name}</h3>
                      <p className="mt-2">{item.price} BDT</p>

                      {hasKnownStock ? (
                        <p className="mt-2 text-sm text-neutral-600">
                          Stock: {currentStock}
                        </p>
                      ) : null}

                      <p className="mt-2 text-sm text-neutral-600">
                        Subtotal: {item.price * item.quantity} BDT
                      </p>

                      {isOutOfStock ? (
                        <div className="mt-3 inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                          Out of Stock
                        </div>
                      ) : quantityExceeded ? (
                        <div className="mt-3 inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
                          Quantity exceeds available stock
                        </div>
                      ) : reachedStockLimit ? (
                        <div className="mt-3 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                          Stock limit reached
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-start gap-3 md:items-end">
                      <div className="flex items-center rounded-full border border-[#ead9d1]">
                        <button
                          type="button"
                          onClick={() => decreaseQuantity(item.id)}
                          className="px-4 py-2"
                        >
                          -
                        </button>

                        <span className="px-4">{item.quantity}</span>

                        <button
                          type="button"
                          disabled={disableIncrease}
                          onClick={() => increaseQuantity(item.id)}
                          className="px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          +
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeFromCart(item.id)}
                        className="text-sm text-red-500"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="h-fit rounded-[24px] border border-[#ead9d1] bg-white p-6">
              <h2 className="text-2xl font-semibold">Order Summary</h2>

              {hasInvalidStockItem ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  কিছু item-এর stock available নেই। Checkout করার আগে cart ঠিক করো।
                </div>
              ) : null}

              <div className="mt-6 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Items Total</span>
                  <span>{cartTotal} BDT</span>
                </div>

                <div className="flex items-center justify-between">
                  <span>Shipping</span>
                  <span>{SHIPPING_FEE} BDT</span>
                </div>

                <div className="flex items-center justify-between border-t border-[#ead9d1] pt-3 text-base font-semibold">
                  <span>Grand Total</span>
                  <span>{cartTotal + SHIPPING_FEE} BDT</span>
                </div>
              </div>

              {hasInvalidStockItem ? (
                <button
                  type="button"
                  disabled
                  className="btn-primary mt-6 block w-full cursor-not-allowed text-center opacity-60"
                >
                  Fix Cart Before Checkout
                </button>
              ) : (
                <Link
                  href="/checkout"
                  className="btn-primary mt-6 block w-full text-center"
                >
                  Proceed to Checkout
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}