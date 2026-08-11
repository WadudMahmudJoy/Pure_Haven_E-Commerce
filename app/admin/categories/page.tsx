"use client";

import { useEffect, useState } from "react";
import AdminNav from "@/components/admin/AdminNav";

type Subcategory = {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
};

type Category = {
  id: number;
  name: string;
  slug: string;
  image?: string | null;
  isActive: boolean;
  sortOrder: number;
  subcategories: Subcategory[];
};

function emptyToZero(value: string) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.floor(numberValue) : 0;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryImage, setCategoryImage] = useState("");
  const [subcategoryInputs, setSubcategoryInputs] = useState<Record<number, string>>({});

  async function loadCategories() {
    try {
      setMessage("");
      const res = await fetch("/api/categories?includeInactive=true", {
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to load categories.");
      }

      setCategories(Array.isArray(data.categories) ? data.categories : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load categories.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
  }, []);

  async function createCategory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "category",
          name: categoryName,
          image: categoryImage,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to create category.");
      }

      setCategoryName("");
      setCategoryImage("");
      await loadCategories();
      setMessage("Category created successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create category.");
    }
  }

  async function createSubcategory(categoryId: number) {
    const name = (subcategoryInputs[categoryId] || "").trim();

    if (!name) {
      setMessage("Subcategory name is required.");
      return;
    }

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "subcategory",
          categoryId,
          name,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to create subcategory.");
      }

      setSubcategoryInputs((prev) => ({
        ...prev,
        [categoryId]: "",
      }));
      await loadCategories();
      setMessage("Subcategory created successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create subcategory.");
    }
  }

  async function updateCategory(category: Category) {
    const name = window.prompt("Category name", category.name);
    if (!name) return;

    const sortOrder = window.prompt("Sort order", String(category.sortOrder));

    try {
      const res = await fetch("/api/categories", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "category",
          id: category.id,
          name,
          image: category.image || "",
          sortOrder: emptyToZero(sortOrder || "0"),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to update category.");
      }

      await loadCategories();
      setMessage("Category updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update category.");
    }
  }

  async function updateSubcategory(subcategory: Subcategory) {
    const name = window.prompt("Subcategory name", subcategory.name);
    if (!name) return;

    const sortOrder = window.prompt("Sort order", String(subcategory.sortOrder));

    try {
      const res = await fetch("/api/categories", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "subcategory",
          id: subcategory.id,
          name,
          sortOrder: emptyToZero(sortOrder || "0"),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to update subcategory.");
      }

      await loadCategories();
      setMessage("Subcategory updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update subcategory.");
    }
  }

  async function toggleCategory(category: Category) {
    try {
      const res = await fetch("/api/categories", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "category",
          id: category.id,
          isActive: !category.isActive,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to update status.");
      }

      await loadCategories();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update status.");
    }
  }

  async function toggleSubcategory(subcategory: Subcategory) {
    try {
      const res = await fetch("/api/categories", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "subcategory",
          id: subcategory.id,
          isActive: !subcategory.isActive,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to update status.");
      }

      await loadCategories();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update status.");
    }
  }

  async function deleteCategory(category: Category) {
    if (!confirm(`Delete ${category.name}? All its subcategories will also be deleted.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/categories?type=category&id=${category.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to delete category.");
      }

      await loadCategories();
      setMessage("Category deleted successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete category.");
    }
  }

  async function deleteSubcategory(subcategory: Subcategory) {
    if (!confirm(`Delete ${subcategory.name}?`)) return;

    try {
      const res = await fetch(`/api/categories?type=subcategory&id=${subcategory.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to delete subcategory.");
      }

      await loadCategories();
      setMessage("Subcategory deleted successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete subcategory.");
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <AdminNav />

        <section className="rounded-none border border-[#ead9d1] bg-white p-6 shadow-sm md:p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-semibold text-[#2e221d]">
              Categories & Subcategories
            </h1>
            <p className="mt-2 text-sm text-neutral-600">
              Manage product categories from admin panel. These will be connected to shop, navbar, and product forms in the next step.
            </p>
          </div>

          <form onSubmit={createCategory} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="Category name, for example Baby Products"
              className="rounded-none border border-[#ead9d1] px-4 py-3 outline-none"
              required
            />
            <input
              value={categoryImage}
              onChange={(e) => setCategoryImage(e.target.value)}
              placeholder="Optional category image URL"
              className="rounded-none border border-[#ead9d1] px-4 py-3 outline-none"
            />
            <button
              type="submit"
              className="rounded-none bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white hover:bg-[#7a5244]"
            >
              Add Category
            </button>
          </form>

          {message ? (
            <div className="mt-5 rounded-none border border-[#ead9d1] bg-[#fffaf7] p-4 text-sm text-[#2e221d]">
              {message}
            </div>
          ) : null}
        </section>

        {loading ? (
          <div className="rounded-none border border-[#ead9d1] bg-white p-8 text-sm text-neutral-600">
            Loading categories...
          </div>
        ) : (
          <section className="grid gap-5">
            {categories.map((category) => (
              <div
                key={category.id}
                className="rounded-none border border-[#ead9d1] bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold text-[#2e221d]">
                        {category.name}
                      </h2>
                      <span className="rounded-none bg-[#f8f3ef] px-3 py-1 text-xs text-[#7a5244]">
                        {category.slug}
                      </span>
                      <span
                        className={`rounded-none px-3 py-1 text-xs ${
                          category.isActive
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {category.isActive ? "Active" : "Hidden"}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-neutral-600">
                      Sort order: {category.sortOrder}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => updateCategory(category)}
                      className="rounded-none border border-[#ead9d1] px-4 py-2 text-sm hover:bg-[#f8f3ef]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className="rounded-none border border-[#ead9d1] px-4 py-2 text-sm hover:bg-[#f8f3ef]"
                    >
                      {category.isActive ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCategory(category)}
                      className="rounded-none border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={subcategoryInputs[category.id] || ""}
                    onChange={(e) =>
                      setSubcategoryInputs((prev) => ({
                        ...prev,
                        [category.id]: e.target.value,
                      }))
                    }
                    placeholder={`Add subcategory under ${category.name}`}
                    className="rounded-none border border-[#ead9d1] px-4 py-3 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => createSubcategory(category.id)}
                    className="rounded-none bg-[#2e221d] px-6 py-3 text-sm font-semibold text-white hover:bg-[#7a5244]"
                  >
                    Add Subcategory
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {category.subcategories.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      No subcategories yet.
                    </p>
                  ) : (
                    category.subcategories.map((subcategory) => (
                      <div
                        key={subcategory.id}
                        className={`flex items-center gap-2 rounded-none border px-3 py-2 text-sm ${
                          subcategory.isActive
                            ? "border-[#ead9d1] bg-[#fffaf7] text-[#2e221d]"
                            : "border-red-100 bg-red-50 text-red-700"
                        }`}
                      >
                        <span>{subcategory.name}</span>
                        <button
                          type="button"
                          onClick={() => updateSubcategory(subcategory)}
                          className="font-semibold text-[#7a5244]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSubcategory(subcategory)}
                          className="font-semibold text-[#7a5244]"
                        >
                          {subcategory.isActive ? "Hide" : "Show"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSubcategory(subcategory)}
                          className="font-semibold text-red-600"
                        >
                          X
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}