"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminNav from "@/components/admin/AdminNav";

type Product = {
  id: number;
  name: string;
  price: number;
  compareAtPrice?: number | null;
  image: string;
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
    image: "",
    category: "",
    subcategory: "",
    description: "",
    stock: "",
    isHotDeal: false,
    isUpcoming: false,
    badgeText: "",
    badgeTone: "sale",
  });

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    async function loadProduct() {
      try {
        const res = await fetch(`/api/products?id=${productId}`, {
          cache: "no-store",
        });

        const data = await res.json();

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
          image: product.image || "",
          category: product.category || "",
          subcategory: product.subcategory || "",
          description: product.description || "",
          stock: String(product.stock ?? 0),
          isHotDeal: Boolean(product.isHotDeal),
          isUpcoming: Boolean(product.isUpcoming),
          badgeText: product.badgeText || "",
          badgeTone: product.badgeTone || "sale",
        });

        setPreviewUrl(product.image || "");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to load product.");
      } finally {
        setInitialLoading(false);
      }
    }

    if (Number.isInteger(productId) && productId > 0) {
      loadProduct();
    } else {
      setMessage("Invalid product id.");
      setInitialLoading(false);
    }
  }, [productId]);

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

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setImageFile(file);

    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(form.image);
    }
  }

  async function uploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok || !data?.imagePath) {
      throw new Error(data?.message || "Image upload failed.");
    }

    return data.imagePath as string;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const imagePath = imageFile ? await uploadImage(imageFile) : form.image;

      const payload = {
        id: productId,
        name: form.name.trim(),
        price: Number(form.price),
        compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
        image: imagePath,
        category: form.category.trim(),
        subcategory: form.subcategory.trim(),
        description: form.description.trim(),
        stock: safeStock(form.stock),
        isHotDeal: form.isHotDeal,
        isUpcoming: form.isUpcoming,
        badgeText: form.badgeText.trim() || null,
        badgeTone: form.badgeTone,
      };

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
                Update product price, discount, badge, stock, and image.
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

            <div>
              <label className="mb-2 block text-sm font-medium">Product Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
              />

              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="mt-4 h-44 w-44 rounded-2xl object-cover"
                />
              ) : null}
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
              disabled={loading}
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