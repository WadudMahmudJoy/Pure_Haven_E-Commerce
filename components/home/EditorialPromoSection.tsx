"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const slides = [
  {
    eyebrow: "New Arrivals",
    title: "Fresh Beauty Collection",
    subtitle: "Explore newly added cosmetics, skincare, haircare, and daily essentials.",
    image: "/images/categories/cosmetics.jpg",
    href: "/shop",
  },
  {
    eyebrow: "Top Picks",
    title: "Picked for Your Routine",
    subtitle: "Selected products for everyday beauty, care, and confidence.",
    image: "/images/categories/skincare.jpg",
    href: "/shop",
  },
  {
    eyebrow: "Hot Deals",
    title: "Beauty Offers Are Live",
    subtitle: "Discover special offers and limited-time product deals.",
    image: "/images/categories/perfume.jpg",
    href: "/shop",
  },
  {
    eyebrow: "Best Sellers",
    title: "Customer Favorites",
    subtitle: "Popular products customers are checking right now.",
    image: "/images/categories/haircare.jpg",
    href: "/shop",
  },
];

export default function EditorialPromoSection() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((prev) => (prev + 1) % slides.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="bg-[#fcf8f6] py-8">
      <div className="container-ph">
        <div className="relative overflow-hidden rounded-[28px] border border-[#ead9d1] bg-[#2e221d] shadow-sm">
          <div
            className="flex transition-transform duration-700 ease-out"
            style={{ transform: `translateX(-${active * 100}%)` }}
          >
            {slides.map((slide) => (
              <div
                key={slide.title}
                className="relative h-[360px] w-full shrink-0 overflow-hidden md:h-[430px]"
              >
                <img
                  src={slide.image}
                  alt={slide.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />

                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-black/5" />

                <div className="relative z-10 flex h-full max-w-2xl flex-col justify-center px-7 text-white md:px-12">
                  <p className="text-xs font-semibold uppercase tracking-[0.34em] text-white/80">
                    {slide.eyebrow}
                  </p>

                  <h2 className="mt-4 text-4xl font-semibold leading-tight md:text-6xl">
                    {slide.title}
                  </h2>

                  <p className="mt-4 max-w-xl text-sm leading-7 text-white/85 md:text-base">
                    {slide.subtitle}
                  </p>

                  <Link
                    href={slide.href}
                    className="mt-7 inline-flex w-fit rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#2e221d] transition hover:bg-[#2e221d] hover:text-white"
                  >
                    Shop now
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2">
            {slides.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setActive(index)}
                className={`h-2.5 rounded-full transition-all ${
                  active === index ? "w-9 bg-white" : "w-2.5 bg-white/50"
                }`}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}