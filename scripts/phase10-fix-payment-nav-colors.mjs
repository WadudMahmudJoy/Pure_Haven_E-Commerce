import { readFileSync, writeFileSync } from "fs";

const file = "app/admin/payments/page.tsx";
let source = readFileSync(file, "utf8").replace(/^\uFEFF/, "");

source = source.replaceAll(
  `className="rounded-full bg-[#2d1f1a] px-4 py-2 text-sm font-medium text-white" href="/admin/payments"`,
  `className="rounded-full bg-[#2d1f1a] px-4 py-2 text-sm font-semibold !text-white shadow-sm hover:bg-[#2d1f1a] hover:!text-white" href="/admin/payments"`
);

source = source.replaceAll(
  `className="rounded-full border border-[#ead8cf] px-4 py-2 text-sm font-medium hover:bg-[#f8f1ed]"`,
  `className="rounded-full border border-[#ead8cf] px-4 py-2 text-sm font-medium text-[#2d1f1a] hover:bg-[#f8f1ed] hover:text-[#2d1f1a]"`
);

writeFileSync(file, source, "utf8");

console.log("Fixed payments page nav button colors.");
