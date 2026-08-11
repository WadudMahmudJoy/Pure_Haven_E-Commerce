const brands = [
  { name: "Neutrogena", src: "/brands/neutrogena.svg" },
  { name: "Dove", src: "/brands/dove.svg" },
  { name: "Garnier", src: "/brands/garnier.svg" },
  { name: "Nivea", src: "/brands/nivea.svg" },
  { name: "Vaseline", src: "/brand-logos/vaseline.svg" },
  { name: "L'Oréal", src: "/brands/loreal.svg" },
  { name: "Maybelline", src: "/brand-logos/maybelline.svg" },
  { name: "Pond's", src: "/brands/ponds.svg" },
];

export default function BrandsSection() {
  const railBrands = [...brands, ...brands];

  return (
    <section className="container-ph section-gap overflow-hidden">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-semibold text-[#2e221d]">Top Brands</h2>
      </div>

      <div className="relative overflow-hidden rounded-[28px] border border-[#ead9d1] bg-white py-6 shadow-sm">
        <div className="ph-brand-logo-track flex w-max items-center gap-6 px-6">
          {railBrands.map((brand, index) => (
            <div
              key={`${brand.name}-${index}`}
              className="flex h-[96px] min-w-[220px] items-center justify-center rounded-[24px] border border-[#ead9d1] bg-[#fffaf7] px-8 shadow-sm"
              aria-hidden={index >= brands.length}
            >
              <img
                src={brand.src}
                alt={brand.name}
                className="max-h-[58px] max-w-[150px] object-contain"
              />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .ph-brand-logo-track {
          animation: phBrandLogoRail 30s linear infinite;
        }

        .ph-brand-logo-track:hover {
          animation-play-state: paused;
        }

        @keyframes phBrandLogoRail {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </section>
  );
}

