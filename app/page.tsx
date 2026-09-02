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
import {
  getHomepagePromos,
  getRepresentativeSubcategoryImages,
} from "@/lib/catalog/homepageQueries";

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

function activePromosByKind(promos: HomePromo[], kind: string) {
  return promos
    .filter((item) => item.kind === kind && item.isActive)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

async function getHomePageData() {
  const [categoryRows, homepagePromos, subcategoryImageMap, promos, footer] =
    await Promise.all([
      getCachedCategoryRows(false).catch(() => getDefaultPublicCategories()),
      getHomepagePromos().catch(() => ({
        newestProduct: null,
        hotDealProduct: null,
      })),
      getRepresentativeSubcategoryImages().catch(() => ({})),
      prisma.homePromo
        .findMany({
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        })
        .then((rows) =>
          rows.map((p) => ({
            id: String(p.id),
            kind: p.kind,
            label: p.label,
            title: p.title,
            subtitle: p.subtitle,
            image: p.image,
            href: p.href,
            isActive: p.isActive,
            sortOrder: p.sortOrder,
          }))
        )
        .catch(() => []),
      prisma.footerSettings
        .findFirst({
          orderBy: { id: "asc" },
          include: { links: { orderBy: { sortOrder: "asc" } } },
        })
        .catch(() => null),
    ]);

  let footerSettings: Partial<FooterSettings> = {};
  if (footer) {
    const quickLinks = footer.links
      .filter((l) => l.group === "QUICK_LINKS" && l.isActive)
      .map((l) => `${l.label}|${l.url}`)
      .join("\n");
    const categoryLinks = footer.links
      .filter((l) => l.group === "CATEGORY_LINKS" && l.isActive)
      .map((l) => `${l.label}|${l.url}`)
      .join("\n");
    const policyLinks = footer.links
      .filter((l) => l.group === "POLICY_LINKS" && l.isActive)
      .map((l) => `${l.label}|${l.url}`)
      .join("\n");

    footerSettings = {
      brandTitle: footer.brandTitle,
      brandSubtitle: footer.brandSubtitle,
      description: footer.description,
      address: footer.address,
      phone: footer.phone,
      email: footer.email,
      facebookUrl: footer.facebookUrl,
      instagramUrl: footer.instagramUrl,
      paymentNote: footer.paymentNote,
      copyright: footer.copyright,
      quickLinksText: quickLinks,
      categoryLinksText: categoryLinks,
      policyLinksText: policyLinks,
    };
  }

  return {
    categories: categoryRows,
    newestProduct: homepagePromos.newestProduct,
    hotDealProduct: homepagePromos.hotDealProduct,
    subcategoryImageMap,
    sliderPromos: activePromosByKind(promos, "slider"),
    widePromo: activePromosByKind(promos, "wide")[0] ?? null,
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
        newestProduct={data.newestProduct}
        hotDealProduct={data.hotDealProduct}
        initialWide={data.widePromo}
        disableSelfFetch
      />

      <CategorySection
        initialCategories={data.categories}
        subcategoryImageMap={data.subcategoryImageMap}
        disableSelfFetch
      />

      <DealsBanner />
      <BrandsSection />
      <TrustSection />
      <Footer initialSettings={data.footerSettings} disableSelfFetch />
    </>
  );
}
