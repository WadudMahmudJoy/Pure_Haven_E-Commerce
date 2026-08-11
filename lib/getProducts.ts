import {
  getCachedProductListRows,
  getCachedProductRow,
  getCachedProductRows,
  peekCachedProductRowFromList,
} from "@/lib/catalogRead";

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
  category: string;
  subcategory?: string;
  description?: string;
  stock?: number;
  variants?: ProductVariant[];
  isHotDeal?: boolean;
  isUpcoming?: boolean;
  badgeText?: string | null;
  badgeTone?: string;
};

function mapProduct(product: any): Product {
  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    compareAtPrice:
      product.compareAtPrice == null ? null : Number(product.compareAtPrice),
    image: product.image,
    category: product.category,
    subcategory: product.subcategory ?? undefined,
    description: product.description ?? undefined,
    stock: product.stock ?? 0,
    variants: Array.isArray(product.variants)
      ? product.variants.map((variant: any) => ({
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
