import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaAdapter?: PrismaPg;
};

const connectionString =
  (process.env.NODE_ENV === "test" && process.env.DATABASE_URL_TEST)
    ? process.env.DATABASE_URL_TEST
    : (process.env.DATABASE_URL || "");

const adapter =
  globalForPrisma.prismaAdapter ??
  new PrismaPg({
    connectionString,
  });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaAdapter = adapter;
}
