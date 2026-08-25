/**
 * Database Safety Gate (Wave F Integration)
 *
 * Enforces strict isolation between the normal application database (DATABASE_URL)
 * and the dedicated test database (DATABASE_URL_TEST).
 *
 * Invariants:
 *   - DATABASE_URL_TEST must exist.
 *   - DATABASE_URL must exist.
 *   - DATABASE_URL_TEST must NOT equal DATABASE_URL.
 *   - Credentials, passwords, and full connection strings are NEVER printed or logged.
 *   - Diagnostics provide only sanitized host category and classification.
 */

import "dotenv/config";

export interface DatabaseSafetyReport {

  safe: boolean;
  reason?: string;
  normalHostCategory?: string;
  testHostCategory?: string;
  isDistinct: boolean;
}

export function validateTestDatabaseSafety(): DatabaseSafetyReport {
  const normalUrl = process.env.DATABASE_URL;
  const testUrl = process.env.DATABASE_URL_TEST;

  if (!normalUrl) {
    return {
      safe: false,
      reason: "DATABASE_URL is missing.",
      isDistinct: false,
    };
  }

  if (!testUrl) {
    return {
      safe: false,
      reason: "DATABASE_URL_TEST is missing. Real concurrency integration testing requires a dedicated test database.",
      isDistinct: false,
    };
  }

  try {
    const parsedNormal = new URL(normalUrl);
    const parsedTest = new URL(testUrl);

    const normalHostCategory = parsedNormal.hostname.includes("neon.tech")
      ? "Neon Cloud PostgreSQL"
      : parsedNormal.hostname.includes("localhost") || parsedNormal.hostname === "127.0.0.1"
      ? "Local PostgreSQL"
      : "Remote PostgreSQL";

    const testHostCategory = parsedTest.hostname.includes("neon.tech")
      ? "Neon Cloud PostgreSQL (Test Branch)"
      : parsedTest.hostname.includes("localhost") || parsedTest.hostname === "127.0.0.1"
      ? "Local PostgreSQL (Test Container)"
      : "Remote PostgreSQL (Test DB)";

    // Compare normalized host and database name (pathname)
    const isSameHost = parsedNormal.hostname.toLowerCase() === parsedTest.hostname.toLowerCase();
    const isSameDb = parsedNormal.pathname.toLowerCase() === parsedTest.pathname.toLowerCase();

    if (isSameHost && isSameDb) {
      return {
        safe: false,
        reason: "DATABASE_URL_TEST points to the exact same host and database as DATABASE_URL. Substitution forbidden to prevent live data corruption.",
        normalHostCategory,
        testHostCategory,
        isDistinct: false,
      };
    }

    return {
      safe: true,
      normalHostCategory,
      testHostCategory,
      isDistinct: true,
    };
  } catch {
    return {
      safe: false,
      reason: "Failed to parse database connection URLs for safety validation.",
      isDistinct: false,
    };
  }
}
