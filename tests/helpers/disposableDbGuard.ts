import "dotenv/config";
import pg from "pg";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "node:fs";
import * as path from "node:path";

export type RedactedLocalDbTarget = Readonly<{
  host: string;
  port: number;
  database: string;
  ssl: boolean;
}>;

export type LocalDisposableDatabaseContext = Readonly<{
  url: string;
  redacted: RedactedLocalDbTarget;
  createClient: () => pg.Client;
  createPrisma: () => PrismaClient;
  ensurePhase6Schema: () => Promise<void>;
}>;

export function verifyAndGetLocalDisposableDatabase(): LocalDisposableDatabaseContext {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl || testUrl.trim() === "") {
    throw new Error("LOCAL_DB_URL_MISSING: DATABASE_URL_TEST is not set in environment or .env");
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch (err: unknown) {
    throw new Error(`LOCAL_DB_URL_INVALID: ${(err as Error).message}`);
  }

  if (parsed.hostname.includes("neon.tech") || parsed.hostname.includes("aws")) {
    throw new Error(`NON_LOCAL_DB_TARGET_BLOCKED: DATABASE_URL_TEST targets cloud host '${parsed.hostname}'`);
  }

  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error(`NON_LOCAL_DB_TARGET_BLOCKED: Host '${parsed.hostname}' is not local`);
  }

  const port = parseInt(parsed.port, 10);
  if (port !== 55439) {
    throw new Error(`UNEXPECTED_LOCAL_DB_PORT: Port ${port} does not match expected local test port 55439`);
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database || database === "postgres") {
    throw new Error(`UNEXPECTED_LOCAL_DB_NAME: Database '${database}' is invalid for disposable tests`);
  }

  const redacted: RedactedLocalDbTarget = {
    host: parsed.hostname,
    port,
    database,
    ssl: parsed.searchParams.get("sslmode") === "require",
  };

  // Only assign process.env.DATABASE_URL AFTER strict local verification
  process.env.DATABASE_URL = testUrl;

  const createClient = () =>
    new pg.Client({
      connectionString: testUrl,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });

  const createPrisma = () => {
    const adapter = new PrismaPg({ connectionString: testUrl });
    return new PrismaClient({ adapter });
  };

  const ensurePhase6Schema = async () => {
    const client = createClient();
    await client.connect();
    try {
      const tableCheck = await client.query(`
        SELECT COUNT(*)::int AS c
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ManagedMedia';
      `);
      if (tableCheck.rows[0].c > 0) {
        return; // Schema already applied
      }

      const migrationDirs = [
        "20260905010000_phase6_media_expand",
        "20260905020000_phase6_product_image_classification",
        "20260905030000_phase6_media_contract",
        "20260905030100_phase6_bounded_columns",
        "20260905030200_phase6_persistence_contract_corrections",
      ];

      for (const dir of migrationDirs) {
        const sqlPath = path.join(process.cwd(), "prisma", "migrations", dir, "migration.sql");
        const sql = fs.readFileSync(sqlPath, "utf8");
        await client.query(sql);
      }
    } finally {
      await client.end();
    }
  };

  return {
    url: testUrl,
    redacted,
    createClient,
    createPrisma,
    ensurePhase6Schema,
  };
}
