import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase11_backup_cancel_stock_restore");
mkdirSync(backupDir, { recursive: true });

const file = "app/api/orders/route.ts";
const fullPath = path.join(root, file);

copyFileSync(fullPath, path.join(backupDir, "app__api__orders__route.ts"));

let source = readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");

const oldBlock = `    const updated = await prisma.order.update({
      where: { id: existing.id },
      data: {
        status: normalizeString(body.status) || existing.status,
        paymentMethod: normalizeString(body.paymentMethod) || existing.paymentMethod,
        paymentStatus: normalizeString(body.paymentStatus) || existing.paymentStatus,
        paymentProvider:
          body.paymentDetails !== undefined
            ? normalizeString(body.paymentDetails?.provider) || null
            : existing.paymentProvider,
        paymentSenderNumber:
          body.paymentDetails !== undefined
            ? sanitizePhone(normalizeString(body.paymentDetails?.senderNumber)) || null
            : existing.paymentSenderNumber,
        paymentTrxId:
          body.paymentDetails !== undefined
            ? getPaymentTrxId(body) || null
            : existing.paymentTrxId,
      },
      include: { items: true },
    });

    return NextResponse.json({
      success: true,
      message: "Order updated successfully.",
      order: mapOrder(updated),
    });`;

const newBlock = `    const nextStatus = normalizeString(body.status) || existing.status;
    const shouldRestoreProductStock =
      existing.status !== "cancelled" && nextStatus === "cancelled";

    const updated = await prisma.$transaction(async (tx) => {
      const orderUpdate = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          paymentMethod: normalizeString(body.paymentMethod) || existing.paymentMethod,
          paymentStatus: normalizeString(body.paymentStatus) || existing.paymentStatus,
          paymentProvider:
            body.paymentDetails !== undefined
              ? normalizeString(body.paymentDetails?.provider) || null
              : existing.paymentProvider,
          paymentSenderNumber:
            body.paymentDetails !== undefined
              ? sanitizePhone(normalizeString(body.paymentDetails?.senderNumber)) || null
              : existing.paymentSenderNumber,
          paymentTrxId:
            body.paymentDetails !== undefined
              ? getPaymentTrxId(body) || null
              : existing.paymentTrxId,
        },
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
      order: mapOrder(updated),
    });`;

if (!source.includes(oldBlock)) {
  throw new Error("Target order update block not found. app/api/orders/route.ts may have changed.");
}

source = source.replace(oldBlock, newBlock);

writeFileSync(fullPath, source, "utf8");

console.log("Phase 11B applied: product stock restores when order becomes cancelled.");
console.log("Variant stock restore intentionally not added because OrderItem has no variantId field.");
console.log(`Backup saved in: ${backupDir}`);
