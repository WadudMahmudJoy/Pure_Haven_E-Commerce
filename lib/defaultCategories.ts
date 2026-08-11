export type PublicSubcategory = {
  id: number | string;
  name: string;
  slug: string;
  isActive?: boolean;
  sortOrder?: number;
};

export type PublicCategory = {
  id: number | string;
  name: string;
  slug: string;
  image?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  subcategories: PublicSubcategory[];
};

export const DEFAULT_CATEGORY_DEFINITIONS = [
  {
    name: "Cosmetics",
    slug: "cosmetics",
    subcategories: [
      "lipstick",
      "liquid-lipstick",
      "lip-liner",
      "lip-gloss",
      "lip-balm",
      "foundation",
      "face-powder",
      "primer",
      "concealer",
      "blush",
      "highlighter",
      "eyeliner",
      "kajal",
      "mascara",
      "eyeshadow",
      "eyebrow-pencil",
      "brush",
    ],
  },
  {
    name: "Skincare",
    slug: "skincare",
    subcategories: [
      "face-wash",
      "moisturizer",
      "cream",
      "lotion",
      "serum",
      "sunscreen",
      "toner",
      "scrub",
      "face-mask",
      "petroleum-jelly",
      "others",
    ],
  },
  {
    name: "Haircare",
    slug: "haircare",
    subcategories: [
      "shampoo",
      "conditioner",
      "hair-oil",
      "hair-serum",
      "hair-mask",
      "hair-color",
      "hair-treatment",
      "styling-gel-spray",
      "others",
    ],
  },
  {
    name: "Perfume",
    slug: "perfume",
    subcategories: [
      "edt-men",
      "edp-men",
      "perfume-men",
      "edt-women",
      "edp-women",
      "perfume-women",
      "attar",
      "others",
    ],
  },
  {
    name: "Food",
    slug: "food",
    subcategories: [
      "oil-ghee",
      "honey",
      "dates",
      "spices",
      "nuts-seeds",
      "beverage",
      "rice",
      "flours-lentils",
      "certified",
      "pickle",
      "others",
    ],
  },
  {
    name: "Mens Products",
    slug: "mens-products",
    subcategories: [
      "shirts",
      "t-shirts",
      "panjabi",
      "pants",
      "wallet",
      "belt",
      "watch",
      "others",
    ],
  },
  {
    name: "Baby Products",
    slug: "baby-products",
    subcategories: [
      "diapers",
      "baby-wipes",
      "baby-lotion",
      "baby-oil",
      "baby-shampoo",
      "baby-soap",
      "baby-powder",
      "feeding-bottle",
      "baby-food",
      "others",
    ],
  },
] as const;

export function labelFromCategorySlug(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getDefaultPublicCategories(): PublicCategory[] {
  return DEFAULT_CATEGORY_DEFINITIONS.map((category, categoryIndex) => ({
    id: `fallback-category-${category.slug}`,
    name: category.name,
    slug: category.slug,
    image: null,
    isActive: true,
    sortOrder: categoryIndex,
    subcategories: category.subcategories.map((slug, subIndex) => ({
      id: `fallback-subcategory-${category.slug}-${slug}`,
      name: labelFromCategorySlug(slug),
      slug,
      isActive: true,
      sortOrder: subIndex,
    })),
  }));
}
