import Link from "next/link";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function OffersPage() {
  return (
    <main>
      <TopBar />
      <Navbar />
      <section className="container-ph section-gap">
        <div className="rounded-[28px] border border-[#ead9d1] bg-white p-8 text-center shadow-sm">
          <p className="text-sm uppercase tracking-[0.22em] text-[#7a5244]">
            Offers
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#2e221d]">
            Current Offers
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-neutral-600">
            Special offers and campaign products will be shown here. For now,
            explore the latest products from the shop.
          </p>
          <Link href="/shop?sort=latest" className="btn-primary mt-6 inline-block">
            Browse Latest Products
          </Link>
        </div>
      </section>
      <Footer />
    </main>
  );
}
