/**
 * Customer Orders Boundary Security Check (Wave B Pre-Lock)
 *
 * Verifies that:
 * 1. Legacy credentials (pure_haven_customer_auth, customer-users.json) MUST NOT authorize order queries.
 * 2. Unauthenticated requests are rejected.
 * 3. IDOR / Historical guest order disclosure:
 *    - Guest Order (userId: null) with phone P MUST NOT be returned to User B with normalizedPhone P.
 *    - User A MUST NOT see Order with userId = User B.
 *    - Authenticated User A ONLY sees Order with userId = A.id.
 */

import "dotenv/config";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/customer-orders/route.js";
import { createCustomerSession } from "../lib/customerSession.js";
import { prisma } from "../lib/prisma.js";

describe("Wave B — Customer Orders Boundary Security & IDOR Isolation Check", () => {
  it("REJECTS forged/legacy user-ID cookie (pure_haven_customer_auth=user_1782043601960_h75jej) with 401 fail-closed", async () => {
    const req = new Request("http://localhost:3000/api/customer-orders", {
      method: "GET",
      headers: {
        cookie: "pure_haven_customer_auth=user_1782043601960_h75jej",
      },
    });

    const res = await GET(req);
    const body = await res.json();

    assert.strictEqual(res.status, 401, "Must return 401 for legacy cookie");
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

  it("REJECTS historical guest order disclosure: phone-matching guest order (userId = null) MUST NOT be returned to authenticated user", async () => {
    const victimPhone = "018" + Math.floor(10000000 + Math.random() * 90000000);
    const suffix = Math.random().toString(36).slice(2, 8);

    // 1. Create a Historical Guest Order with userId = null and customerPhone = victimPhone
    const guestOrder = await prisma.order.create({
      data: {
        orderId: `PH-GUEST-HIST-${suffix}`,
        customerName: "Historical Guest Buyer",
        customerPhone: victimPhone,
        customerCity: "Dhaka",
        customerAddress: "Road 10, Dhanmondi",
        subtotal: 1200,
        deliveryFee: 120,
        total: 1320,
        status: "delivered",
        paymentMethod: "Cash on Delivery",
        paymentStatus: "paid",
        userId: null, // Unlinked guest order
      },
    });

    // 2. Create User B registering with normalizedPhone = victimPhone
    const userB = await prisma.user.create({
      data: {
        name: "User B",
        email: `user_b_${suffix}@example.com`,
        normalizedPhone: victimPhone,
        passwordHash: "dummyHash",
        isActive: true,
      },
    });

    const { rawToken } = await createCustomerSession(userB.id);

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
      assert.strictEqual(body.user.id, userB.id);

      // SECURITY ASSERTION: The guest order with userId=null MUST NOT appear in User B's order history!
      const returnedOrderIds = (body.orders || []).map((o: { orderId: string }) => o.orderId);
      assert.strictEqual(
        returnedOrderIds.includes(guestOrder.orderId),
        false,
        `SECURITY VIOLATION: Historical guest order ${guestOrder.orderId} was disclosed to User B via phone string match!`
      );
    } finally {
      await prisma.order.delete({ where: { id: guestOrder.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
    }
  });

  it("ENFORCES strict userId ownership isolation: User A sees only A's orders, never User B's orders", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);

    const phoneA = "017" + Math.floor(10000000 + Math.random() * 90000000);
    const phoneB = "017" + Math.floor(10000000 + Math.random() * 90000000);

    // Create User A and User B
    const userA = await prisma.user.create({
      data: {
        name: "User A",
        email: `user_a_${suffix}@example.com`,
        normalizedPhone: phoneA,
        passwordHash: "dummyHash",
        isActive: true,
      },
    });

    const userB = await prisma.user.create({
      data: {
        name: "User B",
        email: `user_b_${suffix}@example.com`,
        normalizedPhone: phoneB,
        passwordHash: "dummyHash",
        isActive: true,
      },
    });

    // Create Order owned by User A
    const orderA = await prisma.order.create({
      data: {
        orderId: `PH-A-${suffix}`,
        customerName: "User A",
        customerPhone: "01711000111",
        customerCity: "Dhaka",
        customerAddress: "Address A",
        subtotal: 500,
        deliveryFee: 120,
        total: 620,
        status: "pending",
        paymentMethod: "Cash on Delivery",
        paymentStatus: "pending",
        userId: userA.id,
      },
    });

    // Create Order owned by User B
    const orderB = await prisma.order.create({
      data: {
        orderId: `PH-B-${suffix}`,
        customerName: "User B",
        customerPhone: "01711000222",
        customerCity: "Dhaka",
        customerAddress: "Address B",
        subtotal: 800,
        deliveryFee: 120,
        total: 920,
        status: "pending",
        paymentMethod: "Cash on Delivery",
        paymentStatus: "pending",
        userId: userB.id,
      },
    });

    const sessionA = await createCustomerSession(userA.id);

    try {
      const req = new Request("http://localhost:3000/api/customer-orders", {
        method: "GET",
        headers: {
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
        },
      });

      const res = await GET(req);
      const body = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.authenticated, true);
      assert.strictEqual(body.user.id, userA.id);

      const returnedOrderIds = (body.orders || []).map((o: { orderId: string }) => o.orderId);
      assert.strictEqual(returnedOrderIds.includes(orderA.orderId), true, "User A must see Order A");
      assert.strictEqual(returnedOrderIds.includes(orderB.orderId), false, "User A must NOT see Order B");
    } finally {
      await prisma.order.deleteMany({ where: { id: { in: [orderA.id, orderB.id] } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    }
  });
});
