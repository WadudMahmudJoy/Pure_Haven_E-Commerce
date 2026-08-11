import Link from "next/link";

type CategoryCardProps = {
  title: string;
  image: string;
  href: string;
};

export default function CategoryCard({
  title,
  image,
  href,
}: CategoryCardProps) {
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-none border border-[#ead9d1] bg-white shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        <img
          src={image}
          alt={title}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/12 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5">
          <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/80 sm:text-[11px]">
            Collection
          </p>
          <h3 className="text-xl font-semibold leading-tight sm:text-2xl">
            {title}
          </h3>
        </div>
      </div>
    </Link>
  );
}