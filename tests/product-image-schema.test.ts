import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;

describe("Task 1 — ProductImage Schema and Universal Backfill Contract", () => {
  let client: pg.Client;

  before(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error("DATABASE_URL must be explicitly supplied by the guarded Task-1 harness");
    }
    client = new Client({ connectionString: dbUrl });
    await client.connect();

    const dbNameRes = await client.query("SELECT current_database() AS name");
    const currentDbName = dbNameRes.rows[0]?.name || "";
    if (!/^pure_haven_storefront_gallery_[0-9]+$/.test(currentDbName)) {
      await client.end();
      throw new Error(
        `Safety violation: tests/product-image-schema.test.ts can only execute against a disposable database matching '^pure_haven_storefront_gallery_[0-9]+$', but connected to '${currentDbName}'`
      );
    }

    // Verify required pre-seeded legacy fixtures exist in the disposable database
    const expectedFixtures = [
      "Task1 Active Product",
      "Task1 Inactive Product",
      "Task1 Soft-Deleted Product",
      "Task1 Empty-Image Product",
    ];
    const fixtureRes = await client.query(
      'SELECT name FROM "Product" WHERE name = ANY($1::text[])',
      [expectedFixtures]
    );
    const foundNames = new Set(fixtureRes.rows.map((r: { name: string }) => r.name));
    for (const name of expectedFixtures) {
      if (!foundNames.has(name)) {
        throw new Error(`Required pre-seeded fixture '${name}' is missing in disposable database`);
      }
    }
  });

  after(async () => {
    if (client) {
      await client.end();
    }
  });

  it("1. ProductImage table and column metadata exist in public schema", async () => {
    const tableRes = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProductImage'"
    );
    assert.strictEqual(tableRes.rows.length, 1, "ProductImage table must exist");

    const colRes = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ProductImage'
    `);
    interface ColumnRow {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }
    const cols = Object.fromEntries(
      (colRes.rows as ColumnRow[]).map((r) => [r.column_name, r])
    );

    assert.ok(cols.id, "id column must exist");
    assert.strictEqual(cols.id.data_type, "integer");
    assert.strictEqual(cols.id.is_nullable, "NO");
    assert.match(cols.id.column_default || "", /nextval/i, "id column must be autoincrement sequence");

    assert.ok(cols.productId, "productId column must exist");
    assert.strictEqual(cols.productId.data_type, "integer");
    assert.strictEqual(cols.productId.is_nullable, "NO");

    assert.ok(cols.url, "url column must exist");
    assert.strictEqual(cols.url.data_type, "text");
    assert.strictEqual(cols.url.is_nullable, "NO");

    assert.ok(cols.sortOrder, "sortOrder column must exist");
    assert.strictEqual(cols.sortOrder.data_type, "integer");
    assert.strictEqual(cols.sortOrder.is_nullable, "NO");
    assert.match(
      cols.sortOrder.column_default || "",
      /^('?0'?)(?:::integer)?$/,
      "ProductImage.sortOrder must default to 0"
    );
  });

  it("2. ProductImage.productId foreign key references Product(id) ON DELETE CASCADE", async () => {
    const res = await client.query(`
      SELECT
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'ProductImage' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    assert.ok(res.rows.length >= 1, "Foreign key constraint must exist on ProductImage");
    interface FkRow {
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
    }
    const fk = (res.rows as FkRow[]).find((r) => r.column_name === "productId");
    assert.ok(fk, "Foreign key on productId must exist");
    assert.strictEqual(fk.foreign_table_name, "Product", "Foreign table must be Product");
    assert.strictEqual(fk.foreign_column_name, "id", "Foreign column must be id");
    assert.strictEqual(fk.delete_rule, "CASCADE", "ON DELETE rule must be CASCADE");
  });

  it("3. Unique constraint exists on (productId, sortOrder)", async () => {
    const tableCheck = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProductImage'"
    );
    assert.strictEqual(tableCheck.rows.length, 1, "ProductImage table must exist before checking unique constraint");

    const res = await client.query(`
      SELECT
        i.relname AS index_name,
        a.attname AS column_name
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relname = 'ProductImage'
        AND ix.indisunique = true
        AND i.relname = 'ProductImage_productId_sortOrder_key'
      ORDER BY a.attnum
    `);
    assert.strictEqual(res.rows.length, 2, "Unique index on (productId, sortOrder) must exist and cover 2 columns");
    const cols = (res.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    assert.ok(cols.includes("productId") && cols.includes("sortOrder"), "Unique index must cover productId and sortOrder");
  });

  it("4. No redundant duplicate secondary index exists on ProductImage", async () => {
    const res = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'ProductImage' AND schemaname = 'public'
    `);
    assert.strictEqual(
      res.rows.length,
      2,
      `Expected exactly 2 indexes on ProductImage (pkey + unique), found ${res.rows.length}: ${(res.rows as Array<{ indexname: string }>).map((r) => r.indexname).join(", ")}`
    );
  });

  it("5. Universal backfill correctly populated active, inactive, and soft-deleted products", async () => {
    const tableCheck = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProductImage'"
    );
    assert.strictEqual(tableCheck.rows.length, 1, "ProductImage table must exist before checking backfill");

    const prodRes = await client.query(`
      SELECT id, name, image, "isActive", "deletedAt"
      FROM "Product"
      WHERE name LIKE 'Task1 % Product'
      ORDER BY name ASC
    `);

    for (const prod of prodRes.rows) {
      const imgRes = await client.query(
        'SELECT id, "productId", url, "sortOrder" FROM "ProductImage" WHERE "productId" = $1 ORDER BY "sortOrder" ASC',
        [prod.id]
      );
      if (prod.image && prod.image.trim() !== "") {
        assert.strictEqual(
          imgRes.rows.length,
          1,
          `Expected exactly 1 ProductImage for product ${prod.name} (${prod.id})`
        );
        assert.strictEqual(imgRes.rows[0].sortOrder, 1, "sortOrder must be 1 for backfilled image");
        assert.strictEqual(imgRes.rows[0].url, prod.image.trim(), "url must match trimmed Product.image");
      } else {
        assert.strictEqual(
          imgRes.rows.length,
          0,
          `Expected 0 ProductImage rows for empty-image product ${prod.name}`
        );
      }
    }
  });

  it("6. Product.image values remain byte-for-byte unchanged", async () => {
    const prodRes = await client.query(`
      SELECT name, image
      FROM "Product"
      WHERE name LIKE 'Task1 % Product'
      ORDER BY name ASC
    `);
    const expected: Record<string, string> = {
      "Task1 Active Product": "/uploads/products/active.jpg",
      "Task1 Empty-Image Product": "",
      "Task1 Inactive Product": "/uploads/products/inactive.jpg",
      "Task1 Soft-Deleted Product": "/uploads/products/deleted.jpg",
    };
    for (const prod of prodRes.rows) {
      assert.strictEqual(
        prod.image,
        expected[prod.name],
        `Product.image for ${prod.name} must not be mutated`
      );
    }
  });

  it("7. Duplicate (productId, sortOrder) insertion is rejected by PostgreSQL unique constraint (23505)", async () => {
    const tableCheck = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProductImage'"
    );
    assert.strictEqual(tableCheck.rows.length, 1, "ProductImage table must exist before checking unique constraint");

    const prodRes = await client.query(`
      SELECT id FROM "Product" WHERE name = 'Task1 Active Product' LIMIT 1
    `);
    assert.ok(prodRes.rows.length > 0, "Seeded active product must exist");
    const activeId = prodRes.rows[0].id;
    let error: { code?: string } | null = null;
    try {
      await client.query(
        'INSERT INTO "ProductImage" ("productId", url, "sortOrder", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())',
        [activeId, "/uploads/products/duplicate.jpg", 1]
      );
    } catch (err: unknown) {
      error = err as { code?: string };
    }
    assert.ok(error, "Expected duplicate insertion to fail");
    assert.strictEqual(error.code, "23505", "Error code must be 23505 (unique_violation)");
  });

  it("8. Backfill SQL query is idempotent (re-running backfill inserts 0 additional rows)", async () => {
    const tableCheck = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProductImage'"
    );
    assert.strictEqual(tableCheck.rows.length, 1, "ProductImage table must exist before checking idempotency");
    const beforeCount = await client.query('SELECT count(*)::int AS count FROM "ProductImage"');
    const rerunResult = await client.query(`
      INSERT INTO "ProductImage" ("productId", "url", "sortOrder", "createdAt", "updatedAt")
      SELECT p."id", TRIM(p."image"), 1, NOW(), NOW()
      FROM "Product" p
      WHERE p."image" IS NOT NULL
        AND TRIM(p."image") <> ''
        AND NOT EXISTS (
          SELECT 1 FROM "ProductImage" pi WHERE pi."productId" = p."id"
        );
    `);
    assert.strictEqual(rerunResult.rowCount, 0, "Idempotent backfill must insert 0 rows");
    const afterCount = await client.query('SELECT count(*)::int AS count FROM "ProductImage"');
    assert.strictEqual(afterCount.rows[0].count, beforeCount.rows[0].count, "Total row count must remain unchanged");
  });
});
