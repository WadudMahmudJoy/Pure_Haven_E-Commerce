import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function PrivacyPolicyPage() {
  return (
    <main>
      <TopBar />
      <Navbar />
      <section className="container-ph section-gap">
        <div className="rounded-[28px] border border-[#ead9d1] bg-white p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.22em] text-[#7a5244]">
            Policy
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#2e221d]">
            Privacy Policy
          </h1>
          <div className="mt-6 space-y-4 text-sm leading-6 text-neutral-700">
            <p>
              Pure Haven BD collects only the information needed to process
              orders, contact customers, and support delivery.
            </p>
            <p>
              Customer names, phone numbers, addresses, order items, and payment
              references are used for order handling and customer support.
            </p>
            <p>
              Personal order information is not sold to third parties. Delivery
              information may be shared only when needed to complete an order.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
