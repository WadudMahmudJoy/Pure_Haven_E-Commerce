import {
  getCachedProductListRows,
  getCachedProductRow,
  peekCachedProductRowFromList,
} from "@/lib/catalogRead";
import type { PublicProductMediaProjection } from "@/lib/catalog/types";

export type ProductVariant = {
  id: number;
  label: string;
  price: number;
  stock: number;
  image?: string | null;
};

export type Product = {
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
  isHotDeal?: boolean;
  isUpcoming?: boolean;
  badgeText?: string | null;
  badgeTone?: string;
  media?: PublicProductMediaProjection;
};

function mapProduct(product: {
  id: number;
  name: string;
  price: { toNumber(): number } | number;
  compareAtPrice?: { toNumber(): number } | number | null;
  image: string;
  images?: Array<{ url: string }>;
  category: string;
  subcategory?: string | null;
  description?: string | null;
  stock?: number | null;
  variants?: Array<{ id: number; label: string; price: { toNumber(): number } | number; stock?: number | null; image?: string | null }>;
  isHotDeal?: boolean | null;
  isUpcoming?: boolean | null;
  badgeText?: string | null;
  badgeTone?: string | null;
}): Product {
  const relationalImages = Array.isArray(product.images)
    ? product.images.map((img) => img.url)
    : [];

  const images =
    relationalImages.length > 0 ? relationalImages : [product.image];

  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    compareAtPrice:
      product.compareAtPrice == null ? null : Number(product.compareAtPrice),
    image: product.image,
    images,
    category: product.category,
    subcategory: product.subcategory ?? undefined,
    description: product.description ?? undefined,
    stock: product.stock ?? 0,
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          price: Number(variant.price),
          stock: variant.stock ?? 0,
          image: variant.image ?? null,
        }))
      : [],
    isHotDeal: product.isHotDeal ?? false,
    isUpcoming: product.isUpcoming ?? false,
    badgeText: product.badgeText ?? null,
    badgeTone: product.badgeTone ?? "sale",
  };
}

export async function getProducts(): Promise<Product[]> {
  const products = await getCachedProductListRows();
  return products.map(mapProduct);
}

export async function getProductById(id: number): Promise<Product | null> {
  const cachedFromList = peekCachedProductRowFromList(id);

  if (cachedFromList) {
    return mapProduct(cachedFromList);
  }

  const product = await getCachedProductRow(id);
  return product ? mapProduct(product) : null;
}
