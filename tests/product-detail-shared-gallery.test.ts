import dotenv from "dotenv";
dotenv.config();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import pg from "pg";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { PrismaClient } from "../generated/prisma/client";
import type { getProductById as GetProductByIdType } from "../lib/getProducts";

const { Client } = pg;

const testBaseUrl = process.env.DATABASE_URL_TEST;
if (!testBaseUrl) {
  throw new Error("DATABASE_URL_TEST is required to run product-detail-shared-gallery integration tests.");
}

const parsedBase = new URL(testBaseUrl);
if (parsedBase.hostname.includes("neon.tech")) {
  throw new Error("Safety violation: DATABASE_URL_TEST points to Neon cloud.");
}
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Safety violation: DATABASE_URL_TEST must target local PostgreSQL test environment.");
}

const dbName = `pure_haven_storefront_detail_${Date.now()}`;
if (!/^pure_haven_storefront_detail_[0-9]+$/.test(dbName)) {
  throw new Error(`Safety violation: Invalid disposable database name ${dbName}`);
}

const disposableUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);

const parsedDisposable = new URL(disposableUrl);
if (
  parsedDisposable.hostname !== parsedBase.hostname ||
  parsedDisposable.port !== parsedBase.port ||
  parsedDisposable.protocol !== parsedBase.protocol ||
  parsedDisposable.pathname !== `/${dbName}`
) {
  throw new Error("Target validation failed: disposable URL does not match base configuration.");
}

const prevDbUrl = process.env.DATABASE_URL;
const prevDbUrlTest = process.env.DATABASE_URL_TEST;

describe("Task 9 -- Product Detail Shared Gallery Authority", () => {
  let prisma: PrismaClient;
  let getProductById: typeof GetProductByIdType;
  let rawClient: pg.Client;

  let productWithGalleryId: number;
  let productFallbackId: number;

  before(async () => {
    const adminUrl = testBaseUrl!.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}";`);
    await adminClient.end();

    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    execSync(`${npxCmd} prisma migrate deploy --schema .\\prisma\\schema.prisma`, {
      env: { ...process.env, DATABASE_URL: disposableUrl, DATABASE_URL_TEST: disposableUrl },
      stdio: "pipe",
    });

    process.env.DATABASE_URL = disposableUrl;
    process.env.DATABASE_URL_TEST = disposableUrl;

    const prismaModule = await import("../lib/prisma.js");
    prisma = prismaModule.prisma;

    const getProductsModule = await import("../lib/getProducts.js");
    getProductById = getProductsModule.getProductById;

    rawClient = new Client({ connectionString: disposableUrl });
    await rawClient.connect();

    const dbCheck = await rawClient.query("SELECT current_database()");
    assert.strictEqual(
      dbCheck.rows[0].current_database,
      dbName,
      "Connected database must match generated disposable dbName"
    );

    const category = await prisma.category.create({
      data: {
        name: "Detail Gallery Category",
        slug: `detail-gallery-${Date.now()}`,
        isActive: true,
      },
    });

    const prodA = await prisma.product.create({
      data: {
        name: "Detail Gallery Product",
        price: 500,
        image: "/uploads/products/detail-primary.jpg",
        category: category.name,
        categoryId: category.id,
        description: "Product with relational gallery",
        stock: 10,
        isActive: true,
      },
    });
    productWithGalleryId = prodA.id;

    await prisma.productImage.create({
      data: { productId: prodA.id, url: "/uploads/products/detail-3.jpg", sortOrder: 3, sourceKind: "LEGACY_LOCAL" },
    });
    await prisma.productImage.create({
      data: { productId: prodA.id, url: "/uploads/products/detail-primary.jpg", sortOrder: 1, sourceKind: "LEGACY_LOCAL" },
    });
    await prisma.productImage.create({
      data: { productId: prodA.id, url: "/uploads/products/detail-2.jpg", sortOrder: 2, sourceKind: "LEGACY_LOCAL" },
    });

    await prisma.productVariant.create({
      data: {
        productId: prodA.id,
        label: "Variant With Image",
        price: 500,
        stock: 5,
        image: "/uploads/products/variant-override.jpg",
        isActive: true,
        sortOrder: 1,
      },
    });
    await prisma.productVariant.create({
      data: {
        productId: prodA.id,
        label: "Variant Without Image",
        price: 450,
        stock: 3,
        image: null,
        isActive: true,
        sortOrder: 2,
      },
    });

    const prodB = await prisma.product.create({
      data: {
        name: "Fallback Gallery Product",
        price: 200,
        image: "/uploads/products/detail-fallback.jpg",
        category: category.name,
        categoryId: category.id,
        stock: 5,
        isActive: true,
      },
    });
    productFallbackId = prodB.id;
  });

  after(async () => {
    try { if (rawClient) await rawClient.end(); } catch {}
    try { if (prisma) await prisma.$disconnect(); } catch {}

    let dropError: unknown = null;
    try {
      const adminUrl = testBaseUrl!.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
      const adminClient = new Client({ connectionString: adminUrl });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE "${dbName}" WITH (FORCE);`);
      await adminClient.end();
    } catch (err) {
      dropError = err;
      console.error("Cleanup error dropping disposable DB:", err);
    } finally {
      if (prevDbUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = prevDbUrl;
      }
      if (prevDbUrlTest === undefined) {
        delete process.env.DATABASE_URL_TEST;
      } else {
        process.env.DATABASE_URL_TEST = prevDbUrlTest;
      }
    }
    if (dropError) throw dropError;
  });

  it("A. Relational Authority: getProductById returns images ordered by sortOrder ASC, id ASC", async () => {
    const product = await getProductById(productWithGalleryId);
    assert.ok(product, "Product must be found");
    assert.deepStrictEqual(
      product.images,
      [
        "/uploads/products/detail-primary.jpg",
        "/uploads/products/detail-2.jpg",
        "/uploads/products/detail-3.jpg",
      ],
      "images must be ordered by sortOrder ASC -- not insertion order"
    );
  });

  it("B. Fallback: getProductById with 0 ProductImage rows returns images: [product.image]", async () => {
    const product = await getProductById(productFallbackId);
    assert.ok(product, "Product must be found");
    assert.deepStrictEqual(
      product.images,
      ["/uploads/products/detail-fallback.jpg"],
      "Fallback must be [product.image] -- not empty array"
    );
  });

  it("C. Order proof: first image is sortOrder 1 (not insertion-order first)", async () => {
    const product = await getProductById(productWithGalleryId);
    assert.ok(product?.images);
    assert.strictEqual(product.images![0], "/uploads/products/detail-primary.jpg", "First must be sortOrder: 1");
    assert.strictEqual(product.images![2], "/uploads/products/detail-3.jpg", "Last must be sortOrder: 3");
  });

  it("D. Non-duplication: product.image is NOT appended when relational rows exist", async () => {
    const product = await getProductById(productWithGalleryId);
    assert.ok(product?.images);
    const primaryCount = product.images!.filter(
      (url) => url === "/uploads/products/detail-primary.jpg"
    ).length;
    assert.strictEqual(primaryCount, 1, "product.image must not be duplicated/appended");
    assert.strictEqual(product.images!.length, 3);
  });

  it("E. Relational authority: product.image field still preserved separately", async () => {
    const product = await getProductById(productWithGalleryId);
    assert.ok(product?.images);
    assert.strictEqual(product.image, "/uploads/products/detail-primary.jpg");
    assert.ok(product.images!.includes("/uploads/products/detail-2.jpg"));
    assert.ok(product.images!.includes("/uploads/products/detail-3.jpg"));
  });

  it("F. No N+1 proof: catalogRead.ts getCachedProductRow uses inline images relation", () => {
    
    
    const catalogReadSource = fs.readFileSync(
      nodePath.join(process.cwd(), "lib", "catalogRead.ts"),
      "utf8"
    );
    assert.ok(catalogReadSource.includes("images:"), "getCachedProductRow must include images relation");
    assert.ok(catalogReadSource.includes('sortOrder: "asc"'), "images must be ordered by sortOrder ASC");
    assert.ok(!catalogReadSource.includes("productImage.findMany"), "catalogRead must NOT use separate productImage.findMany");
  });

  it("G. Variant override proof: ProductDetailsClient uses variantImage as override over selectedBaseGalleryImage", () => {
    
    
    const clientSource = fs.readFileSync(
      nodePath.join(process.cwd(), "components", "product", "ProductDetailsClient.tsx"),
      "utf8"
    );
    assert.ok(
      clientSource.includes("const variantImage = selectedVariant?.image?.trim() || null;"),
      "Must extract variantImage"
    );
    assert.ok(
      clientSource.includes("variantImage ? variantImage : selectedBaseGalleryImage"),
      "Must use variantImage as presentation override"
    );
  });

  it("H. Base gallery state: ProductDetailsClient maintains selectedBaseIdx", () => {
    
    
    const clientSource = fs.readFileSync(
      nodePath.join(process.cwd(), "components", "product", "ProductDetailsClient.tsx"),
      "utf8"
    );
    assert.ok(clientSource.includes("selectedBaseIdx"), "Must have selectedBaseIdx");
    assert.ok(clientSource.includes("setSelectedBaseIdx"), "Must have setSelectedBaseIdx");
    assert.ok(clientSource.includes("useState(0)"), "Must initialize at 0");
  });

  it("I. Variant does not mutate base gallery: selectVariant does not reference baseGallery", () => {
    
    
    const clientSource = fs.readFileSync(
      nodePath.join(process.cwd(), "components", "product", "ProductDetailsClient.tsx"),
      "utf8"
    );
    const selectVariantIdx = clientSource.indexOf("function selectVariant");
    const nextFnIdx = clientSource.indexOf("\n  function ", selectVariantIdx + 1);
    const selectVariantBody = clientSource.slice(selectVariantIdx, nextFnIdx > 0 ? nextFnIdx : selectVariantIdx + 500);
    assert.ok(!selectVariantBody.includes("baseGallery"), "selectVariant must NOT mutate baseGallery");
  });

  it("J. Thumbnail accessibility: buttons have aria-current and aria-label with image position", () => {
    
    
    const clientSource = fs.readFileSync(
      nodePath.join(process.cwd(), "components", "product", "ProductDetailsClient.tsx"),
      "utf8"
    );
    assert.ok(
      clientSource.includes("aria-label={`Show product image ${idx + 1} of ${baseGallery.length}`}"),
      "Thumbnails must have aria-label with position"
    );
    assert.ok(
      clientSource.includes('aria-current={selectedBaseIdx === idx ? "true" : undefined}'),
      "Selected thumbnail must have aria-current"
    );
  });

  it("K. Single-image preservation: thumbnail strip guarded by baseGallery.length > 1", () => {
    
    
    const clientSource = fs.readFileSync(
      nodePath.join(process.cwd(), "components", "product", "ProductDetailsClient.tsx"),
      "utf8"
    );
    assert.ok(clientSource.includes("baseGallery.length > 1"), "Thumbnail strip must only render > 1");
  });

  it("L. Multi-image rendering: ProductDetailsClient maps baseGallery to thumbnail buttons with setSelectedBaseIdx", () => {
    
    
    const clientSource = fs.readFileSync(
      nodePath.join(process.cwd(), "components", "product", "ProductDetailsClient.tsx"),
      "utf8"
    );
    assert.ok(clientSource.includes("baseGallery.map((imgUrl, idx)"), "Must map baseGallery");
    assert.ok(clientSource.includes("setSelectedBaseIdx(idx)"), "Thumbnail click must set idx");
  });

  it("M. Commerce preservation: price, stock, image field unchanged", async () => {
    const product = await getProductById(productWithGalleryId);
    assert.ok(product);
    assert.strictEqual(product.price, 500);
    assert.strictEqual(product.stock, 10);
    assert.strictEqual(product.image, "/uploads/products/detail-primary.jpg");
    assert.strictEqual(product.name, "Detail Gallery Product");
  });

  it("N. Variants preserved: both active variants returned with prices and stock", async () => {
    const product = await getProductById(productWithGalleryId);
    assert.ok(product?.variants);
    assert.strictEqual(product.variants!.length, 2);
    const varWithImg = product.variants!.find((v) => v.label === "Variant With Image");
    assert.ok(varWithImg);
    assert.strictEqual(varWithImg.image, "/uploads/products/variant-override.jpg");
    const varNoImg = product.variants!.find((v) => v.label === "Variant Without Image");
    assert.ok(varNoImg);
    assert.strictEqual(varNoImg.image, null);
  });

  it("O. Variant images NOT in base gallery: variant.image absent from product.images", async () => {
    const product = await getProductById(productWithGalleryId);
    assert.ok(product?.images);
    assert.ok(!product.images!.includes("/uploads/products/variant-override.jpg"), "Variant image must NOT be in base gallery");
    assert.strictEqual(product.images!.length, 3);
  });

  it("P. ProductCard/Carousel isolation: lib/getProducts.ts does not reference ProductCard or ProductCardCarousel", () => {
    
    
    const getProductsSource = fs.readFileSync(
      nodePath.join(process.cwd(), "lib", "getProducts.ts"),
      "utf8"
    );
    assert.ok(!getProductsSource.includes("ProductCard"), "getProducts must not reference ProductCard");
    assert.ok(!getProductsSource.includes("ProductCardCarousel"), "getProducts must not reference ProductCardCarousel");
  });
});

