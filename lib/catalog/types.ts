export type PublicSortMode = "latest" | "price-asc" | "price-desc";

export type AdminCatalogFilter = "all" | "hot" | "upcoming" | "discount" | "badge";

export type PublicProductCardDTO = {
  id: number;
  name: string;
  price: number;
  compareAtPrice: number | null;
  image: string;
  category: string;
  stock: number;
  isHotDeal: boolean;
  isUpcoming: boolean;
  badgeText: string | null;
  badgeTone: string;
  hasVariants: boolean;
};

export type PublicProductVariantDTO = {
  id: number;
  label: string;
  price: number;
  stock: number;
  image: string | null;
};

export type PublicProductDetailDTO = PublicProductCardDTO & {
  categoryId: number | null;
  subcategory: string | null;
  description: string | null;
  variants: PublicProductVariantDTO[];
};

export type AdminProductListDTO = {
  id: number;
  name: string;
  price: number;
  compareAtPrice: number | null;
  image: string;
  category: string;
  categoryId: number | null;
  subcategory: string | null;
  stock: number;
  isHotDeal: boolean;
  isUpcoming: boolean;
  badgeText: string | null;
  badgeTone: string;
  isActive: boolean;
  createdAt: string;
  variantCount: number;
  hasVariants: boolean;
};

export type AdminProductVariantDTO = {
  id: number;
  productId: number;
  label: string;
  price: number;
  stock: number;
  image: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type AdminProductDetailDTO = AdminProductListDTO & {
  description: string | null;
  deletedAt: string | null;
  updatedAt: string;
  variants: AdminProductVariantDTO[];
};

export type PaginatedResult<T> = {
  success: true;
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasMore: boolean;
  nextPage: number | null;
};

export type ParsedPublicCatalogParams = {
  page: number;
  pageSize: number;
  sort: PublicSortMode;
  category: string | null;
  subcategory: string | null;
  q: string | null;
  skip: number;
  invalidFilter: boolean;
};

export type ParsedAdminCatalogParams = {
  page: number;
  pageSize: number;
  filter: AdminCatalogFilter;
  q: string | null;
  skip: number;
};
