/**
 * Behavioral Unit Tests — Customer Crypto & Normalization Foundation (Wave A)
 *
 * Requirements from Authoritative Design:
 *   1. Email Normalization (trim, lowercase, dot/plus preservation, syntax rejection)
 *   2. Strict Bangladesh Phone Parser (01[3-9]\d{8}, 8801[3-9]\d{8}, +8801[3-9]\d{8}, formatting stripped, strict rejections)
 *   3. Deterministic Identifier Classifier (EMAIL vs PHONE vs INVALID)
 *   4. Asynchronous scrypt Hashing & Constant-Time Verification (N=16384, r=8, p=1, 8-128 chars bounds, no trimming)
 *   5. Opaque 256-bit CSPRNG Token Generation & SHA-256 Hashing
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  parseAndNormalizePhone,
  classifyIdentifier,
  hashCustomerPassword,
  verifyCustomerPassword,
  generateOpaqueAuthToken,
  hashOpaqueAuthToken,
} from "../lib/customerAuth.js";

describe("Wave A — Customer Crypto & Normalization Foundation", () => {
  // ===========================================================================
  // 1. Strict Email Normalization
  // ===========================================================================
  describe("1. Strict Email Normalization", () => {
    it("lowercases and trims outer whitespace from valid emails", () => {
      assert.strictEqual(
        normalizeEmail("  Customer.User@Example.COM  "),
        "customer.user@example.com"
      );
    });

    it("preserves plus aliases and dots without provider-specific mutation", () => {
      assert.strictEqual(
        normalizeEmail("john.doe+promo123@gmail.com"),
        "john.doe+promo123@gmail.com"
      );
      assert.strictEqual(
        normalizeEmail("J.O.H.N.D.O.E+tag@domain.co.uk"),
        "j.o.h.n.d.o.e+tag@domain.co.uk"
      );
    });

    it("rejects invalid email syntax with null", () => {
      assert.strictEqual(normalizeEmail(""), null);
      assert.strictEqual(normalizeEmail("   "), null);
      assert.strictEqual(normalizeEmail("plainaddress"), null);
      assert.strictEqual(normalizeEmail("@missing-user.com"), null);
      assert.strictEqual(normalizeEmail("user@missing-domain"), null);
      assert.strictEqual(normalizeEmail("user@.com"), null);
      assert.strictEqual(normalizeEmail("user with spaces@domain.com"), null);
      assert.strictEqual(normalizeEmail("a".repeat(250) + "@domain.com"), null); // Exceeds 255 chars
    });
  });

  // ===========================================================================
  // 2. Strict Bangladesh Phone Parser
  // ===========================================================================
  describe("2. Strict Bangladesh Phone Parser", () => {
    it("accepts canonical 11-digit local format for all valid BD operator prefixes", () => {
      const prefixes = ["013", "014", "015", "016", "017", "018", "019"];
      for (const prefix of prefixes) {
        const number = `${prefix}12345678`;
        assert.strictEqual(parseAndNormalizePhone(number), number);
      }
    });

    it("normalizes international formats (8801XXXXXXXXX and +8801XXXXXXXXX) to canonical 01XXXXXXXXX", () => {
      assert.strictEqual(
        parseAndNormalizePhone("8801711223344"),
        "01711223344"
      );
      assert.strictEqual(
        parseAndNormalizePhone("+8801811223344"),
        "01811223344"
      );
      assert.strictEqual(
        parseAndNormalizePhone("+8801912345678"),
        "01912345678"
      );
    });

    it("strips permitted presentation characters (spaces, hyphens, parentheses) when semantic sequence is intact", () => {
      assert.strictEqual(
        parseAndNormalizePhone("017-11 22 33 44"),
        "01711223344"
      );
      assert.strictEqual(
        parseAndNormalizePhone("+880 (1711) 22-33-44"),
        "01711223344"
      );
      assert.strictEqual(
        parseAndNormalizePhone("880 1811 223344"),
        "01811223344"
      );
    });

    it("strictly rejects invalid operator prefixes, extra digits, letters, and embedded text", () => {
      // Invalid operator prefixes
      assert.strictEqual(parseAndNormalizePhone("01011223344"), null);
      assert.strictEqual(parseAndNormalizePhone("01111223344"), null);
      assert.strictEqual(parseAndNormalizePhone("01211223344"), null);

      // Wrong country codes
      assert.strictEqual(parseAndNormalizePhone("+101711223344"), null);
      assert.strictEqual(parseAndNormalizePhone("+9101711223344"), null);

      // Extra digits / too few digits
      assert.strictEqual(parseAndNormalizePhone("017112233445"), null); // 12 digits
      assert.strictEqual(parseAndNormalizePhone("+88017112233445"), null); // 15 chars
      assert.strictEqual(parseAndNormalizePhone("0171122334"), null); // 10 digits

      // Letters and embedded text (must NOT extract phone from arbitrary text)
      assert.strictEqual(parseAndNormalizePhone("0171122334a"), null);
      assert.strictEqual(parseAndNormalizePhone("call me at 01711223344"), null);
      assert.strictEqual(parseAndNormalizePhone("01711223344 please"), null);
      assert.strictEqual(parseAndNormalizePhone(""), null);
    });
  });

  // ===========================================================================
  // 3. Deterministic Identifier Classifier
  // ===========================================================================
  describe("3. Deterministic Identifier Classifier", () => {
    it("classifies valid email candidates as EMAIL", () => {
      assert.deepStrictEqual(classifyIdentifier("  User@Example.COM  "), {
        type: "EMAIL",
        value: "user@example.com",
      });
      assert.deepStrictEqual(classifyIdentifier("buyer+promo@sub.domain.org"), {
        type: "EMAIL",
        value: "buyer+promo@sub.domain.org",
      });
    });

    it("classifies valid Bangladesh phone numbers as PHONE", () => {
      assert.deepStrictEqual(classifyIdentifier("  +8801711-223344  "), {
        type: "PHONE",
        value: "01711223344",
      });
      assert.deepStrictEqual(classifyIdentifier("01811223344"), {
        type: "PHONE",
        value: "01811223344",
      });
    });

    it("classifies invalid or ambiguous inputs as INVALID", () => {
      assert.deepStrictEqual(classifyIdentifier(""), { type: "INVALID" });
      assert.deepStrictEqual(classifyIdentifier("random_string"), {
        type: "INVALID",
      });
      assert.deepStrictEqual(classifyIdentifier("invalid@"), {
        type: "INVALID",
      });
      assert.deepStrictEqual(classifyIdentifier("01011223344"), {
        type: "INVALID",
      });
    });
  });

  // ===========================================================================
  // 4. Asynchronous scrypt Hashing & Constant-Time Verification
  // ===========================================================================
  describe("4. Asynchronous scrypt Hashing & Verification", () => {
    it("enforces password length bounds (8 to 128 characters) and preserves spaces", async () => {
      // Below minimum (< 8)
      await assert.rejects(
        () => hashCustomerPassword("1234567"),
        /Password must be between 8 and 128 characters/
      );

      // Above maximum (> 128)
      await assert.rejects(
        () => hashCustomerPassword("a".repeat(129)),
        /Password must be between 8 and 128 characters/
      );

      // Valid boundary lengths (8 and 128 chars)
      const hash8 = await hashCustomerPassword("12345678");
      assert.ok(hash8.startsWith("scrypt$N=16384,r=8,p=1$"));

      const hash128 = await hashCustomerPassword("x".repeat(128));
      assert.ok(hash128.startsWith("scrypt$N=16384,r=8,p=1$"));

      // Preserves leading/trailing spaces (passwords are never trimmed)
      const spacedPass = "  secret passphrase with spaces  ";
      const hashSpaced = await hashCustomerPassword(spacedPass);
      assert.strictEqual(
        await verifyCustomerPassword(spacedPass, hashSpaced),
        true
      );
      assert.strictEqual(
        await verifyCustomerPassword(spacedPass.trim(), hashSpaced),
        false
      );
    });

    it("verifies correct password and rejects incorrect password", async () => {
      const password = "SuperSecretSecurePassword!2026";
      const hash = await hashCustomerPassword(password);

      assert.strictEqual(await verifyCustomerPassword(password, hash), true);
      assert.strictEqual(
        await verifyCustomerPassword("WrongPassword123", hash),
        false
      );
      assert.strictEqual(
        await verifyCustomerPassword(password.toLowerCase(), hash),
        false
      );
    });

    it("safely rejects malformed hash strings without throwing unhandled exceptions", async () => {
      assert.strictEqual(
        await verifyCustomerPassword("password123", "invalid-hash-string"),
        false
      );
      assert.strictEqual(
        await verifyCustomerPassword("password123", "scrypt$invalid$format"),
        false
      );
      assert.strictEqual(
        await verifyCustomerPassword("password123", ""),
        false
      );
    });
  });

  // ===========================================================================
  // 5. Opaque 256-Bit Token Generation & SHA-256 Hashing
  // ===========================================================================
  describe("5. Opaque Token Generation & Hashing", () => {
    it("generates 256-bit CSPRNG Base64URL raw tokens and deterministic SHA-256 hashes", () => {
      const { rawToken, tokenHash } = generateOpaqueAuthToken();

      assert.ok(rawToken.length >= 43, "Raw token must be at least 43 chars (256 bits Base64URL)");
      assert.ok(/^[A-Za-z0-9_-]+$/.test(rawToken), "Raw token must be URL-safe");
      assert.strictEqual(tokenHash.length, 64, "SHA-256 hash must be 64 hex characters");

      // Deterministic hash function check
      assert.strictEqual(hashOpaqueAuthToken(rawToken), tokenHash);

      // Distinct calls produce distinct tokens
      const second = generateOpaqueAuthToken();
      assert.notStrictEqual(rawToken, second.rawToken);
      assert.notStrictEqual(tokenHash, second.tokenHash);
    });
  });
});
