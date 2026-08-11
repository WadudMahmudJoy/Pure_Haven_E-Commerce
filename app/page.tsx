import { promises as fs } from "fs";
import path from "path";
import TopBar from "@/components/layout/TopBar";
import Navbar from "@/components/layout/Navbar";
import HomeHeroSlider from "@/components/home/HomeHeroSlider";
import HomePromoGrid from "@/components/home/HomePromoGrid";
import CategorySection from "@/components/home/CategorySection";
import DealsBanner from "@/components/home/DealsBanner";
import BrandsSection from "@/components/home/BrandsSection";
import TrustSection from "@/components/home/TrustSection";
import Footer from "@/components/layout/Footer";
import { getCachedCategoryRows } from "@/lib/catalogRead";
import { getDefaultPublicCategories } from "@/lib/defaultCategories";
import { prisma } from "@/lib/prisma";

export const revalidate = 60;


type HomePromo = {
  id: string;
  kind?: string;
  label: string;
  title: string;
  subtitle: string;
  image: string;
  href: string;
  isActive: boolean;
  sortOrder: number;
};

type FooterSettings = {
  brandTitle: string;
  brandSubtitle: string;
  description: string;
  address: string;
  phone: string;
  email: string;
  facebookUrl: string;
  instagramUrl: string;
  paymentNote: string;
  copyright: string;
  quickLinksText: string;
  categoryLinksText: string;
  policyLinksText: string;
};

const dataDir = path.join(process.cwd(), "data");

async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const filePath = path.join(dataDir, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function activePromosByKind(promos: HomePromo[], kind: string) {
  return promos
    .filter((item) => item.kind === kind && item.isActive)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

async function getHomePageData() {
  const [categoryRows, products, promos, footerSettings] = await Promise.all([
    getCachedCategoryRows(false).catch(() => getDefaultPublicCategories()),
    prisma.product
      .findMany({
        orderBy: [{ id: "desc" }],
        select: {
          id: true,
          name: true,
          image: true,
          category: true,
          subcategory: true,
          isHotDeal: true,
          createdAt: true,
        },
      })
      .then((rows) =>
        rows.map((product) => ({
          ...product,
          createdAt: product.createdAt.toISOString(),
        }))
      )
      .catch(() => []),
    readJsonFile<HomePromo[]>("home-promos.json", []),
    readJsonFile<Partial<FooterSettings>>("footer-settings.json", {}),
  ]);

  return {
    categories: categoryRows,
    products,
    sliderPromos: activePromosByKind(Array.isArray(promos) ? promos : [], "slider"),
    widePromo: activePromosByKind(Array.isArray(promos) ? promos : [], "wide")[0] ?? null,
    footerSettings,
  };
}

export default async function HomePage() {
  const data = await getHomePageData();

  return (
    <>
      <TopBar />
      <Navbar initialCategories={data.categories} disableSelfFetch />

      <HomeHeroSlider initialSlides={data.sliderPromos} disableSelfFetch />
      <HomePromoGrid
        initialProducts={data.products}
        initialWide={data.widePromo}
        disableSelfFetch
      />

      <CategorySection
        initialCategories={data.categories}
        initialProducts={data.products}
        disableSelfFetch
      />

      <DealsBanner />
      <BrandsSection />
      <TrustSection />
      <Footer initialSettings={data.footerSettings} disableSelfFetch />
    </>
  );
}

