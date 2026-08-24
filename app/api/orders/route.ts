import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminSession";
import { invalidateProductReadCache } from "@/lib/serverReadCache";
import { consumeRateLimit } from "@/lib/rateLimit";
import {
  getRateLimitClientKey,
  ORDER_CREATION_MAX_REQUESTS_PER_CLIENT,
  ORDER_CREATION_WINDOW_SECONDS,
} from "@/lib/rateLimitPolicy";
import {
  normalizeOrderStatus,
  normalizeCancellationReason,
  normalizeDeliveryFailureReason,
  validateOrderTransition,
} from "@/lib/orderLifecycle";
import {
  DEFAULT_DELIVERY_FEE,
  PREPAID_EVIDENCE_DEADLINE_MINUTES,
} from "@/lib/commerceConstants";
import {
  calculateOrderTotals,
  requireNonNegativeMoney,
} from "@/lib/money";
import {
  withOrderIdRetry,
} from "@/lib/orderIdentifiers";
import {
  reserveOrderInventory,
  InventoryConflictError,
  InventoryIntegrityError,
} from "@/lib/inventoryService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedPaymentMethods = new Set([
  "Cash on Delivery",
  "bKash",
  "Nagad",
]);

type OrderItemInput = {
  id?: number | string;
  productId?: number | string;
  variantId?: number | string | null;
  quantity?: number | string;
};

type OrderBody = {
  id?: string;
  submissionToken?: string;
  customer?: {
    name?: string;
    phone?: string;
    city?: string;
    address?: string;
  };
  customerName?: string;
  name?: string;
  fullName?: string;
  customerPhone?: string;
  phone?: string;
  mobile?: string;
  customerCity?: string;
  city?: string;
  customerAddress?: string;
  address?: string;
  deliveryAddress?: string;
  items?: OrderItemInput[];
  orderItems?: OrderItemInput[];
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  senderNumber?: string;
  transactionId?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  cancellationNote?: string;
  deliveryFailureReason?: string;
  deliveryFailureNote?: string;
  paymentDetails?: {
    provider?: string;
    senderNumber?: string;
    trxId?: string;
    transactionId?: string;
  } | null;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInt(value: unknown, fallback = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(1, Math.floor(num)) : fallback;
}

function normalizeId(value: unknown) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function sanitizePhone(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function isSubmissionTokenUniqueCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; meta?: { target?: string[] | string } };
  if (err.code !== "P2002") return false;

  const target = err.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("submissionToken");
  }
  if (typeof target === "string") {
    return target.includes("submissionToken");
  }
  return false;
}

type MapOrderOptions = {
  includeAudit?: boolean;
};

function mapOrder(
  order: {
    id: string;
    orderId: string;
    customerName: string;
    customerPhone: string;
    customerCity: string;
    customerAddress: string;
    subtotal: number;
    deliveryFee: number;
    total: number;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    paymentProvider: string | null;
    paymentSenderNumber: string | null;
    paymentTrxId: string | null;
    cancelledBy?: string | null;
    cancellationReason?: string | null;
    cancellationNote?: string | null;
    cancelledAt?: Date | null;
    deliveryFailureReason?: string | null;
    deliveryFailureNote?: string | null;
    deliveryFailedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    items: Array<{
      id: number;
      orderId: string;
      productId: number | null;
      variantId?: number | null;
      variantLabel?: string | null;
      name: string;
      price: number;
      compareAtPrice?: number | null;
      image: string;
      category: string;
      quantity: number;
    }>;
  },
  options: MapOrderOptions = {}
) {
  const mapped = {
    id: order.id,
    orderId: order.orderId,
    customer: {
      name: order.customerName,
      phone: order.customerPhone,
      city: order.customerCity,
      address: order.customerAddress,
    },
    items: (order.items || []).map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId ?? null,
      variantId: item.variantId ?? null,
      variantLabel: item.variantLabel ?? null,
      name: item.name,
      price: item.price,
      compareAtPrice: item.compareAtPrice ?? null,
      image: item.image,
      category: item.category,
      quantity: item.quantity,
    })),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentDetails:
      order.paymentProvider ||
      order.paymentSenderNumber ||
      order.paymentTrxId
        ? {
            provider: order.paymentProvider || undefined,
            senderNumber: order.paymentSenderNumber || undefined,
            trxId: order.paymentTrxId || undefined,
          }
        : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };

  if (!options.includeAudit) {
    return mapped;
  }

  return {
    ...mapped,
    cancelledBy: order.cancelledBy ?? null,
    cancellationReason: order.cancellationReason ?? null,
    cancellationNote: order.cancellationNote ?? null,
    cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    deliveryFailureReason: order.deliveryFailureReason ?? null,
    deliveryFailureNote: order.deliveryFailureNote ?? null,
    deliveryFailedAt: order.deliveryFailedAt
      ? order.deliveryFailedAt.toISOString()
      : null,
  };
}

function getCustomerName(body: OrderBody) {
  return (
    normalizeString(body.customer?.name) ||
    normalizeString(body.customerName) ||
    normalizeString(body.name) ||
    normalizeString(body.fullName)
  );
}

function getCustomerPhone(body: OrderBody) {
  return sanitizePhone(
    normalizeString(body.customer?.phone) ||
      normalizeString(body.customerPhone) ||
      normalizeString(body.phone) ||
      normalizeString(body.mobile)
  );
}

function getCustomerCity(body: OrderBody) {
  return normalizeString(body.customer?.city) || normalizeString(body.customerCity) || normalizeString(body.city);
}

function getCustomerAddress(body: OrderBody) {
  return (
    normalizeString(body.customer?.address) ||
    normalizeString(body.customerAddress) ||
    normalizeString(body.address) ||
    normalizeString(body.deliveryAddress)
  );
}

function getPaymentTrxId(body: OrderBody) {
  return (
    normalizeString(body.paymentDetails?.trxId) ||
    normalizeString(body.paymentDetails?.transactionId) ||
    normalizeString(body.transactionId)
  );
}

export async function GET(req: NextRequest) {
  try {
    const track = req.nextUrl.searchParams.get("track");
    const orderId = req.nextUrl.searchParams.get("orderId");
    const phone = req.nextUrl.searchParams.get("phone");
    const id = req.nextUrl.searchParams.get("id");

    if (track === "1") {
      if (!orderId || !phone) {
        return NextResponse.json(
          { success: false, message: "Order ID and phone number are required." },
          { status: 400 }
        );
      }

      const matchedOrder = await prisma.order.findFirst({
        where: {
          orderId: orderId.trim(),
          customerPhone: sanitizePhone(phone),
        },
        include: { items: true },
      });

      if (!matchedOrder) {
        return NextResponse.json(
          { success: false, message: "No matching order found." },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        order: mapOrder(matchedOrder, { includeAudit: false }),
      });
    }

    const unauthorized = requireAdmin(req);
    if (unauthorized) return unauthorized;

    if (id) {
      const order = await prisma.order.findFirst({
        where: {
          OR: [{ id }, { orderId: id }],
        },
        include: { items: true },
      });

      if (!order) {
        return NextResponse.json(
          { success: false, message: "Order not found." },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        order: mapOrder(order, { includeAudit: true }),
      });
    }

    const orders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      orders: orders.map((order) => mapOrder(order, { includeAudit: true })),
    });
  } catch (error) {
    console.error("GET /api/orders failed:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch orders." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Rate-limiting check performed BEFORE database transactions or stock checks
    const clientKey = getRateLimitClientKey(req);
    const clientBucketKey = `order_create:${clientKey}`;

    const rateLimitRes = consumeRateLimit(
      clientBucketKey,
      ORDER_CREATION_MAX_REQUESTS_PER_CLIENT,
      ORDER_CREATION_WINDOW_SECONDS * 1000
    );

    if (!rateLimitRes.allowed) {
      return NextResponse.json(
        { success: false, message: "Too many orders created. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimitRes.retryAfterSeconds),
          },
        }
      );
    }

    const body = (await req.json()) as OrderBody;
    const submissionToken = normalizeString(body.submissionToken) || null;

    // Fast-path idempotency check before opening transaction
    if (submissionToken) {
      const existing = await prisma.order.findUnique({
        where: { submissionToken },
        include: { items: true },
      });
      if (existing) {
        return NextResponse.json({
          success: true,
          message: "Order resolved via submission token.",
          order: mapOrder(existing, { includeAudit: false }),
        });
      }
    }

    const customerName = getCustomerName(body);
    const customerPhone = getCustomerPhone(body);
    const customerCity = getCustomerCity(body);
    const customerAddress = getCustomerAddress(body);
    const rawItems = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.orderItems)
        ? body.orderItems
        : [];

    if (!customerName || !customerPhone || !customerAddress) {
      return NextResponse.json(
        { success: false, message: "Customer information is incomplete." },
        { status: 400 }
      );
    }

    if (customerPhone.length < 11) {
      return NextResponse.json(
        { success: false, message: "A valid phone number is required." },
        { status: 400 }
      );
    }

    if (rawItems.length === 0) {
      return NextResponse.json(
        { success: false, message: "Order items are required." },
        { status: 400 }
      );
    }

    const clientItems = rawItems.map((item) => {
      const productId = normalizeId(item.productId ?? item.id);
      const variantId = normalizeId(item.variantId);
      const quantity = normalizePositiveInt(item.quantity, 1);
      return { productId, variantId, quantity };
    });

    if (clientItems.some((item) => !item.productId || item.quantity < 1)) {
      return NextResponse.json(
        { success: false, message: "Every order item must contain a valid product id and quantity." },
        { status: 400 }
      );
    }

    const paymentMethod =
      normalizeString(body.paymentMethod) || "Cash on Delivery";

    if (!allowedPaymentMethods.has(paymentMethod)) {
      return NextResponse.json(
        { success: false, message: "Invalid payment method." },
        { status: 400 }
      );
    }

    const isPrepaid = paymentMethod === "bKash" || paymentMethod === "Nagad";
    const paymentStatus = isPrepaid ? "awaiting_payment" : "pending";

    const order = await withOrderIdRetry(async (orderId) => {
      return await prisma.$transaction(
        async (tx) => {
          // Idempotency check inside transaction
          if (submissionToken) {
            const existing = await tx.order.findUnique({
              where: { submissionToken },
              include: { items: true },
            });
            if (existing) {
              return existing;
            }
          }

          const preparedItems = [];

          for (const item of clientItems) {
            if (!item.productId) {
              throw new Error("Invalid product id.");
            }

            const product = await tx.product.findUnique({
              where: { id: item.productId },
              include: { variants: true },
            });

            if (!product) {
              throw new Error("One product is no longer available.");
            }

            const variant = item.variantId
              ? product.variants.find((entry) => entry.id === item.variantId)
              : null;

            if (item.variantId && !variant) {
              throw new Error(`${product.name} selected variant is no longer available.`);
            }

            const itemName = variant ? `${product.name} (${variant.label})` : product.name;
            const itemPrice = variant ? variant.price : product.price;
            const itemImage = (variant && variant.image) || product.image || "/uploads/placeholder-product.png";

            preparedItems.push({
              productId: product.id,
              name: itemName,
              price: requireNonNegativeMoney(itemPrice, "Item price"),
              image: itemImage,
              category: product.category || "Uncategorized",
              quantity: item.quantity,
              variantId: variant ? variant.id : null,
              variantLabel: variant ? variant.label : null,
            });
          }

          const { subtotal, deliveryFee, total } = calculateOrderTotals(
            preparedItems,
            DEFAULT_DELIVERY_FEE
          );

          const reservationTimestamp = new Date();
          const evidenceDeadlineAt = isPrepaid
            ? new Date(
                reservationTimestamp.getTime() +
                  PREPAID_EVIDENCE_DEADLINE_MINUTES * 60 * 1000
              )
            : null;

          const createdOrder = await tx.order.create({
            data: {
              orderId,
              submissionToken,
              customerName,
              customerPhone,
              customerCity,
              customerAddress,
              subtotal,
              deliveryFee,
              total,
              status: "pending",
              paymentMethod,
              paymentStatus,
              paymentProvider: isPrepaid ? paymentMethod : null,
              paymentSenderNumber: null,
              paymentTrxId: null,
              items: {
                create: preparedItems.map((item) => ({
                  productId: item.productId,
                  variantId: item.variantId,
                  variantLabel: item.variantLabel,
                  name: item.name,
                  price: item.price,
                  image: item.image,
                  category: item.category,
                  quantity: item.quantity,
                })),
              },
            },
            include: { items: true },
          });

          // Guarded stock reservation & InventoryReservation row creation
          await reserveOrderInventory(
            tx,
            createdOrder.items.map((item) => ({
              id: item.id,
              orderId: createdOrder.id,
              productId: item.productId!,
              variantId: item.variantId,
              quantity: item.quantity,
            })),
            {
              evidenceDeadlineAt,
              reservationTimestamp,
            }
          );

          // Create initial PaymentRecord
          await tx.paymentRecord.create({
            data: {
              orderId: createdOrder.id,
              method: paymentMethod,
              state: "AWAITING_PAYMENT",
              provider: isPrepaid ? paymentMethod : null,
              codSettlementState: isPrepaid ? null : "NOT_APPLICABLE",
            },
          });

          return createdOrder;
        },
        { maxWait: 20000, timeout: 60000 }
      );
    });

    invalidateProductReadCache();

    return NextResponse.json({
      success: true,
      message: "Order created successfully.",
      order: mapOrder(order, { includeAudit: false }),
    });
  } catch (error) {
    if (error instanceof InventoryConflictError) {
      return NextResponse.json(
        {
          success: false,
          code: "INSUFFICIENT_STOCK",
          message: error.message,
        },
        { status: 409 }
      );
    }

    if (error instanceof InventoryIntegrityError) {
      return NextResponse.json(
        {
          success: false,
          code: "INVENTORY_INTEGRITY_ERROR",
          message: "Inventory reservation could not be verified. Please try again.",
        },
        { status: 500 }
      );
    }

    if (isSubmissionTokenUniqueCollision(error)) {
      // Attempt recovery by finding order by submissionToken
      try {
        const body = (await req.json().catch(() => null)) as OrderBody | null;
        const token = body?.submissionToken ? normalizeString(body.submissionToken) : null;
        if (token) {
          const existing = await prisma.order.findUnique({
            where: { submissionToken: token },
            include: { items: true },
          });
          if (existing) {
            return NextResponse.json({
              success: true,
              message: "Order resolved via submission token.",
              order: mapOrder(existing, { includeAudit: false }),
            });
          }
        }
      } catch {
        // Fall through to general error response
      }
    }

    console.error("POST /api/orders failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Order creation failed.",
      },
      { status: 400 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as OrderBody;
    const id = normalizeString(body.id);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Order ID is required." },
        { status: 400 }
      );
    }

    const existing = await prisma.order.findFirst({
      where: {
        OR: [{ id }, { orderId: id }],
      },
      include: { items: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Order not found." },
        { status: 404 }
      );
    }

    // Normalize and validate persisted current status (fail closed if corrupt/unknown)
    const currentStatus = normalizeOrderStatus(existing.status);
    if (!currentStatus) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Persisted order has an unknown or unsupported status. Mutation rejected.",
        },
        { status: 409 }
      );
    }

    // Normalize and validate requested target status
    let targetStatus = currentStatus;
    if (body.status !== undefined) {
      const normalizedTarget = normalizeOrderStatus(body.status);
      if (!normalizedTarget) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid or unsupported target order status.",
          },
          { status: 400 }
        );
      }
      targetStatus = normalizedTarget;
    }

    // Validate status transition against server lifecycle graph
    const transitionCheck = validateOrderTransition(currentStatus, targetStatus);
    if (!transitionCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: transitionCheck.message,
        },
        { status: 409 }
      );
    }

    const isStatusChange = !transitionCheck.noop;

    // Cancellation audit & reason validation
    let cancellationReason: string | null = null;
    let cancellationNote: string | null = null;
    if (isStatusChange && targetStatus === "cancelled") {
      const normalizedReason = normalizeCancellationReason(body.cancellationReason);
      if (!normalizedReason) {
        return NextResponse.json(
          {
            success: false,
            message: "A valid cancellation reason is required to cancel an order.",
          },
          { status: 400 }
        );
      }
      const note = normalizeString(body.cancellationNote);
      if (normalizedReason === "other" && !note) {
        return NextResponse.json(
          {
            success: false,
            message:
              "A non-empty cancellation note is required when cancellation reason is 'other'.",
          },
          { status: 400 }
        );
      }
      cancellationReason = normalizedReason;
      cancellationNote = note || null;
    }

    // Delivery failure audit & reason validation
    let deliveryFailureReason: string | null = null;
    let deliveryFailureNote: string | null = null;
    if (isStatusChange && targetStatus === "delivery_failed") {
      const normalizedReason = normalizeDeliveryFailureReason(body.deliveryFailureReason);
      if (!normalizedReason) {
        return NextResponse.json(
          {
            success: false,
            message:
              "A valid delivery failure reason is required when marking an order as delivery_failed.",
          },
          { status: 400 }
        );
      }
      const note = normalizeString(body.deliveryFailureNote);
      if (normalizedReason === "other" && !note) {
        return NextResponse.json(
          {
            success: false,
            message:
              "A non-empty note is required when delivery failure reason is 'other'.",
          },
          { status: 400 }
        );
      }
      deliveryFailureReason = normalizedReason;
      deliveryFailureNote = note || null;
    }

    // Check for same-state status-only request vs same-state with non-status updates
    const hasPaymentMethodUpdate =
      body.paymentMethod !== undefined &&
      normalizeString(body.paymentMethod) !== "" &&
      normalizeString(body.paymentMethod) !== existing.paymentMethod;
    const hasPaymentStatusUpdate =
      body.paymentStatus !== undefined &&
      normalizeString(body.paymentStatus) !== "" &&
      normalizeString(body.paymentStatus) !== existing.paymentStatus;
    const hasPaymentDetailsUpdate = body.paymentDetails !== undefined;

    const hasNonStatusUpdate =
      hasPaymentMethodUpdate || hasPaymentStatusUpdate || hasPaymentDetailsUpdate;

    if (!isStatusChange && !hasNonStatusUpdate) {
      return NextResponse.json({
        success: true,
        message: "Order updated successfully.",
        order: mapOrder(existing, { includeAudit: true }),
      });
    }

    const shouldRestoreProductStock =
      isStatusChange && targetStatus === "cancelled";

    const updated = await prisma.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        status: targetStatus,
        paymentMethod:
          normalizeString(body.paymentMethod) || existing.paymentMethod,
        paymentStatus:
          normalizeString(body.paymentStatus) || existing.paymentStatus,
        paymentProvider:
          body.paymentDetails !== undefined
            ? normalizeString(body.paymentDetails?.provider) || null
            : existing.paymentProvider,
        paymentSenderNumber:
          body.paymentDetails !== undefined
            ? sanitizePhone(normalizeString(body.paymentDetails?.senderNumber)) ||
              null
            : existing.paymentSenderNumber,
        paymentTrxId:
          body.paymentDetails !== undefined
            ? getPaymentTrxId(body) || null
            : existing.paymentTrxId,
      };

      if (isStatusChange && targetStatus === "cancelled") {
        updateData.cancelledBy = "admin";
        updateData.cancellationReason = cancellationReason;
        updateData.cancellationNote = cancellationNote;
        updateData.cancelledAt = new Date();
      } else if (isStatusChange && targetStatus === "delivery_failed") {
        updateData.deliveryFailureReason = deliveryFailureReason;
        updateData.deliveryFailureNote = deliveryFailureNote;
        updateData.deliveryFailedAt = new Date();
      }

      const orderUpdate = await tx.order.update({
        where: { id: existing.id },
        data: updateData,
        include: { items: true },
      });

      if (shouldRestoreProductStock) {
        for (const item of existing.items) {
          if (!item.productId) continue;

          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { increment: item.quantity },
            },
          });
        }
      }

      return orderUpdate;
    });

    if (shouldRestoreProductStock) {
      invalidateProductReadCache();
    }

    return NextResponse.json({
      success: true,
      message: shouldRestoreProductStock
        ? "Order cancelled and product stock restored."
        : "Order updated successfully.",
      order: mapOrder(updated, { includeAudit: true }),
    });
  } catch (error) {
    console.error("PUT /api/orders failed:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update order." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Order ID is required." },
        { status: 400 }
      );
    }

    const existing = await prisma.order.findFirst({
      where: {
        OR: [{ id }, { orderId: id }],
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, message: "Order not found." },
        { status: 404 }
      );
    }

    await prisma.order.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({
      success: true,
      message: "Order deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE /api/orders failed:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete order." },
      { status: 500 }
    );
  }
}
