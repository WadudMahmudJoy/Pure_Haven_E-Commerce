import fs from "fs/promises";
import path from "path";
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
  log: ["error"],
});

const filePath = path.join(process.cwd(), "data", "products.json");

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function main() {
  console.log("Reading file from:", filePath);

  const file = await fs.readFile(filePath, "utf-8");
  const products = JSON.parse(file);

  console.log("Raw products found:", Array.isArray(products) ? products.length : 0);

  if (!Array.isArray(products) || products.length === 0) {
    console.log("No products found in data/products.json");
    return;
  }

  const normalized = products.map((item) => ({
    name: normalizeString(item.name),
    price: normalizeNumber(item.price, 0),
    image:
      normalizeString(item.image) || "/uploads/placeholder-product.png",
    category: normalizeString(item.category),
    subcategory: normalizeString(item.subcategory) || null,
    description: normalizeString(item.description) || null,
    stock: Math.max(0, Math.floor(normalizeNumber(item.stock, 0))),
  }));

  const validProducts = normalized.filter(
    (item) => item.name && item.category
  );

  console.log("Valid products to import:", validProducts.length);

  if (validProducts.length === 0) {
    console.log("No valid products to import.");
    return;
  }

  await prisma.product.deleteMany();

  const created = await prisma.product.createMany({
    data: validProducts,
  });

  console.log("Inserted products:", created.count);

  const dbProducts = await prisma.product.findMany({
    orderBy: { id: "desc" },
  });

  console.log("Products now in DB:", dbProducts.length);
  console.log("First product:", dbProducts[0] || null);
}

main()
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });