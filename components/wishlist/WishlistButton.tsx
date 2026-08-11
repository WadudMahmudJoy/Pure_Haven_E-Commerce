"use client";

import { useWishlist } from "@/components/wishlist/WishlistContext";

type WishlistButtonProps = {
  id: number;
  name: string;
  price: number;
  image: string;
  category: string;
};

export default function WishlistButton(props: WishlistButtonProps) {
  const { toggleWishlist, isInWishlist } = useWishlist();
  const { id, name, price, image, category } = props;

  const wished = isInWishlist(id);

  return (
    <button
      type="button"
      onClick={() => toggleWishlist({ id, name, price, image, category })}
      className={`rounded-full border px-6 py-3 transition ${
        wished
          ? "border-[#2e221d] bg-[#2e221d] text-white"
          : "border-[#ead9d1] text-[#2e221d] hover:bg-[#f8f3ef]"
      }`}
    >
      {wished ? "Saved to Wishlist" : "Add to Wishlist"}
    </button>
  );
}