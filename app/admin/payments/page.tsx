import AdminNav from "@/components/admin/AdminNav";
import PaymentVerificationClient from "@/components/admin/PaymentVerificationClient";

export default function AdminPaymentsPage() {
  return (
    <main className="min-h-screen bg-[#fcf8f6] px-4 py-10 text-[#2e221d]">
      <div className="mx-auto max-w-7xl space-y-8">
        <AdminNav />

        <PaymentVerificationClient />
      </div>
    </main>
  );
}
