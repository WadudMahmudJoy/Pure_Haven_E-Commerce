"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const cards = [
  {
    eyebrow: "Fresh Just In",
    title: "New Arrivals",
    description: "Explore newly added beauty and self-care essentials.",
    href: "/shop",
    image: "/images/categories/cosmetics.jpg",
  },
  {
    eyebrow: "Customer Favorites",
    title: "Top Picks",
    description: "Selected products picked for Pure Haven BD customers.",
    href: "/shop",
    image: "/images/categories/skincare.jpg",
  },
  {
    eyebrow: "Limited Offers",
    title: "Hot Deals",
    description: "Shop special offers and discounted products.",
    href: "/shop",
    image: "/images/categories/perfume.jpg",
  },
  {
    eyebrow: "Popular Choices",
    title: "Best Sellers",
    description: "Products customers are checking and buying most.",
    href: "/shop",
    image: "/images/categories/haircare.jpg",
  },
];

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

export default function HomeFeatureGrid() {
  const [cardsPerSlide, setCardsPerSlide] = useState(2);
  const [active, setActive] = useState(0);

  useEffect(() => {
    function updateLayout() {
      setCardsPerSlide(window.innerWidth < 768 ? 1 : 2);
    }

    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  const slides = useMemo(() => chunk(cards, cardsPerSlide), [cardsPerSlide]);

  useEffect(() => {
    setActive(0);
  }, [cardsPerSlide]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((prev) => (prev + 1) % slides.length);
    }, 3800);

    return () => window.clearInterval(timer);
  }, [slides.length]);

  return (
    <section className="container-ph py-6 md:py-8">
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-700 ease-out"
          style={{ transform: `translateX(-${active * 100}%)` }}
        >
          {slides.map((group, slideIndex) => (
            <div key={slideIndex} className="w-full shrink-0">
              <div className="grid gap-4 md:grid-cols-2 md:gap-5">
                {group.map((card) => (
                  <Link
                    key={card.title}
                    href={card.href}
                    className="group relative h-[210px] overflow-hidden rounded-[22px] border border-[#ead9d1] bg-[#2e221d] shadow-sm md:h-[250px] md:rounded-[28px]"
                  >
                    <img
                      src={card.image}
                      alt={card.title}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />

                    <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-black/5" />

                    <div className="absolute left-5 top-1/2 max-w-[260px] -translate-y-1/2 text-white md:left-7 md:max-w-[320px]">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/80 md:text-xs md:tracking-[0.28em]">
                        {card.eyebrow}
                      </p>

                      <h3 className="mt-2 text-2xl font-semibold leading-tight md:mt-3 md:text-3xl">
                        {card.title}
                      </h3>

                      <p className="mt-2 text-xs leading-5 text-white/85 md:text-sm md:leading-6">
                        {card.description}
                      </p>

                      <span className="mt-4 inline-flex rounded-full bg-white px-5 py-2 text-xs font-bold text-[#2e221d] shadow-sm transition group-hover:bg-[#2e221d] group-hover:text-white md:mt-5 md:px-6 md:py-2.5 md:text-sm">
                        Explore
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-center gap-2 md:mt-5">
        {slides.map((_, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setActive(index)}
            className={`h-2.5 rounded-full transition-all ${
              active === index ? "w-8 bg-[#2e221d]" : "w-2.5 bg-[#d8c7bf]"
            }`}
            aria-label={`Go to feature slide ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
}