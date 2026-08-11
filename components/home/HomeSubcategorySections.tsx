import Link from "next/link";
import type { Product } from "@/lib/getProducts";

type Props = {
  products: Product[];
};

function slug(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function label(value: string) {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const categorySections = [
  {
    title: "Cosmetics",
    slug: "cosmetics",
    subtitle: "Makeup essentials for everyday beauty.",
    fallback:
      "https://images.unsplash.com/photo-1596462502278-27bfdc403348?q=80&w=1200&auto=format&fit=crop",
    subcategories: [
      "lipstick",
      "liquid-lipstick",
      "lip-liner",
      "lip-gloss",
      "lip-balm",
      "foundation",
      "face-powder",
      "primer",
      "concealer",
      "blush",
      "highlighter",
      "eyeliner",
      "kajal",
      "mascara",
      "eyeshadow",
      "eyebrow-pencil",
      "brush",
    ],
  },
  {
    title: "Haircare",
    slug: "haircare",
    subtitle: "Care and styling picks for healthy hair.",
    fallback:
      "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?q=80&w=1200&auto=format&fit=crop",
    subcategories: [
      "shampoo",
      "conditioner",
      "hair-oil",
      "hair-serum",
      "hair-mask",
      "hair-color",
      "hair-treatment",
      "styling-gel-spray",
      "others",
    ],
  },
  {
    title: "Skincare",
    slug: "skincare",
    subtitle: "Daily skincare and glow essentials.",
    fallback:
      "https://images.unsplash.com/photo-1556228578-8c89e6adf883?q=80&w=1200&auto=format&fit=crop",
    subcategories: [
      "face-wash",
      "moisturizer",
      "cream",
      "lotion",
      "serum",
      "sunscreen",
      "toner",
      "scrub",
      "face-mask",
      "petroleum-jelly",
      "others",
    ],
  },
  {
    title: "Perfume",
    slug: "perfume",
    subtitle: "Fragrance collections for men and women.",
    fallback:
      "https://images.unsplash.com/photo-1541643600914-78b084683601?q=80&w=1200&auto=format&fit=crop",
    subcategories: [
      "EDT-Men",
      "EDT-Women",
      "EDP-Men",
      "EDP-Women",
      "Men's-Perfume",
      "Women's-Perfume",
      
      "Attar",
      "others",
    ],
  },
  {
    title: "Food",
    slug: "food",
    subtitle: "Selected pantry and lifestyle essentials.",
    fallback:
      "https://images.unsplash.com/photo-1587049352851-8d4e89133924?q=80&w=1200&auto=format&fit=crop",
    subcategories: [
      " Olive-oil",
      "honey",
      "dates",
      
      "nuts-seeds",
      "beverage",
      
      
      
      
      "others",
    ],
  },
  {
    title: "Mens Products",
    slug: "mens-products",
    subtitle: "Daily essentials and fashion items for men.",
    fallback:
      "https://images.unsplash.com/photo-1516257984-b1b4d707412e?q=80&w=1200&auto=format&fit=crop",
    subcategories: [
      "Men's shampoo",
      " Beard oil",
      "Shaving cream",
      "Shaving razor",
      "Shaving gel",
      "Beard shampoo",
      
      "others",
    ],
  },
];

export default function HomeSubcategorySections({ products }: Props) {
  return (
    <>
      {categorySections.map((section) => {
        const categoryProducts = products.filter(
          (product) => slug(product.category) === section.slug
        );

        return (
          <section key={section.slug} className="container-ph section-gap">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.22em] text-[#7a5244]">
                  Shop {section.title}
                </p>
                <h2 className="mt-2 text-3xl font-semibold text-[#2e221d]">
                  {section.title}
                </h2>
                <p className="mt-2 max-w-xl text-sm text-neutral-600">
                  {section.subtitle}
                </p>
              </div>

              <Link
                href={`/shop?category=${section.slug}`}
                className="shrink-0 text-sm font-semibold uppercase tracking-[0.14em] text-[#2e221d] hover:text-[#7a5244]"
              >
                View All
              </Link>
            </div>

            <div className="flex gap-5 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {section.subcategories.map((subcategory) => {
                const matchedProduct = categoryProducts.find(
                  (product) => slug(product.subcategory) === subcategory
                );

                return (
                  <Link
                    key={subcategory}
                    href={`/shop?category=${section.slug}&subcategory=${subcategory}`}
                    className="group relative h-[245px] w-[165px] shrink-0 overflow-hidden rounded-none border border-[#ead9d1] bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <img
                         src={matchedProduct?.image || section.fallback}
                         alt={label(subcategory)}
                         loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

                    <div className="absolute bottom-5 left-5 right-5 text-white">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/80">
                        Subcategory
                      </p>
                      <h3 className="mt-1 text-2xl font-semibold leading-tight">
                        {label(subcategory)}
                      </h3>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}