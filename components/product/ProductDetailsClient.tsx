"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import { useCart } from "@/components/cart/CartContext";
import SafeImage from "@/components/ui/SafeImage";
import { normalizeImageSrc } from "@/lib/imagePaths";

type ProductVariant = {
  id: number;
  label: string;
  price: number;
  stock: number;
  image?: string | null;
};

type Product = {
  id: number;
  name: string;
  price: number;
  compareAtPrice?: number | null;
  image: string;
  images?: string[];
  category: string;
  subcategory?: string;
  description?: string;
  stock?: number;
  variants?: ProductVariant[];
  badgeText?: string | null;
};

type ProductDetailsClientProps = {
  product: Product;
};

export default function ProductDetailsClient({ product }: ProductDetailsClientProps) {
  const { addToCart } = useCart();

  // Effective base gallery: relational images if present, else [product.image] fallback
  const baseGallery: string[] =
    Array.isArray(product.images) && product.images.length > 0
      ? product.images
      : [product.image];

  const variants = product.variants || [];
  const firstAvailableVariant =
    variants.find((variant) => Number(variant.stock) > 0) || variants[0] || null;

  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(
    firstAvailableVariant?.id ?? null
  );
  const [selectedBaseIdx, setSelectedBaseIdx] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [stockNotice, setStockNotice] = useState("");

  const selectedVariant = useMemo(() => {
    return variants.find((variant) => variant.id === selectedVariantId) || null;
  }, [variants, selectedVariantId]);

  const activePrice = selectedVariant ? selectedVariant.price : product.price;
  const activeStock = selectedVariant ? selectedVariant.stock : product.stock ?? 0;

  // Variant image is a presentation override only — does NOT mutate base gallery
  const variantImage = selectedVariant?.image?.trim() || null;
  const selectedBaseGalleryImage = baseGallery[selectedBaseIdx] ?? baseGallery[0];
  const activeImage = normalizeImageSrc(
    variantImage ? variantImage : selectedBaseGalleryImage,
    { category: product.category }
  );

  const oldPrice =
    typeof product.compareAtPrice === "number" && product.compareAtPrice > activePrice
      ? product.compareAtPrice
      : null;

  const outOfStock = Number(activeStock) <= 0;
  const maxQuantity = Math.max(1, Number(activeStock || 0));

  function selectVariant(variant: ProductVariant) {
    setSelectedVariantId(variant.id);
    setQuantity(1);
    setAdded(false);

    if (Number(variant.stock) <= 0) {
      setStockNotice(`${variant.label} Out of Stock.`);
    } else {
      setStockNotice("");
    }
  }

  function decreaseQty() {
    setQuantity((prev) => Math.max(1, prev - 1));
  }

  function increaseQty() {
    if (outOfStock) return;
    setQuantity((prev) => Math.min(maxQuantity, prev + 1));
  }

  function handleAddToCart() {
    if (outOfStock) {
      setStockNotice("Ei selected size Out of Stock.");
      return;
    }

    const cartName = selectedVariant
      ? `${product.name} (${selectedVariant.label})`
      : product.name;

    const cartId = selectedVariant
      ? product.id * 100000 + selectedVariant.id
      : product.id;

    for (let i = 0; i < quantity; i++) {
      addToCart({
        id: cartId,
        productId: product.id,
        variantId: selectedVariant?.id ?? null,
        name: cartName,
        price: activePrice,
        image: activeImage,
        category: product.category,
        stock: activeStock,
      } as any);
    }

    setAdded(true);
    window.setTimeout(() => setAdded(false), 1000);
  }

  return (
    <main className="bg-[#fcf8f6] px-4 py-10 text-[#2e221d]">
      <div className="container-ph">
        <Link
          href="/shop"
          className="mb-6 inline-flex text-sm font-semibold text-[#7a5244] hover:text-[#2e221d]"
        >
    ← Back to shop
        </Link>

        <section className="grid gap-10 rounded-[28px] border border-[#ead9d1] bg-white p-5 shadow-sm lg:grid-cols-[1.05fr_0.95fr] lg:p-8">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[24px] border border-[#ead9d1] bg-[#f8f3ef]">
              <SafeImage
                src={activeImage}
                alt={selectedVariant ? `${product.name} ${selectedVariant.label}` : product.name}
                category={product.category}
                className="aspect-square w-full object-cover"
                width={1000}
                height={1000}
                sizes="(max-width: 768px) 100vw, 50vw"
                quality={78}
                priority
              />
            </div>

            {/* Base gallery thumbnail strip — only shown when gallery has > 1 image */}
            {baseGallery.length > 1 ? (
              <div
                className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                aria-label="Product image gallery"
              >
                {baseGallery.map((imgUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedBaseIdx(idx)}
                    aria-current={selectedBaseIdx === idx ? "true" : undefined}
                    aria-label={`Show product image ${idx + 1} of ${baseGallery.length}`}
                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-white transition ${
                      selectedBaseIdx === idx
                        ? "border-[#2e221d] ring-2 ring-[#2e221d]/20"
                        : "border-[#ead9d1] hover:border-[#7a5244]"
                    }`}
                  >
                    <SafeImage
                      src={normalizeImageSrc(imgUrl, { category: product.category })}
                      alt={`Product image ${idx + 1}`}
                      category={product.category}
                      className="h-full w-full object-cover"
                      width={128}
                      height={128}
                      sizes="64px"
                      quality={70}
                    />
                  </button>
                ))}
              </div>
            ) : null}

            {variants.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {variants.map((variant) => {
                  const active = selectedVariantId === variant.id;
                  const noStock = Number(variant.stock) <= 0;
                  const image = normalizeImageSrc(
                    variant.image?.trim() ? variant.image : product.image,
                    { category: product.category }
                  );

                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => selectVariant(variant)}
                      className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border bg-white ${
                        active ? "border-[#2e221d] ring-2 ring-[#2e221d]/20" : "border-[#ead9d1]"
                      } ${noStock ? "opacity-45 grayscale" : ""}`}
                    >
                      <SafeImage
                        src={image}
                        alt={variant.label}
                        category={product.category}
                        className="h-full w-full object-cover"
                        width={160}
                        height={160}
                        sizes="80px"
                        quality={70}
                      />
                      {noStock ? (
                        <span className="absolute inset-x-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">
                          Out of Stock
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="lg:pt-4">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#f8f3ef] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#7a5244]">
                {product.category}
              </span>
              {product.subcategory ? (
                <span className="rounded-full bg-[#f8f3ef] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#7a5244]">
                  {product.subcategory}
                </span>
              ) : null}
            </div>

            <h1 className="mt-5 text-3xl font-semibold leading-tight md:text-4xl">
              {selectedVariant ? `${product.name} (${selectedVariant.label})` : product.name}
            </h1>

            {product.badgeText ? (
              <span className="mt-4 inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-white">
                {product.badgeText}
              </span>
            ) : null}

            <div className="mt-5 flex items-baseline gap-3">
              <p className="text-3xl font-semibold text-[#a12d4a]">{"\u09F3"}{activePrice}</p>
              {oldPrice ? (
                <p className="text-xl font-medium text-neutral-400 line-through">{"\u09F3"}{oldPrice}</p>
              ) : null}
            </div>

            {variants.length > 0 ? (
              <div className="mt-7">
                <p className="mb-3 text-sm font-semibold">Size</p>

                <div className="flex flex-wrap gap-2">
                  {variants.map((variant) => {
                    const active = selectedVariantId === variant.id;
                    const noStock = Number(variant.stock) <= 0;

                    return (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => selectVariant(variant)}
                        className={`relative min-w-[105px] rounded-full border px-5 py-3 text-sm font-semibold transition ${
                          active
                            ? "border-[#2e221d] bg-white text-[#2e221d] shadow-sm ring-2 ring-[#2e221d]/15"
                            : "border-[#d8c8bf] bg-white text-[#2e221d] hover:border-[#7a5244]"
                        } ${noStock ? "opacity-45 grayscale" : ""}`}
                        title={noStock ? "Out of Stock" : "Available"}
                      >
                        <span>{variant.label}</span>
                        {noStock ? (
                          <span className="ml-1 text-[10px] font-medium text-red-600">
                            Out
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {stockNotice ? (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
                    {stockNotice}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5">
              {outOfStock ? (
                <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600">
                  Out of Stock
                </span>
              ) : (
                <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
                  In Stock ({activeStock})
                </span>
              )}
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-5">
              <div>
                <p className="mb-2 text-sm font-semibold">Quantity</p>

                <div className="inline-flex items-center border border-[#ead9d1] bg-white">
                  <button type="button" onClick={decreaseQty} className="px-4 py-3 text-lg hover:bg-[#f8f3ef]">
                    -
                  </button>
                  <span className="min-w-12 border-x border-[#ead9d1] px-4 py-3 text-center font-semibold">
                    {quantity}
                  </span>
                  <button type="button" onClick={increaseQty} className="px-4 py-3 text-lg hover:bg-[#f8f3ef]">
                    +
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                disabled={outOfStock}
                className={`mt-7 inline-flex min-w-[190px] items-center justify-center gap-2 rounded-md px-6 py-4 text-sm font-semibold text-white transition ${
                  outOfStock
                    ? "cursor-not-allowed bg-[#b7aaa2]"
                    : added
                    ? "bg-[#7a5244]"
                    : "bg-[#a12d4a] hover:bg-[#2e221d]"
                }`}
              >
                {added ? <Check className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
                {outOfStock ? "OUT OF STOCK" : added ? "ADDED" : "ADD TO CART"}
              </button>
            </div>

            <p className="mt-3 text-sm text-neutral-600">
              Available to add: {outOfStock ? 0 : activeStock}
            </p>

            <div className="mt-8 border-t border-[#ead9d1] pt-6">
              <h2 className="text-xl font-semibold">Product Details</h2>

              <div className="mt-4 space-y-2 text-sm text-neutral-700">
                <p>Category: {product.category}</p>
                {product.subcategory ? <p>Subcategory: {product.subcategory}</p> : null}
                {selectedVariant ? <p>Selected size: {selectedVariant.label}</p> : null}
                <p>Stock: {activeStock}</p>
              </div>

              <p className="mt-5 leading-7 text-neutral-700">
                {product.description || "No detailed description has been added yet."}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}


