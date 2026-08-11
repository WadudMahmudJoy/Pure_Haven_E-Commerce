import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase3_backup_product_api_lightweight");
mkdirSync(backupDir, { recursive: true });

const files = [
  "lib/catalogRead.ts",
  "lib/getProducts.ts",
  "app/api/products/route.ts",
  "app/admin/products/page.tsx",
];

for (const file of files) {
  copyFileSync(
    path.join(root, file),
    path.join(backupDir, file.replace(/[\\/]/g, "__"))
  );
}

function read(file) {
  return readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "");
}

function write(file, content) {
  writeFileSync(path.join(root, file), content, "utf8");
}

function mustReplace(file, source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Pattern not found in ${file}:\n${search.slice(0, 260)}`);
  }
  return source.replace(search, replacement);
}

/**
 * 1) Add lightweight public product list cache.
 */
{
  const file = "lib/catalogRead.ts";
  let source = read(file);

  if (!source.includes("getCachedProductListRows")) {
    source = mustReplace(
      file,
      source,
`export async function getCachedProductRows() {
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
}`,
`export async function getCachedProductListRows() {
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
}`
    );
  }

  write(file, source);
}

/**
 * 2) Make public getProducts() use lightweight rows.
 *    Product details still use getCachedProductRow(id), so variants remain available there.
 */
{
  const file = "lib/getProducts.ts";
  let source = read(file);

  source = source.replace(
`import {
  getCachedProductRow,
  getCachedProductRows,
  peekCachedProductRowFromList,
} from "@/lib/catalogRead";`,
`import {
  getCachedProductListRows,
  getCachedProductRow,
  getCachedProductRows,
  peekCachedProductRowFromList,
} from "@/lib/catalogRead";`
  );

  source = source.replace(
`export async function getProducts(): Promise<Product[]> {
  const products = await getCachedProductRows();
  return products.map(mapProduct);
}`,
`export async function getProducts(): Promise<Product[]> {
  const products = await getCachedProductListRows();
  return products.map(mapProduct);
}`
  );

  write(file, source);
}

/**
 * 3) Make /api/products default lightweight.
 *    Full product list remains available for admin by ?view=admin.
 *    Single product by id remains full with variants.
 */
{
  const file = "app/api/products/route.ts";
  let source = read(file);

  source = source.replace(
`  getCachedProductRow,
  getCachedProductRows,`,
`  getCachedProductListRows,
  getCachedProductRow,
  getCachedProductRows,`
  );

  source = mustReplace(
    file,
    source,
`    const { searchParams } = new URL(req.url);
    const id = validId(searchParams.get("id"));`,
`    const { searchParams } = new URL(req.url);
    const id = validId(searchParams.get("id"));
    const view = text(searchParams.get("view")).toLowerCase();`
  );

  source = mustReplace(
    file,
    source,
`    const products = await getCachedProductRows();

    return NextResponse.json({ success: true, products });`,
`    const products =
      view === "admin" || view === "full"
        ? await getCachedProductRows()
        : await getCachedProductListRows();

    return NextResponse.json({ success: true, products });`
  );

  write(file, source);
}

/**
 * 4) Admin products page must keep full variants.
 */
{
  const file = "app/admin/products/page.tsx";
  let source = read(file);

  source = source.replace(
`fetch("/api/products", { cache: "no-store" })`,
`fetch("/api/products?view=admin", { cache: "no-store" })`
  );

  write(file, source);
}

console.log("Phase 3 product API lightweight patch applied.");
console.log(`Backups saved in: ${backupDir}`);
