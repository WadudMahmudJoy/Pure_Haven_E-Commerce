import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function TermsConditionsPage() {
  return (
    <main>
      <TopBar />
      <Navbar />
      <section className="container-ph section-gap">
        <div className="rounded-[28px] border border-[#ead9d1] bg-white p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.22em] text-[#7a5244]">
            Terms
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#2e221d]">
            Terms &amp; Conditions
          </h1>
          <div className="mt-6 space-y-4 text-sm leading-6 text-neutral-700">
            <p>
              Orders are accepted after customer information, product
              availability, and delivery details are reviewed.
            </p>
            <p>
              Product prices, stock, and delivery charges may change based on
              availability and delivery location.
            </p>
            <p>
              Customers should provide correct phone numbers and addresses so
              the order can be confirmed and delivered smoothly.
            </p>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
