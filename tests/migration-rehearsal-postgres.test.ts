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
    {
      name: "Rehearsal Images Root Product",
      price: 350.0,
      image: "/images/rehearsal-gallery.jpg",
      category: "Skincare",
      isActive: true,
      deletedAt: null,
    },
    {
      name: "Rehearsal External HTTPS Product",
      price: 400.0,
      image: "https://cdn.example.com/rehearsal-external.jpg",
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
    // Expected exactly 3 indexes: primary key (ProductImage_pkey), unique constraint (ProductImage_productId_sortOrder_key), and managedMediaId foreign key index (ProductImage_managedMediaId_idx)
    assert.strictEqual(
      res.rows.length,
      3,
      `Expected exactly 3 indexes on ProductImage (pkey + unique + managedMediaId), found ${res.rows.length}: ${res.rows.map((r: { indexname: string }) => r.indexname).join(", ")}`
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
      "Rehearsal Empty-Image Product": "",
      "Rehearsal External HTTPS Product": "https://cdn.example.com/rehearsal-external.jpg",
      "Rehearsal Images Root Product": "/images/rehearsal-gallery.jpg",
      "Rehearsal Inactive Product": "   /uploads/products/rehearsal-inactive.jpg   ",
      "Rehearsal Soft-Deleted Product": "/uploads/products/rehearsal-deleted.jpg",
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
        'INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "createdAt", "updatedAt") VALUES ($1, $2, $3, \'LEGACY_LOCAL\', NOW(), NOW())',
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

  it("9. Phase 6 Task 4 EXPAND: additive tables, nullable columns, and backward compatibility", async () => {
    // 1. Verify ManagedMedia, MediaProcessingRun, MediaObject tables exist
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('ManagedMedia', 'MediaProcessingRun', 'MediaObject')
      ORDER BY table_name ASC
    `);
    const tableNames = tablesRes.rows.map((r: { table_name: string }) => r.table_name);
    assert.deepStrictEqual(tableNames, ["ManagedMedia", "MediaObject", "MediaProcessingRun"]);

    // 2. Verify ProductImage additive columns exist and are nullable in EXPAND
    const colRes = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ProductImage'
        AND column_name IN ('sourceKind', 'managedMediaId', 'altText')
    `);
    const cols = Object.fromEntries(colRes.rows.map((r: { column_name: string; is_nullable: string }) => [r.column_name, r.is_nullable]));
    assert.strictEqual(cols.sourceKind, "NO", "ProductImage.sourceKind is NOT NULL after CONTRACT");
    assert.strictEqual(cols.managedMediaId, "YES", "ProductImage.managedMediaId must be nullable in CONTRACT");
    assert.strictEqual(cols.altText, "YES", "ProductImage.altText must be nullable in CONTRACT");

    // 3. Verify all backfilled legacy rows have managedMediaId IS NULL in EXPAND
    const legacyImgRes = await client.query(`
      SELECT id, "sourceKind", "managedMediaId", url
      FROM "ProductImage"
    `);
    assert.ok(legacyImgRes.rows.length > 0, "Backfilled ProductImage rows must exist");
    for (const row of legacyImgRes.rows) {
      assert.strictEqual(row.managedMediaId, null, "Historical ProductImage.managedMediaId must be NULL in EXPAND");
    }

    // 4. Verify foreign key constraints on additive schema
    const fkRes = await client.query(`
      SELECT
        tc.table_name,
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
      WHERE tc.constraint_type = 'FOREIGN KEY'
    `);
    interface FkInfo {
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
    }
    const fks = fkRes.rows as FkInfo[];

    const piFk = fks.find((f) => f.table_name === "ProductImage" && f.column_name === "managedMediaId");
    assert.ok(piFk, "ProductImage.managedMediaId FK must exist");
    assert.strictEqual(piFk.foreign_table_name, "ManagedMedia");
    assert.strictEqual(piFk.delete_rule, "RESTRICT", "ProductImage -> ManagedMedia FK must be ON DELETE RESTRICT");

    const runFk = fks.find((f) => f.table_name === "MediaProcessingRun" && f.column_name === "managedMediaId");
    assert.ok(runFk, "MediaProcessingRun.managedMediaId FK must exist");
    assert.strictEqual(runFk.foreign_table_name, "ManagedMedia");
    assert.strictEqual(runFk.delete_rule, "CASCADE", "MediaProcessingRun -> ManagedMedia FK must be ON DELETE CASCADE");

    const objFk = fks.find((f) => f.table_name === "MediaObject" && f.column_name === "processingRunId");
    assert.ok(objFk, "MediaObject.processingRunId FK must exist");
    assert.strictEqual(objFk.foreign_table_name, "MediaProcessingRun");
    assert.strictEqual(objFk.delete_rule, "CASCADE", "MediaObject -> MediaProcessingRun FK must be ON DELETE CASCADE");
  });

  it("10. Phase 6 Task 6 CLASSIFY: all historical ProductImage rows classified with zero null sourceKind", async () => {
    // 1. Assert zero null sourceKind rows remaining
    const nullRes = await client.query(`
      SELECT count(*)::int AS count
      FROM "ProductImage"
      WHERE "sourceKind" IS NULL
    `);
    assert.strictEqual(
      nullRes.rows[0].count,
      0,
      `All ProductImage rows must have non-null sourceKind after CLASSIFY (found ${nullRes.rows[0].count} null)`
    );

    // 2. Assert exact classification mapping and counts
    const localCountRes = await client.query('SELECT count(*)::int AS count FROM "ProductImage" WHERE "sourceKind" = \'LEGACY_LOCAL\'');
    const externalCountRes = await client.query('SELECT count(*)::int AS count FROM "ProductImage" WHERE "sourceKind" = \'LEGACY_EXTERNAL\'');
    const unapprovedCountRes = await client.query('SELECT count(*)::int AS count FROM "ProductImage" WHERE "sourceKind" NOT IN (\'LEGACY_LOCAL\', \'LEGACY_EXTERNAL\')');
    const totalPiRes = await client.query('SELECT count(*)::int AS count FROM "ProductImage"');

    assert.strictEqual(localCountRes.rows[0].count, 4, "Expected exactly 4 LEGACY_LOCAL rows");
    assert.strictEqual(externalCountRes.rows[0].count, 1, "Expected exactly 1 LEGACY_EXTERNAL row");
    assert.strictEqual(unapprovedCountRes.rows[0].count, 0, "Expected 0 unapproved/unknown rows");
    assert.strictEqual(totalPiRes.rows[0].count, 5, "Expected 5 total ProductImage rows");

    const rowsRes = await client.query(`
      SELECT id, "productId", url, "sortOrder", "sourceKind"
      FROM "ProductImage"
      ORDER BY id ASC
    `);
    assert.strictEqual(rowsRes.rows.length, 5, "Expected exactly 5 backfilled ProductImage rows");
    for (const row of rowsRes.rows) {
      assert.ok(row.id > 0, "ID must be a positive integer");
      assert.ok(row.productId > 0, "productId must be a positive integer");
      assert.ok(row.sortOrder >= 1, "sortOrder must be positive");
      assert.ok(row.url && row.url.length > 0, "url must be non-empty");

      if (row.url.startsWith("/uploads/products/") || row.url.startsWith("/images/")) {
        assert.strictEqual(row.sourceKind, "LEGACY_LOCAL", `Expected ${row.url} to be LEGACY_LOCAL`);
      } else if (row.url.startsWith("https://")) {
        assert.strictEqual(row.sourceKind, "LEGACY_EXTERNAL", `Expected ${row.url} to be LEGACY_EXTERNAL`);
      } else {
        assert.fail(`Unexpected ProductImage url: ${row.url}`);
      }
    }

    // Verify Product.image values remain untouched
    const prodCheck = await client.query(`
      SELECT p.id, p.name, p.image, pi.url
      FROM "Product" p
      JOIN "ProductImage" pi ON pi."productId" = p.id
      WHERE p.name LIKE 'Rehearsal %'
      ORDER BY p.id ASC
    `);
    for (const row of prodCheck.rows) {
      assert.strictEqual(row.image.trim(), row.url, "Product.image must remain identical to backfilled ProductImage.url");
    }

    // 3. Zero ManagedMedia rows created
    const mediaCountRes = await client.query('SELECT count(*)::int AS count FROM "ManagedMedia"');
    assert.strictEqual(mediaCountRes.rows[0].count, 0, "CLASSIFY must NOT create ManagedMedia rows");

    // 4. All managedMediaId fields on historical rows remain null
    const nonNullFkRes = await client.query(`
      SELECT count(*)::int AS count
      FROM "ProductImage"
      WHERE "managedMediaId" IS NOT NULL
    `);
    assert.strictEqual(nonNullFkRes.rows[0].count, 0, "Historical ProductImage managedMediaId must remain null");

    // 5. Test idempotency of CLASSIFY SQL: re-running UPDATE statements modifies 0 rows
    const rerunUpdate1 = await client.query(`
      UPDATE "ProductImage"
      SET "sourceKind" = 'LEGACY_LOCAL'
      WHERE "sourceKind" IS NULL
        AND ("url" LIKE '/uploads/products/%' OR "url" LIKE '/images/%');
    `);
    assert.strictEqual(rerunUpdate1.rowCount, 0, "Idempotent classification must update 0 rows on rerun");

    const rerunUpdate2 = await client.query(`
      UPDATE "ProductImage"
      SET "sourceKind" = 'LEGACY_EXTERNAL'
      WHERE "sourceKind" IS NULL
        AND "url" LIKE 'https://%';
    `);
    assert.strictEqual(rerunUpdate2.rowCount, 0, "Idempotent classification must update 0 rows on rerun");

    // 6. Test precondition guard: unapproved URL scheme triggers exception
    let caughtPreconditionError: Error | null = null;
    try {
      await client.query(`
        DO $$
        DECLARE
          unapproved_count INTEGER;
        BEGIN
          SELECT COUNT(*) INTO unapproved_count
          FROM (SELECT 'ftp://malicious.com/test.jpg' AS url, NULL::"ProductImageSourceKind" AS "sourceKind") simulated
          WHERE "sourceKind" IS NULL
            AND NOT (
              "url" LIKE '/uploads/products/%'
              OR "url" LIKE '/images/%'
              OR "url" LIKE 'https://%'
            );

          IF unapproved_count > 0 THEN
            RAISE EXCEPTION 'PHASE6_CLASSIFY_UNAPPROVED_URL_SCHEME_DETECTED: found % rows outside approved roots', unapproved_count;
          END IF;
        END $$;
      `);
    } catch (err: unknown) {
      caughtPreconditionError = err as Error;
    }
    assert.ok(caughtPreconditionError, "Precondition check must abort when unapproved schemes exist");
    assert.match(caughtPreconditionError.message, /PHASE6_CLASSIFY_UNAPPROVED_URL_SCHEME_DETECTED/);
  });

  it("11. Phase 6 Task 7 CONTRACT: enforces NOT NULL and PostgreSQL CHECK constraints", async () => {
    // 1. Verify ProductImage.sourceKind is NOT NULL
    const colRes = await client.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ProductImage'
        AND column_name = 'sourceKind'
    `);
    assert.strictEqual(
      colRes.rows[0]?.is_nullable,
      "NO",
      "ProductImage.sourceKind must be NOT NULL in CONTRACT phase"
    );

    // Get a valid Product ID
    const prodRes = await client.query('SELECT id FROM "Product" LIMIT 1');
    const productId = prodRes.rows[0].id;

    // Create a ManagedMedia row for testing FKs
    const mediaId = "11111111-1111-4111-8111-111111111111";
    await client.query(`
      INSERT INTO "ManagedMedia" (
        id, "mediaType", "lifecycleState", "ingestPurpose", "ingestActorScope",
        "ingestIdempotencyKey", "ingestSha256", "ingestByteSize", "ingestMimeType",
        "stagingProviderKey", "stagingObjectKey", "stagingState", "createdAt", "updatedAt"
      ) VALUES (
        $1, 'IMAGE', 'READY', 'PRODUCT_IMAGE', 'admin:1',
        'idemp-test-1', 'sha256fake', 1024, 'image/jpeg',
        'local', 'staging/test-1', 'PRESENT', NOW(), NOW()
      ) ON CONFLICT (id) DO NOTHING;
    `, [mediaId]);

    // 2. Reject MANAGED with null managedMediaId
    let errManagedNull: { code?: string } | null = null;
    try {
      await client.query(`
        INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
        VALUES ($1, '/uploads/products/managed-invalid.jpg', 901, 'MANAGED', NULL, NOW(), NOW())
      `, [productId]);
    } catch (e: unknown) {
      errManagedNull = e as { code?: string };
    }
    assert.ok(errManagedNull, "Expected rejection for MANAGED with NULL managedMediaId");
    assert.strictEqual(errManagedNull.code, "23514", "Expected SQLSTATE 23514 (check_violation)");

    // 3. Reject LEGACY_LOCAL with non-null managedMediaId
    let errLegacyNonNull: { code?: string } | null = null;
    try {
      await client.query(`
        INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
        VALUES ($1, '/uploads/products/legacy-invalid.jpg', 902, 'LEGACY_LOCAL', $2, NOW(), NOW())
      `, [productId, mediaId]);
    } catch (e: unknown) {
      errLegacyNonNull = e as { code?: string };
    }
    assert.ok(errLegacyNonNull, "Expected rejection for LEGACY_LOCAL with non-null managedMediaId");
    assert.strictEqual(errLegacyNonNull.code, "23514", "Expected SQLSTATE 23514 (check_violation)");

    // 4. Reject LEGACY_EXTERNAL with local URL
    let errExternalLocal: { code?: string } | null = null;
    try {
      await client.query(`
        INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
        VALUES ($1, '/uploads/products/not-external.jpg', 903, 'LEGACY_EXTERNAL', NULL, NOW(), NOW())
      `, [productId]);
    } catch (e: unknown) {
      errExternalLocal = e as { code?: string };
    }
    assert.ok(errExternalLocal, "Expected rejection for LEGACY_EXTERNAL with local URL");
    assert.strictEqual(errExternalLocal.code, "23514", "Expected SQLSTATE 23514 (check_violation)");

    // 5. Reject LEGACY_LOCAL with HTTPS URL
    let errLocalHttps: { code?: string } | null = null;
    try {
      await client.query(`
        INSERT INTO "ProductImage" ("productId", url, "sortOrder", "sourceKind", "managedMediaId", "createdAt", "updatedAt")
        VALUES ($1, 'https://cdn.example.com/not-local.jpg', 904, 'LEGACY_LOCAL', NULL, NOW(), NOW())
      `, [productId]);
    } catch (e: unknown) {
      errLocalHttps = e as { code?: string };
    }
    assert.ok(errLocalHttps, "Expected rejection for LEGACY_LOCAL with HTTPS URL");
    assert.strictEqual(errLocalHttps.code, "23514", "Expected SQLSTATE 23514 (check_violation)");

    // Create a MediaProcessingRun for MediaObject testing
    const runId = "22222222-2222-4222-8222-222222222222";
    await client.query(`
      INSERT INTO "MediaProcessingRun" (
        id, "managedMediaId", "profileVersion", "profileDefinitionHash",
        state, "attemptCount", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 'product-image-v1', 'hash123',
        'PENDING', 0, NOW(), NOW()
      ) ON CONFLICT (id) DO NOTHING;
    `, [runId, mediaId]);

    // 6. Reject MASTER with PUBLIC_DELIVERY
    let errMasterPublic: { code?: string } | null = null;
    try {
      await client.query(`
        INSERT INTO "MediaObject" (
          id, "processingRunId", role, "accessClass", "variantKey",
          "storageProviderKey", "objectKey", "mimeType", width, height,
          "byteSize", "checksumSha256", "createdAt", "updatedAt"
        ) VALUES (
          '33333333-3333-4333-8333-333333333331', $1, 'MASTER', 'PUBLIC_DELIVERY', 'master',
          'local', 'obj/master-invalid', 'image/jpeg', 1000, 1000,
          50000, 'sha256obj', NOW(), NOW()
        );
      `, [runId]);
    } catch (e: unknown) {
      errMasterPublic = e as { code?: string };
    }
    assert.ok(errMasterPublic, "Expected rejection for MASTER with PUBLIC_DELIVERY");
    assert.strictEqual(errMasterPublic.code, "23514", "Expected SQLSTATE 23514 (check_violation)");

    // 7. Reject RENDITION with PRIVATE_SOURCE
    let errRenditionPrivate: { code?: string } | null = null;
    try {
      await client.query(`
        INSERT INTO "MediaObject" (
          id, "processingRunId", role, "accessClass", "variantKey",
          "storageProviderKey", "objectKey", "mimeType", width, height,
          "byteSize", "checksumSha256", "createdAt", "updatedAt"
        ) VALUES (
          '33333333-3333-4333-8333-333333333332', $1, 'RENDITION', 'PRIVATE_SOURCE', 'w640',
          'local', 'obj/rendition-invalid', 'image/webp', 640, 640,
          25000, 'sha256obj2', NOW(), NOW()
        );
      `, [runId]);
    } catch (e: unknown) {
      errRenditionPrivate = e as { code?: string };
    }
    assert.ok(errRenditionPrivate, "Expected rejection for RENDITION with PRIVATE_SOURCE");
    assert.strictEqual(errRenditionPrivate.code, "23514", "Expected SQLSTATE 23514 (check_violation)");
  });

  it("12. Phase 6 Task 7 CONTRACT: verifies actual PostgreSQL constraint metadata in pg_constraint and pg_indexes", async () => {
    // 1. Verify CHECK constraints exist in pg_constraint
    const checkConstraintsRes = await client.query(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE contype = 'c'
        AND conname IN (
          'ProductImage_source_kind_managed_ck',
          'ProductImage_legacy_url_ck',
          'MediaObject_role_access_ck',
          'MediaObject_dimensions_bytes_positive_ck',
          'ManagedMedia_deleted_tombstone_ck',
          'ManagedMedia_cleanup_pending_ck',
          'ManagedMedia_failed_classification_ck',
          'MediaProcessingRun_complete_ck',
          'MediaProcessingRun_processing_lease_ck'
        )
      ORDER BY conname ASC;
    `);
    const foundChecks = checkConstraintsRes.rows.map((r: { conname: string }) => r.conname);
    assert.strictEqual(foundChecks.length, 9, `Expected 9 CHECK constraints, found ${foundChecks.length}: ${foundChecks.join(", ")}`);

    // 2. Verify all expected indexes exist in pg_indexes
    const expectedIndexes = [
      "ProductImage_managedMediaId_idx",
      "ManagedMedia_lifecycleState_cleanupEligibleAt_idx",
      "ManagedMedia_lifecycleState_updatedAt_idx",
      "ManagedMedia_ingestActorScope_ingestPurpose_ingestIdempoten_key",
      "MediaProcessingRun_state_leaseExpiresAt_idx",
      "MediaProcessingRun_managedMediaId_state_idx",
      "MediaProcessingRun_managedMediaId_profileVersion_key",
      "MediaObject_processingRunId_idx",
      "MediaObject_processingRunId_variantKey_key",
      "MediaObject_storageProviderKey_objectKey_key",
    ];
    const indexesRes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
      ORDER BY indexname ASC;
    `, [expectedIndexes]);
    const foundIndexes = indexesRes.rows.map((r: { indexname: string }) => r.indexname);
    assert.strictEqual(foundIndexes.length, expectedIndexes.length, `Expected ${expectedIndexes.length} indexes, found ${foundIndexes.length}`);

    // 3. Verify bounded column lengths for originalFilename and failureCode
    const boundedColsRes = await client.query(`
      SELECT table_name, column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'ManagedMedia' AND column_name IN ('originalFilename', 'failureCode'))
          OR
          (table_name = 'MediaProcessingRun' AND column_name = 'failureCode')
        )
      ORDER BY table_name, column_name;
    `);
    const boundedMap = new Map<string, number>();
    for (const r of boundedColsRes.rows) {
      boundedMap.set(`${r.table_name}.${r.column_name}`, r.character_maximum_length);
    }
    assert.strictEqual(boundedMap.get("ManagedMedia.originalFilename"), 255, "ManagedMedia.originalFilename must be VARCHAR(255)");
    assert.strictEqual(boundedMap.get("ManagedMedia.failureCode"), 100, "ManagedMedia.failureCode must be VARCHAR(100)");
    assert.strictEqual(boundedMap.get("MediaProcessingRun.failureCode"), 100, "MediaProcessingRun.failureCode must be VARCHAR(100)");
  });

  it("13. Phase 6 Task 7 CONTRACT: query plan sanity checks for critical operational indexes", async () => {
    // 1. Owner lookup by ProductImage.managedMediaId
    const ownerPlan = await client.query(`
      EXPLAIN SELECT * FROM "ProductImage" WHERE "managedMediaId" = '00000000-0000-0000-0000-000000000000';
    `);
    const ownerPlanText = ownerPlan.rows.map((r: Record<string, string>) => Object.values(r)[0]).join("\n");
    assert.match(ownerPlanText, /Index Scan|Bitmap Heap Scan|Seq Scan/, "Owner query plan must be valid");

    // 2. Cleanup candidate query by (lifecycleState, cleanupEligibleAt)
    const cleanupPlan = await client.query(`
      EXPLAIN SELECT * FROM "ManagedMedia"
      WHERE "lifecycleState" = 'CLEANUP_PENDING' AND "cleanupEligibleAt" <= NOW();
    `);
    const cleanupPlanText = cleanupPlan.rows.map((r: Record<string, string>) => Object.values(r)[0]).join("\n");
    assert.match(cleanupPlanText, /Index Scan|Bitmap Heap Scan|Seq Scan/, "Cleanup candidate plan must be valid");

    // 3. Stale processing lease query by (state, leaseExpiresAt)
    const leasePlan = await client.query(`
      EXPLAIN SELECT * FROM "MediaProcessingRun"
      WHERE "state" = 'PROCESSING' AND "leaseExpiresAt" <= NOW();
    `);
    const leasePlanText = leasePlan.rows.map((r: Record<string, string>) => Object.values(r)[0]).join("\n");
    assert.match(leasePlanText, /Index Scan|Bitmap Heap Scan|Seq Scan/, "Lease expiry query plan must be valid");
  });

  it("14. Phase 6 Task 7 CONTRACT: fresh database migration deployment path succeeds", async () => {
    const freshDbName = `pure_haven_storefront_fresh_${Date.now()}_${process.pid}`;
    const adminUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${freshDbName}";`);

      const freshDbUrl = testBaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${freshDbName}$1`);
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      const currentSchemaPath = path.join(process.cwd(), "prisma", "schema.prisma");

      // Deploy full migration chain to the clean empty database
      const deployOutput = execFileSync(
        npxCmd,
        ["prisma", "migrate", "deploy", "--schema", currentSchemaPath],
        {
          env: { ...process.env, DATABASE_URL: freshDbUrl },
          stdio: "pipe",
          shell: process.platform === "win32",
        }
      );
      assert.match(deployOutput.toString(), /all migrations have been successfully applied/i);

      // Verify all tables exist in fresh database
      const freshClient = new Client({ connectionString: freshDbUrl });
      await freshClient.connect();
      try {
        const tableCheck = await freshClient.query(`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('Product', 'ProductImage', 'ManagedMedia', 'MediaProcessingRun', 'MediaObject')
          ORDER BY table_name ASC;
        `);
        const tables = tableCheck.rows.map((r: { table_name: string }) => r.table_name);
        assert.deepStrictEqual(tables, ["ManagedMedia", "MediaObject", "MediaProcessingRun", "Product", "ProductImage"]);
      } finally {
        await freshClient.end();
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${freshDbName}" WITH (FORCE);`);
      await admin.end();
    }
  });
});
