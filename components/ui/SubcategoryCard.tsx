"use client";

import Link from "next/link";
import { useState } from "react";

type SubcategoryCardProps = {
  title: string;
  image: string;
  href: string;
  active?: boolean;
  onClick?: () => void;
};

export default function SubcategoryCard({
  title,
  image,
  href,
  active = false,
  onClick,
}: SubcategoryCardProps) {
  const [imageError, setImageError] = useState(false);

  const hasValidImage = image && image.trim() !== "" && !imageError;

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group relative block overflow-hidden rounded-none border bg-white shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-md ${
        active ? "border-[#2e221d]" : "border-[#ead9d1]"
      }`}
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        {hasValidImage ? (
          <img
            src={image}
            alt={title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(180deg,#f3eadf_0%,#e7d5c3_45%,#cdb39b_100%)]" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/12 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5">
          <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/80 sm:text-[11px]">
            Subcategory
          </p>
          <h3 className="text-xl font-semibold leading-tight sm:text-2xl">
            {title}
          </h3>
        </div>
      </div>
    </Link>
  );
}