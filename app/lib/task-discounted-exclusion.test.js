import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DISCOUNTED_SCOPE,
  DISCOUNTED_SKIP_REASONS,
  isVariantDiscounted,
  normalizeDiscountedScope,
  splitVariantsByDiscountedScope,
} from "./task-discounted-exclusion.js";

const variants = [
  {
    id: "gid://shopify/ProductVariant/1",
    price: "80.00",
    compareAtPrice: "100.00",
    product: { id: "gid://shopify/Product/1" },
  },
  {
    id: "gid://shopify/ProductVariant/2",
    price: "120.00",
    compareAtPrice: "120.00",
    product: { id: "gid://shopify/Product/1" },
  },
  {
    id: "gid://shopify/ProductVariant/3",
    price: "50.00",
    compareAtPrice: null,
    product: { id: "gid://shopify/Product/2" },
  },
];

describe("discounted task exclusions", () => {
  it("normalizes supported scope aliases", () => {
    assert.equal(normalizeDiscountedScope("NONE"), DISCOUNTED_SCOPE.NONE);
    assert.equal(normalizeDiscountedScope("none"), DISCOUNTED_SCOPE.NONE);
    assert.equal(
      normalizeDiscountedScope("PRODUCTS_ON_SALE"),
      DISCOUNTED_SCOPE.PRODUCTS_ON_SALE,
    );
    assert.equal(
      normalizeDiscountedScope("product_variants_on_sale"),
      DISCOUNTED_SCOPE.VARIANTS_ON_SALE,
    );
    assert.equal(
      normalizeDiscountedScope("product_types_on_sale"),
      DISCOUNTED_SCOPE.VARIANTS_ON_SALE,
    );
  });

  it("detects a discounted variant when compare-at price is greater than price", () => {
    assert.equal(isVariantDiscounted(variants[0]), true);
    assert.equal(isVariantDiscounted(variants[1]), false);
    assert.equal(isVariantDiscounted(variants[2]), false);
  });

  it("keeps every variant when discounted scope is none", () => {
    const result = splitVariantsByDiscountedScope(variants, "none");

    assert.deepEqual(
      result.variants.map((variant) => variant.id),
      variants.map((variant) => variant.id),
    );
    assert.equal(result.skipped.length, 0);
  });

  it("skips only discounted variants for variants_on_sale", () => {
    const result = splitVariantsByDiscountedScope(variants, "variants_on_sale");

    assert.deepEqual(
      result.variants.map((variant) => variant.id),
      ["gid://shopify/ProductVariant/2", "gid://shopify/ProductVariant/3"],
    );
    assert.equal(result.skipped[0].skipReason, DISCOUNTED_SKIP_REASONS.VARIANT_ON_SALE);
  });

  it("skips an entire product for products_on_sale", () => {
    const result = splitVariantsByDiscountedScope(
      variants,
      "products_on_sale",
      new Set(["gid://shopify/Product/1"]),
    );

    assert.deepEqual(
      result.variants.map((variant) => variant.id),
      ["gid://shopify/ProductVariant/3"],
    );
    assert.deepEqual(
      result.skipped.map((item) => item.variant.id),
      ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
    );
    assert.equal(result.skipped[0].skipReason, DISCOUNTED_SKIP_REASONS.PRODUCT_ON_SALE);
  });
});
