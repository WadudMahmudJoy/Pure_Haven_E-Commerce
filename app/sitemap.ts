import type { MetadataRoute } from "next";
import { getProducts } from "@/lib/getProducts";

const baseUrl = "https://pure-haven-bd-final-wdb1.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getProducts();

  return [
    { url: baseUrl, lastModified: new Date() },
    { url: `${baseUrl}/shop`, lastModified: new Date() },
    { url: `${baseUrl}/track-order`, lastModified: new Date() },
    ...products.map((p) => ({
      url: `${baseUrl}/product/${p.id}`,
      lastModified: new Date(),
    })),
  ];
}