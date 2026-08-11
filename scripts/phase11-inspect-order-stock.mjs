import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const root = process.cwd();
const outputDir = path.join(root, "_phase11_inspection");
mkdirSync(outputDir, { recursive: true });

function read(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) {
    return `FILE_NOT_FOUND: ${file}`;
  }
  return readFileSync(full, "utf8").replace(/^\uFEFF/, "");
}

function extractAround(source, keywords, radius = 2200) {
  const lower = source.toLowerCase();
  const chunks = [];

  for (const keyword of keywords) {
    const index = lower.indexOf(keyword.toLowerCase());
    if (index === -1) continue;

    const start = Math.max(0, index - radius);
    const end = Math.min(source.length, index + radius);
    chunks.push(`\n\n===== AROUND KEYWORD: ${keyword} =====\n\n${source.slice(start, end)}`);
  }

  return chunks.join("\n");
}

const ordersRoute = read("app/api/orders/route.ts");
const adminOrdersPage = read("app/admin/orders/page.tsx");
const schema = read("prisma/schema.prisma");

const report = `
==============================
PHASE 11 INSPECTION REPORT
==============================

--- prisma/schema.prisma: Order/Product/OrderItem/ProductVariant models ---

${extractAround(schema, ["model Order", "model OrderItem", "model Product", "model ProductVariant"], 1600)}

--- app/api/orders/route.ts: status/update/stock/cancel logic ---

${extractAround(ordersRoute, ["export async function PATCH", "export async function PUT", "status", "cancelled", "decrement", "increment", "order.update", "orderItem"], 2600)}

--- app/admin/orders/page.tsx: order status update fetch logic ---

${extractAround(adminOrdersPage, ["updateStatus", "setStatus", "status", "fetch(", "/api/orders", "PATCH", "PUT"], 2600)}
`;

const outputPath = path.join(outputDir, "phase11-inspection-report.txt");
writeFileSync(outputPath, report, "utf8");

console.log("Phase 11 inspection complete.");
console.log(`Report saved at: ${outputPath}`);
console.log("");
console.log("Open this file and send me its content or screenshots:");
console.log("_phase11_inspection/phase11-inspection-report.txt");
