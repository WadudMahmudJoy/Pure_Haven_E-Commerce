import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase2_backup_homepage_performance");
mkdirSync(backupDir, { recursive: true });

const files = [
  "app/page.tsx",
  "components/layout/Navbar.tsx",
  "components/home/HomeHeroSlider.tsx",
  "components/home/HomePromoGrid.tsx",
  "components/home/CategorySection.tsx",
  "components/layout/Footer.tsx",
];

for (const file of files) {
  copyFileSync(
    path.join(root, file),
    path.join(backupDir, file.replace(/[\\/]/g, "__"))
  );
}

function read(file) {
  return readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "");
}

function write(file, content) {
  writeFileSync(path.join(root, file), content, "utf8");
}

function mustReplace(file, source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Pattern not found in ${file}:\n${search.slice(0, 240)}`);
  }
  return source.replace(search, replacement);
}

write("app/page.tsx", `import { promises as fs } from "fs";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePromo = {
  id: string;
  kind?: string;
  label: string;
  title: string;
  subtitle?: string;
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
`);

{
  const file = "components/layout/Navbar.tsx";
  let source = read(file);

  source = mustReplace(
    file,
    source,
`export default function Navbar() {
  const [categories, setCategories] = useState<Category[]>(() =>
    getDefaultPublicCategories()
  );`,
`type NavbarProps = {
  initialCategories?: Category[];
  disableSelfFetch?: boolean;
};

export default function Navbar({
  initialCategories,
  disableSelfFetch = false,
}: NavbarProps = {}) {
  const [categories, setCategories] = useState<Category[]>(() =>
    initialCategories && initialCategories.length > 0
      ? initialCategories
      : getDefaultPublicCategories()
  );`
  );

  source = mustReplace(
    file,
    source,
`  useEffect(() => {
    async function loadCategories() {`,
`  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }, [initialCategories]);

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadCategories() {`
  );

  source = mustReplace(
    file,
    source,
`
  }, []);

  function closeMenu()`,
`
  }, [disableSelfFetch]);

  function closeMenu()`
  );

  write(file, source);
}

{
  const file = "components/home/HomeHeroSlider.tsx";
  let source = read(file);

  source = mustReplace(
    file,
    source,
`export default function HomeHeroSlider() {
  const [slides, setSlides] = useState<Slide[]>(fallbackSlides);`,
`type HomeHeroSliderProps = {
  initialSlides?: Slide[];
  disableSelfFetch?: boolean;
};

export default function HomeHeroSlider({
  initialSlides,
  disableSelfFetch = false,
}: HomeHeroSliderProps = {}) {
  const [slides, setSlides] = useState<Slide[]>(() =>
    initialSlides && initialSlides.length > 0 ? initialSlides : fallbackSlides
  );`
  );

  source = mustReplace(
    file,
    source,
`  useEffect(() => {
    async function loadSlides() {`,
`  useEffect(() => {
    if (initialSlides && initialSlides.length > 0) {
      setSlides(initialSlides);
      setActive(0);
    }
  }, [initialSlides]);

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadSlides() {`
  );

  source = mustReplace(
    file,
    source,
`
  }, []);

  const safeSlides`,
`
  }, [disableSelfFetch]);

  const safeSlides`
  );

  write(file, source);
}

{
  const file = "components/home/HomePromoGrid.tsx";
  let source = read(file);

  source = mustReplace(
    file,
    source,
`export default function HomePromoGrid() {
  const [products, setProducts] = useState<Product[]>([]);
  const [wide, setWide] = useState<HomePromo>(fallbackWide);`,
`type HomePromoGridProps = {
  initialProducts?: Product[];
  initialWide?: HomePromo | null;
  disableSelfFetch?: boolean;
};

export default function HomePromoGrid({
  initialProducts,
  initialWide,
  disableSelfFetch = false,
}: HomePromoGridProps = {}) {
  const [products, setProducts] = useState<Product[]>(() => initialProducts ?? []);
  const [wide, setWide] = useState<HomePromo>(() => initialWide ?? fallbackWide);`
  );

  source = mustReplace(
    file,
    source,
`  useEffect(() => {
    async function loadData() {`,
`  useEffect(() => {
    if (initialProducts) {
      setProducts(initialProducts);
    }
  }, [initialProducts]);

  useEffect(() => {
    if (initialWide) {
      setWide(initialWide);
    }
  }, [initialWide]);

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadData() {`
  );

  source = mustReplace(
    file,
    source,
`
  }, []);

  const newestProduct`,
`
  }, [disableSelfFetch]);

  const newestProduct`
  );

  write(file, source);
}

{
  const file = "components/home/CategorySection.tsx";
  let source = read(file);

  source = mustReplace(
    file,
    source,
`export default function CategorySection() {
  const [categories, setCategories] = useState<Category[]>(() =>
    getDefaultPublicCategories()
  );
  const [products, setProducts] = useState<Product[]>([]);`,
`type CategorySectionProps = {
  initialCategories?: Category[];
  initialProducts?: Product[];
  disableSelfFetch?: boolean;
};

export default function CategorySection({
  initialCategories,
  initialProducts,
  disableSelfFetch = false,
}: CategorySectionProps = {}) {
  const [categories, setCategories] = useState<Category[]>(() =>
    initialCategories && initialCategories.length > 0
      ? initialCategories
      : getDefaultPublicCategories()
  );
  const [products, setProducts] = useState<Product[]>(() => initialProducts ?? []);`
  );

  source = mustReplace(
    file,
    source,
`  useEffect(() => {
    let alive = true;`,
`  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }, [initialCategories]);

  useEffect(() => {
    if (initialProducts) {
      setProducts(initialProducts);
    }
  }, [initialProducts]);

  useEffect(() => {
    if (disableSelfFetch) return;

    let alive = true;`
  );

  source = mustReplace(
    file,
    source,
`
  }, []);

  const visibleCategories`,
`
  }, [disableSelfFetch]);

  const visibleCategories`
  );

  write(file, source);
}

{
  const file = "components/layout/Footer.tsx";
  let source = read(file);

  source = mustReplace(
    file,
    source,
`export default function Footer() {
  const [settings, setSettings] = useState<FooterSettings>(fallback);`,
`type FooterProps = {
  initialSettings?: Partial<FooterSettings> | null;
  disableSelfFetch?: boolean;
};

export default function Footer({
  initialSettings,
  disableSelfFetch = false,
}: FooterProps = {}) {
  const [settings, setSettings] = useState<FooterSettings>(() => ({
    ...fallback,
    ...(initialSettings ?? {}),
  }));`
  );

  source = mustReplace(
    file,
    source,
`  useEffect(() => {
    async function loadFooter() {`,
`  useEffect(() => {
    if (initialSettings) {
      setSettings({ ...fallback, ...initialSettings });
    }
  }, [initialSettings]);

  useEffect(() => {
    if (disableSelfFetch) return;

    async function loadFooter() {`
  );

  source = mustReplace(
    file,
    source,
`
  }, []);

  const quickLinks`,
`
  }, [disableSelfFetch]);

  const quickLinks`
  );

  write(file, source);
}

console.log("Phase 2 homepage performance patch applied.");
console.log(`Backups saved in: ${backupDir}`);
