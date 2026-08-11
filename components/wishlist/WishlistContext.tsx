"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type WishlistItem = {
  id: number;
  name: string;
  price: number;
  image: string;
  category: string;
};

type WishlistContextType = {
  wishlistItems: WishlistItem[];
  wishlistCount: number;
  addToWishlist: (item: WishlistItem) => void;
  removeFromWishlist: (id: number) => void;
  toggleWishlist: (item: WishlistItem) => void;
  isInWishlist: (id: number) => boolean;
  clearWishlist: () => void;
};

const WishlistContext = createContext<WishlistContextType | undefined>(
  undefined
);

export function WishlistProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ph_wishlist");
      if (saved) {
        setWishlistItems(JSON.parse(saved));
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem("ph_wishlist", JSON.stringify(wishlistItems));
  }, [wishlistItems, loaded]);

  function addToWishlist(item: WishlistItem) {
    setWishlistItems((prev) => {
      const exists = prev.some((wishlistItem) => wishlistItem.id === item.id);
      if (exists) return prev;
      return [...prev, item];
    });
  }

  function removeFromWishlist(id: number) {
    setWishlistItems((prev) =>
      prev.filter((wishlistItem) => wishlistItem.id !== id)
    );
  }

  function toggleWishlist(item: WishlistItem) {
    setWishlistItems((prev) => {
      const exists = prev.some((wishlistItem) => wishlistItem.id === item.id);
      if (exists) {
        return prev.filter((wishlistItem) => wishlistItem.id !== item.id);
      }
      return [...prev, item];
    });
  }

  function isInWishlist(id: number) {
    return wishlistItems.some((item) => item.id === id);
  }

  function clearWishlist() {
    setWishlistItems([]);
  }

  const value = useMemo(
    () => ({
      wishlistItems,
      wishlistCount: wishlistItems.length,
      addToWishlist,
      removeFromWishlist,
      toggleWishlist,
      isInWishlist,
      clearWishlist,
    }),
    [wishlistItems]
  );

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);

  if (!context) {
    throw new Error("useWishlist must be used inside WishlistProvider");
  }

  return context;
}