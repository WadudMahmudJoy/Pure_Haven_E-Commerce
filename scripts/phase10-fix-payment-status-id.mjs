import { readFileSync, writeFileSync } from "fs";

const file = "app/api/orders/payment-status/route.ts";
let source = readFileSync(file, "utf8").replace(/^\uFEFF/, "");

source = source.replace(
`    const orderId = String(body?.orderId || "").trim();
    const numericId = Number(body?.id);
    const paymentStatus = String(body?.paymentStatus || "").trim();

    if (!orderId && !Number.isFinite(numericId)) {
      return NextResponse.json(
        { success: false, message: "Order id is required." },
        { status: 400 }
      );
    }`,
`    const orderId = String(body?.orderId || "").trim();
    const id = String(body?.id || "").trim();
    const paymentStatus = String(body?.paymentStatus || "").trim();

    if (!orderId && !id) {
      return NextResponse.json(
        { success: false, message: "Order id is required." },
        { status: 400 }
      );
    }`
);

source = source.replace(
`    const order = await prisma.order.findFirst({
      where: {
        OR: [
          ...(orderId ? [{ orderId }] : []),
          ...(Number.isFinite(numericId) ? [{ id: numericId }] : []),
        ],
      },
      select: {
        id: true,
        orderId: true,
      },
    });`,
`    const lookup = [
      ...(orderId ? [{ orderId }] : []),
      ...(id ? [{ id }] : []),
    ];

    const order = await prisma.order.findFirst({
      where: {
        OR: lookup,
      },
      select: {
        id: true,
        orderId: true,
      },
    });`
);

writeFileSync(file, source, "utf8");

console.log("Fixed payment-status route: order id lookup now uses string id.");
