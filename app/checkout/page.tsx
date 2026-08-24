"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/components/cart/CartContext";

type CheckoutForm = {
  name: string;
  phone: string;
  address: string;
  paymentMethod: string;
  senderNumber: string;
  transactionId: string;
};

function money(value: number) {
  return `৳${value.toLocaleString("en-BD")}`;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { cartItems, clearCart } = useCart();

  const [form, setForm] = useState<CheckoutForm>({
    name: "",
    phone: "",
    address: "",
    paymentMethod: "Cash on Delivery",
    senderNumber: "",
    transactionId: "",
  });

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const submissionTokenRef = useRef<string>("");

  useEffect(() => {
    if (!submissionTokenRef.current && typeof crypto !== "undefined" && crypto.randomUUID) {
      submissionTokenRef.current = crypto.randomUUID();
    }
  }, []);

  const subtotal = useMemo(() => {
    return cartItems.reduce((sum: number, item: any) => {
      const qty = Number(item.quantity || 1);
      const price = Number(item.price || 0);
      return sum + qty * price;
    }, 0);
  }, [cartItems]);

  const deliveryCharge = subtotal > 0 ? 120 : 0;
  const grandTotal = subtotal + deliveryCharge;

  const normalizedPaymentMethod = form.paymentMethod.toLowerCase();
  const isBkashPayment = normalizedPaymentMethod.includes("bkash");
  const isNagadPayment = normalizedPaymentMethod.includes("nagad");
  const isManualMobilePayment = isBkashPayment || isNagadPayment;
  const selectedMobileProvider = isNagadPayment ? "Nagad" : "bKash";

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (cartItems.length === 0) {
        throw new Error("Your cart is empty.");
      }

      if (!submissionTokenRef.current && typeof crypto !== "undefined" && crypto.randomUUID) {
        submissionTokenRef.current = crypto.randomUUID();
      }

      const orderItems = cartItems.map((item: any) => {
        const qty = Number(item.quantity || 1);
        const price = Number(item.price || 0);
        const rawId = Number(item.id || 0);
        const isVariantCartId = rawId >= 100000;
        const realProductId = item.productId || (isVariantCartId ? Math.floor(rawId / 100000) : rawId);
        const variantId = item.variantId || (isVariantCartId ? rawId % 100000 : null);
        const itemName = String(item.name || item.productName || "Product");

        return {
          id: realProductId,
          productId: realProductId,
          variantId,
          cartItemId: rawId,
          name: itemName,
          productName: itemName,
          title: itemName,
          quantity: qty,
          price,
          total: qty * price,
          image: item.image || "",
          category: item.category || "",
        };
      });

      const payload = {
        submissionToken: submissionTokenRef.current || undefined,
        // direct fields
        customerName: form.name.trim(),
        name: form.name.trim(),
        fullName: form.name.trim(),

        customerPhone: form.phone.trim(),
        phone: form.phone.trim(),
        mobile: form.phone.trim(),

        customerAddress: form.address.trim(),
        address: form.address.trim(),
        deliveryAddress: form.address.trim(),

        // nested customer object for older API compatibility
        customer: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
        },

        paymentMethod: form.paymentMethod,
        paymentStatus: isManualMobilePayment ? "awaiting_payment" : "pending",
        senderNumber: form.senderNumber,
        transactionId: form.transactionId,
        paymentDetails: isManualMobilePayment
          ? {
              provider: selectedMobileProvider,
              senderNumber: form.senderNumber,
              transactionId: form.transactionId,
            }
          : null,
        status: "pending",

        items: orderItems,
        orderItems,

        subtotal,
        deliveryCharge,
        total: grandTotal,
        totalAmount: grandTotal,
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || data?.success === false) {
        throw new Error(data?.message || "Failed to place order.");
      }

      // Rotate submission token for subsequent new checkout intent
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        submissionTokenRef.current = crypto.randomUUID();
      }

      const orderId = data?.order?.orderId || data?.orderId || data?.order?.id || data?.id || "";
      clearCart();
      router.push(orderId ? `/order-success?orderId=${encodeURIComponent(orderId)}&paymentMethod=${encodeURIComponent(form.paymentMethod)}` : "/order-success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to place order.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10 text-[#2e221d]">
      <div className="container-ph">
        <Link href="/cart" className="mb-6 inline-flex text-sm font-semibold text-[#7a5244]">
          ← Back to cart
        </Link>

        <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
          <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
            <h1 className="text-3xl font-semibold">Checkout</h1>
            <p className="mt-2 text-sm text-neutral-600">
              Fill customer and delivery information.
            </p>

            {message ? (
              <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {message}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Customer name"
              />

              <input
                name="phone"
                value={form.phone}
                onChange={handleChange}
                required
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Phone number"
              />

              <textarea
                name="address"
                value={form.address}
                onChange={handleChange}
                required
                rows={4}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Delivery address"
              />

              <select
                name="paymentMethod"
                value={form.paymentMethod}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
              >
                <option value="Cash on Delivery">Cash on Delivery</option>
                <option value="bKash">bKash</option>
                <option value="Nagad">Nagad</option>
              </select>

              {isManualMobilePayment ? (
                <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-5">
                  <p className="text-sm font-semibold text-[#2e221d]">
                    {selectedMobileProvider} Payment Reservation
                  </p>

                  <p className="mt-2 text-sm leading-6 text-neutral-600">
                    Your order items will be reserved immediately upon placing the order.
                    You will have 15 minutes to complete payment via {selectedMobileProvider} and
                    submit your transaction details.
                  </p>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading || cartItems.length === 0}
                className="rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white hover:bg-[#7a5244] disabled:opacity-60"
              >
                {loading ? "Placing Order..." : "Place Order"}
              </button>
            </form>
          </section>

          <aside className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Order Summary</h2>

            <div className="mt-5 space-y-4">
              {cartItems.length === 0 ? (
                <p className="text-sm text-neutral-600">Your cart is empty.</p>
              ) : (
                cartItems.map((item: any) => {
                  const qty = Number(item.quantity || 1);
                  const price = Number(item.price || 0);

                  return (
                    <div key={item.id} className="flex gap-3 border-b border-[#ead9d1] pb-4">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-16 w-16 rounded-2xl object-cover"
                      />

                      <div className="flex-1">
                        <p className="font-semibold">{item.name}</p>
                        <p className="mt-1 text-sm text-neutral-600">
                          {money(price)} × {qty}
                        </p>
                      </div>

                      <p className="font-semibold">{money(price * qty)}</p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{money(subtotal)}</span>
              </div>

              <div className="flex justify-between">
                <span>Delivery Charge</span>
                <span>{money(deliveryCharge)}</span>
              </div>

              <div className="flex justify-between border-t border-[#ead9d1] pt-3 text-lg font-semibold">
                <span>Total</span>
                <span>{money(grandTotal)}</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}








