import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const outputDir = path.join(root, "_phase12_inspection");
mkdirSync(outputDir, { recursive: true });

function read(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) return `FILE_NOT_FOUND: ${file}`;
  return readFileSync(full, "utf8").replace(/^\uFEFF/, "");
}

function extractAround(source, keywords, radius = 2600) {
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

const files = {
  customerAuth: "app/api/customer-auth/route.ts",
  userLogin: "app/user-login/page.tsx",
  ordersRoute: "app/api/orders/route.ts",
  navbar: "components/layout/Navbar.tsx",
  customerUsers: "data/customer-users.json",
};

const customerAuth = read(files.customerAuth);
const userLogin = read(files.userLogin);
const ordersRoute = read(files.ordersRoute);
const navbar = read(files.navbar);
const customerUsers = read(files.customerUsers);

const report = `
==============================
PHASE 12 INSPECTION REPORT
Customer Dashboard / Order History
==============================

--- app/api/customer-auth/route.ts ---

${extractAround(customerAuth, [
  "export async function",
  "login",
  "register",
  "logout",
  "cookie",
  "customer",
  "password",
  "session"
], 3000)}

--- app/user-login/page.tsx ---

${extractAround(userLogin, [
  "localStorage",
  "customer",
  "login",
  "register",
  "/api/customer-auth",
  "router",
  "cookie"
], 3000)}

--- app/api/orders/route.ts customer/order access ---

${extractAround(ordersRoute, [
  "export async function GET",
  "track",
  "phone",
  "customerPhone",
  "orderId",
  "requireAdmin",
  "orders"
], 3000)}

--- components/layout/Navbar.tsx account/user link ---

${extractAround(navbar, [
  "user-login",
  "account",
  "profile",
  "customer",
  "logout",
  "href"
], 3000)}

--- data/customer-users.json sample ---

${customerUsers.slice(0, 3000)}
`;

const outputPath = path.join(outputDir, "phase12-inspection-report.txt");
writeFileSync(outputPath, report, "utf8");

console.log("Phase 12 inspection complete.");
console.log(`Report saved at: ${outputPath}`);
console.log("");
console.log("Open this file and send me its content or screenshots:");
console.log("_phase12_inspection/phase12-inspection-report.txt");
