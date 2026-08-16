/**
 * Regression test — Payment Verification UI DTO Data Mapping
 *
 * Verifies that PaymentVerificationClient resolver functions and filter logic
 * correctly map nested API DTO properties returned by GET /api/orders
 * (e.g. order.customer.name, order.paymentDetails.trxId) as well as legacy flat fields,
 * and only fall back to default labels when data is genuinely absent.
 *
 * PURE / NON-DESTRUCTIVE GUARANTEE:
 *   - No database connections or Prisma queries
 *   - No HTTP server or network requests
 *   - No order mutations
 *   - Pure in-memory unit tests of typed resolver and filter logic
 *
 * Run with:
 *   npx tsx --test tests/payment-verification-data-mapping.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCustomerName,
  resolveCustomerPhone,
  resolvePaymentProvider,
  resolvePaymentSenderNumber,
  resolvePaymentTrxId,
  isPaymentVerificationOrder,
} from "../components/admin/PaymentVerificationClient";

test("CASE 1 — Nested API DTO resolves real customer name and phone instead of fallbacks", () => {
  const nestedDtoOrder = {
    orderId: "PH-20260816-5338",
    customer: {
      name: "Tanzim Ahmed",
      phone: "01712345678",
    },
    paymentMethod: "bKash",
    paymentStatus: "verification_pending",
  };

  assert.equal(
    resolveCustomerName(nestedDtoOrder),
    "Tanzim Ahmed",
    "Should resolve customer.name from nested customer object"
  );
  assert.equal(
    resolveCustomerPhone(nestedDtoOrder),
    "01712345678",
    "Should resolve customer.phone from nested customer object"
  );
});

test("CASE 2 — Nested paymentDetails resolves provider, senderNumber, and trxId", () => {
  const nestedPaymentOrder = {
    orderId: "PH-20260816-5338",
    customer: {
      name: "Tanzim Ahmed",
      phone: "01712345678",
    },
    paymentMethod: "bKash",
    paymentStatus: "verification_pending",
    paymentDetails: {
      provider: "bKash Personal",
      senderNumber: "01811223344",
      trxId: "TRX99887766",
    },
  };

  assert.equal(
    resolvePaymentProvider(nestedPaymentOrder),
    "bKash Personal",
    "Should resolve provider from nested paymentDetails"
  );
  assert.equal(
    resolvePaymentSenderNumber(nestedPaymentOrder),
    "01811223344",
    "Should resolve senderNumber from nested paymentDetails"
  );
  assert.equal(
    resolvePaymentTrxId(nestedPaymentOrder),
    "TRX99887766",
    "Should resolve trxId from nested paymentDetails"
  );
});

test("CASE 3 — Existing supported flat fields still work as fallback", () => {
  const flatOrder = {
    orderId: "PH-20260816-1001",
    customerName: "Legacy Customer",
    customerPhone: "01999888777",
    paymentProvider: "Nagad Merchant",
    paymentSenderNumber: "01999888777",
    paymentTrxId: "NAGAD123456",
    paymentMethod: "Nagad",
    paymentStatus: "verification_pending",
  };

  assert.equal(
    resolveCustomerName(flatOrder),
    "Legacy Customer",
    "Should fallback to flat customerName"
  );
  assert.equal(
    resolveCustomerPhone(flatOrder),
    "01999888777",
    "Should fallback to flat customerPhone"
  );
  assert.equal(
    resolvePaymentProvider(flatOrder),
    "Nagad Merchant",
    "Should fallback to flat paymentProvider"
  );
  assert.equal(
    resolvePaymentSenderNumber(flatOrder),
    "01999888777",
    "Should fallback to flat paymentSenderNumber"
  );
  assert.equal(
    resolvePaymentTrxId(flatOrder),
    "NAGAD123456",
    "Should fallback to flat paymentTrxId"
  );
});

test("CASE 4 — An order containing only nested paymentDetails.trxId is included by the payment-verification filter", () => {
  const orderWithNestedTrxIdOnly = {
    orderId: "PH-20260816-9999",
    paymentMethod: "CustomGateway",
    paymentStatus: "unpaid",
    paymentDetails: {
      trxId: "TX-NESTED-ONLY-123",
    },
  };

  assert.equal(
    isPaymentVerificationOrder(orderWithNestedTrxIdOnly),
    true,
    "Filter must recognize nested paymentDetails.trxId and include the order"
  );

  const orderWithTransactionIdAlias = {
    orderId: "PH-20260816-9998",
    paymentMethod: "CustomGateway",
    paymentStatus: "unpaid",
    paymentDetails: {
      transactionId: "TX-ALIAS-456",
    },
  };

  assert.equal(
    isPaymentVerificationOrder(orderWithTransactionIdAlias),
    true,
    "Filter must recognize nested paymentDetails.transactionId alias and include the order"
  );

  const orderWithoutTrxOrMfs = {
    orderId: "PH-20260816-9997",
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
  };

  assert.equal(
    isPaymentVerificationOrder(orderWithoutTrxOrMfs),
    false,
    "Filter must exclude COD pending orders without manual payment trx"
  );
});

test("CASE 5 — Fallback labels are used only when the corresponding values are genuinely absent", () => {
  const emptyOrder = {
    orderId: "PH-20260816-0000",
  };

  assert.equal(
    resolveCustomerName(emptyOrder),
    "Customer",
    "Should fallback to default 'Customer'"
  );
  assert.equal(
    resolveCustomerPhone(emptyOrder),
    "No phone",
    "Should fallback to default 'No phone'"
  );
  assert.equal(
    resolvePaymentProvider(emptyOrder),
    "Manual",
    "Should fallback to default 'Manual'"
  );
  assert.equal(
    resolvePaymentSenderNumber(emptyOrder),
    "Not provided",
    "Should fallback to default 'Not provided'"
  );
  assert.equal(
    resolvePaymentTrxId(emptyOrder),
    "No trx id",
    "Should fallback to default 'No trx id'"
  );
});
