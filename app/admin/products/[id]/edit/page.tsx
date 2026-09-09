"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminNav from "@/components/admin/AdminNav";
import {
  moveGalleryItemUp,
  moveGalleryItemDown,
  canAddGalleryItem,
  canRemoveGalleryItem,
  serializeGalleryPayload,
  toAdminManagedUploadStatus,
  applyManagedUploadStatus,
  boundedStatusPollDelays,
  canSaveProduct,
  type AdminGalleryItem,
  type AdminGalleryManagedItem,
} from "@/lib/catalog/adminGalleryState";
import type { AdminProductGalleryItemDto } from "@/lib/catalog/types";

type Product = {
  id: number;
  name: string;
  price: number;
  compareAtPrice?: number | null;
  image: string;
  images?: string[];
  gallery?: AdminProductGalleryItemDto[];
  category: string;
  subcategory?: string | null;
  description?: string | null;
  stock?: number;
  isHotDeal?: boolean;
  isUpcoming?: boolean;
  badgeText?: string | null;
  badgeTone?: string | null;
};

function safeStock(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const productId = Number(params?.id);

  const [form, setForm] = useState({
    name: "",
    price: "",
    compareAtPrice: "",
    category: "",
    subcategory: "",
    description: "",
    stock: "",
    isHotDeal: false,
    isUpcoming: false,
    badgeText: "",
    badgeTone: "sale",
  });

  const [gallery, setGallery] = useState<AdminGalleryItem[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function loadProduct() {
      if (!Number.isInteger(productId) || productId <= 0) {
        if (alive) {
          setMessage("Invalid product id.");
          setInitialLoading(false);
        }
        return;
      }

      try {
        const res = await fetch(`/api/products?view=admin&id=${productId}`, {
          cache: "no-store",
        });

        const data = await res.json();

        if (!alive) return;

        if (!res.ok || !data?.success || !data?.product) {
          throw new Error(data?.message || "Product not found.");
        }

        const product = data.product as Product;

        setForm({
          name: product.name || "",
          price: String(product.price ?? ""),
          compareAtPrice:
            product.compareAtPrice === null || product.compareAtPrice === undefined
              ? ""
              : String(product.compareAtPrice),
          category: product.category || "",
          subcategory: product.subcategory || "",
          description: product.description || "",
          stock: String(product.stock ?? 0),
          isHotDeal: Boolean(product.isHotDeal),
          isUpcoming: Boolean(product.isUpcoming),
          badgeText: product.badgeText || "",
          badgeTone: product.badgeTone || "sale",
        });

        // Initialize gallery authority from product.images with fallback to [product.image]
        const initialImages: string[] =
          Array.isArray(product.images) && product.images.length > 0
            ? product.images
            : product.image
            ? [product.image]
            : [];

        if (initialImages.length === 0) {
          throw new Error("Product has no valid gallery image.");
        }

        if (initialImages.length > 4) {
          throw new Error(
            "Product gallery exceeds the supported maximum of 4 images."
          );
        }

        if (Array.isArray(product.gallery) && product.gallery.length > 0) {
          setGallery(
            product.gallery.map((item, idx) => {
              if (item.sourceKind === "MANAGED" && item.managedMediaId) {
                return {
                  id: `gallery-init-${idx}-${item.productImageId}`,
                  kind: "managed" as const,
                  managedMediaId: item.managedMediaId,
                  previewUrl: item.previewUrl,
                  url: item.previewUrl,
                  status: "Ready" as const,
                  idempotencyKey: `init-${item.managedMediaId}`,
                  altText: item.altText,
                };
              }
              return {
                id: `gallery-init-${idx}-${item.productImageId}`,
                kind: "legacy-existing" as const,
                productImageId: item.productImageId,
                previewUrl: item.previewUrl,
                url: item.previewUrl,
                sourceKind: item.sourceKind as "LEGACY_LOCAL" | "LEGACY_EXTERNAL",
                altText: item.altText,
              };
            })
          );
        } else {
          setGallery(
            initialImages.map((url, idx) => ({
              id: `gallery-init-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              url,
              previewUrl: url,
            }))
          );
        }
      } catch (error) {
        if (alive) {
          setMessage(error instanceof Error ? error.message : "Failed to load product.");
        }
      } finally {
        if (alive) {
          setInitialLoading(false);
        }
      }
    }

    loadProduct();

    return () => {
      alive = false;
    };
  }, [productId]);

  // Track temporary Object URLs for unmount revocation
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());

  const revokeBlobUrl = useCallback((blobUrl: string) => {
    if (blobUrl && blobUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {}
      activeBlobUrlsRef.current.delete(blobUrl);
    }
  }, []);

  useEffect(() => {
    const urls = activeBlobUrlsRef.current;
    return () => {
      // Clean up any remaining temporary object URLs on unmount
      for (const blobUrl of urls) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {}
      }
      urls.clear();
    };
  }, []);

  const pollMediaStatus = useCallback(
    async (mediaId: string, itemId: string) => {
      const delays = boundedStatusPollDelays(30000);
      for (const delay of delays) {
        await new Promise((r) => setTimeout(r, delay));

        try {
          const res = await fetch(`/api/media/uploads/${mediaId}`, {
            cache: "no-store",
          });
          if (!res.ok) continue;
          const statusData = await res.json();
          const nextStatus = toAdminManagedUploadStatus(statusData);

          setGallery((prev) =>
            prev.map((it) => {
              if (it.id !== itemId || !("kind" in it) || it.kind !== "managed") {
                return it;
              }
              return applyManagedUploadStatus(it, statusData, revokeBlobUrl);
            })
          );

          if (nextStatus !== "Processing") {
            return;
          }
        } catch {
          // Network failure during polling; continue next attempt
        }
      }
    },
    [revokeBlobUrl]
  );

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const target = e.target as HTMLInputElement;
    const { name, value } = target;

    if (target.type === "checkbox") {
      setForm((prev) => ({
        ...prev,
        [name]: target.checked,
      }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function uploadManagedMedia(file: File, idempotencyKey: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", "PRODUCT_IMAGE");

    const res = await fetch("/api/media/uploads", {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: formData,
    });

    const data = await res.json();

    if (!res.ok || !data?.mediaId) {
      throw new Error(data?.message || "Managed media upload failed.");
    }

    return data;
  }

  async function handleRetry(item: AdminGalleryManagedItem) {
    if (!item.file) {
      setMessage("Original file not available for retry. Please choose another file.");
      return;
    }

    setGallery((prev) =>
      prev.map((it) =>
        it.id === item.id ? { ...it, status: "Uploading" as const } : it
      )
    );

    try {
      const data = await uploadManagedMedia(item.file, item.idempotencyKey);
      const status = toAdminManagedUploadStatus(data);

      setGallery((prev) =>
        prev.map((it) => {
          if (it.id !== item.id || !("kind" in it) || it.kind !== "managed") return it;
          return applyManagedUploadStatus(it, data, revokeBlobUrl);
        })
      );

      if (status === "Processing") {
        pollMediaStatus(data.mediaId, item.id);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Retry failed.");
      setGallery((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, status: "Retry" as const } : it
        )
      );
    }
  }

  async function handleAddImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!canAddGalleryItem(gallery)) {
      setMessage("Maximum 4 images allowed in gallery.");
      e.target.value = "";
      return;
    }

    setUploadingImage(true);
    setMessage("");

    const temporaryObjectUrl = URL.createObjectURL(file);
    activeBlobUrlsRef.current.add(temporaryObjectUrl);
    const idempotencyKey = crypto.randomUUID();
    const itemId = `gallery-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    try {
      const data = await uploadManagedMedia(file, idempotencyKey);
      const status = toAdminManagedUploadStatus(data);

      const initialItem: AdminGalleryManagedItem = {
        id: itemId,
        kind: "managed",
        managedMediaId: data.mediaId,
        previewUrl: data.previewUrl || temporaryObjectUrl,
        url: data.previewUrl || temporaryObjectUrl,
        temporaryObjectUrl: data.previewUrl ? undefined : temporaryObjectUrl,
        status,
        failureCode: data.failureCode,
        idempotencyKey,
        file,
        altText: "",
      };

      if (data.previewUrl) {
        revokeBlobUrl(temporaryObjectUrl);
      }

      setGallery((prev) => {
        if (!canAddGalleryItem(prev)) {
          return prev;
        }
        return [...prev, initialItem];
      });

      e.target.value = "";

      if (status === "Processing") {
        pollMediaStatus(data.mediaId, itemId);
      }
    } catch (err) {
      revokeBlobUrl(temporaryObjectUrl);
      setMessage(err instanceof Error ? err.message : "Image upload failed.");
      e.target.value = "";
    } finally {
      setUploadingImage(false);
    }
  }

  function handleMoveUp(index: number) {
    setGallery((prev) => moveGalleryItemUp(prev, index));
  }

  function handleMoveDown(index: number) {
    setGallery((prev) => moveGalleryItemDown(prev, index));
  }

  function handleRemoveImage(index: number) {
    if (!canRemoveGalleryItem(gallery)) {
      setMessage("At least one image is required.");
      return;
    }
    const itemToRemove = gallery[index];
    if (
      itemToRemove &&
      "temporaryObjectUrl" in itemToRemove &&
      itemToRemove.temporaryObjectUrl
    ) {
      revokeBlobUrl(itemToRemove.temporaryObjectUrl);
    }
    setGallery((prev) => {
      if (!canRemoveGalleryItem(prev)) {
        return prev;
      }
      return prev.filter((_, idx) => idx !== index);
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    if (gallery.length === 0) {
      setMessage("At least one product image is required.");
      setLoading(false);
      return;
    }

    if (!canSaveProduct(gallery)) {
      setMessage("All managed media images must finish processing before saving.");
      setLoading(false);
      return;
    }

    try {
      const galleryPayload = serializeGalleryPayload(gallery);

      const payload: Record<string, unknown> = {
        id: productId,
        name: form.name.trim(),
        price: Number(form.price),
        compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
        image: galleryPayload.image,
        images: galleryPayload.images,
        category: form.category.trim(),
        subcategory: form.subcategory.trim(),
        description: form.description.trim(),
        stock: safeStock(form.stock),
        isHotDeal: form.isHotDeal,
        isUpcoming: form.isUpcoming,
        badgeText: form.badgeText.trim() || null,
        badgeTone: form.badgeTone,
      };

      if (galleryPayload.gallery) {
        payload.gallery = galleryPayload.gallery;
      }

      const res = await fetch("/api/products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to update product.");
      }

      router.push("/admin/products");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (initialLoading) {
    return (
      <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
        <div className="mx-auto max-w-6xl space-y-8">
          <AdminNav />
          <div className="rounded-[28px] border border-[#ead9d1] bg-white p-8">
            Loading product...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <AdminNav />

        <div className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-[#2e221d]">
                Edit Product
              </h1>
              <p className="mt-2 text-sm text-neutral-600">
                Update product price, discount, badge, stock, and gallery.
              </p>
            </div>

            <Link
              href="/admin/products"
              className="rounded-full border border-[#ead9d1] px-4 py-2 text-sm hover:bg-[#f8f3ef]"
            >
              Back Products
            </Link>
          </div>

          {message ? (
            <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {message}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="grid gap-5">
            <div>
              <label className="mb-2 block text-sm font-medium">Product Name</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
              />
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium">Current Price</label>
                <input
                  name="price"
                  type="number"
                  min="0"
                  value={form.price}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Previous Price / Regular Price
                </label>
                <input
                  name="compareAtPrice"
                  type="number"
                  min="0"
                  value={form.compareAtPrice}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                  placeholder="Old price"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Stock</label>
                <input
                  name="stock"
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Category</label>
                <input
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                  placeholder="Cosmetics"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Subcategory</label>
                <input
                  name="subcategory"
                  value={form.subcategory}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                  placeholder="lipstick"
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 md:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white p-4 text-sm font-medium text-[#2e221d]">
                <input
                  name="isHotDeal"
                  type="checkbox"
                  checked={form.isHotDeal}
                  onChange={handleChange}
                  className="h-4 w-4"
                />
                Mark as Hot Deal
              </label>

              <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white p-4 text-sm font-medium text-[#2e221d]">
                <input
                  name="isUpcoming"
                  type="checkbox"
                  checked={form.isUpcoming}
                  onChange={handleChange}
                  className="h-4 w-4"
                />
                Mark as Upcoming Product
              </label>
            </div>

            <div className="grid gap-4 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 md:grid-cols-[1fr_220px]">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Custom Image Badge
                </label>
                <input
                  name="badgeText"
                  value={form.badgeText}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  placeholder="20% OFF, New Year Sale, Eid Offer"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Badge Style</label>
                <select
                  name="badgeTone"
                  value={form.badgeTone}
                  onChange={handleChange}
                  className="w-full rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                >
                  <option value="sale">Sale Red</option>
                  <option value="new">New Green</option>
                  <option value="offer">Offer Orange</option>
                  <option value="hot">Hot Brown</option>
                  <option value="festival">Festival Purple</option>
                </select>
              </div>
            </div>

            {/* Product Gallery Section */}
            <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-[#2e221d]">
                    Product Gallery (1 to 4 images)
                  </h2>
                  <p className="text-xs text-neutral-600">
                    The first image is the Primary display image. Use Up/Down to reorder.
                  </p>
                </div>
                <span className="text-xs font-medium text-neutral-500">
                  {gallery.length}/4 images
                </span>
              </div>

              {/* Gallery Items */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {gallery.map((item, index) => {
                  const isPrimary = index === 0;
                  const itemPreview =
                    "previewUrl" in item && item.previewUrl
                      ? item.previewUrl
                      : item.url;
                  const isManaged = "kind" in item && item.kind === "managed";
                  const managedStatus = isManaged
                    ? (item as AdminGalleryManagedItem).status
                    : null;
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col justify-between rounded-2xl border border-[#ead9d1] bg-white p-3 shadow-xs"
                    >
                      <div>
                        <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-xl bg-neutral-100">
                          <img
                            src={itemPreview}
                            alt={`Product gallery image ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                          <div className="absolute top-2 left-2 flex items-center gap-1">
                            <span className="rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
                              #{index + 1}
                            </span>
                            {isPrimary ? (
                              <span className="rounded-md bg-[#2e221d] px-2 py-0.5 text-xs font-semibold text-white">
                                Primary
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Status indicators */}
                        {isManaged && managedStatus !== "Ready" ? (
                          <div className="mb-2 flex items-center justify-between rounded-lg bg-[#fffaf7] p-2 text-xs">
                            <span
                              className={`font-semibold ${
                                managedStatus === "Processing" ||
                                managedStatus === "Uploading"
                                  ? "text-amber-700"
                                  : managedStatus === "Retry"
                                  ? "text-rose-700"
                                  : "text-red-700"
                              }`}
                            >
                              {managedStatus === "Uploading"
                                ? "Uploading..."
                                : managedStatus === "Processing"
                                ? "Processing..."
                                : managedStatus === "Retry"
                                ? "Failed"
                                : "Invalid"}
                            </span>
                            {managedStatus === "Processing" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  pollMediaStatus(
                                    (item as AdminGalleryManagedItem)
                                      .managedMediaId,
                                    item.id
                                  )
                                }
                                className="text-xs text-neutral-600 underline hover:text-black"
                              >
                                Refresh status
                              </button>
                            ) : managedStatus === "Retry" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleRetry(item as AdminGalleryManagedItem)
                                }
                                className="text-xs font-semibold text-rose-700 underline hover:text-rose-900"
                              >
                                Retry
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Alt text field */}
                        <div className="mb-2">
                          <input
                            type="text"
                            aria-label={`Alt text for image ${index + 1}`}
                            value={item.altText ?? ""}
                            placeholder="Alt text"
                            onChange={(e) => {
                              const val = e.target.value;
                              setGallery((prev) =>
                                prev.map((it, idx) =>
                                  idx === index ? { ...it, altText: val } : it
                                )
                              );
                            }}
                            className="w-full rounded-lg border border-[#ead9d1] px-2.5 py-1 text-xs outline-none"
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-1">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            aria-label="Move image up"
                            disabled={index === 0}
                            onClick={() => handleMoveUp(index)}
                            className="rounded-lg border border-[#ead9d1] px-2.5 py-1 text-xs font-medium text-[#2e221d] hover:bg-[#f8f3ef] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ↑ Up
                          </button>
                          <button
                            type="button"
                            aria-label="Move image down"
                            disabled={index === gallery.length - 1}
                            onClick={() => handleMoveDown(index)}
                            className="rounded-lg border border-[#ead9d1] px-2.5 py-1 text-xs font-medium text-[#2e221d] hover:bg-[#f8f3ef] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ↓ Down
                          </button>
                        </div>
                        <button
                          type="button"
                          aria-label="Remove image"
                          disabled={!canRemoveGalleryItem(gallery)}
                          onClick={() => handleRemoveImage(index)}
                          className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add Image Control */}
              <div className="mt-5 border-t border-[#ead9d1] pt-4">
                <label className="mb-2 block text-sm font-medium text-[#2e221d]">
                  Add Image to Gallery
                </label>
                <input
                  type="file"
                  accept="image/*"
                  disabled={!canAddGalleryItem(gallery) || uploadingImage}
                  onChange={handleAddImageFile}
                  className="w-full rounded-2xl border border-[#ead9d1] bg-white px-4 py-2.5 text-sm outline-none file:mr-3 file:rounded-full file:border-0 file:bg-[#2e221d] file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-[#7a5244] disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                  <span>Supported: JPG, PNG, WEBP (up to 5 MB each).</span>
                  {!canAddGalleryItem(gallery) ? (
                    <span className="font-semibold text-amber-700">
                      Maximum 4 images reached
                    </span>
                  ) : null}
                  {uploadingImage ? (
                    <span className="font-semibold text-[#2e221d]">
                      Uploading image...
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Description</label>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={5}
                className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                placeholder="Product description"
              />
            </div>

            <button
              type="submit"
              disabled={loading || uploadingImage || !canSaveProduct(gallery)}
              className="rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white hover:bg-[#7a5244] disabled:opacity-60"
            >
              {loading ? "Updating..." : "Update Product"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
