import dotenv from "dotenv";
dotenv.config();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import pg from "pg";

const { Client } = pg;

// ============================================================
// 1. DATABASE_URL_TEST Safety Protocol (Local only, reject cloud)
// ============================================================

const testBaseUrl = process.env.DATABASE_URL_TEST;
if (!testBaseUrl) {
  throw new Error("TASK10_DATABASE_URL_TEST_MISSING");
}

const parsedBase = new URL(testBaseUrl);
if (parsedBase.hostname.includes("neon.tech")) {
  throw new Error("Safety violation: DATABASE_URL_TEST points to Neon cloud.");
}
if (!["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
  throw new Error("Safety violation: DATABASE_URL_TEST must target local PostgreSQL test environment.");
}

// ============================================================
// 2. Unique Disposable Database Name & Target Validation
// ============================================================

const timestamp = Date.now();
const pid = process.pid;
const dbName = `pure_haven_storefront_gallery_${timestamp}_${pid}`;
if (!/^pure_haven_storefront_gallery_[0-9]+_[0-9]+$/.test(dbName)) {
  throw new Error(`Safety violation: Invalid disposable database name ${dbName}`);
}

const disposableTestUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);

const parsedDisposable = new URL(disposableTestUrl);
if (
  parsedDisposable.hostname !== parsedBase.hostname ||
  parsedDisposable.port !== parsedBase.port ||
  parsedDisposable.protocol !== parsedBase.protocol ||
  parsedDisposable.pathname !== `/${dbName}`
) {
  throw new Error("Target validation failed: disposable URL does not match base configuration.");
}

const longLivedDbName = parsedBase.pathname.replace(/^\//, "");
if (dbName === longLivedDbName || dbName === "postgres") {
  throw new Error("Target validation failed: disposable DB cannot equal long-lived test DB or postgres.");
}

const prevDbUrl = process.env.DATABASE_URL;
const prevDbUrlTest = process.env.DATABASE_URL_TEST;

const tempBaseline = fs.mkdtempSync(path.join(os.tmpdir(), `pure-haven-phase5-baseline-${timestamp}-${pid}-`));
const tempArchive = path.join(tempBaseline, `prisma-baseline-${timestamp}.tar`);

describe("Task 10 — PostgreSQL Migration Rehearsal & Universal Backfill Verification", () => {
  let client: pg.Client;
  let preMigrationAbsenceVerified = false;

  const legacyFixtures = [
    {
      name: "Rehearsal Active Product",
      price: 150.0,
      image: "/uploads/products/rehearsal-active.jpg",
      category: "Skincare",
      isActive: true,
      deletedAt: null,
    },
    {
      name: "Rehearsal Inactive Product",
      price: 200.0,
      image: "   /uploads/products/rehearsal-inactive.jpg   ",
      category: "Skincare",
      isActive: false,
      deletedAt: null,
    },
    {
      name: "Rehearsal Soft-Deleted Product",
      price: 250.0,
      image: "/uploads/products/rehearsal-deleted.jpg",
      category: "Skincare",
      isActive: true,
      deletedAt: new Date(),
    },
    {
      name: "Rehearsal Empty-Image Product",
      price: 300.0,
      image: "",
      category: "Skincare",
      isActive: true,
      deletedAt: null,
    },
  ];

  before(async () => {
    // 1. Create disposable DB via admin connection to "postgres"
    const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}";`);
    await adminClient.end();

    // 2. Binary-safe Phase-5 baseline export from git
    execFileSync(
      "git",
      ["archive", "--format=tar", "-o", tempArchive, "da6f210729f75ae39469efa665cb22229f9a5b8e", "prisma"],
      { stdio: "pipe" }
    );
    execFileSync("tar", ["-xf", tempArchive, "-C", tempBaseline], { stdio: "pipe" });

    // 3. Historical BOM replayability adaptation
    const baselineHistoricalPath = path.join(
      tempBaseline,
      "prisma",
      "migrations",
      "20260526183231_sync_current_schema_security_fix",
      "migration.sql"
    );
    const currentRepairedPath = path.join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260526183231_sync_current_schema_security_fix",
      "migration.sql"
    );

    const baselineBuffer = fs.readFileSync(baselineHistoricalPath);
    const currentRepairedBuffer = fs.readFileSync(currentRepairedPath);

    // Current repaired file must NOT have BOM
    if (
      currentRepairedBuffer.length >= 3 &&
      currentRepairedBuffer[0] === 0xef &&
      currentRepairedBuffer[1] === 0xbb &&
      currentRepairedBuffer[2] === 0xbf
    ) {
      throw new Error("Current migration file has forbidden UTF-8 BOM");
    }

    const hasBom =
      baselineBuffer.length >= 3 &&
      baselineBuffer[0] === 0xef &&
      baselineBuffer[1] === 0xbb &&
      baselineBuffer[2] === 0xbf;

    if (hasBom) {
      if (!baselineBuffer.subarray(3).equals(currentRepairedBuffer)) {
        throw new Error("TASK10_BASELINE_REPAIR_IDENTITY_MISMATCH");
      }
    } else {
      if (!baselineBuffer.equals(currentRepairedBuffer)) {
        throw new Error("TASK10_BASELINE_REPAIR_IDENTITY_MISMATCH");
      }
    }

    // Apply approved byte repair to TEMPORARY baseline copy only
    fs.writeFileSync(baselineHistoricalPath, currentRepairedBuffer);

    // 4. Deploy Phase-5 baseline migrations to disposable DB
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    const tempBaselineSchemaPath = path.join(tempBaseline, "prisma", "schema.prisma");
    const tempConfigPath = path.join(tempBaseline, "prisma.config.mjs");
    fs.writeFileSync(
      tempConfigPath,
      `export default {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
};`
    );

    execFileSync(
      npxCmd,
      ["prisma", "migrate", "deploy", "--config", tempConfigPath, "--schema", tempBaselineSchemaPath],
      {
        env: { ...process.env, DATABASE_URL: disposableTestUrl },
        stdio: "pipe",
        shell: process.platform === "win32",
      }
    );

    // Connect raw pg client
    client = new Client({ connectionString: disposableTestUrl });
    await client.connect();

    // Verify current_database() matches dbName
    const dbCheck = await client.query("SELECT current_database() AS name");
    assert.strictEqual(
      dbCheck.rows[0]?.name,
      dbName,
      "Connected database must match generated disposable dbName"
    );

    // 5. Seed legacy products in pre-ProductImage baseline
    for (const fixture of legacyFixtures) {
      await client.query(
        `INSERT INTO "Product" (name, price, image, category, "isActive", "deletedAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          fixture.name,
          fixture.price,
          fixture.image,
          fixture.category,
          fixture.isActive,
          fixture.deletedAt,
        ]
      );
    }

    // 6. Assert ProductImage table does NOT exist yet
    const preCheck = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProductImage'"
    );
    if (preCheck.rows.length === 0) {
      preMigrationAbsenceVerified = true;
    } else {
      throw new Error("ProductImage already exists in baseline database before current migration deployment");
    }

    // 7. Deploy current repository migrations to the SAME disposable DB
    const currentSchemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    execFileSync(
      npxCmd,
      ["prisma", "migrate", "deploy", "--schema", currentSchemaPath],
      {
        env: { ...process.env, DATABASE_URL: disposableTestUrl },
        stdio: "pipe",
        shell: process.platform === "win32",
      }
    );
  });

  after(async () => {
    if (client) {
      try {
        await client.end();
      } catch {}
    }

    let dropError: unknown = null;
    try {
      const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
      const adminClient = new Client({ connectionString: adminUrl });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE "${dbName}" WITH (FORCE);`);
      await adminClient.end();
    } catch (err) {
      dropError = err;
      console.error("Cleanup error dropping disposable DB:", err);
    }

    try {
      if (fs.existsSync(tempArchive)) {
        fs.unlinkSync(tempArchive);
      }
      if (fs.existsSync(tempBaseline)) {
        fs.rmSync(tempBaseline, { recursive: true, force: true });
      }
    } catch (err) {
      console.error("Cleanup error removing temp baseline files:", err);
    }

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

    if (dropError) {
      throw dropError;
    }
  });

  it("1. Pre-migration absence and table creation metadata", async () => {
    assert.strictEqual(
      preMigrationAbsenceVerified,
      true,
      "ProductImage must be proven absent prior to applying current migrations"
    );

    const tableRes = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ProductImage'"
    );
    assert.strictEqual(tableRes.rows.length, 1, "ProductImage table must exist after migration");

    const colRes = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ProductImage'
    `);
    const cols = Object.fromEntries(
      colRes.rows.map((r: { column_name: string; data_type: string; is_nullable: string; column_default: string | null }) => [r.column_name, r])
    );

    assert.ok(cols.id, "id column must exist");
    assert.strictEqual(cols.id.data_type, "integer");
    assert.strictEqual(cols.id.is_nullable, "NO");

    assert.ok(cols.productId, "productId column must exist");
    assert.strictEqual(cols.productId.data_type, "integer");
    assert.strictEqual(cols.productId.is_nullable, "NO");

    assert.ok(cols.url, "url column must exist");
    assert.strictEqual(cols.url.data_type, "text");
    assert.strictEqual(cols.url.is_nullable, "NO");

    assert.ok(cols.sortOrder, "sortOrder column must exist");
    assert.strictEqual(cols.sortOrder.data_type, "integer");
    assert.strictEqual(cols.sortOrder.is_nullable, "NO");
    assert.match(cols.sortOrder.column_default || "", /^('?0'?)(?:::integer)?$/);
  });

  it("2. Foreign key cascade constraint references Product(id)", async () => {
    const fkRes = await client.query(`
      SELECT
        tc.constraint_name,
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
    assert.ok(fkRes.rows.length >= 1, "Foreign key constraint must exist on ProductImage");
    const fk = fkRes.rows.find((r: { column_name: string }) => r.column_name === "productId");
    assert.ok(fk, "Foreign key on productId must exist");
    assert.strictEqual(fk.foreign_table_name, "Product");
    assert.strictEqual(fk.foreign_column_name, "id");
    assert.strictEqual(fk.delete_rule, "CASCADE", "ON DELETE rule must be CASCADE");
  });

  it("3. Unique constraint exists on (productId, sortOrder)", async () => {
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
    assert.strictEqual(res.rows.length, 2, "Unique index on (productId, sortOrder) must cover 2 columns");
    const cols = res.rows.map((r: { column_name: string }) => r.column_name);
    assert.ok(cols.includes("productId") && cols.includes("sortOrder"));
  });

  it("4. No redundant duplicate secondary index on (productId, sortOrder)", async () => {
    const res = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'ProductImage' AND schemaname = 'public'
    `);
    // Expected exactly 2 indexes: primary key (ProductImage_pkey) and unique constraint (ProductImage_productId_sortOrder_key)
    assert.strictEqual(
      res.rows.length,
      2,
      `Expected exactly 2 indexes on ProductImage (pkey + unique), found ${res.rows.length}: ${res.rows.map((r: { indexname: string }) => r.indexname).join(", ")}`
    );
  });

  it("5. Universal backfill parity for active, inactive, and soft-deleted products", async () => {
    const prodRes = await client.query(`
      SELECT id, name, image, "isActive", "deletedAt"
      FROM "Product"
      WHERE name LIKE 'Rehearsal % Product'
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
          `Expected exactly 1 ProductImage for ${prod.name} (${prod.id})`
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

    // Universal parity query across ALL eligible products in database
    const parityRes = await client.query(`
      SELECT p.id, p.name, TRIM(p.image) AS expected_url, pi.url AS actual_url
      FROM "Product" p
      LEFT JOIN "ProductImage" pi ON pi."productId" = p.id AND pi."sortOrder" = 1
      WHERE p.image IS NOT NULL AND TRIM(p.image) <> ''
        AND (pi.id IS NULL OR pi.url <> TRIM(p.image));
    `);
    assert.strictEqual(
      parityRes.rows.length,
      0,
      `Universal parity query returned ${parityRes.rows.length} discrepancies`
    );
  });

  it("6. Product.image non-destruction: original values remain text and byte identical", async () => {
    const prodRes = await client.query(`
      SELECT name, image
      FROM "Product"
      WHERE name LIKE 'Rehearsal % Product'
      ORDER BY name ASC
    `);
    const expectedMap: Record<string, string> = {
      "Rehearsal Active Product": "/uploads/products/rehearsal-active.jpg",
      "Rehearsal Inactive Product": "   /uploads/products/rehearsal-inactive.jpg   ",
      "Rehearsal Soft-Deleted Product": "/uploads/products/rehearsal-deleted.jpg",
      "Rehearsal Empty-Image Product": "",
    };

    for (const prod of prodRes.rows) {
      assert.strictEqual(
        prod.image,
        expectedMap[prod.name],
        `Product.image for ${prod.name} must not be mutated by migration`
      );
    }
  });

  it("7. Duplicate (productId, sortOrder) insertion rejected with PostgreSQL SQLSTATE 23505", async () => {
    const prodRes = await client.query(
      `SELECT id FROM "Product" WHERE name = 'Rehearsal Active Product' LIMIT 1`
    );
    assert.ok(prodRes.rows.length > 0);
    const activeId = prodRes.rows[0].id;

    let caughtError: { code?: string } | null = null;
    try {
      await client.query(
        'INSERT INTO "ProductImage" ("productId", url, "sortOrder", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())',
        [activeId, "/uploads/products/duplicate.jpg", 1]
      );
    } catch (err: unknown) {
      caughtError = err as { code?: string };
    }

    assert.ok(caughtError, "Expected duplicate insertion to throw error");
    assert.strictEqual(caughtError.code, "23505", "PostgreSQL error code must be 23505 (unique_violation)");

    // Verify session remains usable after error
    const aliveRes = await client.query("SELECT 1 AS alive");
    assert.strictEqual(aliveRes.rows[0]?.alive, 1, "Session must remain usable after caught unique violation");
  });

  it("8. Backfill SQL idempotency and repeated migrate deploy safety", async () => {
    const beforeCountRes = await client.query('SELECT count(*)::int AS count FROM "ProductImage"');
    const beforeCount = beforeCountRes.rows[0].count;

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
    assert.strictEqual(rerunResult.rowCount, 0, "Idempotent backfill SQL must insert 0 rows");

    const afterCountRes = await client.query('SELECT count(*)::int AS count FROM "ProductImage"');
    assert.strictEqual(afterCountRes.rows[0].count, beforeCount, "Total ProductImage count must remain unchanged");

    // Rerun prisma migrate deploy to prove idempotent no-pending migration result
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    const currentSchemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    const deployOutput = execFileSync(
      npxCmd,
      ["prisma", "migrate", "deploy", "--schema", currentSchemaPath],
      {
        env: { ...process.env, DATABASE_URL: disposableTestUrl },
        stdio: "pipe",
        shell: process.platform === "win32",
      }
    );
    assert.match(
      deployOutput.toString(),
      /No pending migrations to apply|applied/i,
      "Repeated migrate deploy must succeed cleanly"
    );
  });
});
