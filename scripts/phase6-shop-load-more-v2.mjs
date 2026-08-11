import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase6_backup_shop_load_more_v2");
mkdirSync(backupDir, { recursive: true });

const shopFile = "app/shop/page.tsx";
const shopPath = path.join(root, shopFile);

if (!existsSync(shopPath)) {
  throw new Error("app/shop/page.tsx not found.");
}

copyFileSync(shopPath, path.join(backupDir, "app__shop__page.tsx"));

mkdirSync(path.join(root, "components", "shop"), { recursive: true });

writeFileSync(
  path.join(root, "components/shop/LoadMoreProducts.tsx"),
`"use client";

import { useEffect, useMemo, useState } from "react";
import ProductCard from "@/components/ui/ProductCard";

type ProductLike = {
  id: number | string;
  name: string;
  price: number;
  compareAtPrice?: number | null;
  image?: string | null;
  category: string;
  subcategory?: string | null;
  description?: string | null;
  stock: number;
  isHotDeal?: boolean;
  isUpcoming?: boolean;
  badgeText?: string | null;
  badgeTone?: "sale" | "new" | "offer" | "hot" | "festival" | string | null;
};

type LoadMoreProductsProps = {
  products: ProductLike[];
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
          <ProductCard
            key={product.id}
            id={Number(product.id)}
            name={product.name}
            price={product.price}
            compareAtPrice={product.compareAtPrice ?? undefined}
            image={product.image ?? undefined}
            category={product.category}
            subcategory={product.subcategory ?? undefined}
            description={product.description ?? undefined}
            stock={product.stock}
            isHotDeal={product.isHotDeal}
            isUpcoming={product.isUpcoming}
            badgeText={product.badgeText ?? undefined}
            badgeTone={product.badgeTone as any}
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

let source = readFileSync(shopPath, "utf8").replace(/^\uFEFF/, "");

if (!source.includes(`import LoadMoreProducts from "@/components/shop/LoadMoreProducts";`)) {
  if (source.includes(`import ProductCard from "@/components/ui/ProductCard";`)) {
    source = source.replace(
      `import ProductCard from "@/components/ui/ProductCard";`,
      `import LoadMoreProducts from "@/components/shop/LoadMoreProducts";`
    );
  } else if (source.includes(`import ProductCard from "@/components/product/ProductCard";`)) {
    source = source.replace(
      `import ProductCard from "@/components/product/ProductCard";`,
      `import LoadMoreProducts from "@/components/shop/LoadMoreProducts";`
    );
  } else {
    const lastImportMatch = [...source.matchAll(/^import .*;$/gm)].pop();
    if (!lastImportMatch) {
      throw new Error("No import section found in app/shop/page.tsx.");
    }
    const insertAt = lastImportMatch.index + lastImportMatch[0].length;
    source =
      source.slice(0, insertAt) +
      `\nimport LoadMoreProducts from "@/components/shop/LoadMoreProducts";` +
      source.slice(insertAt);
  }
}

const productCardIndex = source.indexOf("<ProductCard");

if (productCardIndex === -1) {
  if (source.includes("<LoadMoreProducts")) {
    console.log("LoadMoreProducts already exists in app/shop/page.tsx. Nothing to replace.");
    writeFileSync(shopPath, source, "utf8");
    process.exit(0);
  }

  throw new Error("Could not find <ProductCard in app/shop/page.tsx.");
}

const beforeProductCard = source.slice(0, productCardIndex);
const divMatches = [...beforeProductCard.matchAll(/<div\s+className="([^"]*grid[^"]*)"/g)];

if (divMatches.length === 0) {
  throw new Error("Could not find parent grid div before <ProductCard.");
}

const lastGridMatch = divMatches[divMatches.length - 1];
const gridStart = lastGridMatch.index;
const gridClassName = lastGridMatch[1];

let depth = 0;
let gridEnd = -1;
const tagRegex = /<div\b|<\/div>/g;
tagRegex.lastIndex = gridStart;

let match;
while ((match = tagRegex.exec(source)) !== null) {
  if (match[0].startsWith("<div")) {
    depth++;
  } else {
    depth--;
    if (depth === 0) {
      gridEnd = tagRegex.lastIndex;
      break;
    }
  }
}

if (gridEnd === -1) {
  throw new Error("Could not find closing </div> for product grid.");
}

const gridBlock = source.slice(gridStart, gridEnd);

const mapMatch =
  gridBlock.match(/\{\s*([A-Za-z0-9_$]+)\.map\s*\(\s*\(?\s*product\s*\)?\s*=>/) ||
  gridBlock.match(/([A-Za-z0-9_$]+)\.map\s*\(\s*\(?\s*product\s*\)?\s*=>/);

if (!mapMatch) {
  console.log("---- Product grid block found, but product list variable was not detected ----");
  console.log(gridBlock.slice(0, 1200));
  throw new Error("Could not detect products variable used in product.map.");
}

const productsVariable = mapMatch[1];

const replacement = `<LoadMoreProducts
              products={${productsVariable}}
              gridClassName="${gridClassName}"
              initialLimit={12}
              step={12}
            />`;

source = source.slice(0, gridStart) + replacement + source.slice(gridEnd);

writeFileSync(shopPath, source, "utf8");

console.log("Phase 6 v2 shop load-more patch applied.");
console.log(`Products variable detected: ${productsVariable}`);
console.log(`Grid class preserved: ${gridClassName}`);
console.log(`Backups saved in: ${backupDir}`);
