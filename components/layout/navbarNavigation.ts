import type { PublicCategory } from "@/lib/defaultCategories";

export const DESKTOP_NAV_PRIMARY_BUDGET = 4;

export function sortAndSplitNavCategories(
  categories: PublicCategory[],
  budget: number = DESKTOP_NAV_PRIMARY_BUDGET
): {
  primaryCategories: PublicCategory[];
  overflowCategories: PublicCategory[];
} {
  if (typeof budget !== "number" || budget < 0 || !Number.isInteger(budget)) {
    throw new Error("Invalid navigation category budget.");
  }

  // 1. Exclude categories where isActive === false
  // 2. Preserve categories where isActive is true or undefined
  const active = categories.filter((cat) => cat.isActive !== false);

  // 3. Deterministic sorting: sortOrder ASC, then id ASC (immutable)
  const sorted = [...active].sort((a, b) => {
    const sortA = a.sortOrder ?? 0;
    const sortB = b.sortOrder ?? 0;
    if (sortA !== sortB) {
      return sortA - sortB;
    }

    if (typeof a.id === "number" && typeof b.id === "number") {
      return a.id - b.id;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  // 4. Split sorted active list by budget
  return {
    primaryCategories: sorted.slice(0, budget),
    overflowCategories: sorted.slice(budget),
  };
}
