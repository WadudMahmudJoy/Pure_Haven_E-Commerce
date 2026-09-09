import { notFound } from "next/navigation";
import { getPublicProductDetailQuery } from "@/lib/catalog/publicCatalogQuery";
import ProductDetailsClient from "@/components/product/ProductDetailsClient";

type ProductPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params;
  const productId = Number(id);

  if (!Number.isInteger(productId) || productId <= 0) {
    notFound();
  }

  const product = await getPublicProductDetailQuery(productId);

  if (!product) {
    notFound();
  }

  return (
    <ProductDetailsClient
      product={{
        ...product,
        subcategory: product.subcategory ?? undefined,
        description: product.description ?? undefined,
      }}
    />
  );
}
