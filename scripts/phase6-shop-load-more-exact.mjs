import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase6_backup_shop_load_more_exact");
mkdirSync(backupDir, { recursive: true });

const shopFile = path.join(root, "app/shop/page.tsx");
copyFileSync(shopFile, path.join(backupDir, "app__shop__page.tsx"));

mkdirSync(path.join(root, "components/shop"), { recursive: true });

writeFileSync(
  path.join(root, "components/shop/LoadMoreProducts.tsx"),
`"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "@/components/ui/ProductCard";

type LoadMoreProductsProps = {
  products: any[];
  initialLimit?: number;
  step?: number;
  gridClassName?: string;
};

export default function LoadMoreProducts({
  products,
  initialLimit = 12,
  step = 12,
  gridClassName = "grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6",
}: LoadMoreProductsProps) {
  const [visibleCount, setVisibleCount] = useState(initialLimit);

  useEffect(() => {
    setVisibleCount(initialLimit);
  }, [products, initialLimit]);

  const safeProducts = Array.isArray(products) ? products : [];

  const visibleProducts = useMemo(
    () => safeProducts.slice(0, visibleCount),
    [safeProducts, visibleCount]
  );

  const remaining = Math.max(safeProducts.length - visibleProducts.length, 0);
  const hasMore = remaining > 0;

  return (
    <div className="space-y-8">
      <div className={gridClassName}>
        {visibleProducts.map((product) => (
          <ProductCard
            key={product.id}
            id={product.id}
            name={product.name}
            price={product.price}
            compareAtPrice={product.compareAtPrice}
            image={product.image}
            category={product.category}
            stock={product.stock}
            isHotDeal={product.isHotDeal}
            isUpcoming={product.isUpcoming}
            badgeText={product.badgeText}
            badgeTone={product.badgeTone}
          />
        ))}
      </div>

      {hasMore ? (
        <div className="flex flex-col items-center gap-3 pt-2">
          <p className="text-xs uppercase tracking-[0.22em] text-[#8b5a45]">
            Showing {visibleProducts.length} of {safeProducts.length} products
          </p>
          <button
            type="button"
            onClick={() =>
              setVisibleCount((current) =>
                Math.min(current + step, safeProducts.length)
              )
            }
            className="rounded-full bg-[#2d1f1a] px-8 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white shadow-sm transition hover:bg-[#8b5a45]"
          >
            Load More
          </button>
        </div>
      ) : safeProducts.length > initialLimit ? (
        <p className="text-center text-xs uppercase tracking-[0.22em] text-[#8b5a45]">
          All products loaded
        </p>
      ) : null}
    </div>
  );
}
`,
  "utf8"
);

let source = readFileSync(shopFile, "utf8").replace(/^\uFEFF/, "");

if (source.includes(`import ProductCard from "@/components/ui/ProductCard";`)) {
  source = source.replace(
    `import ProductCard from "@/components/ui/ProductCard";`,
    `import LoadMoreProducts from "@/components/shop/LoadMoreProducts";`
  );
}

if (!source.includes(`import LoadMoreProducts from "@/components/shop/LoadMoreProducts";`)) {
  const imports = [...source.matchAll(/^import .*;$/gm)];
  if (!imports.length) throw new Error("No imports found in app/shop/page.tsx");
  const last = imports[imports.length - 1];
  const insertAt = last.index + last[0].length;
  source =
    source.slice(0, insertAt) +
    `\nimport LoadMoreProducts from "@/components/shop/LoadMoreProducts";` +
    source.slice(insertAt);
}

const oldBlock = `<div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6">
            {visibleProducts.map((product: Product) => (
              <ProductCard
                key={product.id}
                id={product.id}
                name={product.name}
                price={product.price}
                compareAtPrice={product.compareAtPrice}
                image={product.image}
                category={product.category}
                stock={product.stock}
                isHotDeal={product.isHotDeal}
                isUpcoming={product.isUpcoming}
                badgeText={product.badgeText}
                badgeTone={product.badgeTone}
              />
            ))}
          </div>`;

const newBlock = `<LoadMoreProducts
            products={visibleProducts}
            gridClassName="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6"
            initialLimit={12}
            step={12}
          />`;

if (!source.includes(oldBlock)) {
  throw new Error("Exact ProductCard grid block not found. The file may already be modified or formatting changed.");
}

source = source.replace(oldBlock, newBlock);

writeFileSync(shopFile, source, "utf8");

console.log("Phase 6 exact patch applied.");
console.log("Replaced visibleProducts ProductCard grid with LoadMoreProducts.");
console.log(`Backup saved in: ${backupDir}`);
