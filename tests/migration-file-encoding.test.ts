import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration File Encoding Guard", () => {
  it("every migration.sql file must NOT start with a UTF-8 Byte Order Mark (0xEF 0xBB 0xBF)", () => {
    const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");
    assert.ok(fs.existsSync(migrationsRoot), `Migrations directory must exist at ${migrationsRoot}`);

    const entries = fs.readdirSync(migrationsRoot, { withFileTypes: true });
    const migrationDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    assert.ok(migrationDirs.length > 0, "At least one migration directory must exist");

    const bomViolations: { file: string; firstBytesHex: string }[] = [];

    for (const dir of migrationDirs) {
      const sqlPath = path.join(migrationsRoot, dir, "migration.sql");
      if (!fs.existsSync(sqlPath)) {
        continue;
      }

      const buf = fs.readFileSync(sqlPath);
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        const hex = Array.from(buf.subarray(0, 3))
          .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
          .join(" ");
        const relPath = path.relative(process.cwd(), sqlPath).replace(/\\/g, "/");
        bomViolations.push({ file: relPath, firstBytesHex: hex });
      }
    }

    assert.strictEqual(
      bomViolations.length,
      0,
      `UTF-8 BOM (EF BB BF) detected in migration files: ${JSON.stringify(bomViolations, null, 2)}`
    );
  });
});
