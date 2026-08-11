"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  variants?: {
    id?: number;
    label: string;
    price: number;
    stock: number;
    image?: string | null;
  }[];
};

const emptyForm = {
  name: "",
  compareAtPrice: "",
  image: "",
  categoryId: "",
  categoryName: "",
  subcategoryId: "",
  subcategorySlug: "",
  description: "",
  isHotDeal: false,
  isUpcoming: false,
  badgeText: "",
  badgeTone: "sale",
};

function safeStock(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function slugify(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [variants, setVariants] = useState<VariantInput[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");

  async function loadProducts() {
    const res = await fetch("/api/products?view=admin", { cache: "no-store" });
    const data = await res.json();

    if (res.ok && data?.success && Array.isArray(data.products)) {
      setProducts(data.products);
    }
  }

  async function loadCategories() {
    const res = await fetch("/api/categories", { cache: "no-store" });
    const data = await res.json();

    if (res.ok && data?.success && Array.isArray(data.categories)) {
      setCategories(data.categories);
    }
  }

  useEffect(() => {
    loadProducts();
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

  const filteredProducts = useMemo(() => {
    if (filter === "hot") return products.filter((p) => p.isHotDeal);
    if (filter === "upcoming") return products.filter((p) => p.isUpcoming);
    if (filter === "discount") {
      return products.filter(
        (p) => typeof p.compareAtPrice === "number" && p.compareAtPrice > p.price
      );
    }
    if (filter === "badge") return products.filter((p) => p.badgeText);
    return products;
  }, [products, filter]);

  function startEdit(product: Product) {
    const matchedCategory =
      categories.find(
        (c) =>
          c.name.toLowerCase() === product.category.toLowerCase() ||
          c.slug === slugify(product.category)
      ) || null;

    const matchedSubcategory =
      matchedCategory?.subcategories.find(
        (s) =>
          s.slug === slugify(product.subcategory) ||
          s.name.toLowerCase() === (product.subcategory || "").toLowerCase()
      ) || null;

    setEditingId(product.id);
    setMessage("");
    setImageFile(null);
    setPreviewUrl(product.image || "");

    setForm({
      name: product.name || "",
      compareAtPrice:
        product.compareAtPrice === null || product.compareAtPrice === undefined
          ? ""
          : String(product.compareAtPrice),
      image: product.image || "",
      categoryId: matchedCategory ? String(matchedCategory.id) : "",
      categoryName: product.category || "",
      subcategoryId: matchedSubcategory ? String(matchedSubcategory.id) : "",
      subcategorySlug: product.subcategory || "",
      description: product.description || "",
      isHotDeal: Boolean(product.isHotDeal),
      isUpcoming: Boolean(product.isUpcoming),
      badgeText: product.badgeText || "",
      badgeTone: product.badgeTone || "sale",
    });

    const existingVariants =
      Array.isArray(product.variants) && product.variants.length > 0
        ? product.variants.map((v) => ({
            label: v.label || "",
            price: String(v.price ?? ""),
            stock: String(v.stock ?? 0),
            image: v.image || "",
            imageFile: null,
          }))
        : [
            {
              label: "",
              price: String(product.price ?? ""),
              stock: String(product.stock ?? 0),
              image: "",
              imageFile: null,
            },
          ];

    setVariants(existingVariants);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setVariants([]);
    setImageFile(null);
    setPreviewUrl("");
    setMessage("");
  }

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
      const category = categories.find((c) => String(c.id) === value);
      const firstSub = category?.subcategories?.[0];

      setForm((prev) => ({
        ...prev,
        categoryId: value,
        categoryName: category?.name || prev.categoryName,
        subcategoryId: firstSub ? String(firstSub.id) : "",
        subcategorySlug: firstSub?.slug || "",
      }));
      return;
    }

    if (name === "subcategoryId") {
      const sub = subcategories.find((s) => String(s.id) === value);

      setForm((prev) => ({
        ...prev,
        subcategoryId: value,
        subcategorySlug: sub?.slug || "",
      }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleMainImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setImageFile(file);
    setPreviewUrl(file ? URL.createObjectURL(file) : form.image);
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

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!editingId) {
      setMessage("Please click Edit first.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const validRows = variants.filter((v) => v.label.trim() && Number(v.price) > 0);

      if (validRows.length === 0) {
        throw new Error("Please add primary size, price, and stock.");
      }

      const imagePath = imageFile ? await uploadImage(imageFile) : form.image;

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
        id: editingId,
        name: form.name.trim(),
        price: primaryVariant.price,
        compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
        image: imagePath,
        category: selectedCategory?.name || form.categoryName.trim(),
        subcategory: selectedSubcategory?.slug || form.subcategorySlug.trim(),
        description: form.description.trim(),
        stock: totalStock,
        isHotDeal: form.isHotDeal,
        isUpcoming: form.isUpcoming,
        badgeText: form.badgeText.trim() || null,
        badgeTone: form.badgeTone,
        variants: cleanedVariants,
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

      await loadProducts();
      setMessage("Product updated successfully.");
      alert("Product updated successfully.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Update failed.";
      setMessage(msg);
      alert(msg);
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(product: Product) {
    if (!confirm(`Delete ${product.name}?`)) return;

    await fetch(`/api/products?id=${product.id}`, {
      method: "DELETE",
    });

    await loadProducts();

    if (editingId === product.id) resetEdit();
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <AdminNav />

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-[#2e221d]">Admin Products</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Product edit korle first size primary hisebe kaj korbe.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
            >
              <option value="all">All products</option>
              <option value="hot">Hot deals</option>
              <option value="upcoming">Upcoming</option>
              <option value="discount">Discounted</option>
              <option value="badge">Custom badge</option>
            </select>

            <Link
  href="/admin/products/add"
  className="inline-flex min-w-[150px] items-center justify-center rounded-2xl border border-[#ead9d1] bg-white px-5 py-3 text-sm font-semibold text-[#2e221d] shadow-sm transition hover:bg-[#fff7f2] hover:text-[#7a5244]"
>
  + Add Product
</Link>
          </div>
        </div>

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-semibold text-[#2e221d]">
            {editingId ? `Editing Product #${editingId}` : "Select a product to edit"}
          </h2>

          {message ? (
            <div className="mt-4 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]">
              {message}
            </div>
          ) : null}

          {editingId ? (
            <form onSubmit={handleUpdate} className="mt-6 grid gap-6">
              <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-5">
                <h3 className="mb-4 text-lg font-semibold text-[#2e221d]">
                  Product Information
                </h3>

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
                      className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                    >
                      <option value="">{form.categoryName || "Select category"}</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>

                    <select
                      name="subcategoryId"
                      value={form.subcategoryId}
                      onChange={handleChange}
                      className="rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                    >
                      <option value="">{form.subcategorySlug || "No subcategory"}</option>
                      {subcategories.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-[#2e221d]">
                      Main Product Image
                    </label>

                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="mb-3 h-36 w-36 rounded-2xl object-cover"
                      />
                    ) : null}

                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleMainImage}
                      className="w-full rounded-2xl border border-[#ead9d1] bg-white px-4 py-3 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-5">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-[#2e221d]">
                      Size, Price & Stock
                    </h3>
                    <p className="mt-1 text-xs text-neutral-500">
                      First row = Primary Size. Product card price oi row theke nibe.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={addVariant}
                    className="w-fit rounded-full bg-[#2e221d] text-white px-4 py-2 text-sm font-semibold text-white hover:bg-[#7a5244]"
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
                <h3 className="mb-4 text-lg font-semibold text-[#2e221d]">
                  Offer & Details
                </h3>

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

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-[#2e221d] text-white px-6 py-4 text-sm font-semibold text-white hover:bg-[#7a5244] disabled:opacity-60"
                >
                  {saving ? "Updating..." : "Update Product"}
                </button>

                <button
                  type="button"
                  onClick={resetEdit}
                  className="rounded-full border border-[#ead9d1] px-6 py-4 text-sm font-semibold hover:bg-[#f8f3ef]"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">
              Product card theke Edit click koro.
            </p>
          )}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              className="rounded-[24px] border border-[#ead9d1] bg-white p-4 shadow-sm"
            >
              <div className="grid grid-cols-[110px_1fr] gap-4">
                <img
                  src={product.image}
                  alt={product.name}
                  className="h-28 w-28 rounded-2xl object-cover"
                />

                <div>
                  <h3 className="font-semibold text-[#2e221d]">{product.name}</h3>
                  <p className="mt-1 text-sm text-neutral-600">
                    {product.category}
                    {product.subcategory ? ` / ${product.subcategory}` : ""}
                  </p>

                  <p className="mt-2 font-semibold">৳{product.price}</p>

                  {product.variants?.length ? (
                    <p className="mt-2 text-xs text-[#7a5244]">
                      {product.variants.length} size option
                      {product.variants.length > 1 ? "s" : ""}:{" "}
                      {product.variants
                        .map((v, i) => `${i === 0 ? "Primary " : ""}${v.label}${v.image ? " ðŸ–¼ï¸" : ""}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(product)}
                  className="rounded-full bg-[#2e221d] text-white px-4 py-2 text-sm font-semibold text-white"
                >
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => deleteProduct(product)}
                  className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

