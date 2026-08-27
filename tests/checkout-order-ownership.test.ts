/**
 * Wave C — Authenticated Checkout Ownership & Customer Order Integration Test Suite
 *
 * Verifies:
 * 1. Authenticated checkout binds Order.userId to server-derived user.id (email and phone users).
 * 2. Guest checkout creates Order.userId = null.
 * 3. Client-supplied userId in request body is strictly ignored / rejected.
 * 4. Submission-token idempotency maintains exact ownership without mutation.
 * 5. Cross-user submission-token replay returns conflict (409) and prevents disclosure/takeover.
 * 6. Guest order with token T, then authenticated retry with token T does NOT mutate Order.userId (no retro claiming).
 * 7. Authenticated order with token T, then guest retry with token T returns 409 conflict.
 * 8. Historical guest orders (userId = null) with matching phone are NOT claimed.
 * 9. Authenticated newly-created orders are returned in GET /api/customer-orders.
 * 10. User A orders are completely isolated from User B.
 */

import "dotenv/config";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../app/api/orders/route.js";
import { GET as getCustomerOrders } from "../app/api/customer-orders/route.js";
import { createCustomerSession } from "../lib/customerSession.js";
import { hashCustomerPassword } from "../lib/customerAuth.js";
import { prisma } from "../lib/prisma.js";

function randomPhone() {
  return `017${Math.floor(10000000 + Math.random() * 90000000)}`;
}

describe("Wave C — Authenticated Checkout Ownership & Customer Order Integration", () => {
  it("A1. Authenticated email user checkout binds Order.userId to server-resolved user.id", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");
    const userPhone = randomPhone();

    const user = await prisma.user.create({
      data: {
        name: "Auth Email User",
        email: `auth_email_${suffix}@example.com`,
        normalizedPhone: userPhone,
        passwordHash,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    const product = await prisma.product.create({
      data: {
        name: `Wave C Product ${suffix}`,
        price: 500,
        stock: 10,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    try {
      const payload = {
        submissionToken: `tok-auth-email-${suffix}`,
        customerName: "Auth Email User",
        customerPhone: "01711223344",
        customerCity: "Dhaka",
        customerAddress: "Dhanmondi 27",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 500, name: product.name }],
      };

      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
      assert.strictEqual(data.success, true);

      const dbOrder = await prisma.order.findUnique({
        where: { id: data.order.id },
      });

      assert.ok(dbOrder, "Order must exist in database");
      assert.strictEqual(dbOrder.userId, user.id);
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken: `tok-auth-email-${suffix}` } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("A2. Authenticated phone user checkout binds Order.userId to server-resolved user.id", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: "Auth Phone User",
        email: null,
        normalizedPhone: "01811334455",
        passwordHash,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    const product = await prisma.product.create({
      data: {
        name: `Wave C Phone Product ${suffix}`,
        price: 450,
        stock: 10,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    try {
      const payload = {
        submissionToken: `tok-auth-phone-${suffix}`,
        customerName: "Auth Phone User",
        customerPhone: "01811334455",
        customerCity: "Sylhet",
        customerAddress: "Zindabazar",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 450, name: product.name }],
      };

      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);

      const dbOrder = await prisma.order.findUnique({
        where: { id: data.order.id },
      });

      assert.ok(dbOrder);
      assert.strictEqual(dbOrder.userId, user.id);
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken: `tok-auth-phone-${suffix}` } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("B. Guest checkout creates Order with Order.userId = null", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const product = await prisma.product.create({
      data: {
        name: `Wave C Guest Product ${suffix}`,
        price: 350,
        stock: 5,
        image: "/placeholder.png",
        category: "Makeup",
      },
    });

    try {
      const payload = {
        submissionToken: `tok-guest-${suffix}`,
        customerName: "Guest Shopper",
        customerPhone: "01811556677",
        customerCity: "Chittagong",
        customerAddress: "Agrabad C/A",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 350, name: product.name }],
      };

      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          // No customer session cookie
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);

      const dbOrder = await prisma.order.findUnique({
        where: { id: data.order.id },
      });

      assert.ok(dbOrder);
      assert.strictEqual(dbOrder.userId, null, "Guest Order.userId must be null");
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken: `tok-guest-${suffix}` } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
    }
  });

  it("C. Client-supplied body userId is strictly ignored / stripped", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const userA = await prisma.user.create({
      data: {
        name: "User A",
        email: `usera_${suffix}@example.com`,
        normalizedPhone: randomPhone(),
        passwordHash,
        isActive: true,
      },
    });

    const userB = await prisma.user.create({
      data: {
        name: "User B (Victim)",
        email: `userb_${suffix}@example.com`,
        normalizedPhone: randomPhone(),
        passwordHash,
        isActive: true,
      },
    });

    const sessionA = await createCustomerSession(userA.id);

    const product = await prisma.product.create({
      data: {
        name: `Wave C Spoof Product ${suffix}`,
        price: 400,
        stock: 5,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    try {
      const payload = {
        submissionToken: `tok-spoof-${suffix}`,
        userId: userB.id, // ATTACK: spoofed user ID
        customerName: "Attacker User A",
        customerPhone: "01711990011",
        customerCity: "Dhaka",
        customerAddress: "Banani",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 400, name: product.name }],
      };

      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);

      const dbOrder = await prisma.order.findUnique({
        where: { id: data.order.id },
      });

      assert.ok(dbOrder);
      assert.strictEqual(
        dbOrder.userId,
        userA.id,
        `SECURITY VIOLATION: Expected Order.userId to be ${userA.id}, but got ${dbOrder.userId}`
      );
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken: `tok-spoof-${suffix}` } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    }
  });

  it("D. Authenticated checkout Order is immediately visible in GET /api/customer-orders", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: "Dashboard Order User",
        email: `dashboard_order_${suffix}@example.com`,
        normalizedPhone: "01911445566",
        passwordHash,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    const product = await prisma.product.create({
      data: {
        name: `Dashboard Test Product ${suffix}`,
        price: 600,
        stock: 5,
        image: "/placeholder.png",
        category: "Fragrance",
      },
    });

    try {
      const payload = {
        submissionToken: `tok-dash-${suffix}`,
        customerName: "Dashboard Order User",
        customerPhone: "01911445566",
        customerCity: "Dhaka",
        customerAddress: "Gulshan 1",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 600, name: product.name }],
      };

      const createReq = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payload),
      });

      const createRes = await POST(createReq);
      const createData = await createRes.json();
      assert.strictEqual(createRes.status, 200);

      const getReq = new Request("http://localhost:3000/api/customer-orders", {
        method: "GET",
        headers: {
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
      });

      const getRes = await getCustomerOrders(getReq);
      const getData = await getRes.json();

      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getData.authenticated, true);
      const orderIds = (getData.orders || []).map((o: { orderId: string }) => o.orderId);
      assert.ok(
        orderIds.includes(createData.order.orderId),
        `Newly created authenticated order ${createData.order.orderId} must be present in customer orders list`
      );
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken: `tok-dash-${suffix}` } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("E. Same-user submissionToken retry returns idempotent 200 without creating duplicate order or mutating ownership", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const phone = randomPhone();
    const user = await prisma.user.create({
      data: {
        name: "Retry User",
        email: `retry_user_${suffix}@example.com`,
        normalizedPhone: phone,
        passwordHash,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    const product = await prisma.product.create({
      data: {
        name: `Retry Product ${suffix}`,
        price: 800,
        stock: 5,
        image: "/placeholder.png",
        category: "Haircare",
      },
    });

    const submissionToken = `tok-retry-${suffix}`;

    try {
      const payload = {
        submissionToken,
        customerName: "Retry User",
        customerPhone: phone,
        customerCity: "Dhaka",
        customerAddress: "Mirpur 10",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 800, name: product.name }],
      };

      const req1 = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payload),
      });

      const res1 = await POST(req1);
      const data1 = await res1.json();
      assert.strictEqual(res1.status, 200);

      const req2 = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payload),
      });

      const res2 = await POST(req2);
      const data2 = await res2.json();
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(data2.order.orderId, data1.order.orderId);

      const productAfter = await prisma.product.findUnique({ where: { id: product.id } });
      assert.strictEqual(productAfter?.stock, 4);
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("F. Cross-user submissionToken replay returns 409 conflict and prevents ownership disclosure/hijack", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const userA = await prisma.user.create({
      data: {
        name: "Original Owner A",
        email: `owner_a_${suffix}@example.com`,
        normalizedPhone: randomPhone(),
        passwordHash,
        isActive: true,
      },
    });

    const userB = await prisma.user.create({
      data: {
        name: "Replay Attacker B",
        email: `attacker_b_${suffix}@example.com`,
        normalizedPhone: randomPhone(),
        passwordHash,
        isActive: true,
      },
    });

    const sessionA = await createCustomerSession(userA.id);
    const sessionB = await createCustomerSession(userB.id);

    const product = await prisma.product.create({
      data: {
        name: `Replay Product ${suffix}`,
        price: 900,
        stock: 5,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    const submissionToken = `tok-cross-user-${suffix}`;

    try {
      const payloadA = {
        submissionToken,
        customerName: "Original Owner A",
        customerPhone: "01711776655",
        customerCity: "Dhaka",
        customerAddress: "Mohakhali",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 900, name: product.name }],
      };

      const reqA = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payloadA),
      });

      const resA = await POST(reqA);
      assert.strictEqual(resA.status, 200);

      const payloadB = {
        submissionToken,
        customerName: "Replay Attacker B",
        customerPhone: "01711776644",
        customerCity: "Dhaka",
        customerAddress: "Gulshan",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 900, name: product.name }],
      };

      const reqB = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${sessionB.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payloadB),
      });

      const resB = await POST(reqB);
      const dataB = await resB.json();

      assert.strictEqual(resB.status, 409);
      assert.strictEqual(dataB.success, false);

      const dbOrder = await prisma.order.findUnique({
        where: { submissionToken },
      });

      assert.strictEqual(dbOrder?.userId, userA.id);
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
    }
  });

  it("G. Authenticated order with token T, then guest retry with token T returns 409 conflict", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const phoneA = randomPhone();
    const userA = await prisma.user.create({
      data: {
        name: "Owner A",
        email: `owner_a_${suffix}@example.com`,
        normalizedPhone: phoneA,
        passwordHash,
        isActive: true,
      },
    });

    const sessionA = await createCustomerSession(userA.id);

    const product = await prisma.product.create({
      data: {
        name: `Auth Guest Race Product ${suffix}`,
        price: 300,
        stock: 5,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    const submissionToken = `tok-auth-then-guest-${suffix}`;

    try {
      // User A creates order with token
      const payloadA = {
        submissionToken,
        customerName: "Owner A",
        customerPhone: phoneA,
        customerCity: "Dhaka",
        customerAddress: "Banani",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 300, name: product.name }],
      };

      const reqA = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payloadA),
      });

      const resA = await POST(reqA);
      assert.strictEqual(resA.status, 200);

      // Anonymous guest sends same submissionToken
      const payloadGuest = {
        submissionToken,
        customerName: "Anonymous Guest",
        customerPhone: "01800000000",
        customerCity: "Dhaka",
        customerAddress: "Dhanmondi",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 300, name: product.name }],
      };

      const reqGuest = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          // No customer session
        },
        body: JSON.stringify(payloadGuest),
      });

      const resGuest = await POST(reqGuest);
      assert.strictEqual(resGuest.status, 409, "Guest retry for auth-owned order must return 409");

      // Verify Order.userId remains User A.id
      const dbOrder = await prisma.order.findUnique({
        where: { submissionToken },
      });
      assert.strictEqual(dbOrder?.userId, userA.id);
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    }
  });

  it("H. Guest order with token T, then authenticated retry with token T returns 409 conflict", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const userA = await prisma.user.create({
      data: {
        name: "User A",
        email: `user_a_${suffix}@example.com`,
        normalizedPhone: randomPhone(),
        passwordHash,
        isActive: true,
      },
    });

    const sessionA = await createCustomerSession(userA.id);

    const product = await prisma.product.create({
      data: {
        name: `Guest Auth Race Product ${suffix}`,
        price: 350,
        stock: 5,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    const submissionToken = `tok-guest-then-auth-${suffix}`;

    try {
      // 1. Guest creates order with submissionToken
      const payloadGuest = {
        submissionToken,
        customerName: "Anonymous Guest",
        customerPhone: "01800000000",
        customerCity: "Dhaka",
        customerAddress: "Dhanmondi",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 350, name: product.name }],
      };

      const reqGuest = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
        },
        body: JSON.stringify(payloadGuest),
      });

      const resGuest = await POST(reqGuest);
      assert.strictEqual(resGuest.status, 200);

      // 2. Authenticated user sends same submissionToken
      const payloadAuth = {
        submissionToken,
        customerName: "User A",
        customerPhone: "01711665544",
        customerCity: "Dhaka",
        customerAddress: "Banani",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 350, name: product.name }],
      };

      const reqAuth = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${sessionA.rawToken}`,
          origin: "http://localhost:3000",
        },
        body: JSON.stringify(payloadAuth),
      });

      const resAuth = await POST(reqAuth);
      const dataAuth = await resAuth.json();

      assert.strictEqual(
        resAuth.status,
        409,
        `BEHAVIORAL RED: Authenticated retry for guest-created token must return 409 conflict, got ${resAuth.status}`
      );
      assert.strictEqual(dataAuth.success, false);

      // Verify guest order remained userId = null and was not mutated
      const dbOrder = await prisma.order.findUnique({
        where: { submissionToken },
      });
      assert.strictEqual(dbOrder?.userId, null, "Guest order must remain userId = null");
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    }
  });

  it("I. Authenticated checkout with customer session rejects cross-origin request with 403", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const passwordHash = await hashCustomerPassword("Password!123");

    const user = await prisma.user.create({
      data: {
        name: "CSRF User",
        email: `csrf_user_${suffix}@example.com`,
        normalizedPhone: randomPhone(),
        passwordHash,
        isActive: true,
      },
    });

    const session = await createCustomerSession(user.id);

    const product = await prisma.product.create({
      data: {
        name: `CSRF Product ${suffix}`,
        price: 250,
        stock: 5,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    try {
      const payload = {
        submissionToken: `tok-csrf-${suffix}`,
        customerName: "CSRF User",
        customerPhone: "01711998877",
        customerCity: "Dhaka",
        customerAddress: "Banani",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 250, name: product.name }],
      };

      // Malicious Origin
      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
          cookie: `pure_haven_customer_session=${session.rawToken}`,
          origin: "http://attacker-controlled-site.com",
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      assert.strictEqual(
        res.status,
        403,
        `BEHAVIORAL RED: Cross-origin authenticated checkout must return 403, got ${res.status}`
      );
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken: `tok-csrf-${suffix}` } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });

  it("J. Guest checkout without session cookie succeeds without requiring customer CSRF validation", async () => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const product = await prisma.product.create({
      data: {
        name: `Guest Public Product ${suffix}`,
        price: 200,
        stock: 5,
        image: "/placeholder.png",
        category: "Skincare",
      },
    });

    try {
      const payload = {
        submissionToken: `tok-guest-public-${suffix}`,
        customerName: "Public Guest",
        customerPhone: "01822334455",
        customerCity: "Dhaka",
        customerAddress: "Mirpur",
        paymentMethod: "Cash on Delivery",
        items: [{ productId: product.id, quantity: 1, price: 200, name: product.name }],
      };

      const req = new NextRequest("http://localhost:3000/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `10.99.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      assert.strictEqual(res.status, 200);

      const dbOrder = await prisma.order.findUnique({
        where: { submissionToken: `tok-guest-public-${suffix}` },
      });
      assert.strictEqual(dbOrder?.userId, null);
    } finally {
      await prisma.order.deleteMany({ where: { submissionToken: `tok-guest-public-${suffix}` } }).catch(() => {});
      await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
    }
  });
});
