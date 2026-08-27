import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeReturnTo } from "../lib/returnTo.js";

describe("Wave E — Return-To URL Sanitization & Open Redirect Defense", () => {
  it("A. Accepts safe local relative paths", () => {
    assert.strictEqual(sanitizeReturnTo("/checkout"), "/checkout");
    assert.strictEqual(sanitizeReturnTo("/customer/dashboard"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("/shop?category=skincare&page=2"), "/shop?category=skincare&page=2");
    assert.strictEqual(sanitizeReturnTo("/product/123#reviews"), "/product/123#reviews");
  });

  it("B. Falls back to default when input is null, undefined, or empty", () => {
    assert.strictEqual(sanitizeReturnTo(null), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo(undefined), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo(""), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("   "), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo(null, "/checkout"), "/checkout");
  });

  it("C. Rejects absolute external URLs with protocols", () => {
    assert.strictEqual(sanitizeReturnTo("https://evil.com"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("http://attacker.org/steal"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("ftp://example.com"), "/customer/dashboard");
  });

  it("D. Rejects protocol-relative URLs (//evil.com)", () => {
    assert.strictEqual(sanitizeReturnTo("//evil.com"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("//attacker.org/path"), "/customer/dashboard");
  });

  it("E. Rejects backslash evasion attempts (/\\evil.com or /\\\\)", () => {
    assert.strictEqual(sanitizeReturnTo("/\\evil.com"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("/\\\\evil.com"), "/customer/dashboard");
  });

  it("F. Rejects javascript: or data: pseudo-protocols", () => {
    assert.strictEqual(sanitizeReturnTo("/javascript:alert(1)"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("/data:text/html,evil"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("/vbscript:msgbox(1)"), "/customer/dashboard");
  });

  it("G. Rejects control characters and CRLF injection", () => {
    assert.strictEqual(sanitizeReturnTo("/path\r\nSet-Cookie: evil"), "/customer/dashboard");
    assert.strictEqual(sanitizeReturnTo("/path\0evil"), "/customer/dashboard");
  });
});
