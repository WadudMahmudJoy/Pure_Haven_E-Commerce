import NavbarTopClickFix from "@/components/layout/NavbarTopClickFix";
import MobileNavClickFix from "@/components/layout/MobileNavClickFix";
import SafeMobileBottomNav from "@/components/layout/SafeMobileBottomNav";
import FloatingCartSummary from "@/components/cart/FloatingCartSummary";
import CartBurstProvider from "@/components/cart/CartBurstProvider";
import type { Metadata } from "next";
import "./globals.css";
import RouteChromeGuard from "@/components/layout/RouteChromeGuard";
import FloatingMessageButton from "@/components/layout/FloatingMessageButton";
import { CartProvider } from "@/components/cart/CartContext";
import { WishlistProvider } from "@/components/wishlist/WishlistContext";
import { MobileUIProvider } from "@/components/mobile/MobileUIContext";

export const metadata: Metadata = {
  metadataBase: new URL("https://pure-haven-bd-final-wdb1.vercel.app"),
  title: {
    default: "Pure Haven BD | Beauty, Skincare, Perfume & Lifestyle Store",
    template: "%s | Pure Haven BD",
  },
  description:
    "Shop cosmetics, skincare, haircare, perfume, men's products, and lifestyle essentials from Pure Haven BD.",
  keywords: [
    "Pure Haven BD",
    "Bangladesh ecommerce",
    "cosmetics Bangladesh",
    "skincare Bangladesh",
    "perfume Bangladesh",
    "haircare products",
  ],
  openGraph: {
    title: "Pure Haven BD",
    description:
      "Beauty, skincare, fragrance and lifestyle essentials in one online store.",
    url: "https://pure-haven-bd-final-wdb1.vercel.app",
    siteName: "Pure Haven BD",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <MobileUIProvider>
          <CartProvider>
            <WishlistProvider>{children}</WishlistProvider>
            <CartBurstProvider />
            <FloatingCartSummary />
</CartProvider>
        </MobileUIProvider>
              <FloatingMessageButton />
              <RouteChromeGuard />
        <SafeMobileBottomNav />
              <MobileNavClickFix />
              <NavbarTopClickFix />
      </body>
    </html>
  );
}







