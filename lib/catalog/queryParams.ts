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

function normalizeCanonicalDecimalDigits(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    return null;
  }

  return value.replace(/^0+(?=\d)/, "");
}

function exceedsDecimalBound(decimalDigits: string, max: number): boolean {
  const maxText = String(max);
  if (decimalDigits.length !== maxText.length) {
    return decimalDigits.length > maxText.length;
  }
  return decimalDigits > maxText;
}

export function parsePublicCatalogParams(
  raw: Record<string, unknown>
): ParsedPublicCatalogParams {
  let invalidFilter = false;

  // 1. Page normalization
  let page = 1;
  if (raw.page !== undefined && raw.page !== null && raw.page !== "") {
    const digits = normalizeCanonicalDecimalDigits(raw.page);
    if (digits !== null) {
      if (exceedsDecimalBound(digits, MAX_PUBLIC_PAGE)) {
        throw new CatalogQueryParamError(
          "INVALID_PAGE",
          `Requested page exceeds maximum allowed page boundary (${MAX_PUBLIC_PAGE}).`
        );
      }
      const parsed = Number.parseInt(digits, 10);
      page = parsed >= 1 ? parsed : 1;
    } else {
      page = 1;
    }
  }

  // 2. PageSize normalization (default 24, max 48)
  let pageSize = 24;
  if (raw.pageSize !== undefined && raw.pageSize !== null && raw.pageSize !== "") {
    const digits = normalizeCanonicalDecimalDigits(raw.pageSize);
    if (digits !== null) {
      if (exceedsDecimalBound(digits, 48)) {
        pageSize = 48;
      } else {
        const parsed = Number.parseInt(digits, 10);
        pageSize = parsed >= 1 ? parsed : 24;
      }
    } else {
      pageSize = 24;
    }
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
    const digits = normalizeCanonicalDecimalDigits(raw.page);
    if (digits !== null) {
      if (exceedsDecimalBound(digits, MAX_ADMIN_PAGE)) {
        throw new CatalogQueryParamError(
          "INVALID_PAGE",
          `Requested admin page exceeds maximum allowed boundary (${MAX_ADMIN_PAGE}).`
        );
      }
      const parsed = Number.parseInt(digits, 10);
      page = parsed >= 1 ? parsed : 1;
    } else {
      page = 1;
    }
  }

  // 2. PageSize normalization (default 20, max 50)
  let pageSize = 20;
  if (raw.pageSize !== undefined && raw.pageSize !== null && raw.pageSize !== "") {
    const digits = normalizeCanonicalDecimalDigits(raw.pageSize);
    if (digits !== null) {
      if (exceedsDecimalBound(digits, 50)) {
        pageSize = 50;
      } else {
        const parsed = Number.parseInt(digits, 10);
        pageSize = parsed >= 1 ? parsed : 20;
      }
    } else {
      pageSize = 20;
    }
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
