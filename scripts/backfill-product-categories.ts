import "dotenv/config";
import { prisma } from "../lib/prisma.js";

async function backfillCategories() {
  console.log("Starting Product category backfill...");
  const categories = await prisma.category.findMany();
  console.log(`Found ${categories.length} categories in database:`, categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name })));

  const products = await prisma.product.findMany({
    where: { categoryId: null },
  });

  console.log(`Found ${products.length} products needing category backfill.`);

  let updatedCount = 0;
  let unmatchedCount = 0;

  for (const product of products) {
    const rawCategory = (product.category || "").trim().toLowerCase();
    const matched = categories.find(
      (c) => c.slug.toLowerCase() === rawCategory || c.name.toLowerCase() === rawCategory
    );

    if (matched) {
      await prisma.product.update({
        where: { id: product.id },
        data: { categoryId: matched.id },
      });
      updatedCount++;
    } else {
      console.warn(`Unmatched category "${product.category}" on product #${product.id} ("${product.name}")`);
      unmatchedCount++;
    }
  }

  console.log(`Backfill finished: ${updatedCount} products updated, ${unmatchedCount} unmatched.`);
}

backfillCategories()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());