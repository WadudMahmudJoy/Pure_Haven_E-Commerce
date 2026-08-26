/**
 * Customer Authentication & Normalization Foundation (Phase 3)
 *
 * Authoritative implementation compliant with:
 * docs/superpowers/specs/2026-08-26-phase3-customer-authentication-design.md
 */

import crypto from "node:crypto";

function asyncScrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}


export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;
export const SCRYPT_SALT_BYTES = 16;

export const CUSTOMER_PASSWORD_MIN_LENGTH = 8;
export const CUSTOMER_PASSWORD_MAX_LENGTH = 128;

export type ParsedIdentifier =
  | { type: "EMAIL"; value: string }
  | { type: "PHONE"; value: string }
  | { type: "INVALID" };

/**
 * Strict Email Normalization
 * - Trims outer whitespace
 * - Lowercases entire string
 * - Preserves dots, plus-sub-addressing, and provider semantics
 * - Rejects invalid RFC 5322 syntax or strings > 255 chars
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 255) return null;

  const email = trimmed.toLowerCase();
  // Standard RFC 5322 practical regex
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(email)) return null;

  return email;
}

/**
 * Strict Bangladesh Phone Parser & Normalization
 * - Valid operator prefixes: 013, 014, 015, 016, 017, 018, 019
 * - Accepted semantic input forms:
 *     01[3-9]\d{8} (11 digits)
 *     8801[3-9]\d{8} (13 digits)
 *     +8801[3-9]\d{8} (14 chars)
 * - Strips permitted presentation punctuation (whitespace, hyphens, parentheses)
 * - Returns canonical 11-digit representation: 01XXXXXXXXX
 * - Strictly rejects letters, wrong operator/country codes, extra/too few digits, embedded text
 */
export function parseAndNormalizePhone(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Validate that input consists strictly of allowed phone characters
  if (!/^[+\d\s\-()]+$/.test(trimmed)) {
    return null;
  }

  // Strip allowed presentation punctuation
  const clean = trimmed.replace(/[\s\-()]/g, "");

  // Pattern 1: +8801[3-9]\d{8}
  if (/^\+8801[3-9]\d{8}$/.test(clean)) {
    return clean.slice(3); // Returns 01XXXXXXXXX
  }

  // Pattern 2: 8801[3-9]\d{8}
  if (/^8801[3-9]\d{8}$/.test(clean)) {
    return clean.slice(2); // Returns 01XXXXXXXXX
  }

  // Pattern 3: 01[3-9]\d{8}
  if (/^01[3-9]\d{8}$/.test(clean)) {
    return clean;
  }

  return null; // Strict rejection
}

/**
 * Deterministic Unified-Login Identifier Classifier
 */
export function classifyIdentifier(raw: string | null | undefined): ParsedIdentifier {
  if (!raw || typeof raw !== "string") return { type: "INVALID" };

  const trimmed = raw.trim();
  if (!trimmed) return { type: "INVALID" };

  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    if (email) {
      return { type: "EMAIL", value: email };
    }
    return { type: "INVALID" };
  }

  const phone = parseAndNormalizePhone(trimmed);
  if (phone) {
    return { type: "PHONE", value: phone };
  }

  return { type: "INVALID" };
}

/**
 * Asynchronous Node.js scrypt Password Hashing
 * - Enforces 8 to 128 character bounds
 * - Never trims or modifies password characters
 * - Serialized format: scrypt$N=16384,r=8,p=1$<saltHex>$<derivedKeyHex>
 */
export async function hashCustomerPassword(password: string): Promise<string> {
  if (
    typeof password !== "string" ||
    password.length < CUSTOMER_PASSWORD_MIN_LENGTH ||
    password.length > CUSTOMER_PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `Password must be between ${CUSTOMER_PASSWORD_MIN_LENGTH} and ${CUSTOMER_PASSWORD_MAX_LENGTH} characters.`
    );
  }

  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const derivedKey = await asyncScrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  });

  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

/**
 * Constant-Time Customer Password Verification
 */
export async function verifyCustomerPassword(
  password: string,
  serializedHash: string
): Promise<boolean> {
  if (!password || !serializedHash || typeof serializedHash !== "string") {
    return false;
  }

  if (!serializedHash.startsWith("scrypt$")) {
    return false;
  }

  const parts = serializedHash.split("$");
  if (parts.length !== 4) {
    return false;
  }

  const [, paramsStr, saltHex, expectedKeyHex] = parts;
  if (!paramsStr || !saltHex || !expectedKeyHex) {
    return false;
  }

  // Parse parameters
  let N = SCRYPT_N;
  let r = SCRYPT_R;
  let p = SCRYPT_P;

  try {
    const paramPairs = paramsStr.split(",");
    for (const pair of paramPairs) {
      const [k, v] = pair.split("=");
      if (k === "N") N = parseInt(v, 10);
      if (k === "r") r = parseInt(v, 10);
      if (k === "p") p = parseInt(v, 10);
    }
  } catch {
    return false;
  }

  try {
    const salt = Buffer.from(saltHex, "hex");
    const expectedKey = Buffer.from(expectedKeyHex, "hex");

    if (salt.length !== SCRYPT_SALT_BYTES || expectedKey.length !== SCRYPT_KEYLEN) {
      return false;
    }

    const derivedKey = await asyncScrypt(password, salt, expectedKey.length, {
      N,
      r,
      p,
      maxmem: 32 * 1024 * 1024,
    });

    return (
      derivedKey.length === expectedKey.length &&
      crypto.timingSafeEqual(derivedKey, expectedKey)
    );
  } catch {
    return false;
  }
}

/**
 * Generates an opaque 256-bit CSPRNG token (Base64URL) and its SHA-256 hash.
 */
export function generateOpaqueAuthToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashOpaqueAuthToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Computes deterministic SHA-256 hash of an opaque raw token for database storage.
 */
export function hashOpaqueAuthToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
