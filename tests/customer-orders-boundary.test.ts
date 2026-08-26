/**
 * Customer Orders Boundary Security Check (Wave B Pre-Lock)
 *
 * Verifies that legacy credentials (pure_haven_customer_auth, customer-users.json)
 * must NEVER authorize order queries or return customer order data.
 * Valid pure_haven_customer_session authorizes against PostgreSQL.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/customer-orders/route.js";
import { createCustomerSession } from "../lib/customerSession.js";
import { prisma } from "../lib/prisma.js";

describe("Wave B — Customer Orders Boundary Security Check", () => {
  it("REJECTS forged/legacy user-ID cookie (pure_haven_customer_auth=user_1782043601960_h75jej) with 401 fail-closed", async () => {
    const req = new Request("http://localhost:3000/api/customer-orders", {
      method: "GET",
      headers: {
        cookie: "pure_haven_customer_auth=user_1782043601960_h75jej",
      },
    });

    const res = await GET(req);
    const body = await res.json();

    assert.strictEqual(res.status, 401, "Must return 401 for legacy cookie matching customer-users.json");
    assert.strictEqual(body.authenticated, false, "Must not authenticate legacy cookie");
    assert.strictEqual(body.orders, undefined, "Must not return orders for legacy cookie");
  });

  it("REJECTS random legacy user-ID cookie with 401 fail-closed", async () => {
    const req = new Request("http://localhost:3000/api/customer-orders", {
      method: "GET",
      headers: {
        cookie: "pure_haven_customer_auth=random_forged_value_12345",
      },
    });

    const res = await GET(req);
    const body = await res.json();

    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.authenticated, false);
    assert.strictEqual(body.orders, undefined);
  });

  it("REJECTS requests without any session cookie with 401 fail-closed", async () => {
    const req = new Request("http://localhost:3000/api/customer-orders", {
      method: "GET",
    });

    const res = await GET(req);
    const body = await res.json();

    assert.strictEqual(res.status, 401);
    assert.strictEqual(body.authenticated, false);
    assert.strictEqual(body.orders, undefined);
  });

  it("ACCEPTS valid pure_haven_customer_session and returns authenticated customer orders response", async () => {
    // Create test user in test DB
    const user = await prisma.user.create({
      data: {
        name: "Boundary Test User",
        email: `boundary_test_${Math.random().toString(36).slice(2)}@example.com`,
        normalizedPhone: "01799887766",
        passwordHash: "dummyHash",
        isActive: true,
      },
    });

    const { rawToken } = await createCustomerSession(user.id);

    try {
      const req = new Request("http://localhost:3000/api/customer-orders", {
        method: "GET",
        headers: {
          cookie: `pure_haven_customer_session=${rawToken}`,
        },
      });

      const res = await GET(req);
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.authenticated, true);
      assert.strictEqual(body.user.id, user.id);
      assert.ok(Array.isArray(body.orders));
    } finally {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
