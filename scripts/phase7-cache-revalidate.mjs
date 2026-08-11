import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase7_backup_cache_revalidate");
mkdirSync(backupDir, { recursive: true });

const files = [
  "app/page.tsx",
  "app/shop/page.tsx",
  "app/api/products/route.ts",
  "app/api/categories/route.ts",
  "app/api/home-promos/route.ts",
  "app/api/footer-settings/route.ts",
  "app/api/site-settings/route.ts",
];

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

function replaceOrInsertRevalidate(file, seconds) {
  const full = path.join(root, file);
  if (!existsSync(full)) return;

  let source = read(file);

  source = source.replace(/export const dynamic = ["']force-dynamic["'];\r?\n?/g, "");
  source = source.replace(/export const revalidate = 0;\r?\n?/g, "");
  source = source.replace(/export const revalidate = false;\r?\n?/g, "");

  if (source.match(/export const revalidate = \d+;/)) {
    source = source.replace(/export const revalidate = \d+;/, `export const revalidate = ${seconds};`);
  } else {
    const importMatches = [...source.matchAll(/^import .*;$/gm)];
    if (importMatches.length > 0) {
      const last = importMatches[importMatches.length - 1];
      const insertAt = last.index + last[0].length;
      source = source.slice(0, insertAt) + `\n\nexport const revalidate = ${seconds};` + source.slice(insertAt);
    } else {
      source = `export const revalidate = ${seconds};\n\n` + source;
    }
  }

  write(file, source);
}

function addCacheHeaderToNextResponseJson(file, seconds) {
  const full = path.join(root, file);
  if (!existsSync(full)) return;

  let source = read(file);

  if (!source.includes("function publicCacheHeaders(")) {
    const insertAfter = source.includes(`import { NextResponse } from "next/server";`)
      ? `import { NextResponse } from "next/server";`
      : source.match(/^import .*;$/m)?.[0];

    if (!insertAfter) return;

    source = source.replace(
      insertAfter,
      `${insertAfter}

function publicCacheHeaders(seconds = ${seconds}) {
  return {
    "Cache-Control": \`public, max-age=0, s-maxage=\${seconds}, stale-while-revalidate=\${seconds * 5}\`,
  };
}`
    );
  }

  // Patch common success JSON responses only. Mutations are not touched.
  source = source.replaceAll(
    `return NextResponse.json({ success: true, products });`,
    `return NextResponse.json({ success: true, products }, { headers: publicCacheHeaders() });`
  );

  source = source.replaceAll(
    `return NextResponse.json({ success: true, product });`,
    `return NextResponse.json({ success: true, product }, { headers: publicCacheHeaders() });`
  );

  source = source.replaceAll(
    `return NextResponse.json({ success: true, categories });`,
    `return NextResponse.json({ success: true, categories }, { headers: publicCacheHeaders() });`
  );

  source = source.replaceAll(
    `return NextResponse.json({ success: true, promos });`,
    `return NextResponse.json({ success: true, promos }, { headers: publicCacheHeaders() });`
  );

  source = source.replaceAll(
    `return NextResponse.json({ success: true, settings });`,
    `return NextResponse.json({ success: true, settings }, { headers: publicCacheHeaders() });`
  );

  source = source.replaceAll(
    `return NextResponse.json({ success: true, slides });`,
    `return NextResponse.json({ success: true, slides }, { headers: publicCacheHeaders() });`
  );

  write(file, source);
}

// Public page cache tuning.
// Short cache so admin edits are not stale for long.
replaceOrInsertRevalidate("app/page.tsx", 60);
replaceOrInsertRevalidate("app/shop/page.tsx", 60);

// Public GET API cache hints.
addCacheHeaderToNextResponseJson("app/api/products/route.ts", 60);
addCacheHeaderToNextResponseJson("app/api/categories/route.ts", 300);
addCacheHeaderToNextResponseJson("app/api/home-promos/route.ts", 300);
addCacheHeaderToNextResponseJson("app/api/footer-settings/route.ts", 600);
addCacheHeaderToNextResponseJson("app/api/site-settings/route.ts", 600);

console.log("Phase 7 cache/revalidate patch applied.");
console.log("Homepage revalidate: 60s");
console.log("Shop revalidate: 60s");
console.log("Public API cache headers patched where matching response patterns existed.");
console.log(`Backups saved in: ${backupDir}`);
