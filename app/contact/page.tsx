import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function ContactPage() {
  return (
    <main>
      <TopBar />
      <Navbar />
      <section className="container-ph section-gap">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
          <div className="rounded-[28px] border border-[#ead9d1] bg-white p-8 shadow-sm">
            <p className="text-sm uppercase tracking-[0.22em] text-[#7a5244]">
              Contact
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[#2e221d]">
              Contact Pure Haven BD
            </h1>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              For product queries, order support, and delivery updates, contact
              Pure Haven BD through phone or email.
            </p>
          </div>

          <div className="rounded-[28px] border border-[#ead9d1] bg-white p-8 shadow-sm">
            <h2 className="text-xl font-semibold text-[#2e221d]">
              Support Information
            </h2>
            <div className="mt-5 space-y-3 text-sm text-neutral-700">
              <p><span className="font-medium text-[#2e221d]">Email:</span> purehavenbd@gmail.com</p>
              <p><span className="font-medium text-[#2e221d]">Phone:</span> +880 1977269164</p>
              <p><span className="font-medium text-[#2e221d]">Location:</span> Dhaka, Bangladesh</p>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
