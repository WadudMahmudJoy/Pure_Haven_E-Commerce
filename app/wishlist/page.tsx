"use client";

import Link from "next/link";
import { useWishlist } from "@/components/wishlist/WishlistContext";
import { useCart } from "@/components/cart/CartContext";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function WishlistPage() {
  const { wishlistItems, removeFromWishlist, clearWishlist } = useWishlist();
  const { addToCart } = useCart();

  return (
    <main>
      <TopBar />
      <Navbar />

      <section className="container-ph section-gap">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-[#2e221d]">Wishlist</h1>
            <p className="mt-2 text-neutral-600">
              Saved products you may want to buy later.
            </p>
          </div>

          {wishlistItems.length > 0 ? (
            <button
              type="button"
              onClick={clearWishlist}
              className="rounded-full border border-red-200 px-5 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Clear Wishlist
            </button>
          ) : null}
        </div>

        {wishlistItems.length === 0 ? (
          <div className="rounded-[24px] border border-[#ead9d1] bg-white p-10 text-center">
            <h2 className="text-2xl font-semibold text-[#2e221d]">
              Your wishlist is empty
            </h2>
            <p className="mt-3 text-neutral-600">
              Save products from the shop and they will appear here.
            </p>

            <Link
              href="/shop"
              className="mt-6 inline-flex min-w-[150px] items-center justify-center rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold !text-white hover:bg-[#7a5244]"
              style={{ color: "#ffffff" }}
            >
              Go to Shop
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {wishlistItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-4 rounded-[24px] border border-[#ead9d1] bg-white p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-center gap-4">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="h-24 w-24 rounded-2xl bg-[#f8f3ef] object-cover"
                    onError={(e) => {
                      e.currentTarget.src =
                        "https://via.placeholder.com/600x600?text=No+Image";
                    }}
                  />

                  <div>
                    <p className="text-sm text-[#7a5244]">{item.category}</p>
                    <Link
                      href={`/product/${item.id}`}
                      className="mt-1 block text-lg font-semibold text-[#2e221d] hover:text-[#7a5244]"
                    >
                      {item.name}
                    </Link>
                    <p className="mt-2 text-base font-medium text-[#2e221d]">
                      {item.price} BDT
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => addToCart(item)}
                    className="rounded-full bg-[#2e221d] px-5 py-3 text-sm font-semibold text-white hover:bg-[#7a5244]"
                  >
                    Add to Cart
                  </button>

                  <button
                    type="button"
                    onClick={() => removeFromWishlist(item.id)}
                    className="rounded-full border border-red-200 px-5 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}