import { describe, it } from "node:test";
import assert from "node:assert";
import { validateTestDatabaseSafety } from "./db-safety";

describe("Wave F — Hard Test Database Safety Gate", () => {
  it("SAFETY GATE — Blocks execution when DATABASE_URL_TEST is missing", () => {
    const originalNormal = process.env.DATABASE_URL;
    const originalTest = process.env.DATABASE_URL_TEST;

    process.env.DATABASE_URL = "postgresql://user:secret@ep-live-123.neon.tech/neondb?sslmode=require";
    delete process.env.DATABASE_URL_TEST;

    try {
      const report = validateTestDatabaseSafety();
      assert.strictEqual(report.safe, false);
      assert.strictEqual(report.isDistinct, false);
      assert.ok(report.reason?.includes("DATABASE_URL_TEST is missing"));
    } finally {
      process.env.DATABASE_URL = originalNormal;
      if (originalTest) process.env.DATABASE_URL_TEST = originalTest;
    }
  });

  it("SAFETY GATE — Blocks execution when DATABASE_URL_TEST equals DATABASE_URL", () => {
    const originalNormal = process.env.DATABASE_URL;
    const originalTest = process.env.DATABASE_URL_TEST;

    const liveUrl = "postgresql://user:secret@ep-live-123.neon.tech/neondb?sslmode=require";
    process.env.DATABASE_URL = liveUrl;
    process.env.DATABASE_URL_TEST = liveUrl;

    try {
      const report = validateTestDatabaseSafety();
      assert.strictEqual(report.safe, false);
      assert.strictEqual(report.isDistinct, false);
      assert.ok(report.reason?.includes("exact same host and database"));
    } finally {
      process.env.DATABASE_URL = originalNormal;
      if (originalTest) process.env.DATABASE_URL_TEST = originalTest;
      else delete process.env.DATABASE_URL_TEST;
    }
  });

  it("SAFETY GATE — Approves execution when DATABASE_URL_TEST is a distinct test database", () => {
    const originalNormal = process.env.DATABASE_URL;
    const originalTest = process.env.DATABASE_URL_TEST;

    process.env.DATABASE_URL = "postgresql://user:secret@ep-live-123.neon.tech/neondb?sslmode=require";
    process.env.DATABASE_URL_TEST = "postgresql://user:testsecret@ep-test-456.neon.tech/testdb?sslmode=require";

    try {
      const report = validateTestDatabaseSafety();
      assert.strictEqual(report.safe, true);
      assert.strictEqual(report.isDistinct, true);
      assert.strictEqual(report.normalHostCategory, "Neon Cloud PostgreSQL");
      assert.strictEqual(report.testHostCategory, "Neon Cloud PostgreSQL (Test Branch)");
    } finally {
      process.env.DATABASE_URL = originalNormal;
      if (originalTest) process.env.DATABASE_URL_TEST = originalTest;
      else delete process.env.DATABASE_URL_TEST;
    }
  });
});
