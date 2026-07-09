import db from "../db.server";
import {
  normalizeDiscountedScope,
  splitVariantsByDiscountedScope,
} from "../lib/task-discounted-exclusion";

const TASK_VARIANTS_QUERY = `#graphql
  query TaskProductVariants($first: Int!, $after: String, $query: String) {
    productVariants(first: $first, after: $after, query: $query) {
      nodes {
        id
        title
        price
        compareAtPrice
        inventoryItem {
          id
          unitCost {
            amount
          }
        }
        product {
          id
          title
          productType
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

const TASK_NODES_QUERY = `#graphql
  query TaskNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        compareAtPrice
        inventoryItem {
          id
          unitCost {
            amount
          }
        }
        product {
          id
          title
          productType
          tags
        }
      }
      ... on Product {
        id
        title
        productType
        tags
        variants(first: 100) {
          nodes {
            id
            title
            price
            compareAtPrice
            inventoryItem {
              id
              unitCost {
                amount
              }
            }
            product {
              id
              title
              productType
              tags
            }
          }
        }
      }
    }
  }
`;

const TASK_PRODUCT_VARIANTS_FOR_PRODUCT_QUERY = `#graphql
  query TaskProductVariantsForProduct($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      title
      productType
      tags
      variants(first: $first, after: $after) {
        nodes {
          id
          title
          price
          compareAtPrice
          inventoryItem {
            id
            unitCost {
              amount
            }
          }
          product {
            id
            title
            productType
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

const TASK_COLLECTION_PRODUCTS_QUERY = `#graphql
  query TaskCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        nodes {
          id
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const TASK_PRODUCT_VARIANTS_BULK_UPDATE = `#graphql
  mutation TaskProductVariantsBulkUpdate(
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

const TASK_INVENTORY_ITEM_UPDATE = `#graphql
  mutation TaskInventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        unitCost {
          amount
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const MAX_TASK_VARIANTS = 250;
const VARIANT_PAGE_SIZE = 100;
const TASK_UPDATE_CONCURRENCY = 4;
const GRAPHQL_MAX_RETRIES = 4;
const GRAPHQL_RETRY_BASE_MS = 500;

export async function executeAutoReapplyTask(admin, task) {
  const targetVariants = await loadTargetVariants(admin, task);
  const excludedVariantIds = await loadExcludedVariantIds(admin, task);
  const selectedVariants = uniqueVariants(targetVariants).filter(
    (variant) => !excludedVariantIds.has(variant.id),
  );
  const { variants, skippedLogs } = await applyDiscountedExclusion(
    admin,
    selectedVariants,
    getDiscountedScope(task),
  );
  const auditLogs = skippedLogs.map((log) => ({
    taskId: task.id,
    shop: task.shop,
    ...log,
  }));
  const productVariantUpdates = [];
  const inventoryUpdates = [];

  for (const variant of variants) {
    const variantUpdate = buildVariantUpdate(variant, task);
    const inventoryUpdate = buildInventoryUpdate(variant, task.costPerItemChange);

    if (variantUpdate) {
      productVariantUpdates.push(variantUpdate);
      auditLogs.push(
        buildAuditLogRecord(variant, {
          action: "Updated",
          newPrice: variantUpdate.variant.price ?? variant.price,
          taskId: task.id,
          shop: task.shop,
        }),
      );
    }

    if (inventoryUpdate) {
      inventoryUpdates.push(inventoryUpdate);
    }

    if (!variantUpdate && !inventoryUpdate) {
      auditLogs.push(
        buildAuditLogRecord(variant, {
          action: "Skipped",
          skipReason: "No price or cost change required.",
          taskId: task.id,
          shop: task.shop,
        }),
      );
    }
  }

  const variantResults = await applyVariantUpdates(admin, productVariantUpdates);
  const inventoryResults = await applyInventoryUpdates(admin, inventoryUpdates);
  await persistTaskAuditLogs(auditLogs);

  return {
    ok: variantResults.errors.length === 0 && inventoryResults.errors.length === 0,
    analyzedVariants: variants.length,
    totalPriceChanges: productVariantUpdates.length,
    updatedVariants: variantResults.updatedCount,
    updatedInventoryItems: inventoryResults.updatedCount,
    skippedVariants:
      targetVariants.length -
      variants.length +
      variants.length -
      productVariantUpdates.length,
    errors: [...variantResults.errors, ...inventoryResults.errors],
  };
}

async function shopifyGraphql(admin, query, variables = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= GRAPHQL_MAX_RETRIES; attempt += 1) {
    try {
      const response = await admin.graphql(query, { variables });
      const payload = await response.json();

      if (payload.errors) {
        const message = payload.errors
          .map((error) => error.message)
          .join("; ");

        if (isThrottleError(payload.errors) && attempt < GRAPHQL_MAX_RETRIES) {
          await sleep(getGraphqlRetryDelay(attempt));
          continue;
        }

        throw new Error(message);
      }

      return payload.data;
    } catch (error) {
      lastError = error;

      if (!isRetryableGraphqlError(error) || attempt >= GRAPHQL_MAX_RETRIES) {
        throw error;
      }

      await sleep(getGraphqlRetryDelay(attempt));
    }
  }

  throw lastError || new Error("Shopify GraphQL request failed.");
}

async function loadTargetVariants(admin, taskData) {
  const { applyScope, applyResources = {} } = taskData;

  if (applyScope === "selected_products") {
    return loadVariantsFromProductIds(admin, applyResources.productIds);
  }

  if (applyScope === "selected_products_with_variants") {
    return loadVariantsFromVariantIds(admin, applyResources.variantIds);
  }

  if (applyScope === "selected_collections") {
    return loadVariantsFromCollectionIds(admin, applyResources.collectionIds);
  }

  if (applyScope === "selected_tags") {
    return loadVariantsFromTags(admin, applyResources.tagNames);
  }

  return loadVariantsByQuery(admin, null);
}

async function loadExcludedVariantIds(admin, taskData) {
  const { excludeScope, excludeResources = {} } = taskData;
  let variants = [];

  if (excludeScope === "selected_products") {
    variants = await loadVariantsFromProductIds(admin, excludeResources.productIds);
  } else if (excludeScope === "selected_products_with_variants") {
    variants = await loadVariantsFromVariantIds(admin, excludeResources.variantIds);
  } else if (excludeScope === "selected_collections") {
    variants = await loadVariantsFromCollectionIds(admin, excludeResources.collectionIds);
  } else if (excludeScope === "selected_tags") {
    variants = await loadVariantsFromTags(admin, excludeResources.tagNames);
  }

  return new Set(variants.map((variant) => variant.id).filter(Boolean));
}

async function loadVariantsByQuery(admin, query) {
  const variants = [];
  let after = null;

  do {
    const data = await shopifyGraphql(admin, TASK_VARIANTS_QUERY, {
      first: Math.min(VARIANT_PAGE_SIZE, MAX_TASK_VARIANTS - variants.length),
      after,
      query,
    });
    const connection = data.productVariants;
    variants.push(...(connection?.nodes || []));
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after && variants.length < MAX_TASK_VARIANTS);

  return variants;
}

async function loadNodes(admin, ids = []) {
  const cleanIds = [...new Set(ids.filter(Boolean))];
  if (!cleanIds.length) return [];

  const data = await shopifyGraphql(admin, TASK_NODES_QUERY, { ids: cleanIds });
  return data.nodes || [];
}

function variantsFromNodes(nodes) {
  const variants = [];

  for (const node of nodes || []) {
    if (!node) continue;
    if (node.price !== undefined && node.product?.id) {
      variants.push(node);
      continue;
    }
    if (node.variants?.nodes) {
      variants.push(...node.variants.nodes);
    }
  }

  return variants;
}

async function loadVariantsFromProductIds(admin, productIds = []) {
  const variants = [];
  const cleanProductIds = [...new Set(productIds.filter(Boolean))];

  for (const productId of cleanProductIds) {
    variants.push(...(await loadVariantsFromProductId(admin, productId)));
    if (variants.length >= MAX_TASK_VARIANTS) break;
  }

  return variants.slice(0, MAX_TASK_VARIANTS);
}

async function loadVariantsFromVariantIds(admin, variantIds = []) {
  return variantsFromNodes(await loadNodes(admin, variantIds));
}

async function loadVariantsFromCollectionIds(admin, collectionIds = []) {
  const productIds = [];
  const cleanCollectionIds = [...new Set(collectionIds.filter(Boolean))];

  for (const collectionId of cleanCollectionIds) {
    productIds.push(...(await loadProductIdsFromCollection(admin, collectionId)));
    if (productIds.length >= MAX_TASK_VARIANTS) break;
  }

  return loadVariantsFromProductIds(admin, productIds);
}

async function loadVariantsFromProductId(admin, productId) {
  const variants = [];
  let after = null;

  do {
    const data = await shopifyGraphql(admin, TASK_PRODUCT_VARIANTS_FOR_PRODUCT_QUERY, {
      id: productId,
      first: Math.min(VARIANT_PAGE_SIZE, MAX_TASK_VARIANTS - variants.length),
      after,
    });
    const connection = data.product?.variants;
    variants.push(...(connection?.nodes || []));
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after && variants.length < MAX_TASK_VARIANTS);

  return variants;
}

async function loadProductIdsFromCollection(admin, collectionId) {
  const productIds = [];
  let after = null;

  do {
    const data = await shopifyGraphql(admin, TASK_COLLECTION_PRODUCTS_QUERY, {
      id: collectionId,
      first: Math.min(VARIANT_PAGE_SIZE, MAX_TASK_VARIANTS - productIds.length),
      after,
    });
    const connection = data.collection?.products;
    productIds.push(...(connection?.nodes || []).map((product) => product.id));
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after && productIds.length < MAX_TASK_VARIANTS);

  return productIds;
}

async function loadVariantsFromTags(admin, tagNames = []) {
  const variants = [];

  for (const tagName of tagNames) {
    const safeTag = String(tagName).replaceAll('"', '\\"');
    variants.push(...(await loadVariantsByQuery(admin, `tag:"${safeTag}"`)));
    if (variants.length >= MAX_TASK_VARIANTS) break;
  }

  return variants.slice(0, MAX_TASK_VARIANTS);
}

function getDiscountedScope(taskData) {
  return normalizeDiscountedScope([
    taskData.discountedScope,
    taskData.excludeResources?.discountedScope,
  ].find(Boolean));
}

async function applyDiscountedExclusion(admin, variants, discountedScope) {
  const normalizedScope = normalizeDiscountedScope(discountedScope);

  if (normalizedScope === "nothing") {
    return { variants, skippedLogs: [] };
  }

  const discountedProductIds =
    normalizedScope === "products_on_sale"
      ? await loadDiscountedProductIds(admin, variants)
      : new Set();

  const result = splitVariantsByDiscountedScope(
    variants,
    normalizedScope,
    discountedProductIds,
  );

  return {
    variants: result.variants,
    skippedLogs: result.skipped.map(({ variant, skipReason }) =>
      buildAuditLogRecord(variant, {
        action: "Skipped",
        skipReason,
      }),
    ),
  };
}

async function loadDiscountedProductIds(admin, variants) {
  const productIds = [
    ...new Set(variants.map((variant) => variant.product?.id).filter(Boolean)),
  ];
  const discountedProductIds = new Set();

  for (const productId of productIds) {
    const productVariants = await loadVariantsFromProductId(admin, productId);
    if (productVariants.some(isVariantDiscounted)) {
      discountedProductIds.add(productId);
    }
  }

  return discountedProductIds;
}

function buildVariantUpdate(variant, taskData) {
  const update = {
    productId: variant.product?.id,
    variant: { id: variant.id },
  };
  const nextPrice = calculateFieldValue(variant.price, variant, taskData.priceChange);
  const nextCompareAtPrice = calculateFieldValue(
    variant.compareAtPrice,
    variant,
    taskData.compareAtPriceChange,
    { resetValue: null, fallbackBase: variant.price },
  );

  if (nextPrice != null && !moneyValuesEqual(nextPrice, variant.price)) {
    update.variant.price = nextPrice;
  }
  if (
    nextCompareAtPrice !== undefined &&
    !moneyValuesEqual(nextCompareAtPrice, variant.compareAtPrice)
  ) {
    update.variant.compareAtPrice = nextCompareAtPrice;
  }

  return Object.keys(update.variant).length > 1 && update.productId ? update : null;
}

function buildInventoryUpdate(variant, costChange) {
  if (!variant.inventoryItem?.id) return null;

  const nextCost = calculateFieldValue(
    variant.inventoryItem.unitCost?.amount,
    variant,
    costChange,
    { resetValue: null, fallbackBase: variant.price },
  );

  if (nextCost === undefined) return null;

  return {
    id: variant.inventoryItem.id,
    input: { cost: nextCost },
  };
}

async function applyVariantUpdates(admin, updates) {
  const errors = [];
  let updatedCount = 0;
  const byProduct = new Map();

  for (const update of updates) {
    if (!byProduct.has(update.productId)) byProduct.set(update.productId, []);
    byProduct.get(update.productId).push(update.variant);
  }

  const productUpdates = Array.from(byProduct, ([productId, variants]) => ({
    productId,
    variants,
  }));

  for (const batch of chunkArray(productUpdates, TASK_UPDATE_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(async ({ productId, variants }) => {
        try {
          const data = await shopifyGraphql(admin, TASK_PRODUCT_VARIANTS_BULK_UPDATE, {
            productId,
            variants,
          });
          return { ok: true, result: data.productVariantsBulkUpdate };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error ? error.message : "Variant update failed.",
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        errors.push(item.error);
        continue;
      }

      const userErrors = item.result?.userErrors || [];
      if (userErrors.length) {
        errors.push(...userErrors.map((error) => error.message));
      } else {
        updatedCount += item.result?.productVariants?.length || 0;
      }
    }
  }

  return { errors, updatedCount };
}

async function applyInventoryUpdates(admin, updates) {
  const errors = [];
  let updatedCount = 0;

  for (const batch of chunkArray(updates, TASK_UPDATE_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(async (update) => {
        try {
          const data = await shopifyGraphql(admin, TASK_INVENTORY_ITEM_UPDATE, update);
          return { ok: true, result: data.inventoryItemUpdate };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Cost per item update failed.",
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        errors.push(item.error);
        continue;
      }

      const userErrors = item.result?.userErrors || [];
      if (userErrors.length) {
        errors.push(...userErrors.map((error) => error.message));
      } else {
        updatedCount += 1;
      }
    }
  }

  return { errors, updatedCount };
}

function calculateFieldValue(currentValue, variant, change, options = {}) {
  const action = change?.action || "";
  const current = toNumber(currentValue);

  if (!action) return undefined;
  if (action === "reset_compare_at_price" || action === "reset_cost_per_item") {
    return options.resetValue;
  }
  if (action === "set_to_price") return formatPrice(variant.price);
  if (action === "set_to_compare_at_price") {
    return variant.compareAtPrice == null ? undefined : formatPrice(variant.compareAtPrice);
  }

  let nextValue = current ?? toNumber(options.fallbackBase);

  if (action === "set_new_value") {
    nextValue = toNumber(change.amount);
  } else if (action === "increase" || action === "decrease") {
    const relativeBase = getRelativeBaseValue(variant, change.relativeTo);
    if (relativeBase != null) nextValue = relativeBase;
    if (nextValue == null) return undefined;
    const direction = action === "increase" ? 1 : -1;
    if (change.type === "by_amount") {
      const amount = toNumber(change.amount);
      if (amount == null) return undefined;
      nextValue += direction * amount;
    } else {
      const percent = toNumber(change.percent);
      if (percent == null) return undefined;
      nextValue += direction * nextValue * (percent / 100);
    }
  }

  if (nextValue == null) return undefined;

  nextValue = applyRounding(nextValue, change.rounding);
  return formatPrice(Math.max(0, nextValue));
}

function getRelativeBaseValue(variant, relativeTo) {
  if (relativeTo === "actual_price") return toNumber(variant.price);
  if (relativeTo === "cost_per_item") {
    return toNumber(variant.inventoryItem?.unitCost?.amount);
  }

  return null;
}

function applyRounding(value, rounding = {}) {
  if (rounding.mode === "round_to_whole") return Math.round(value);

  if (rounding.mode === "override_cents") {
    const cents = clampCents(rounding.centsValue);
    const lower = Math.floor(value) + cents / 100;
    const upper = Math.ceil(value) + cents / 100;
    return rounding.overrideToNearest && Math.abs(upper - value) < Math.abs(lower - value)
      ? upper
      : lower;
  }

  if (rounding.mode === "set_ending") {
    const ending = String(rounding.endingPattern || "").replace("*", "");
    const parsedEnding = Number(`0${ending.startsWith(".") ? ending : `.${ending}`}`);
    if (Number.isFinite(parsedEnding)) {
      return Math.floor(value) + parsedEnding;
    }
  }

  return value;
}

function isVariantDiscounted(variant) {
  const price = toNumber(variant.price);
  const compareAtPrice = toNumber(variant.compareAtPrice);
  return compareAtPrice != null && price != null && compareAtPrice > price;
}

function buildAuditLogRecord(variant, options = {}) {
  return {
    taskId: options.taskId,
    shop: options.shop,
    productId: variant.product?.id || "",
    variantId: variant.id || "",
    previousPrice:
      options.previousPrice !== undefined ? options.previousPrice : variant.price,
    newPrice: options.newPrice !== undefined ? options.newPrice : null,
    action: options.action || "Updated",
    skipReason: options.skipReason || null,
  };
}

async function persistTaskAuditLogs(logs) {
  const rows = logs
    .filter((log) => log.taskId && log.shop)
    .map((log) => ({
      taskId: Number(log.taskId),
      shop: log.shop,
      productId: log.productId || null,
      variantId: log.variantId || null,
      previousPrice: log.previousPrice == null ? null : String(log.previousPrice),
      newPrice: log.newPrice == null ? null : String(log.newPrice),
      action: log.action,
      skipReason: log.skipReason || null,
    }));

  if (rows.length) {
    await db.taskAuditLog.createMany({ data: rows });
  }
}

function uniqueVariants(variants) {
  const byId = new Map();

  for (const variant of variants) {
    if (variant?.id && !byId.has(variant.id)) {
      byId.set(variant.id, variant);
    }
  }

  return [...byId.values()];
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function clampCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return 0;
  return Math.max(0, Math.min(99, Math.trunc(cents)));
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPrice(value) {
  const number = toNumber(value);
  return number == null ? null : number.toFixed(2);
}

function moneyValuesEqual(left, right) {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);

  if (leftNumber == null || rightNumber == null) {
    return leftNumber == null && rightNumber == null;
  }

  return leftNumber.toFixed(2) === rightNumber.toFixed(2);
}

function isThrottleError(errors = []) {
  return errors.some((error) => {
    const code = String(error?.extensions?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();

    return code === "THROTTLED" || message.includes("throttled");
  });
}

function isRetryableGraphqlError(error) {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("throttled") ||
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("socket") ||
    message.includes("econnreset")
  );
}

function getGraphqlRetryDelay(attempt) {
  return GRAPHQL_RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
