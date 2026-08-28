import type {
  ParsedPublicCatalogParams,
  ParsedAdminCatalogParams,
  PublicSortMode,
  AdminCatalogFilter,
} from "./types";

export class CatalogQueryParamError extends Error {
  constructor(
    public code: "INVALID_PAGE" | "INVALID_PAGE_SIZE",
    message: string
  ) {
    super(message);
    this.name = "CatalogQueryParamError";
  }
}

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_PUBLIC_PAGE = 10_000;
export const MAX_ADMIN_PAGE = 10_000;

function parseCanonicalBase10Integer(raw: unknown): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parsePublicCatalogParams(
  raw: Record<string, unknown>
): ParsedPublicCatalogParams {
  let invalidFilter = false;

  // 1. Page normalization
  let page = 1;
  if (raw.page !== undefined && raw.page !== null && raw.page !== "") {
    const p = parseCanonicalBase10Integer(raw.page);
    if (p === null || p < 1) {
      page = 1;
    } else if (p > MAX_PUBLIC_PAGE) {
      throw new CatalogQueryParamError(
        "INVALID_PAGE",
        `Requested page exceeds maximum allowed page boundary (${MAX_PUBLIC_PAGE}).`
      );
    } else {
      page = p;
    }
  }

  // 2. PageSize normalization (default 24, max 48)
  let pageSize = 24;
  if (raw.pageSize !== undefined && raw.pageSize !== null && raw.pageSize !== "") {
    const ps = parseCanonicalBase10Integer(raw.pageSize);
    pageSize = ps !== null && ps >= 1 ? Math.min(ps, 48) : 24;
  }

  // 3. Sort normalization
  const sortVal = String(raw.sort || "").trim().toLowerCase();
  const sort: PublicSortMode =
    sortVal === "price-asc" || sortVal === "price-desc" ? sortVal : "latest";

  // 4. Category normalization & validation
  let category: string | null = null;
  if (raw.category !== undefined && raw.category !== null) {
    const rawStr = String(raw.category).trim().toLowerCase();
    if (rawStr.length > 0) {
      if (rawStr.length <= 100 && SLUG_REGEX.test(rawStr)) {
        category = rawStr;
      } else {
        invalidFilter = true;
      }
    }
  }

  // 5. Subcategory normalization & validation
  let subcategory: string | null = null;
  if (raw.subcategory !== undefined && raw.subcategory !== null) {
    const rawSubStr = String(raw.subcategory).trim().toLowerCase();
    if (rawSubStr.length > 0) {
      if (category && rawSubStr.length <= 100 && SLUG_REGEX.test(rawSubStr)) {
        subcategory = rawSubStr;
      } else {
        invalidFilter = true;
      }
    }
  }

  // 6. Search query normalization (max 80 chars)
  let q: string | null = null;
  if (raw.q !== undefined && raw.q !== null) {
    const qTrim = String(raw.q).trim().slice(0, 80);
    q = qTrim.length > 0 ? qTrim : null;
  }

  // 7. Safe skip calculation
  const skipNum = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skipNum)) {
    throw new CatalogQueryParamError(
      "INVALID_PAGE",
      "Requested page/pageSize exceeds safe integer calculation."
    );
  }
  const skip = skipNum;

  return {
    page,
    pageSize,
    sort,
    category,
    subcategory,
    q,
    skip,
    invalidFilter,
  };
}

export function parseAdminCatalogParams(
  raw: Record<string, unknown>
): ParsedAdminCatalogParams {
  // 1. Page normalization
  let page = 1;
  if (raw.page !== undefined && raw.page !== null && raw.page !== "") {
    const p = parseCanonicalBase10Integer(raw.page);
    if (p === null || p < 1) {
      page = 1;
    } else if (p > MAX_ADMIN_PAGE) {
      throw new CatalogQueryParamError(
        "INVALID_PAGE",
        `Requested admin page exceeds maximum allowed boundary (${MAX_ADMIN_PAGE}).`
      );
    } else {
      page = p;
    }
  }

  // 2. PageSize normalization (default 20, max 50)
  let pageSize = 20;
  if (raw.pageSize !== undefined && raw.pageSize !== null && raw.pageSize !== "") {
    const ps = parseCanonicalBase10Integer(raw.pageSize);
    pageSize = ps !== null && ps >= 1 ? Math.min(ps, 50) : 20;
  }

  // 3. Filter normalization
  const filterVal = String(raw.filter || "").trim().toLowerCase();
  const filter: AdminCatalogFilter = [
    "hot",
    "upcoming",
    "discount",
    "badge",
  ].includes(filterVal)
    ? (filterVal as AdminCatalogFilter)
    : "all";

  // 4. Search query normalization (max 80 chars)
  let q: string | null = null;
  if (raw.q !== undefined && raw.q !== null) {
    const qTrim = String(raw.q).trim().slice(0, 80);
    q = qTrim.length > 0 ? qTrim : null;
  }

  // 5. Safe skip calculation
  const skipNum = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skipNum)) {
    throw new CatalogQueryParamError(
      "INVALID_PAGE",
      "Requested admin page/pageSize exceeds safe integer calculation."
    );
  }
  const skip = skipNum;

  return {
    page,
    pageSize,
    filter,
    q,
    skip,
  };
}
