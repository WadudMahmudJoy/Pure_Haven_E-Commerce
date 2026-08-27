import "dotenv/config";
import { prisma } from "../lib/prisma.js";

async function checkDistinct() {
  const orderStatuses = await prisma.order.findMany({ select: { status: true }, distinct: ['status'] });
  const resStatuses = await prisma.inventoryReservation.findMany({ select: { status: true }, distinct: ['status'] });
  const resReasons = await prisma.inventoryReservation.findMany({ select: { releaseReason: true }, distinct: ['releaseReason'] });
  const payStates = await prisma.paymentRecord.findMany({ select: { state: true }, distinct: ['state'] });
  const codStates = await prisma.paymentRecord.findMany({ select: { codSettlementState: true }, distinct: ['codSettlementState'] });
  const evStates = await prisma.paymentEvidenceAttempt.findMany({ select: { state: true }, distinct: ['state'] });
  const retDisps = await prisma.returnItem.findMany({ select: { disposition: true }, distinct: ['disposition'] });

  console.log("Distinct DB Values:", {
    orderStatuses: orderStatuses.map(r => r.status),
    resStatuses: resStatuses.map(r => r.status),
    resReasons: resReasons.map(r => r.releaseReason),
    payStates: payStates.map(r => r.state),
    codStates: codStates.map(r => r.codSettlementState),
    evStates: evStates.map(r => r.state),
    retDisps: retDisps.map(r => r.disposition),
  });
}

checkDistinct()
  .catch(console.error)
  .finally(() => prisma.$disconnect());