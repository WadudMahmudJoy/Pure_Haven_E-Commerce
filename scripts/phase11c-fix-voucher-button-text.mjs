import { readFileSync, writeFileSync } from "fs";

const file = "app/admin/orders/page.tsx";
let source = readFileSync(file, "utf8").replace(/^\uFEFF/, "");

source = source.replaceAll(
  `className="rounded-full bg-[#2d1f1a] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#8b5a45]"`,
  `className="rounded-full bg-[#2d1f1a] px-6 py-3 text-sm font-semibold !text-white shadow-sm transition hover:bg-[#8b5a45] hover:!text-white"`
);

writeFileSync(file, source, "utf8");

console.log("Fixed Print Voucher / Print Invoice button text color.");
