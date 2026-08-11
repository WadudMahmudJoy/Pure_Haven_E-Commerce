import Link from "next/link";

export default function Hero() {
  return (
    <section className="section-gap">
      <div className="container-ph grid items-center gap-10 md:grid-cols-2 md:gap-12">
        <div className="order-2 md:order-1">
          <p className="mb-3 text-sm font-medium uppercase tracking-[0.24em] text-[#7a5244]">
            Pure Beauty Collection
          </p>

          <h1 className="max-w-xl text-4xl font-semibold leading-tight text-[#2e221d] md:text-5xl lg:text-6xl">
            Discover Your Natural Glow
          </h1>

          <p className="mt-5 max-w-lg text-base leading-7 text-neutral-600">
            Cosmetics, skincare, perfumes, and daily essentials curated for a
            softer, more confident everyday routine.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Link
              href="/shop"
              className="inline-flex rounded-none bg-[#2e221d] px-7 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#7a5244]"
            >
              Shop Now
            </Link>

            <Link
              href="#featured-products"
              className="inline-flex items-center text-sm font-medium text-[#2e221d] transition hover:text-[#7a5244]"
            >
              Browse featured products
            </Link>
          </div>
        </div>

        <div className="order-1 relative md:order-2">
          <div className="overflow-hidden rounded-none border border-[#ead9d1] bg-white shadow-[0_12px_40px_rgba(46,34,29,0.08)]">
            <img
              src="https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?q=80&w=1200&auto=format&fit=crop"
              alt="Pure Haven BD hero"
              className="h-[300px] w-full object-cover sm:h-[380px] md:h-[460px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}