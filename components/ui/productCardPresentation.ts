export type CardBadgeResult =
  | {
      label: string;
      className: string;
    }
  | null;

export const badgeStyles: Record<string, string> = {
  sale: "bg-red-600 text-white",
  new: "bg-green-600 text-white",
  offer: "bg-[#f58b19] text-white",
  hot: "bg-[#2e221d] text-white",
  festival: "bg-purple-600 text-white",
};

/**
 * Resolves the unboxed category/subcategory eyebrow text.
 * Precedence:
 *   1. trimmed non-empty subcategoryName
 *   2. else trimmed non-empty categoryName
 *   3. else null
 */
export function resolveEyebrow(
  categoryName?: string | null,
  subcategoryName?: string | null
): string | null {
  if (typeof subcategoryName === "string") {
    const trimmedSub = subcategoryName.trim();
    if (trimmedSub.length > 0) {
      return trimmedSub;
    }
  }

  if (typeof categoryName === "string") {
    const trimmedCat = categoryName.trim();
    if (trimmedCat.length > 0) {
      return trimmedCat;
    }
  }

  return null;
}

/**
 * Resolves single badge overlay for ProductCard.
 * Priority:
 *   1. OUT OF STOCK (strictly wins over promotional and low-stock)
 *   2. PROMOTIONAL (wins over low-stock)
 *   3. LOW STOCK (0 < stock <= 5 and no promo)
 *   4. NONE (in stock, normal)
 */
export function resolveCardBadge(params: {
  stock?: number;
  isOutOfStock: boolean;
  isLowStock: boolean;
  isHotDeal?: boolean;
  isUpcoming?: boolean;
  badgeText?: string | null;
  badgeTone?: string | null;
}): CardBadgeResult {
  const { isOutOfStock, isLowStock, isHotDeal, isUpcoming, badgeText, badgeTone } = params;

  // 1. OUT OF STOCK always wins
  if (isOutOfStock) {
    return {
      label: "Out of Stock",
      className: "border border-red-200 bg-red-50/95 text-red-600",
    };
  }

  // 2. PROMOTIONAL wins over low stock
  if (badgeText && badgeText.trim()) {
    const tone = badgeTone || "sale";
    return {
      label: badgeText.trim(),
      className: badgeStyles[tone] || badgeStyles.sale,
    };
  }
  if (isHotDeal) {
    return {
      label: "Hot Deal",
      className: badgeStyles.hot,
    };
  }
  if (isUpcoming) {
    return {
      label: "Upcoming",
      className: badgeStyles.new,
    };
  }

  // 3. LOW STOCK
  if (isLowStock) {
    return {
      label: "Low Stock",
      className: "border border-amber-200 bg-amber-50/95 text-amber-700",
    };
  }

  // 4. NONE
  return null;
}

/**
 * Resolves bottom CTA label and disabled state.
 * Priority:
 *   A. isOutOfStock: label is 'Add to Cart', disabled: true (NEVER repeats 'Out of Stock')
 *   B. reachedStockLimit: label is 'Limit Reached', disabled: true
 *   C. justAddedToCart: label is 'Added', disabled: false
 *   D. default: label is 'Add to Cart', disabled: false
 */
export function resolveCardCTA(params: {
  isOutOfStock: boolean;
  reachedStockLimit: boolean;
  justAddedToCart: boolean;
}): {
  label: string;
  disabled: boolean;
} {
  const { isOutOfStock, reachedStockLimit, justAddedToCart } = params;

  if (isOutOfStock) {
    return {
      label: "Add to Cart",
      disabled: true,
    };
  }

  if (reachedStockLimit) {
    return {
      label: "Limit Reached",
      disabled: true,
    };
  }

  if (justAddedToCart) {
    return {
      label: "Added",
      disabled: false,
    };
  }

  return {
    label: "Add to Cart",
    disabled: false,
  };
}

/**
 * Formats price with literal Bangladesh Taka sign (৳ U+09F3).
 */
export function formatCardPrice(price: number): string {
  return "৳" + price;
}
