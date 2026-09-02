import type { MetadataRoute } from "next";
import { getSitemapProductRowsBatch } from "@/lib/catalog/publicCatalogQuery";

const baseUrl = "https://pure-haven-bd-final-wdb1.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const productRows: Array<{ id: number; updatedAt: Date }> = [];
  let afterId: number | undefined;

  while (true) {
    const batch = await getSitemapProductRowsBatch({
      afterId,
      take: 1000,
    });

    if (batch.length === 0) break;

    const lastItem = batch[batch.length - 1];
    if (afterId !== undefined && lastItem.id <= afterId) {
      throw new Error("Sitemap keyset traversal failed to advance");
    }

    productRows.push(...batch);
    afterId = lastItem.id;

    if (batch.length < 1000) break;
  }

  return [
    { url: baseUrl, lastModified: new Date() },
    { url: `${baseUrl}/shop`, lastModified: new Date() },
    { url: `${baseUrl}/track-order`, lastModified: new Date() },
    ...productRows.map((p) => ({
      url: `${baseUrl}/product/${p.id}`,
      lastModified: p.updatedAt,
    })),
  ];
}