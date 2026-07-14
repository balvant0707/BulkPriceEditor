import {
  rollbackMarketPrices,
  updateMarketPrices,
} from "../services/market-pricing.server";
import {
  DISCOUNTED_SCOPE,
  isVariantDiscounted,
  normalizeDiscountedScope,
  splitVariantsByDiscountedScope,
} from "./task-discounted-exclusion";
import { DEFAULT_REPORT_SETTINGS } from "./product-reports";

const SALE_VARIANTS_QUERY = `#graphql
  query SaleProductVariants($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query) {
      nodes {
        id
        title
        price
        compareAtPrice
        product {
          id
          title
          status
          tags
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SALE_NODES_QUERY = `#graphql
  query SaleNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        compareAtPrice
        product {
          id
          title
          status
          tags
        }
      }
      ... on Product {
        id
        title
        status
        tags
        variants(first: 100) {
          nodes {
            id
            title
            price
            compareAtPrice
            product {
              id
              title
              status
              tags
            }
          }
        }
      }
      ... on Collection {
        id
        title
        products(first: 100) {
          nodes {
            id
            title
            status
            variants(first: 100) {
              nodes {
                id
                title
                price
                compareAtPrice
                product {
                  id
                  title
                  status
                  tags
                }
              }
            }
          }
        }
      }
    }
  }
`;

const SALE_PRODUCT_VARIANTS_FOR_PRODUCT_QUERY = `#graphql
  query SaleProductVariantsForProduct($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      variants(first: $first, after: $after) {
        nodes {
          id
          title
          price
          compareAtPrice
          product {
            id
            title
            status
            tags
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const SALE_PRODUCT_VARIANTS_BULK_UPDATE = `#graphql
  mutation SaleProductVariantsBulkUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SALE_TAGS_ADD = `#graphql
  mutation SaleTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SALE_TAGS_REMOVE = `#graphql
  mutation SaleTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const MAX_SALE_VARIANTS = 10000;
const SALE_VARIANT_PAGE_SIZE = 250;

export async function executeSaleRecord(admin, sale) {
  const { targetVariants, variants } = await loadSaleMatchingVariants(admin, sale);
  const variantUpdates = [];
  const originalVariants = [];
  const logs = [];

  if (sale.changeType === "markets") {
    const marketResult = await updateMarketPrices({
      admin,
      ownerType: "sale",
      ownerId: sale.id,
      shop: sale.shop,
      markets: sale.markets,
      variants,
      priceChange: sale.priceChange,
      compareAtPriceChange: sale.compareAtPriceChange,
      applyToFixedPrices: sale.applyToFixedPrices,
    });

    return {
      ok: marketResult.ok,
      status: marketResult.ok ? "Completed" : "Failed",
      progress: 100,
      analyzedVariants: variants.length,
      variantUpdates: marketResult.updatedCount,
      updatedVariants: marketResult.updatedCount,
      taggedProducts: 0,
      skippedVariants: marketResult.skippedCount,
      originalVariants: [],
      originalMarketPrices: marketResult.originalMarketPrices,
      logs: marketResult.logs,
      errors: marketResult.errors,
      cappedAt: MAX_SALE_VARIANTS,
      endAt: sale.endAt,
      needsRevert: Boolean(sale.endAt),
    };
  }

  for (const variant of variants) {
    const update = buildSaleVariantUpdate(variant, sale);
    if (!update) continue;

    variantUpdates.push(update);
    originalVariants.push({
      id: variant.id,
      productId: variant.product?.id,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
    });
    logs.push(buildSaleVariantLog(variant, update.variant));
  }

  const variantResults = await applySaleVariantUpdates(admin, variantUpdates);
  const productIds = uniqueProductIds(variants);
  const tagResults = await applySaleTagRules(admin, productIds, sale);
  const errors = [...variantResults.errors, ...tagResults.errors];

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "Completed" : "Failed",
    progress: 100,
    analyzedVariants: variants.length,
    variantUpdates: variantUpdates.length,
    updatedVariants: variantResults.updatedCount,
    taggedProducts: tagResults.updatedCount,
    skippedVariants:
      targetVariants.length - variants.length + variants.length - variantUpdates.length,
    originalVariants,
    logs,
    errors,
    cappedAt: MAX_SALE_VARIANTS,
    endAt: sale.endAt,
    needsRevert: Boolean(sale.endAt),
  };
}

export async function executeSaleConditionChangeRecord(admin, sale, options = {}) {
  const trackConditionChanges = options.trackConditionChanges !== false;
  const reapplyExisting = Boolean(options.reapplyExisting);
  const existingOriginalVariants = sale.executionSummary?.originalVariants || [];
  const existingOriginalMarketPrices = sale.executionSummary?.originalMarketPrices || [];
  const existingOriginalsById = new Map(
    existingOriginalVariants
      .filter((variant) => variant?.id)
      .map((variant) => [variant.id, variant]),
  );
  const { variants: matchingVariants } = await loadSaleMatchingVariants(admin, sale, {
    respectDiscountedScope: false,
  });
  const { variants } = await applySaleDiscountedExclusion(
    admin,
    matchingVariants,
    sale.discountedScope,
  );

  if (sale.changeType === "markets") {
    const existingMarketKeys = new Set(
      existingOriginalMarketPrices.map((item) =>
        [item.priceListId, item.variantId].filter(Boolean).join(":"),
      ),
    );
    const marketResult = await updateMarketPrices({
      admin,
      ownerType: "sale",
      ownerId: sale.id,
      shop: sale.shop,
      markets: sale.markets,
      variants: variants.filter((variant) => variant?.id),
      priceChange: sale.priceChange,
      compareAtPriceChange: sale.compareAtPriceChange,
      applyToFixedPrices: sale.applyToFixedPrices,
    });
    const nextOriginalMarketPrices = [
      ...existingOriginalMarketPrices,
      ...marketResult.originalMarketPrices.filter((item) => {
        const key = [item.priceListId, item.variantId].filter(Boolean).join(":");
        if (existingMarketKeys.has(key)) return false;
        existingMarketKeys.add(key);
        return true;
      }),
    ];

    return {
      ok: marketResult.ok,
      status: marketResult.ok ? "Completed" : "Failed",
      progress: 100,
      analyzedVariants: variants.length,
      addedVariants: marketResult.updatedCount,
      removedVariants: 0,
      taggedProducts: 0,
      originalVariants: [],
      originalMarketPrices: nextOriginalMarketPrices,
      logs: marketResult.logs,
      errors: marketResult.errors,
      checkedAt: new Date().toISOString(),
    };
  }

  const matchingIds = new Set(variants.map((variant) => variant.id).filter(Boolean));
  const removedOriginalVariants = trackConditionChanges
    ? existingOriginalVariants.filter(
        (variant) => variant?.id && !matchingIds.has(variant.id),
      )
    : [];
  const addedVariants = trackConditionChanges ? variants.filter((variant) => {
    if (!variant?.id || existingOriginalsById.has(variant.id)) return false;
    return true;
  }) : [];
  const reappliedVariants = reapplyExisting
    ? variants.filter((variant) => variant?.id && existingOriginalsById.has(variant.id))
    : [];
  const variantUpdates = [];
  const addedOriginalVariants = [];
  const logs = [];

  for (const variant of [...addedVariants, ...reappliedVariants]) {
    const update = buildSaleVariantUpdate(variant, sale);
    if (!update) continue;

    variantUpdates.push(update);
    if (!existingOriginalsById.has(variant.id)) {
      addedOriginalVariants.push({
        id: variant.id,
        productId: variant.product?.id,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
      });
    }
    logs.push(
      buildSaleVariantLog(
        variant,
        update.variant,
        existingOriginalsById.has(variant.id) ? "Reapplied" : "Added",
      ),
    );
  }

  const addedResults = await applySaleVariantUpdates(admin, variantUpdates);
  const removedResults = await restoreOriginalSaleVariants(admin, removedOriginalVariants);
  const addedTagResults = await applySaleTagRules(
    admin,
    uniqueProductIds([...addedVariants, ...reappliedVariants]),
    sale,
  );
  const removedTagResults = await reverseSaleTagRules(
    admin,
    uniqueProductIdsFromOriginals(removedOriginalVariants),
    sale,
  );
  const errors = [
    ...addedResults.errors,
    ...removedResults.errors,
    ...addedTagResults.errors,
    ...removedTagResults.errors,
  ];
  const removedIds = new Set(removedOriginalVariants.map((variant) => variant.id));
  const nextOriginalVariants = [
    ...existingOriginalVariants.filter((variant) => !removedIds.has(variant?.id)),
    ...addedOriginalVariants,
  ];

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "Completed" : "Failed",
    progress: 100,
    analyzedVariants: variants.length,
    addedVariants: addedResults.updatedCount,
    removedVariants: removedResults.restoredCount,
    taggedProducts: addedTagResults.updatedCount + removedTagResults.updatedCount,
    originalVariants: nextOriginalVariants,
    logs,
    errors,
    checkedAt: new Date().toISOString(),
  };
}

export async function endSaleRecord(admin, sale) {
  if (sale.changeType === "markets") {
    const marketRollback = await rollbackMarketPrices(
      admin,
      sale.executionSummary?.originalMarketPrices || [],
    );

    return {
      ok: marketRollback.ok,
      restoredVariants: marketRollback.updatedCount,
      restoredTags: 0,
      errors: marketRollback.errors,
      endedAt: new Date().toISOString(),
    };
  }

  const originalVariants = sale.executionSummary?.originalVariants || [];
  const errors = [];
  const variantsByProduct = new Map();

  for (const original of originalVariants) {
    if (!original.productId || !original.id) continue;

    if (!variantsByProduct.has(original.productId)) {
      variantsByProduct.set(original.productId, []);
    }

    variantsByProduct.get(original.productId).push({
      id: original.id,
      price: formatSalePrice(original.price),
      compareAtPrice:
        original.compareAtPrice == null
          ? null
          : formatSalePrice(original.compareAtPrice),
    });
  }

  let restoredVariants = 0;
  for (const [productId, variants] of variantsByProduct) {
    const data = await saleGraphql(admin, SALE_PRODUCT_VARIANTS_BULK_UPDATE, {
      productId,
      variants,
    });
    const result = data.productVariantsBulkUpdate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
    } else {
      restoredVariants += result?.productVariants?.length || 0;
    }
  }

  const productIds = [...variantsByProduct.keys()];
  const tagResults = await reverseSaleTagRules(admin, productIds, sale);
  errors.push(...tagResults.errors);

  return {
    ok: errors.length === 0,
    restoredVariants,
    restoredTags: tagResults.updatedCount,
    errors,
    endedAt: new Date().toISOString(),
  };
}

async function loadSaleMatchingVariants(admin, sale, options = {}) {
  const respectDiscountedScope = options.respectDiscountedScope !== false;
  const targetVariants = filterSaleVariantsByProductStatus(
    await loadSaleTargetVariants(admin, sale),
    sale,
  );
  const excludedVariantIds = await loadSaleExcludedVariantIds(admin, sale);
  const selectedVariants = uniqueSaleVariants(targetVariants).filter((variant) => {
    if (excludedVariantIds.has(variant.id)) return false;
    return true;
  });
  const { variants, skipped } = respectDiscountedScope
    ? await applySaleDiscountedExclusion(admin, selectedVariants, sale.discountedScope)
    : { variants: selectedVariants, skipped: [] };

  return { targetVariants, variants, skippedDiscountedVariants: skipped };
}

function shouldIncludeDraftProducts(sale) {
  const configuration = sale?.configuration || {};
  const form = configuration.form || {};
  const value =
    form.includeDraftProducts ??
    configuration.includeDraftProducts ??
    configuration.include_draft_products ??
    DEFAULT_REPORT_SETTINGS.includeDraftProducts;

  return String(value) !== "false";
}

function filterSaleVariantsByProductStatus(variants, sale) {
  if (shouldIncludeDraftProducts(sale)) return variants;

  return (variants || []).filter((variant) => {
    const status = String(variant?.product?.status || "").toUpperCase();
    return !status || status === "ACTIVE";
  });
}

async function saleGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload.errors) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

async function loadSaleTargetVariants(admin, sale) {
  const { applyScope, applyResources = {} } = sale;

  if (applyScope === "selected_products") {
    return loadSaleVariantsFromProductIds(admin, getResourceIds(applyResources.products));
  }

  if (applyScope === "selected_products_with_variants") {
    return loadSaleVariantsFromVariantIds(admin, getResourceIds(applyResources.variants));
  }

  if (applyScope === "selected_collections") {
    return loadSaleVariantsFromCollectionIds(admin, getResourceIds(applyResources.collections));
  }

  if (applyScope === "selected_tags") {
    return loadSaleVariantsFromTags(admin, getResourceTitles(applyResources.tags));
  }

  return loadSaleVariantsByQuery(admin, null);
}

async function loadSaleExcludedVariantIds(admin, sale) {
  const { excludeScope, excludeResources = {} } = sale;
  let variants = [];

  if (excludeScope === "selected_products") {
    variants = await loadSaleVariantsFromProductIds(admin, getResourceIds(excludeResources.products));
  } else if (excludeScope === "selected_products_with_variants") {
    variants = await loadSaleVariantsFromVariantIds(admin, getResourceIds(excludeResources.variants));
  } else if (excludeScope === "selected_collections") {
    variants = await loadSaleVariantsFromCollectionIds(admin, getResourceIds(excludeResources.collections));
  } else if (excludeScope === "selected_tags") {
    variants = await loadSaleVariantsFromTags(admin, getResourceTitles(excludeResources.tags));
  }

  return new Set(variants.map((variant) => variant.id).filter(Boolean));
}

async function loadSaleVariantsByQuery(admin, query) {
  const variants = [];
  let after = null;

  do {
    const data = await saleGraphql(admin, SALE_VARIANTS_QUERY, {
      first: Math.min(SALE_VARIANT_PAGE_SIZE, MAX_SALE_VARIANTS - variants.length),
      after,
      query,
    });
    const connection = data.productVariants;
    variants.push(...(connection?.nodes || []));
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after && variants.length < MAX_SALE_VARIANTS);

  return variants;
}

async function loadSaleNodes(admin, ids) {
  const cleanIds = [...new Set((ids || []).filter(Boolean))];
  if (!cleanIds.length) return [];

  const data = await saleGraphql(admin, SALE_NODES_QUERY, { ids: cleanIds });
  return data.nodes || [];
}

function saleVariantsFromNodes(nodes) {
  const variants = [];

  for (const node of nodes || []) {
    if (!node) continue;
    if (node.price !== undefined && node.product?.id) {
      variants.push(node);
      continue;
    }
    if (node.variants?.nodes) variants.push(...node.variants.nodes);
    if (node.products?.nodes) {
      for (const product of node.products.nodes) {
        variants.push(...(product.variants?.nodes || []));
      }
    }
  }

  return variants;
}

async function loadSaleVariantsFromProductIds(admin, productIds) {
  const variants = [];
  const cleanProductIds = [...new Set((productIds || []).filter(Boolean))];

  for (const productId of cleanProductIds) {
    variants.push(...(await loadSaleVariantsFromProductId(admin, productId)));
    if (variants.length >= MAX_SALE_VARIANTS) break;
  }

  return variants.slice(0, MAX_SALE_VARIANTS);
}

async function loadSaleVariantsFromVariantIds(admin, variantIds) {
  return saleVariantsFromNodes(await loadSaleNodes(admin, variantIds));
}

async function loadSaleVariantsFromCollectionIds(admin, collectionIds) {
  return saleVariantsFromNodes(await loadSaleNodes(admin, collectionIds));
}

async function loadSaleVariantsFromProductId(admin, productId) {
  const variants = [];
  let after = null;

  do {
    const data = await saleGraphql(admin, SALE_PRODUCT_VARIANTS_FOR_PRODUCT_QUERY, {
      id: productId,
      first: Math.min(SALE_VARIANT_PAGE_SIZE, MAX_SALE_VARIANTS - variants.length),
      after,
    });
    const connection = data.product?.variants;
    variants.push(...(connection?.nodes || []));
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after && variants.length < MAX_SALE_VARIANTS);

  return variants;
}

async function loadSaleVariantsFromTags(admin, tagNames) {
  const variants = [];

  for (const tagName of tagNames || []) {
    const safeTag = String(tagName).replaceAll('"', '\\"');
    variants.push(...(await loadSaleVariantsByQuery(admin, `tag:"${safeTag}"`)));
    if (variants.length >= MAX_SALE_VARIANTS) break;
  }

  return variants.slice(0, MAX_SALE_VARIANTS);
}

function buildSaleVariantUpdate(variant, sale) {
  const update = {
    productId: variant.product?.id,
    variant: { id: variant.id },
  };
  const nextPrice = calculateSaleFieldValue(variant.price, sale.priceChange, variant);
  const nextCompareAtPrice = calculateSaleCompareAtPrice(variant, sale);

  if (nextPrice != null) update.variant.price = nextPrice;
  if (nextCompareAtPrice !== undefined) update.variant.compareAtPrice = nextCompareAtPrice;

  return Object.keys(update.variant).length > 1 && update.productId ? update : null;
}

function calculateSaleFieldValue(currentValue, change, variant) {
  const action = change?.action || "";
  const current = toSaleNumber(currentValue);

  if (!action) return undefined;
  if (action === "set_new_value") return formatSalePrice(change.amount);
  if (action === "set_to_compare_at_price") {
    return variant.compareAtPrice == null ? undefined : formatSalePrice(variant.compareAtPrice);
  }

  if (current == null) return undefined;
  let nextValue = current;

  if (action === "increase" || action === "decrease") {
    const direction = action === "increase" ? 1 : -1;
    if (change.type === "by_amount") {
      const amount = toSaleNumber(change.amount);
      if (amount == null) return undefined;
      nextValue += direction * amount;
    } else {
      const percent = toSaleNumber(change.percent);
      if (percent == null) return undefined;
      nextValue += direction * nextValue * (percent / 100);
    }
  }

  return formatSalePrice(Math.max(0, applySaleRounding(nextValue, change.rounding)));
}

function calculateSaleCompareAtPrice(variant, sale) {
  const change = sale.compareAtPriceChange;

  if (!change?.action) return undefined;
  if (change.action === "reset_compare_at_price") return null;
  if (change.action === "set_to_price") return formatSalePrice(variant.price);
  if (change.action === "set_new_value") return formatSalePrice(change.amount);

  return calculateSaleFieldValue(variant.compareAtPrice, change, variant);
}

function applySaleRounding(value, rounding = {}) {
  if (rounding.mode === "round_to_whole") return Math.round(value);

  if (rounding.mode === "override_cents") {
    const cents = clampSaleCents(rounding.centsValue);
    const lower = Math.floor(value) + cents / 100;
    const upper = Math.ceil(value) + cents / 100;
    return rounding.overrideToNearest && Math.abs(upper - value) < Math.abs(lower - value)
      ? upper
      : lower;
  }

  if (rounding.mode === "set_ending") {
    const ending = String(rounding.endingPattern || "").replace("*", "");
    const parsedEnding = Number(`0${ending.startsWith(".") ? ending : `.${ending}`}`);
    if (Number.isFinite(parsedEnding)) return Math.floor(value) + parsedEnding;
  }

  return value;
}

async function applySaleVariantUpdates(admin, updates) {
  const errors = [];
  let updatedCount = 0;
  const byProduct = new Map();

  for (const update of updates) {
    if (!byProduct.has(update.productId)) byProduct.set(update.productId, []);
    byProduct.get(update.productId).push(update.variant);
  }

  for (const [productId, variants] of byProduct) {
    const data = await saleGraphql(admin, SALE_PRODUCT_VARIANTS_BULK_UPDATE, {
      productId,
      variants,
    });
    const result = data.productVariantsBulkUpdate;
    const userErrors = result?.userErrors || [];
    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
    } else {
      updatedCount += result?.productVariants?.length || 0;
    }
  }

  return { errors, updatedCount };
}

async function restoreOriginalSaleVariants(admin, originalVariants) {
  const errors = [];
  let restoredCount = 0;
  const byProduct = new Map();

  for (const original of originalVariants) {
    if (!original?.productId || !original?.id) continue;

    if (!byProduct.has(original.productId)) byProduct.set(original.productId, []);
    byProduct.get(original.productId).push({
      id: original.id,
      price: formatSalePrice(original.price),
      compareAtPrice:
        original.compareAtPrice == null
          ? null
          : formatSalePrice(original.compareAtPrice),
    });
  }

  for (const [productId, variants] of byProduct) {
    const data = await saleGraphql(admin, SALE_PRODUCT_VARIANTS_BULK_UPDATE, {
      productId,
      variants,
    });
    const result = data.productVariantsBulkUpdate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
    } else {
      restoredCount += result?.productVariants?.length || 0;
    }
  }

  return { errors, restoredCount };
}

async function applySaleTagRules(admin, productIds, sale) {
  const tagsToAdd = sale.addTagsEnabled ? getResourceTitles(sale.tagRules?.add) : [];
  const tagsToRemove = sale.removeTagsEnabled ? getResourceTitles(sale.tagRules?.remove) : [];

  return applyTagChanges(admin, productIds, tagsToAdd, tagsToRemove);
}

async function reverseSaleTagRules(admin, productIds, sale) {
  const tagsToAdd = sale.removeTagsEnabled ? getResourceTitles(sale.tagRules?.remove) : [];
  const tagsToRemove = sale.addTagsEnabled ? getResourceTitles(sale.tagRules?.add) : [];

  return applyTagChanges(admin, productIds, tagsToAdd, tagsToRemove);
}

async function applyTagChanges(admin, productIds, tagsToAdd, tagsToRemove) {
  const errors = [];
  let updatedCount = 0;

  for (const productId of productIds) {
    if (tagsToAdd.length) {
      const data = await saleGraphql(admin, SALE_TAGS_ADD, { id: productId, tags: tagsToAdd });
      const userErrors = data.tagsAdd?.userErrors || [];
      if (userErrors.length) errors.push(...userErrors.map((error) => error.message));
      else updatedCount += 1;
    }

    if (tagsToRemove.length) {
      const data = await saleGraphql(admin, SALE_TAGS_REMOVE, { id: productId, tags: tagsToRemove });
      const userErrors = data.tagsRemove?.userErrors || [];
      if (userErrors.length) errors.push(...userErrors.map((error) => error.message));
      else updatedCount += 1;
    }
  }

  return { errors, updatedCount };
}

function uniqueSaleVariants(variants) {
  const byId = new Map();
  for (const variant of variants) {
    if (variant?.id && !byId.has(variant.id)) byId.set(variant.id, variant);
  }
  return [...byId.values()];
}

function uniqueProductIds(variants) {
  return [...new Set(variants.map((variant) => variant.product?.id).filter(Boolean))];
}

function uniqueProductIdsFromOriginals(originalVariants) {
  return [...new Set(originalVariants.map((variant) => variant.productId).filter(Boolean))];
}

function getResourceIds(items = []) {
  return items.map((item) => item.id).filter(Boolean);
}

function getResourceTitles(items = []) {
  return items.map((item) => item.title).filter(Boolean);
}

async function applySaleDiscountedExclusion(admin, variants, discountedScope) {
  const normalizedScope = normalizeDiscountedScope(discountedScope);

  if (normalizedScope === DISCOUNTED_SCOPE.NONE) {
    return { variants, skipped: [] };
  }

  const discountedProductIds =
    normalizedScope === DISCOUNTED_SCOPE.PRODUCTS_ON_SALE
      ? await loadSaleDiscountedProductIds(admin, variants)
      : new Set();

  return splitVariantsByDiscountedScope(
    variants,
    normalizedScope,
    discountedProductIds,
  );
}

async function loadSaleDiscountedProductIds(admin, variants) {
  const productIds = uniqueProductIds(variants);
  const discountedProductIds = new Set();

  for (const productId of productIds) {
    const productVariants = await loadSaleVariantsFromProductId(admin, productId);
    if (productVariants.some(isVariantDiscounted)) {
      discountedProductIds.add(productId);
    }
  }

  return discountedProductIds;
}

function buildSaleVariantLog(variant, update, status = "Applied") {
  const productId = variant.product?.id || "";
  const changes = [];

  if (update.price !== undefined) {
    changes.push(`Price: ${formatLogValue(variant.price)} -> ${formatLogValue(update.price)}`);
  }

  if (update.compareAtPrice !== undefined) {
    changes.push(
      `Compare at price: ${formatLogValue(variant.compareAtPrice)} -> ${formatLogValue(
        update.compareAtPrice,
      )}`,
    );
  }

  return {
    id: variant.id,
    variantId: variant.id,
    productId,
    productTitle: variant.product?.title || "Product",
    variantTitle: variant.title || "",
    changes,
    status,
  };
}

function formatLogValue(value) {
  if (value === null || value === undefined || value === "") return "blank";
  return formatSalePrice(value);
}

function clampSaleCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return 0;
  return Math.max(0, Math.min(99, Math.trunc(cents)));
}

function toSaleNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatSalePrice(value) {
  const number = toSaleNumber(value);
  return number == null ? null : number.toFixed(2);
}
