import Link from "next/link";

export default function DealsBanner() {
  return (
    <section className="container-ph">
      <div className="overflow-hidden rounded-[28px] border border-[#ead9d1] bg-[#f7e8e4]">
        <div className="grid items-center gap-6 px-8 py-10 md:grid-cols-2 md:px-12">
          
          {/* Left Content */}
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-[0.25em] text-[#7a5244]">
              Limited Time
            </p>

            <h2 className="mb-3 text-4xl font-semibold">
              Best Deals Up To 50% Off
            </h2>

            <p className="mb-6 text-neutral-700">
              Explore selected skincare, makeup and self-care products with special discounts this week.
            </p>

            <Link href="/offers" className="btn-primary inline-block">
              Shop Deals
            </Link>
          </div>

          {/* Right Image */}
          <div
            className="min-h-[260px] rounded-[24px] bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1596755389378-c31d21fd1273?q=80&w=1200&auto=format&fit=crop')",
            }}
          />
        </div>
      </div>
    </section>
  );
}