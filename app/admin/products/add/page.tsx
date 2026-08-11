"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "@/components/admin/AdminNav";

type Subcategory = { id: number; name: string; slug: string };
type Category = { id: number; name: string; slug: string; subcategories: Subcategory[] };

type VariantInput = {
  label: string;
  price: string;
  stock: string;
  image: string;
  imageFile?: File | null;
};

function safeStock(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export default function AddProductPage() {
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [variants, setVariants] = useState<VariantInput[]>([
    { label: "", price: "", stock: "", image: "", imageFile: null },
  ]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    name: "",
    compareAtPrice: "",
    categoryId: "",
    subcategoryId: "",
    description: "",
    isHotDeal: false,
    isUpcoming: false,
    badgeText: "",
    badgeTone: "sale",
  });

  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetch("/api/categories", { cache: "no-store" });
        const data = await res.json();
        const list: Category[] =
          res.ok && data?.success && Array.isArray(data.categories)
            ? data.categories
            : [];

        setCategories(list);

        const first = list[0];
        const firstSub = first?.subcategories?.[0];

        setForm((prev) => ({
          ...prev,
          categoryId: first ? String(first.id) : "",
          subcategoryId: firstSub ? String(firstSub.id) : "",
        }));
      } catch {
        setCategories([]);
      }
    }

    loadCategories();
  }, []);

  const selectedCategory = useMemo(
    () => categories.find((c) => String(c.id) === form.categoryId),
    [categories, form.categoryId]
  );

  const subcategories = selectedCategory?.subcategories || [];

  const selectedSubcategory = useMemo(
    () => subcategories.find((s) => String(s.id) === form.subcategoryId),
    [subcategories, form.subcategoryId]
  );

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const target = e.target as HTMLInputElement;
    const { name, value } = target;

    if (target.type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: target.checked }));
      return;
    }

    if (name === "categoryId") {
      const nextCategory = categories.find((c) => String(c.id) === value);
      const firstSub = nextCategory?.subcategories?.[0];

      setForm((prev) => ({
        ...prev,
        categoryId: value,
        subcategoryId: firstSub ? String(firstSub.id) : "",
      }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleMainImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    setPreviewUrl(file ? URL.createObjectURL(file) : "");
  }

  function addVariant() {
    setVariants((prev) => [
      ...prev,
      { label: "", price: "", stock: "", image: "", imageFile: null },
    ]);
  }

  function updateVariant(index: number, field: keyof VariantInput, value: string) {
    setVariants((prev) =>
      prev.map((variant, i) =>
        i === index ? { ...variant, [field]: value } : variant
      )
    );
  }

  function updateVariantFile(index: number, file: File | null) {
    setVariants((prev) =>
      prev.map((variant, i) =>
        i === index ? { ...variant, imageFile: file } : variant
      )
    );
  }

  function removeVariant(index: number) {
    if (index === 0) {
      setMessage("Primary size remove kora jabe na. Product-er at least one size thakte hobe.");
      return;
    }

    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
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
      if (!selectedCategory) throw new Error("Please select a category.");
      if (!imageFile) throw new Error("Please choose main product image.");

      const validRows = variants.filter((v) => v.label.trim() && Number(v.price) > 0);

      if (validRows.length === 0) {
        throw new Error("Please add primary size, price, and stock.");
      }

      const mainImage = await uploadImage(imageFile);

      const cleanedVariants = await Promise.all(
        validRows.map(async (v) => {
          const variantImage = v.imageFile ? await uploadImage(v.imageFile) : v.image.trim();

          return {
            label: v.label.trim(),
            price: Number(v.price),
            stock: safeStock(v.stock),
            image: variantImage || null,
          };
        })
      );

      const primaryVariant = cleanedVariants[0];
      const totalStock = cleanedVariants.reduce((sum, v) => sum + v.stock, 0);

      const payload = {
        name: form.name.trim(),
        price: primaryVariant.price,
        compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
        image: mainImage,
        category: selectedCategory.name,
        subcategory: selectedSubcategory?.slug || "",
        description: form.description.trim(),
        stock: totalStock,
        isHotDeal: form.isHotDeal,
        isUpcoming: form.isUpcoming,
        badgeText: form.badgeText.trim() || null,
        badgeTone: form.badgeTone,
        variants: cleanedVariants,
      };

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to create product.");
      }

      router.push("/admin/products");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-[#2e221d]">Add Product</h1>
              <p className="mt-2 text-sm text-neutral-600">
                Product-er primary size first row-e dao. Extra size thakle Add Another Size use koro.
              </p>
            </div>

            <Link
              href="/admin/products"
              className="w-fit rounded-full border border-[#ead9d1] px-4 py-2 text-sm hover:bg-[#f8f3ef]"
            >
              Back Products
            </Link>
          </div>

          {message ? (
            <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {message}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="grid gap-6">
            <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-5">
              <h2 className="mb-4 text-lg font-semibold text-[#2e221d]">Product Information</h2>

              <div className="grid gap-4">
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  className="w-full rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  placeholder="Product name"
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <select
                    name="categoryId"
                    value={form.categoryId}
                    onChange={handleChange}
                    required
                    className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  >
                    {categories.length === 0 ? (
                      <option value="">No category found</option>
                    ) : (
                      categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))
                    )}
                  </select>

                  <select
                    name="subcategoryId"
                    value={form.subcategoryId}
                    onChange={handleChange}
                    className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  >
                    {subcategories.length === 0 ? (
                      <option value="">No subcategory</option>
                    ) : (
                      subcategories.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#2e221d]">
                    Main Product Image
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleMainImageChange}
                    required
                    className="w-full rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  />
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="mt-4 h-40 w-40 rounded-2xl object-cover"
                    />
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-5">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[#2e221d]">
                    Size, Price & Stock
                  </h2>
                  <p className="mt-1 text-xs text-neutral-500">
                    First row = primary size. Example: 400 ml. Extra rows = 800 ml, 1 kg, 250 gm.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={addVariant}
                  className="w-fit rounded-full bg-[#2e221d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7a5244]"
                >
                  Add Another Size
                </button>
              </div>

              <div className="grid gap-3">
                {variants.map((variant, index) => (
                  <div
                    key={index}
                    className="grid gap-3 rounded-2xl bg-white p-4 md:grid-cols-[1fr_150px_130px_1fr_auto]"
                  >
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-neutral-500">
                        {index === 0 ? "Primary Size" : "Another Size"}
                      </label>
                      <input
                        value={variant.label}
                        onChange={(e) => updateVariant(index, "label", e.target.value)}
                        className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                        placeholder={index === 0 ? "400 ml" : "800 ml"}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-neutral-500">
                        Price
                      </label>
                      <input
                        value={variant.price}
                        onChange={(e) => updateVariant(index, "price", e.target.value)}
                        type="number"
                        min="0"
                        className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                        placeholder="৳"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-neutral-500">
                        Stock
                      </label>
                      <input
                        value={variant.stock}
                        onChange={(e) => updateVariant(index, "stock", e.target.value)}
                        type="number"
                        min="0"
                        className="w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-neutral-500">
                        Variant Image Optional
                      </label>
                      <input
                        value={variant.image}
                        onChange={(e) => updateVariant(index, "image", e.target.value)}
                        className="mb-2 w-full rounded-2xl border border-[#ead9d1] px-4 py-3 outline-none"
                        placeholder="Leave empty for main image"
                      />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => updateVariantFile(index, e.target.files?.[0] || null)}
                        className="w-full text-xs"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeVariant(index)}
                        className={`rounded-full border px-4 py-3 text-sm font-semibold ${
                          index === 0
                            ? "cursor-not-allowed border-[#ead9d1] text-neutral-400"
                            : "border-red-200 text-red-600 hover:bg-red-50"
                        }`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-5">
              <h2 className="mb-4 text-lg font-semibold text-[#2e221d]">Offer & Details</h2>

              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                  <input
                    name="badgeText"
                    value={form.badgeText}
                    onChange={handleChange}
                    className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                    placeholder="Badge: 20% OFF, New Year Sale"
                  />

                  <select
                    name="badgeTone"
                    value={form.badgeTone}
                    onChange={handleChange}
                    className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  >
                    <option value="sale">Sale Red</option>
                    <option value="new">New Green</option>
                    <option value="offer">Offer Orange</option>
                    <option value="hot">Hot Brown</option>
                    <option value="festival">Festival Purple</option>
                  </select>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
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

                <input
                  name="compareAtPrice"
                  type="number"
                  min="0"
                  value={form.compareAtPrice}
                  onChange={handleChange}
                  className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  placeholder="Previous price / regular price optional"
                />

                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  rows={5}
                  className="w-full rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                  placeholder="Product description"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-[#2e221d] px-6 py-4 text-sm font-semibold text-white hover:bg-[#7a5244] disabled:opacity-60"
            >
              {loading ? "Saving..." : "Add Product"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
