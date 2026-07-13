export const DISCOUNTED_SCOPE = Object.freeze({
  NONE: "nothing",
  PRODUCTS_ON_SALE: "products_on_sale",
  VARIANTS_ON_SALE: "variants_on_sale",
});

export const DISCOUNTED_SKIP_REASONS = Object.freeze({
  PRODUCT_ON_SALE: "Product has at least one variant on sale.",
  VARIANT_ON_SALE: "Variant is on sale.",
});

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeDiscountedScope(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (
    normalized === "products_on_sale" ||
    normalized === "product_on_sale" ||
    normalized === "all_products_on_sale"
  ) {
    return DISCOUNTED_SCOPE.PRODUCTS_ON_SALE;
  }

  if (
    normalized === "variants_on_sale" ||
    normalized === "variant_on_sale" ||
    normalized === "product_types_on_sale" ||
    normalized === "product_variants_on_sale" ||
    normalized === "all_variants_on_sale" ||
    normalized === "all_product_variants_on_sale"
  ) {
    return DISCOUNTED_SCOPE.VARIANTS_ON_SALE;
  }

  return DISCOUNTED_SCOPE.NONE;
}

export function isVariantDiscounted(variant) {
  const price = toNumber(variant?.price);
  const compareAtPrice = toNumber(variant?.compareAtPrice);

  return compareAtPrice != null && price != null && compareAtPrice > price;
}

export function splitVariantsByDiscountedScope(
  variants,
  discountedScope,
  discountedProductIds = new Set(),
) {
  const scope = normalizeDiscountedScope(discountedScope);
  const kept = [];
  const skipped = [];

  for (const variant of variants || []) {
    if (
      scope === DISCOUNTED_SCOPE.PRODUCTS_ON_SALE &&
      discountedProductIds.has(variant?.product?.id)
    ) {
      skipped.push({
        variant,
        skipReason: DISCOUNTED_SKIP_REASONS.PRODUCT_ON_SALE,
      });
      continue;
    }

    if (
      scope === DISCOUNTED_SCOPE.VARIANTS_ON_SALE &&
      isVariantDiscounted(variant)
    ) {
      skipped.push({
        variant,
        skipReason: DISCOUNTED_SKIP_REASONS.VARIANT_ON_SALE,
      });
      continue;
    }

    kept.push(variant);
  }

  return { variants: kept, skipped };
}
