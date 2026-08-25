/**
 * Wave-D Corrective Tests — PRE-LOCK CORRECTIVE PASS
 *
 * Six behavioral RED tests written BEFORE production fixes.
 *
 * Findings:
 *   A. Same-order concurrent different TrxIDs → EVIDENCE_ALREADY_SUBMITTED (409)
 *   B. Admin ACCEPT vs REJECT loser mutation (concurrent verify race)
 *   C. Mixed RESERVED + RELEASED reservation → REFUND_REQUIRED (not PAID)
 *   D. refundAmount = 0 → rejected (400)
 *   E. refundAmount > authoritative total → rejected (400)
 *   F. Prepaid AWAITING_PAYMENT → PAID via generic/admin endpoint → blocked (409)
 *   G. Evidence rate-limit denial before any DB call
 *
 * Run with:
 *   npx tsx --test tests/wave-d-corrective.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as POST_EVIDENCE } from "@/app/api/orders/payment-evidence/route";
import { PATCH as PATCH_PAYMENT_STATUS } from "@/app/api/orders/payment-status/route";
import { createAdminSessionToken, ADMIN_SESSION_COOKIE } from "@/lib/adminSession";
import { prisma } from "@/lib/prisma";
import { resetRateLimit } from "@/lib/rateLimit";

process.env.ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");

function makeAdminCookie(): string {
  const token = createAdminSessionToken("admin@purehaven.test");
  return `${ADMIN_SESSION_COOKIE}=${token}`;
}

function makeEvidenceRequest(
  body: unknown,
  clientIp = "10.0.0.1"
): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/orders/payment-evidence",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": clientIp,
        "x-real-ip": clientIp,
      },
      body: JSON.stringify(body),
    }
  );
}

function makeAdminPatchRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/orders/payment-status",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: makeAdminCookie(),
      },
      body: JSON.stringify(body),
    }
  );
}

// ============================================================
// Finding A — Same-order concurrent different TrxIDs
// ============================================================
describe(
  "Wave-D Finding A — Same-order concurrent different TrxIDs",
  { concurrency: false },
  () => {
    it(
      "RACE — Second concurrent submission for SAME order with DIFFERENT TrxId returns 409 EVIDENCE_ALREADY_SUBMITTED",
      async (t) => {
        const originalOrderFindFirst = prisma.order.findFirst;
        const originalReservationFindMany = prisma.inventoryReservation.findMany;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.order.findFirst = originalOrderFindFirst;
          prisma.inventoryReservation.findMany = originalReservationFindMany;
          prisma.$transaction = original$transaction;
        });

        const deadline = new Date(Date.now() + 10 * 60 * 1000);
        const paymentRecordId = 500;

        (prisma.order.findFirst as any) = async () => ({
          id: "cuid_race_order_1",
          orderId: "PH-RACE-001",
          customerPhone: "01712345678",
          paymentMethod: "bKash",
          status: "pending",
          paymentRecord: {
            id: paymentRecordId,
            orderId: "cuid_race_order_1",
            method: "bKash",
            state: "AWAITING_PAYMENT",
          },
        });

        (prisma.inventoryReservation.findMany as any) = async () => [
          {
            id: 10,
            orderId: "cuid_race_order_1",
            status: "RESERVED",
            evidenceDeadlineAt: deadline,
          },
        ];

        // Simulate: Request A already won the PaymentRecord claim (count=1),
        // so when Request B runs, updateMany returns count=0 (already VERIFICATION_PENDING).
        // Inside the transaction, re-reading finds the PaymentRecord is VERIFICATION_PENDING
        // with a different TrxId (TRX-A, not TRX-B). → 409 EVIDENCE_ALREADY_SUBMITTED.
        let txCallCount = 0;
        (prisma.$transaction as any) = async (callback: any) => {
          txCallCount++;
          const mockTx: any = {
            paymentRecord: {
              // The updateMany claim returns count=0 because Request A already transitioned it
              updateMany: async (_args: any) => ({ count: 0 }),
              // Re-read: it's VERIFICATION_PENDING with TRX-A (different from TRX-B)
              findUnique: async (_args: any) => ({
                id: paymentRecordId,
                state: "VERIFICATION_PENDING",
                provider: "BKASH",
                evidenceAttempts: [
                  {
                    id: 999,
                    paymentRecordId,
                    normalizedProvider: "BKASH",
                    normalizedTrxId: "TRX_A", // Request A's TrxId
                    state: "PENDING_REVIEW",
                  },
                ],
              }),
            },
            paymentEvidenceAttempt: {
              findFirst: async (_args: any) => null,
              create: async (_args: any) => {
                throw new Error(
                  "MUST NOT create second attempt — concurrent loser"
                );
              },
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        // Request B submits TRX-B for the same order
        const req = makeEvidenceRequest(
          {
            orderId: "PH-RACE-001",
            customerPhone: "01712345678",
            provider: "bKash",
            senderNumber: "01799887700",
            trxId: "TRX-B",
          },
          "10.0.10.1"
        );

        const res = await POST_EVIDENCE(req);
        const data = await res.json();

        assert.strictEqual(
          res.status,
          409,
          `Expected 409 for same-order concurrent different TrxId, got ${res.status}`
        );
        assert.strictEqual(data.success, false);
        assert.strictEqual(
          data.code,
          "EVIDENCE_ALREADY_SUBMITTED",
          `Expected code EVIDENCE_ALREADY_SUBMITTED, got: ${data.code}`
        );
        // Critically: no second PENDING_REVIEW attempt was created
        assert.strictEqual(txCallCount, 1, "Transaction must run exactly once");
      }
    );

    it(
      "RACE — Same-order same TrxId after successful first claim returns idempotent 200",
      async (t) => {
        const originalOrderFindFirst = prisma.order.findFirst;
        const originalReservationFindMany = prisma.inventoryReservation.findMany;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.order.findFirst = originalOrderFindFirst;
          prisma.inventoryReservation.findMany = originalReservationFindMany;
          prisma.$transaction = original$transaction;
        });

        const deadline = new Date(Date.now() + 10 * 60 * 1000);
        const paymentRecordId = 501;

        (prisma.order.findFirst as any) = async () => ({
          id: "cuid_race_order_2",
          orderId: "PH-RACE-002",
          customerPhone: "01712345678",
          paymentMethod: "bKash",
          status: "pending",
          paymentRecord: {
            id: paymentRecordId,
            orderId: "cuid_race_order_2",
            method: "bKash",
            state: "AWAITING_PAYMENT",
          },
        });

        (prisma.inventoryReservation.findMany as any) = async () => [
          {
            id: 11,
            orderId: "cuid_race_order_2",
            status: "RESERVED",
            evidenceDeadlineAt: deadline,
          },
        ];

        // updateMany returns count=0, but re-read shows VERIFICATION_PENDING
        // with THE SAME TrxId → idempotent 200
        (prisma.$transaction as any) = async (callback: any) => {
          const mockTx: any = {
            paymentRecord: {
              updateMany: async (_args: any) => ({ count: 0 }),
              findUnique: async (_args: any) => ({
                id: paymentRecordId,
                state: "VERIFICATION_PENDING",
                provider: "BKASH",
                evidenceAttempts: [
                  {
                    id: 1001,
                    paymentRecordId,
                    normalizedProvider: "BKASH",
                    normalizedTrxId: "TRX_SAME_IDEM",
                    state: "PENDING_REVIEW",
                  },
                ],
              }),
            },
            paymentEvidenceAttempt: {
              findFirst: async (_args: any) => null,
              create: async () => {
                throw new Error("MUST NOT create — idempotent path");
              },
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        const req = makeEvidenceRequest(
          {
            orderId: "PH-RACE-002",
            customerPhone: "01712345678",
            provider: "bKash",
            senderNumber: "01799887700",
            trxId: "TRX_SAME_IDEM",
          },
          "10.0.10.2"
        );

        const res = await POST_EVIDENCE(req);
        const data = await res.json();

        assert.strictEqual(res.status, 200, `Expected 200 idempotent, got ${res.status}`);
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.idempotent, true);
      }
    );

    it(
      "RESUBMIT RACE — REJECTED→VERIFICATION_PENDING resubmission with competing TrxId returns 409",
      async (t) => {
        const originalOrderFindFirst = prisma.order.findFirst;
        const originalReservationFindMany = prisma.inventoryReservation.findMany;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.order.findFirst = originalOrderFindFirst;
          prisma.inventoryReservation.findMany = originalReservationFindMany;
          prisma.$transaction = original$transaction;
        });

        const deadline = new Date(Date.now() + 10 * 60 * 1000);
        const paymentRecordId = 502;

        (prisma.order.findFirst as any) = async () => ({
          id: "cuid_race_order_3",
          orderId: "PH-RACE-003",
          customerPhone: "01712345678",
          paymentMethod: "bKash",
          status: "pending",
          paymentRecord: {
            id: paymentRecordId,
            orderId: "cuid_race_order_3",
            method: "bKash",
            state: "REJECTED",
          },
        });

        (prisma.inventoryReservation.findMany as any) = async () => [
          {
            id: 12,
            orderId: "cuid_race_order_3",
            status: "RESERVED",
            evidenceDeadlineAt: deadline,
          },
        ];

        // Concurrent resubmit: Request A (TRX-NEW-A) wins, Request B (TRX-NEW-B) loses
        (prisma.$transaction as any) = async (callback: any) => {
          const mockTx: any = {
            paymentRecord: {
              updateMany: async (_args: any) => ({ count: 0 }),
              findUnique: async (_args: any) => ({
                id: paymentRecordId,
                state: "VERIFICATION_PENDING",
                provider: "BKASH",
                evidenceAttempts: [
                  {
                    id: 1002,
                    paymentRecordId,
                    normalizedProvider: "BKASH",
                    normalizedTrxId: "TRX_NEW_A",
                    state: "PENDING_REVIEW",
                  },
                ],
              }),
            },
            paymentEvidenceAttempt: {
              findFirst: async (_args: any) => null,
              create: async () => {
                throw new Error("MUST NOT create during resubmit race loser");
              },
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        const req = makeEvidenceRequest(
          {
            orderId: "PH-RACE-003",
            customerPhone: "01712345678",
            provider: "bKash",
            senderNumber: "01799887700",
            trxId: "TRX-NEW-B",
          },
          "10.0.10.3"
        );

        const res = await POST_EVIDENCE(req);
        const data = await res.json();

        assert.strictEqual(res.status, 409, `Expected 409 for resubmit race loser, got ${res.status}`);
        assert.strictEqual(data.success, false);
        assert.strictEqual(
          data.code,
          "EVIDENCE_ALREADY_SUBMITTED",
          `Expected EVIDENCE_ALREADY_SUBMITTED, got: ${data.code}`
        );
      }
    );
  }
);

// ============================================================
// Finding B — Admin ACCEPT vs REJECT concurrent loser mutation
// ============================================================
describe(
  "Wave-D Finding B — Admin ACCEPT/REJECT concurrent loser mutation",
  { concurrency: false },
  () => {
    it(
      "ACCEPT WINS / REJECT LOSES — Loser REJECT performs ZERO PaymentRecord mutation",
      async (t) => {
        const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
          prisma.$transaction = original$transaction;
        });

        (prisma.paymentRecord.findFirst as any) = async () => ({
          id: 700,
          orderId: "cuid_verify_race_1",
          method: "bKash",
          state: "VERIFICATION_PENDING",
          order: {
            id: "cuid_verify_race_1",
            orderId: "PH-VER-RACE-1",
            status: "pending",
            total: 1000,
          },
          evidenceAttempts: [
            {
              id: 800,
              paymentRecordId: 700,
              state: "PENDING_REVIEW",
              trxId: "TRX_RACE_VERIFY",
            },
          ],
        });

        let paymentRecordUpdateCalled = false;

        // Simulate: REJECT is the loser — attemptClaim.count = 0
        (prisma.$transaction as any) = async (callback: any) => {
          const mockTx: any = {
            inventoryReservation: {
              findMany: async () => [
                { id: 1, orderId: "cuid_verify_race_1", status: "RESERVED" },
              ],
            },
            paymentEvidenceAttempt: {
              // count=0 → loser (ACCEPT already claimed it)
              updateMany: async (_args: any) => ({ count: 0 }),
              findUnique: async (_args: any) => ({
                id: 800,
                state: "ACCEPTED", // already ACCEPTED by winner
                paymentRecordId: 700,
              }),
            },
            paymentRecord: {
              update: async (args: any) => {
                paymentRecordUpdateCalled = true;
                return { id: 700, ...args.data };
              },
              updateMany: async (_args: any) => ({ count: 0 }),
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        const req = makeAdminPatchRequest({
          orderId: "PH-VER-RACE-1",
          attemptId: 800,
          action: "REJECT",
          rejectionNote: "loser reject",
        });

        const res = await PATCH_PAYMENT_STATUS(req);
        const data = await res.json();

        // The loser REJECT should get 409 and NOT mutate the PaymentRecord
        assert.strictEqual(
          res.status,
          409,
          `Expected 409 for concurrent verify loser, got ${res.status}: ${JSON.stringify(data)}`
        );
        assert.strictEqual(data.success, false);
        assert.strictEqual(
          paymentRecordUpdateCalled,
          false,
          "LOSER must NOT call PaymentRecord update"
        );
      }
    );

    it(
      "REJECT WINS / ACCEPT LOSES — Loser ACCEPT performs ZERO PaymentRecord mutation",
      async (t) => {
        const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
          prisma.$transaction = original$transaction;
        });

        (prisma.paymentRecord.findFirst as any) = async () => ({
          id: 701,
          orderId: "cuid_verify_race_2",
          method: "bKash",
          state: "VERIFICATION_PENDING",
          order: {
            id: "cuid_verify_race_2",
            orderId: "PH-VER-RACE-2",
            status: "pending",
            total: 1200,
          },
          evidenceAttempts: [
            {
              id: 801,
              paymentRecordId: 701,
              state: "PENDING_REVIEW",
              trxId: "TRX_RACE_VERIFY_2",
            },
          ],
        });

        let paymentRecordUpdateCalled = false;

        // ACCEPT is the loser — attemptClaim.count = 0 (REJECT already claimed)
        (prisma.$transaction as any) = async (callback: any) => {
          const mockTx: any = {
            inventoryReservation: {
              findMany: async () => [
                { id: 2, orderId: "cuid_verify_race_2", status: "RESERVED" },
              ],
            },
            paymentEvidenceAttempt: {
              updateMany: async (_args: any) => ({ count: 0 }),
              findUnique: async (_args: any) => ({
                id: 801,
                state: "REJECTED", // already REJECTED by winner
                paymentRecordId: 701,
              }),
            },
            paymentRecord: {
              update: async (args: any) => {
                paymentRecordUpdateCalled = true;
                return { id: 701, ...args.data };
              },
              updateMany: async (_args: any) => ({ count: 0 }),
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        const req = makeAdminPatchRequest({
          orderId: "PH-VER-RACE-2",
          attemptId: 801,
          action: "ACCEPT",
        });

        const res = await PATCH_PAYMENT_STATUS(req);
        const data = await res.json();

        assert.strictEqual(
          res.status,
          409,
          `Expected 409 for concurrent verify loser (ACCEPT), got ${res.status}`
        );
        assert.strictEqual(data.success, false);
        assert.strictEqual(
          paymentRecordUpdateCalled,
          false,
          "LOSER ACCEPT must NOT call PaymentRecord update"
        );
      }
    );
  }
);

// ============================================================
// Finding C — Mixed RESERVED + RELEASED reservation → REFUND_REQUIRED
// ============================================================
describe(
  "Wave-D Finding C — Mixed RESERVED + RELEASED reservation entitlement",
  { concurrency: false },
  () => {
    it(
      "MIXED RESERVATION — Any RELEASED reservation forces REFUND_REQUIRED, not PAID",
      async (t) => {
        const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
          prisma.$transaction = original$transaction;
        });

        (prisma.paymentRecord.findFirst as any) = async () => ({
          id: 900,
          orderId: "cuid_mixed_res",
          method: "bKash",
          state: "VERIFICATION_PENDING",
          order: {
            id: "cuid_mixed_res",
            orderId: "PH-MIXED-RES",
            status: "pending",
            total: 1500,
          },
          evidenceAttempts: [
            {
              id: 1100,
              paymentRecordId: 900,
              state: "PENDING_REVIEW",
              trxId: "TRX_MIXED",
            },
          ],
        });

        let updatedAttemptState: string | null = null;
        let updatedPaymentRecordState: string | null = null;

        (prisma.$transaction as any) = async (callback: any) => {
          const mockTx: any = {
            inventoryReservation: {
              // Mixed: one RESERVED + one RELEASED
              findMany: async () => [
                { id: 1, orderId: "cuid_mixed_res", status: "RESERVED" },
                { id: 2, orderId: "cuid_mixed_res", status: "RELEASED" },
              ],
            },
            paymentEvidenceAttempt: {
              updateMany: async (args: any) => {
                updatedAttemptState = args.data.state;
                return { count: 1 };
              },
              findUnique: async () => null,
            },
            paymentRecord: {
              update: async (args: any) => {
                updatedPaymentRecordState = args.data.state;
                return { id: 900, ...args.data };
              },
              updateMany: async (args: any) => {
                updatedPaymentRecordState = args.data.state;
                return { count: 1 };
              },
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        const req = makeAdminPatchRequest({
          orderId: "PH-MIXED-RES",
          attemptId: 1100,
          action: "ACCEPT",
        });

        const res = await PATCH_PAYMENT_STATUS(req);
        const data = await res.json();

        assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
        assert.strictEqual(data.success, true);
        assert.strictEqual(
          updatedAttemptState,
          "ACCEPTED",
          "Attempt must be ACCEPTED"
        );
        assert.strictEqual(
          updatedPaymentRecordState,
          "REFUND_REQUIRED",
          `Mixed RESERVED+RELEASED must produce REFUND_REQUIRED, got: ${updatedPaymentRecordState}`
        );
      }
    );
  }
);

// ============================================================
// Finding D & E — Refund amount bounds (zero, negative, excessive)
// ============================================================
describe(
  "Wave-D Finding D/E — Refund amount validation bounds",
  { concurrency: false },
  () => {
    function makeRefundRequest(refundAmount: unknown): NextRequest {
      return makeAdminPatchRequest({
        orderId: "PH-REFUND-BOUNDS",
        targetState: "REFUND_REQUIRED",
        refundAmount,
      });
    }

    async function setupRefundMocks(t: any, orderTotal: number) {
      const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
      const original$transaction = prisma.$transaction;

      t.after(() => {
        prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
        prisma.$transaction = original$transaction;
      });

      (prisma.paymentRecord.findFirst as any) = async () => ({
        id: 1200,
        orderId: "cuid_refund_bounds",
        method: "bKash",
        state: "VERIFICATION_PENDING",
        order: {
          id: "cuid_refund_bounds",
          orderId: "PH-REFUND-BOUNDS",
          status: "pending",
          total: orderTotal,
        },
        evidenceAttempts: [],
      });

      (prisma.$transaction as any) = async (callback: any) => {
        const mockTx: any = {
          paymentRecord: {
            update: async (args: any) => ({ id: 1200, ...args.data }),
          },
          order: { update: async () => ({}) },
        };
        return await callback(mockTx);
      };
    }

    it("REFUND BOUND — refundAmount = 0 is rejected (400)", async (t) => {
      await setupRefundMocks(t, 1000);
      const res = await PATCH_PAYMENT_STATUS(makeRefundRequest(0));
      const data = await res.json();
      assert.strictEqual(
        res.status,
        400,
        `refundAmount=0 must be rejected with 400, got ${res.status}`
      );
      assert.strictEqual(data.success, false);
    });

    it("REFUND BOUND — refundAmount = -1 is rejected (400)", async (t) => {
      await setupRefundMocks(t, 1000);
      const res = await PATCH_PAYMENT_STATUS(makeRefundRequest(-1));
      const data = await res.json();
      assert.strictEqual(
        res.status,
        400,
        `refundAmount=-1 must be rejected with 400, got ${res.status}`
      );
      assert.strictEqual(data.success, false);
    });

    it("REFUND BOUND — refundAmount = NaN is rejected (400)", async (t) => {
      await setupRefundMocks(t, 1000);
      const res = await PATCH_PAYMENT_STATUS(makeRefundRequest("NaN"));
      const data = await res.json();
      assert.strictEqual(
        res.status,
        400,
        `refundAmount=NaN must be rejected with 400, got ${res.status}`
      );
      assert.strictEqual(data.success, false);
    });

    it("REFUND BOUND — refundAmount = Infinity is rejected (400)", async (t) => {
      await setupRefundMocks(t, 1000);
      const res = await PATCH_PAYMENT_STATUS(makeRefundRequest("Infinity"));
      const data = await res.json();
      assert.strictEqual(
        res.status,
        400,
        `refundAmount=Infinity must be rejected with 400, got ${res.status}`
      );
      assert.strictEqual(data.success, false);
    });

    it("REFUND BOUND — refundAmount > authoritative total is rejected (400)", async (t) => {
      await setupRefundMocks(t, 1000);
      const res = await PATCH_PAYMENT_STATUS(makeRefundRequest(1000.01));
      const data = await res.json();
      assert.strictEqual(
        res.status,
        400,
        `refundAmount exceeding total (1000.01 > 1000) must be rejected with 400, got ${res.status}`
      );
      assert.strictEqual(data.success, false);
    });

    it("REFUND BOUND — refundAmount = authoritative total is allowed", async (t) => {
      await setupRefundMocks(t, 1000);
      const res = await PATCH_PAYMENT_STATUS(makeRefundRequest(1000));
      const data = await res.json();
      assert.strictEqual(
        res.status,
        200,
        `refundAmount equal to total (1000 == 1000) must be allowed (200), got ${res.status}`
      );
      assert.strictEqual(data.success, true);
    });

    it("REFUND BOUND — valid partial positive refundAmount is allowed", async (t) => {
      await setupRefundMocks(t, 1000);
      const res = await PATCH_PAYMENT_STATUS(makeRefundRequest(500));
      const data = await res.json();
      assert.strictEqual(
        res.status,
        200,
        `Valid partial refundAmount (500 <= 1000) must be allowed (200), got ${res.status}`
      );
      assert.strictEqual(data.success, true);
    });
  }
);

// ============================================================
// Finding F — Prepaid direct AWAITING_PAYMENT → PAID bypass blocked
// ============================================================
describe(
  "Wave-D Finding F — Prepaid direct AWAITING_PAYMENT → PAID blocked",
  { concurrency: false },
  () => {
    async function setupDirectPaidMocks(
      t: any,
      paymentMethod: string,
      prState: string
    ) {
      const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
      const original$transaction = prisma.$transaction;

      t.after(() => {
        prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
        prisma.$transaction = original$transaction;
      });

      (prisma.paymentRecord.findFirst as any) = async () => ({
        id: 1300,
        orderId: "cuid_direct_paid",
        method: paymentMethod,
        state: prState,
        order: {
          id: "cuid_direct_paid",
          orderId: "PH-DIRECT-PAID",
          status: "pending",
          total: 800,
        },
        evidenceAttempts: [],
      });

      (prisma.$transaction as any) = async (callback: any) => {
        const mockTx: any = {
          paymentRecord: {
            update: async (args: any) => ({ id: 1300, ...args.data }),
          },
          order: { update: async () => ({}) },
        };
        return await callback(mockTx);
      };
    }

    it(
      "PREPAID BYPASS — bKash AWAITING_PAYMENT → PAID via generic endpoint is blocked (409)",
      async (t) => {
        await setupDirectPaidMocks(t, "bKash", "AWAITING_PAYMENT");
        const req = makeAdminPatchRequest({
          orderId: "PH-DIRECT-PAID",
          targetState: "PAID",
        });
        const res = await PATCH_PAYMENT_STATUS(req);
        const data = await res.json();
        assert.strictEqual(
          res.status,
          409,
          `bKash AWAITING_PAYMENT → PAID via generic endpoint must be blocked (409), got ${res.status}`
        );
        assert.strictEqual(data.success, false);
        assert.ok(
          data.code === "INVALID_PAYMENT_TRANSITION" ||
            data.code === "PREPAID_DIRECT_PAID_BLOCKED",
          `Expected INVALID_PAYMENT_TRANSITION or PREPAID_DIRECT_PAID_BLOCKED, got: ${data.code}`
        );
      }
    );

    it(
      "PREPAID BYPASS — Nagad AWAITING_PAYMENT → PAID via generic endpoint is blocked (409)",
      async (t) => {
        await setupDirectPaidMocks(t, "Nagad", "AWAITING_PAYMENT");
        const req = makeAdminPatchRequest({
          orderId: "PH-DIRECT-PAID",
          targetState: "PAID",
        });
        const res = await PATCH_PAYMENT_STATUS(req);
        const data = await res.json();
        assert.strictEqual(
          res.status,
          409,
          `Nagad AWAITING_PAYMENT → PAID via generic endpoint must be blocked (409), got ${res.status}`
        );
        assert.strictEqual(data.success, false);
      }
    );

    it(
      "PREPAID ALLOWED — bKash VERIFICATION_PENDING → PAID via ACCEPT is allowed",
      async (t) => {
        const originalPaymentRecordFindFirst = prisma.paymentRecord.findFirst;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.paymentRecord.findFirst = originalPaymentRecordFindFirst;
          prisma.$transaction = original$transaction;
        });

        (prisma.paymentRecord.findFirst as any) = async () => ({
          id: 1301,
          orderId: "cuid_accept_paid",
          method: "bKash",
          state: "VERIFICATION_PENDING",
          order: {
            id: "cuid_accept_paid",
            orderId: "PH-ACCEPT-PAID",
            status: "pending",
            total: 800,
          },
          evidenceAttempts: [
            {
              id: 1400,
              paymentRecordId: 1301,
              state: "PENDING_REVIEW",
              trxId: "TRX_VALID",
            },
          ],
        });

        let updatedPaymentRecordState: string | null = null;

        (prisma.$transaction as any) = async (callback: any) => {
          const mockTx: any = {
            inventoryReservation: {
              findMany: async () => [
                { id: 1, orderId: "cuid_accept_paid", status: "RESERVED" },
              ],
            },
            paymentEvidenceAttempt: {
              updateMany: async (_args: any) => ({ count: 1 }),
            },
            paymentRecord: {
              update: async (args: any) => {
                updatedPaymentRecordState = args.data.state;
                return { id: 1301, ...args.data };
              },
              updateMany: async (args: any) => {
                updatedPaymentRecordState = args.data.state;
                return { count: 1 };
              },
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        const req = makeAdminPatchRequest({
          orderId: "PH-ACCEPT-PAID",
          attemptId: 1400,
          action: "ACCEPT",
        });

        const res = await PATCH_PAYMENT_STATUS(req);
        const data = await res.json();

        assert.strictEqual(res.status, 200, `Expected 200 for valid ACCEPT, got ${res.status}`);
        assert.strictEqual(data.success, true);
        assert.strictEqual(
          updatedPaymentRecordState,
          "PAID",
          `ACCEPT path must set PAID, got: ${updatedPaymentRecordState}`
        );
      }
    );
  }
);

// ============================================================
// Finding G — Evidence rate-limit denial before DB reads
// ============================================================
describe(
  "Wave-D Finding G — Payment evidence rate-limit enforcement",
  { concurrency: false },
  () => {
    const EVIDENCE_LIMIT = 10; // Per spec: 10 requests / client / 60 seconds
    const RATE_LIMIT_TEST_IP = "10.99.99.1";
    const RATE_LIMIT_OTHER_IP = "10.99.99.2";

    // Reset the bucket for this IP before each test scenario
    function resetEvidence() {
      resetRateLimit(`payment_evidence:${RATE_LIMIT_TEST_IP}`);
      resetRateLimit(`payment_evidence:${RATE_LIMIT_OTHER_IP}`);
    }

    it(
      "RATE LIMIT — After limit exhausted, next request returns 429 without any DB call",
      async (t) => {
        resetEvidence();

        let dbCallCount = 0;

        const originalOrderFindFirst = prisma.order.findFirst;
        const originalReservationFindMany = prisma.inventoryReservation.findMany;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.order.findFirst = originalOrderFindFirst;
          prisma.inventoryReservation.findMany = originalReservationFindMany;
          prisma.$transaction = original$transaction;
          resetEvidence();
        });

        // DB stubs that count calls
        const deadline = new Date(Date.now() + 10 * 60 * 1000);
        (prisma.order.findFirst as any) = async () => {
          dbCallCount++;
          return {
            id: "cuid_rl_order",
            orderId: "PH-RL-001",
            customerPhone: "01712345678",
            paymentMethod: "bKash",
            status: "pending",
            paymentRecord: {
              id: 2000,
              orderId: "cuid_rl_order",
              method: "bKash",
              state: "AWAITING_PAYMENT",
            },
          };
        };

        (prisma.inventoryReservation.findMany as any) = async () => {
          dbCallCount++;
          return [
            {
              id: 20,
              orderId: "cuid_rl_order",
              status: "RESERVED",
              evidenceDeadlineAt: deadline,
            },
          ];
        };

        (prisma.$transaction as any) = async (callback: any) => {
          dbCallCount++;
          const mockTx: any = {
            paymentRecord: {
              updateMany: async () => ({ count: 1 }),
              findUnique: async () => null,
            },
            paymentEvidenceAttempt: {
              findFirst: async () => null,
              create: async () => ({ id: 9999 }),
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        // Exhaust the per-client limit
        for (let i = 0; i < EVIDENCE_LIMIT; i++) {
          await POST_EVIDENCE(
            makeEvidenceRequest(
              {
                orderId: "PH-RL-001",
                customerPhone: "01712345678",
                provider: "bKash",
                senderNumber: "01799887766",
                trxId: `TRX_RL_${i}`,
              },
              RATE_LIMIT_TEST_IP
            )
          );
        }

        // Reset call counter — we only care about the over-limit request
        dbCallCount = 0;

        // This 11th request must be denied 429
        const overLimitReq = makeEvidenceRequest(
          {
            orderId: "PH-RL-001",
            customerPhone: "01712345678",
            provider: "bKash",
            senderNumber: "01799887766",
            trxId: "TRX_RL_OVER",
          },
          RATE_LIMIT_TEST_IP
        );

        const res = await POST_EVIDENCE(overLimitReq);
        const data = await res.json();

        assert.strictEqual(
          res.status,
          429,
          `Expected 429 for rate-limited evidence request, got ${res.status}`
        );
        assert.strictEqual(data.success, false);
        assert.strictEqual(
          dbCallCount,
          0,
          `ZERO DB calls must execute after rate-limit denial — got ${dbCallCount}`
        );
      }
    );

    it(
      "RATE LIMIT — Independent client IPs do NOT share per-client buckets",
      async (t) => {
        resetEvidence();

        const originalOrderFindFirst = prisma.order.findFirst;
        const originalReservationFindMany = prisma.inventoryReservation.findMany;
        const original$transaction = prisma.$transaction;

        t.after(() => {
          prisma.order.findFirst = originalOrderFindFirst;
          prisma.inventoryReservation.findMany = originalReservationFindMany;
          prisma.$transaction = original$transaction;
          resetEvidence();
        });

        const deadline = new Date(Date.now() + 10 * 60 * 1000);
        (prisma.order.findFirst as any) = async () => ({
          id: "cuid_rl_iso",
          orderId: "PH-RL-ISO",
          customerPhone: "01712345678",
          paymentMethod: "bKash",
          status: "pending",
          paymentRecord: {
            id: 2001,
            orderId: "cuid_rl_iso",
            method: "bKash",
            state: "AWAITING_PAYMENT",
          },
        });

        (prisma.inventoryReservation.findMany as any) = async () => [
          {
            id: 21,
            orderId: "cuid_rl_iso",
            status: "RESERVED",
            evidenceDeadlineAt: deadline,
          },
        ];

        (prisma.$transaction as any) = async (callback: any) => {
          const mockTx: any = {
            paymentRecord: {
              updateMany: async () => ({ count: 1 }),
              findUnique: async () => null,
            },
            paymentEvidenceAttempt: {
              findFirst: async () => null,
              create: async () => ({ id: 9998 }),
            },
            order: { update: async () => ({}) },
          };
          return await callback(mockTx);
        };

        // Exhaust IP A
        for (let i = 0; i < EVIDENCE_LIMIT; i++) {
          await POST_EVIDENCE(
            makeEvidenceRequest(
              {
                orderId: "PH-RL-ISO",
                customerPhone: "01712345678",
                provider: "bKash",
                senderNumber: "01799887766",
                trxId: `TRX_A_${i}`,
              },
              RATE_LIMIT_TEST_IP
            )
          );
        }

        // IP B's first request must still succeed (not 429)
        const ipBReq = makeEvidenceRequest(
          {
            orderId: "PH-RL-ISO",
            customerPhone: "01712345678",
            provider: "bKash",
            senderNumber: "01799887766",
            trxId: "TRX_B_FIRST",
          },
          RATE_LIMIT_OTHER_IP
        );

        const res = await POST_EVIDENCE(ipBReq);
        // It may fail for DB reasons but NOT 429
        assert.notStrictEqual(
          res.status,
          429,
          `IP B must NOT inherit IP A's rate-limit bucket (got 429)`
        );
      }
    );
  }
);
