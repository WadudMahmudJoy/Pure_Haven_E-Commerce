import { notFound } from "next/navigation";
import { getProductById } from "@/lib/getProducts";
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

  const product = await getProductById(productId);

  if (!product) {
    notFound();
  }

  return <ProductDetailsClient product={product} />;
}



