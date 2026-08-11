import { writeFileSync } from "fs";

writeFileSync(
  "app/admin/payments/page.tsx",
`import PaymentVerificationClient from "@/components/admin/PaymentVerificationClient";

export default function AdminPaymentsPage() {
  return (
    <main className="min-h-screen bg-[#fbf7f4] px-4 py-8 text-[#171717] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-8 flex flex-wrap gap-3 rounded-[24px] border border-[#ead8cf] bg-white p-4 shadow-sm">
          <a className="rounded-full border border-[#ead8cf] px-4 py-2 text-sm font-medium hover:bg-[#f8f1ed]" href="/admin">
            Dashboard
          </a>
          <a className="rounded-full border border-[#ead8cf] px-4 py-2 text-sm font-medium hover:bg-[#f8f1ed]" href="/admin/products">
            Products
          </a>
          <a className="rounded-full border border-[#ead8cf] px-4 py-2 text-sm font-medium hover:bg-[#f8f1ed]" href="/admin/orders">
            Orders
          </a>
          <a className="rounded-full bg-[#2d1f1a] px-4 py-2 text-sm font-medium text-white" href="/admin/payments">
            Payments
          </a>
          <a className="rounded-full border border-[#ead8cf] px-4 py-2 text-sm font-medium hover:bg-[#f8f1ed]" href="/admin/home-promos">
            Home Slider
          </a>
        </nav>

        <PaymentVerificationClient />
      </div>
    </main>
  );
}
`,
  "utf8"
);

console.log("Fixed app/admin/payments/page.tsx without AdminShell dependency.");
