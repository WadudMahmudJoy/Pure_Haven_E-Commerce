import PaymentVerificationClient from "@/components/admin/PaymentVerificationClient";

const navClass =
  "rounded-full border border-[#ead8cf] bg-white px-4 py-2 text-sm font-medium text-[#2d1f1a] transition hover:bg-[#f8f1ed]";

export default function AdminPaymentsPage() {
  return (
    <main className="min-h-screen bg-[#fbf7f4] px-4 py-8 text-[#171717] sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-8 flex flex-wrap gap-3 rounded-[24px] border border-[#ead8cf] bg-white p-4 shadow-sm">
          <a className={navClass} href="/admin">
            Dashboard
          </a>
          <a className={navClass} href="/admin/products">
            Products
          </a>
          <a className={navClass} href="/admin/orders">
            Orders
          </a>
          <a className={navClass} href="/admin/payments">
            Payments
          </a>
          <a className={navClass} href="/admin/home-promos">
            Home Slider
          </a>
        </nav>

        <PaymentVerificationClient />
      </div>
    </main>
  );
}
