import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase6_backup_shop_load_more");
mkdirSync(backupDir, { recursive: true });

const files = ["app/shop/page.tsx"];

for (const file of files) {
  const full = path.join(root, file);
  if (existsSync(full)) {
    copyFileSync(full, path.join(backupDir, file.replace(/[\\/]/g, "__")));
  }
}

function read(file) {
  return readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "");
}

function write(file, content) {
  writeFileSync(path.join(root, file), content, "utf8");
}

mkdirSync(path.join(root, "components", "shop"), { recursive: true });

write("components/shop/LoadMoreProducts.tsx", `"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import ProductCard from "@/components/ui/ProductCard";

type ProductCardData = ComponentProps<typeof ProductCard>;

type LoadMoreProductsProps = {
  products: ProductCardData[];
  initialLimit?: number;
  step?: number;
  gridClassName?: string;
};

export default function LoadMoreProducts({
  products,
  initialLimit = 12,
  step = 12,
  gridClassName = "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
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
          <ProductCard key={product.id} {...product} />
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
`);

const file = "app/shop/page.tsx";
let source = read(file);

if (source.includes(`import ProductCard from "@/components/ui/ProductCard";`)) {
  source = source.replace(
    `import ProductCard from "@/components/ui/ProductCard";`,
    `import LoadMoreProducts from "@/components/shop/LoadMoreProducts";`
  );
} else if (!source.includes(`import LoadMoreProducts from "@/components/shop/LoadMoreProducts";`)) {
  source = source.replace(
    /import SafeImage from "@\/components\/ui\/SafeImage";\r?\n/,
    `import SafeImage from "@/components/ui/SafeImage";\nimport LoadMoreProducts from "@/components/shop/LoadMoreProducts";\n`
  );
}

const gridRegex =
  /<div\s+className="([^"]*grid[^"]*)">\s*\{\s*([A-Za-z0-9_]+)\.map\(\(product\)\s*=>\s*\(\s*<ProductCard[\s\S]*?key=\{product\.id\}[\s\S]*?\{\.\.\.product\}[\s\S]*?\/>\s*\)\)\s*\}\s*<\/div>/m;

const match = source.match(gridRegex);

if (!match) {
  throw new Error(
    "Could not find the ProductCard grid in app/shop/page.tsx. Send screenshot or paste the product grid part of app/shop/page.tsx."
  );
}

const gridClassName = match[1];
const productsVariable = match[2];

source = source.replace(
  gridRegex,
  `<LoadMoreProducts
              products={${productsVariable}}
              gridClassName="${gridClassName}"
              initialLimit={12}
              step={12}
            />`
);

write(file, source);

console.log("Phase 6 shop load-more patch applied.");
console.log(`Backups saved in: ${backupDir}`);
console.log("Created: components/shop/LoadMoreProducts.tsx");
