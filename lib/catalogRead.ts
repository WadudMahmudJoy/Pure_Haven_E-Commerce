import { prisma } from "@/lib/prisma";
import {
  peekServerReadCache,
  withServerReadCache,
} from "@/lib/serverReadCache";

export async function getCachedProductListRows() {
  return withServerReadCache("products:rows:list:light", () =>
    prisma.product.findMany({
      orderBy: [{ id: "desc" }],
      select: {
        id: true,
        name: true,
        price: true,
        compareAtPrice: true,
        image: true,
        category: true,
        subcategory: true,
        description: true,
        stock: true,
        isHotDeal: true,
        isUpcoming: true,
        badgeText: true,
        badgeTone: true,
        createdAt: true,
      },
    })
  );
}

export async function getCachedProductRows() {
  return withServerReadCache("products:rows:list", () =>
    prisma.product.findMany({
      orderBy: [{ id: "desc" }],
      include: {
        variants: {
          orderBy: { id: "asc" },
        },
      },
    })
  );
}

export async function getCachedProductRow(id: number) {
  return withServerReadCache(`products:rows:id:${id}`, () =>
    prisma.product.findUnique({
      where: { id },
      include: {
        variants: {
          orderBy: { id: "asc" },
        },
      },
    })
  );
}

export function peekCachedProductRowFromList(id: number) {
  const products = peekServerReadCache<any[]>("products:rows:list");

  if (!products) return null;

  return products.find((product) => product.id === id) ?? null;
}

export async function getCachedCategoryRows(includeInactive: boolean) {
  return withServerReadCache(
    `categories:rows:${includeInactive ? "all" : "active"}`,
    () =>
      prisma.category.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          subcategories: {
            where: includeInactive ? {} : { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
      })
  );
}
