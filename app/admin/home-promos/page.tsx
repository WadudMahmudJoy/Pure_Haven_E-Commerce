"use client";

import { useEffect, useMemo, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

type PromoKind = "slider" | "wide" | "small";

type HomePromo = {
  id: string;
  kind: PromoKind;
  label: string;
  title: string;
  subtitle: string;
  image: string;
  href: string;
  isActive: boolean;
  sortOrder: number;
};

const emptyForm = {
  id: "",
  kind: "slider" as PromoKind,
  label: "",
  title: "",
  subtitle: "",
  image: "",
  href: "/shop",
  isActive: true,
  sortOrder: "1",
};

export default function AdminHomePromosPage() {
  const [items, setItems] = useState<HomePromo[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const editing = Boolean(form.id);

  async function loadItems() {
    const res = await fetch("/api/home-promos", { cache: "no-store" });
    const data = await res.json();

    if (res.ok && data?.success && Array.isArray(data.items)) {
      setItems(data.items);
    } else {
      setMessage(data?.message || "Failed to load promos.");
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  const grouped = useMemo(() => {
    return {
      slider: items.filter((item) => item.kind === "slider"),
      wide: items.filter((item) => item.kind === "wide"),
      small: items.filter((item) => item.kind === "small"),
    };
  }, [items]);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const target = e.target as HTMLInputElement;
    const { name, value } = target;

    if (target.type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: target.checked }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function uploadImage(file: File) {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: fd,
    });

    const data = await res.json();

    if (!res.ok || !data?.imagePath) {
      throw new Error(data?.message || "Image upload failed.");
    }

    return data.imagePath as string;
  }

  function editItem(item: HomePromo) {
    setForm({
      id: item.id,
      kind: item.kind,
      label: item.label,
      title: item.title,
      subtitle: item.subtitle,
      image: item.image,
      href: item.href,
      isActive: item.isActive,
      sortOrder: String(item.sortOrder),
    });

    setImageFile(null);
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(emptyForm);
    setImageFile(null);
    setMessage("");
  }

  async function saveItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const uploadedImage = imageFile ? await uploadImage(imageFile) : "";
      const imagePath = uploadedImage || form.image.trim();

      const payload = {
        id: form.id,
        kind: form.kind,
        label: form.label.trim(),
        title: form.title.trim(),
        subtitle: form.subtitle.trim(),
        image: imagePath,
        href: form.href.trim(),
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder || 0),
      };

      const res = await fetch("/api/home-promos", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to save promo.");
      }

      await loadItems();
      resetForm();
      setMessage(editing ? "Promo updated successfully." : "Promo added successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(item: HomePromo) {
    if (!confirm(`Delete "${item.title}"?`)) return;

    const res = await fetch(`/api/home-promos?id=${item.id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await loadItems();
      if (form.id === item.id) resetForm();
    }
  }

  function quickFill(type: "slider" | "top-picks" | "new-arrivals" | "hot-deals") {
    if (type === "slider") {
      setForm((prev) => ({
        ...prev,
        kind: "slider",
        label: "New Arrivals",
        title: "Fresh Beauty Collection",
        subtitle: "Explore cosmetics, skincare, haircare, and daily essentials.",
        href: "/shop",
        sortOrder: "1",
      }));
    }

    if (type === "top-picks") {
      setForm((prev) => ({
        ...prev,
        kind: "wide",
        label: "Explore Now",
        title: "Top Picks",
        subtitle: "",
        href: "/shop",
        sortOrder: "1",
      }));
    }

    if (type === "new-arrivals") {
      setForm((prev) => ({
        ...prev,
        kind: "small",
        label: "New Arrivals",
        title: "New Arrivals",
        subtitle: "",
        href: "/shop",
        sortOrder: "1",
      }));
    }

    if (type === "hot-deals") {
      setForm((prev) => ({
        ...prev,
        kind: "small",
        label: "Hot Deals",
        title: "Hot Deals",
        subtitle: "",
        href: "/shop",
        sortOrder: "2",
      }));
    }
  }

  function PromoList({ title, items }: { title: string; items: HomePromo[] }) {
    return (
      <section className="rounded-[28px] border border-[#ead9d1] bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-[#2e221d]">{title}</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-[#ead9d1] p-4">
              <img
                src={item.image}
                alt={item.title}
                className="h-36 w-full rounded-2xl object-cover"
              />

              <p className="mt-3 text-xs uppercase tracking-[0.22em] text-[#7a5244]">
                {item.label || item.kind}
              </p>

              <h3 className="mt-1 font-semibold text-[#2e221d]">{item.title}</h3>

              <p className="mt-1 text-xs text-neutral-500">
                {item.isActive ? "Active" : "Inactive"} Â· Order {item.sortOrder}
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => editItem(item)}
                  className="rounded-full bg-[#2e221d] px-4 py-2 text-sm font-semibold text-white"
                >
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => deleteItem(item)}
                  className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          {items.length === 0 ? (
            <p className="text-sm text-neutral-500">No items found.</p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <AdminNav />

        <section className="rounded-[28px] border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <h1 className="text-3xl font-semibold text-[#2e221d]">
            Homepage Slider & Promo Manager
          </h1>

          <p className="mt-2 text-sm text-neutral-600">
            Add, edit, delete, and hide/show home slider, Top Picks, New Arrivals, and Hot Deals.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => quickFill("slider")} className="rounded-full border border-[#ead9d1] px-4 py-2 text-sm font-semibold">
              Home Slider
            </button>
            <button type="button" onClick={() => quickFill("top-picks")} className="rounded-full border border-[#ead9d1] px-4 py-2 text-sm font-semibold">
              Top Picks
            </button>
            <button type="button" onClick={() => quickFill("new-arrivals")} className="rounded-full border border-[#ead9d1] px-4 py-2 text-sm font-semibold">
              New Arrivals
            </button>
            <button type="button" onClick={() => quickFill("hot-deals")} className="rounded-full border border-[#ead9d1] px-4 py-2 text-sm font-semibold">
              Hot Deals
            </button>
          </div>

          {message ? (
            <div className="mt-5 rounded-2xl border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]">
              {message}
            </div>
          ) : null}

          <form onSubmit={saveItem} className="mt-6 grid gap-5">
            <div className="grid gap-4 md:grid-cols-3">
              <select
                name="kind"
                value={form.kind}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
              >
                <option value="slider">Home Sliding Banner</option>
                <option value="wide">Top Picks Wide Banner</option>
                <option value="small">New Arrivals / Hot Deals Small Card</option>
              </select>

              <input
                name="label"
                value={form.label}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="Label"
              />

              <input
                name="sortOrder"
                type="number"
                value={form.sortOrder}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="Order"
              />
            </div>

            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3"
              placeholder="Title"
            />

            <textarea
              name="subtitle"
              value={form.subtitle}
              onChange={handleChange}
              rows={3}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3"
              placeholder="Subtitle optional"
            />

            <div className="grid gap-4 md:grid-cols-2">
              <input
                name="image"
                value={form.image}
                onChange={handleChange}
                                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="/images/categories/cosmetics.jpg"
              />

              <input
                name="href"
                value={form.href}
                onChange={handleChange}
                className="rounded-2xl border border-[#ead9d1] px-4 py-3"
                placeholder="/shop"
              />
            </div>

            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              className="rounded-2xl border border-[#ead9d1] px-4 py-3"
            />

            {form.image ? (
              <img
                src={form.image}
                alt="Preview"
                className="h-40 w-64 rounded-2xl object-cover"
              />
            ) : null}

            <label className="flex w-fit items-center gap-3 rounded-2xl bg-[#fffaf7] px-4 py-3 text-sm font-semibold">
              <input
                name="isActive"
                type="checkbox"
                checked={form.isActive}
                onChange={handleChange}
              />
              Active
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving..." : editing ? "Update Promo" : "Add Promo"}
              </button>

              {editing ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-full border border-[#ead9d1] px-6 py-3 text-sm font-semibold"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <PromoList title="Home Sliding Banners" items={grouped.slider} />
        <PromoList title="Top Picks Wide Banner" items={grouped.wide} />
        <PromoList title="New Arrivals / Hot Deals Small Cards" items={grouped.small} />
      </div>
    </main>
  );
}



