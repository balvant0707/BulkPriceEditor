// app/cron/auto-reapply.server.js
// Runs the hourly Auto Re-Apply Price Changes job.
// Place this file at: app/cron/auto-reapply.server.js

import { pathToFileURL } from "url";
import db from "../db.server";
import {
  DISCOUNTED_SKIP_REASONS,
  isVariantDiscounted,
  normalizeDiscountedScope,
  splitVariantsByDiscountedScope,
} from "../lib/task-discounted-exclusion";
import { DEFAULT_REPORT_SETTINGS } from "../lib/product-reports";
import { getNextAutoReapplyRunMs } from "../lib/task-auto-reapply";
import { updateMarketPrices } from "../services/market-pricing.server";

const AUTO_REAPPLY_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_REAPPLY_RUNNING_LOCK_MS = 55 * 60 * 1000;
const AUTO_REAPPLY_BATCH_SIZE = 25;
const DEFAULT_SHOPIFY_API_VERSION = "2025-04";

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
          status
          totalInventory
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
          status
          totalInventory
          productType
          tags
        }
      }
      ... on Product {
        id
        title
        productType
        status
        totalInventory
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
              status
              totalInventory
              productType
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
            productType
            status
            totalInventory
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
                  status
                  totalInventory
                  productType
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

const TASK_PRODUCT_VARIANTS_FOR_PRODUCT_QUERY = `#graphql
  query TaskProductVariantsForProduct($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      title
      productType
      status
      totalInventory
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
            status
            totalInventory
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
      product {
        id
      }
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

const MAX_TASK_VARIANTS = 10000;
const VARIANT_PAGE_SIZE = 100;
const TASK_UPDATE_CONCURRENCY = 4;
const PROGRESS_UPDATE_MIN_INTERVAL_MS = 500;
const PROGRESS_UPDATE_MIN_DELTA = 2;
const GRAPHQL_MAX_RETRIES = 4;
const GRAPHQL_RETRY_BASE_MS = 500;

async function executeTask(
  admin,
  taskData,
  onProgress = async () => {},
  options = {},
) {
  try {
    const targetVariants = filterVariantsByProductStatus(
      await loadTargetVariants(admin, taskData),
      taskData,
    );
    const excludedVariantIds = await loadExcludedVariantIds(admin, taskData);
    await onProgress(25, {
      analyzedVariants: targetVariants.length,
    });

    const discountedScope = getDiscountedScope(taskData);
    const selectedVariants = uniqueVariants(targetVariants).filter(
      (variant) => !excludedVariantIds.has(variant.id),
    );
    const { variants, skippedLogs } = await applyDiscountedExclusion(
      admin,
      selectedVariants,
      discountedScope,
    );
    const auditLogs = skippedLogs.map((log) => ({
      taskId: options.taskId,
      shop: options.shop || taskData.shop,
      ...log,
    }));

    excludedVariantIds.forEach((variantId) => {
      const variant = targetVariants.find((item) => item.id === variantId);
      if (!variant) return;
      auditLogs.push(
        buildAuditLogRecord(variant, {
          action: "Skipped",
          skipReason: "Excluded by task configuration.",
          taskId: options.taskId,
          shop: options.shop || taskData.shop,
        }),
      );
    });

    const productVariantUpdates = [];
    const inventoryUpdates = [];
    const originalVariants = [];
    const originalInventoryItems = [];

    if (taskData.applyChangesTo === "markets") {
      const marketResult = await updateMarketPrices({
        admin,
        ownerType: "task",
        ownerId: options.taskId,
        shop: options.shop || taskData.shop,
        markets: taskData.selectedMarkets,
        variants,
        priceChange: taskData.priceChange,
        compareAtPriceChange: taskData.compareAtPriceChange,
        applyToFixedPrices: taskData.applyToFixedPrices,
      });
      const marketAuditLogs = marketResult.logs.map((log) => ({
        taskId: options.taskId,
        shop: options.shop || taskData.shop,
        productId: log.productId,
        variantId: log.variantId,
        previousPrice: log.oldPrice,
        newPrice: log.newPrice,
        action: log.status,
        skipReason: log.errors?.join("; ") || null,
      }));

      await persistTaskAuditLogs([...auditLogs, ...marketAuditLogs]);
      await onProgress(95, {
        analyzedVariants: variants.length,
        variantUpdates: marketResult.updatedCount,
        inventoryUpdates: 0,
        skippedVariants: marketResult.skippedCount,
      });

      return {
        ok: marketResult.ok,
        analyzedVariants: variants.length,
        variantUpdates: marketResult.updatedCount,
        inventoryUpdates: 0,
        updatedVariants: marketResult.updatedCount,
        updatedInventoryItems: 0,
        totalPriceChanges: marketResult.totalPriceChanges,
        skippedVariants:
          targetVariants.length - variants.length + marketResult.skippedCount,
        skippedProducts: countSkippedProducts(skippedLogs),
        logs: [...auditLogs, ...marketAuditLogs].map(({ taskId, shop, ...log }) => log),
        originalVariants: [],
        originalInventoryItems: [],
        originalMarketPrices: marketResult.originalMarketPrices,
        errors: marketResult.errors,
        cappedAt: MAX_TASK_VARIANTS,
      };
    }

    for (const variant of variants) {
      const variantUpdate = buildVariantUpdate(variant, taskData);
      if (variantUpdate) {
        productVariantUpdates.push(variantUpdate);
        auditLogs.push(
          buildAuditLogRecord(variant, {
            action: "Updated",
            newPrice: variantUpdate.variant.price ?? variant.price,
            taskId: options.taskId,
            shop: options.shop || taskData.shop,
          }),
        );
      }

      if (variantUpdate || shouldLogPriceNoChange(variant, taskData)) {
        originalVariants.push(buildOriginalVariantRecord(variant, variantUpdate));
      }

      const inventoryUpdate = buildInventoryUpdate(variant, taskData.costPerItemChange);
      if (inventoryUpdate) {
        inventoryUpdates.push(inventoryUpdate);
        originalInventoryItems.push({
          id: variant.inventoryItem.id,
          variantId: variant.id,
          variantTitle: variant.title,
          productId: variant.product?.id,
          productTitle: variant.product?.title,
          cost: variant.inventoryItem.unitCost?.amount,
          nextCost: inventoryUpdate.input.cost,
        });
      }

      if (!variantUpdate && !inventoryUpdate) {
        auditLogs.push(
          buildAuditLogRecord(variant, {
            action: "Skipped",
            skipReason: "No price or cost change required.",
            taskId: options.taskId,
            shop: options.shop || taskData.shop,
          }),
        );
      }
    }

    await onProgress(40, {
      analyzedVariants: variants.length,
      variantUpdates: productVariantUpdates.length,
      inventoryUpdates: inventoryUpdates.length,
      skippedVariants:
        targetVariants.length -
        variants.length +
        variants.length -
        productVariantUpdates.length,
    });

    const totalUpdateSteps =
      countProductUpdateSteps(productVariantUpdates) + inventoryUpdates.length;
    let completedUpdateSteps = 0;
    const reportUpdateProgress = async () => {
      completedUpdateSteps += 1;
      const progress =
        totalUpdateSteps > 0
          ? 40 + Math.round((completedUpdateSteps / totalUpdateSteps) * 55)
          : 95;

      await onProgress(Math.min(progress, 95), {
        analyzedVariants: variants.length,
        variantUpdates: productVariantUpdates.length,
        inventoryUpdates: inventoryUpdates.length,
        updateSteps: totalUpdateSteps,
        completedUpdateSteps,
      });
    };

    if (totalUpdateSteps === 0) {
      await onProgress(95, {
        analyzedVariants: variants.length,
        variantUpdates: 0,
        inventoryUpdates: 0,
        skippedVariants:
          targetVariants.length - variants.length + variants.length - productVariantUpdates.length,
      });
    }

    const variantResults = await applyVariantUpdates(
      admin,
      productVariantUpdates,
      reportUpdateProgress,
    );
    const inventoryResults = await applyInventoryUpdates(
      admin,
      inventoryUpdates,
      reportUpdateProgress,
    );
    const errors = [...variantResults.errors, ...inventoryResults.errors];
    await persistTaskAuditLogs(auditLogs);

    return {
      ok: errors.length === 0,
      analyzedVariants: variants.length,
      variantUpdates: productVariantUpdates.length,
      inventoryUpdates: inventoryUpdates.length,
      updatedVariants: variantResults.updatedCount,
      updatedInventoryItems: inventoryResults.updatedCount,
      totalPriceChanges: productVariantUpdates.length,
      skippedVariants:
        targetVariants.length - variants.length + variants.length - productVariantUpdates.length,
      skippedProducts: countSkippedProducts(skippedLogs),
      logs: auditLogs.map(({ taskId, shop, ...log }) => log),
      originalVariants,
      originalInventoryItems,
      errors,
      cappedAt: MAX_TASK_VARIANTS,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to execute task.",
      analyzedVariants: 0,
      updatedVariants: 0,
      totalPriceChanges: 0,
    };
  }
}

function countProductUpdateSteps(updates) {
  return new Set(updates.map((update) => update.productId).filter(Boolean)).size;
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

function getDiscountedScope(taskData) {
  return normalizeDiscountedScope([
    taskData.applyScope === "products_on_sale" ? "products_on_sale" : "",
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
    try {
      const productVariants = await loadVariantsFromProductId(admin, productId);
      if (productVariants.some(isVariantDiscounted)) {
        discountedProductIds.add(productId);
      }
    } catch {
      const selectedProductVariants = variants.filter(
        (variant) => variant.product?.id === productId,
      );
      if (selectedProductVariants.some(isVariantDiscounted)) {
        discountedProductIds.add(productId);
      }
    }
  }

  return discountedProductIds;
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
    createdAt: new Date().toISOString(),
  };
}

function countSkippedProducts(logs) {
  return new Set(
    logs
      .filter(
        (log) => log.skipReason === DISCOUNTED_SKIP_REASONS.PRODUCT_ON_SALE,
      )
      .map((log) => log.productId)
      .filter(Boolean),
  ).size;
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

  if (!rows.length) return;

  await db.taskAuditLog.createMany({ data: rows });
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

async function loadTargetVariants(admin, taskData) {
  const { applyScope, applyResources } = taskData;

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
  const { excludeScope, excludeResources } = taskData;
  let variants = [];

  if (excludeScope === "selected_products") {
    variants = await loadVariantsFromProductIds(admin, excludeResources.productIds);
  } else if (excludeScope === "selected_products_with_variants") {
    variants = await loadVariantsFromVariantIds(admin, excludeResources.variantIds);
  } else if (excludeScope === "selected_collections") {
    variants = await loadVariantsFromCollectionIds(
      admin,
      excludeResources.collectionIds,
    );
  } else if (excludeScope === "selected_tags") {
    variants = await loadVariantsFromTags(admin, excludeResources.tagNames);
  }

  return new Set(variants.map((variant) => variant.id));
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

async function loadNodes(admin, ids) {
  const cleanIds = [...new Set((ids || []).filter(Boolean))];
  if (!cleanIds.length) return [];

  const data = await shopifyGraphql(admin, TASK_NODES_QUERY, {
    ids: cleanIds,
  });

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
      continue;
    }
    if (node.products?.nodes) {
      for (const product of node.products.nodes) {
        variants.push(...(product.variants?.nodes || []));
      }
    }
  }

  return variants;
}

async function loadVariantsFromProductIds(admin, productIds) {
  const variants = [];
  const cleanProductIds = [...new Set((productIds || []).filter(Boolean))];

  for (const productId of cleanProductIds) {
    variants.push(...(await loadVariantsFromProductId(admin, productId)));
    if (variants.length >= MAX_TASK_VARIANTS) break;
  }

  return variants.slice(0, MAX_TASK_VARIANTS);
}

async function loadVariantsFromVariantIds(admin, variantIds) {
  return variantsFromNodes(await loadNodes(admin, variantIds));
}

async function loadVariantsFromCollectionIds(admin, collectionIds) {
  const productIds = [];
  const cleanCollectionIds = [...new Set((collectionIds || []).filter(Boolean))];

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

async function loadVariantsFromTags(admin, tagNames) {
  const variants = [];

  for (const tagName of tagNames || []) {
    const safeTag = String(tagName).replaceAll('"', '\\"');
    variants.push(...(await loadVariantsByQuery(admin, `tag:"${safeTag}"`)));
    if (variants.length >= MAX_TASK_VARIANTS) break;
  }

  return variants.slice(0, MAX_TASK_VARIANTS);
}

function getProductStateFilters(record) {
  const configuration = getObjectValue(record?.configuration);
  const includeDraftFallback =
    configuration.includeDraftProducts ??
    configuration.include_draft_products ??
    DEFAULT_REPORT_SETTINGS.includeDraftProducts;

  return {
    active: getBooleanConfigValue(
      record?.applyToActiveProducts ??
        configuration.applyToActiveProducts ??
        configuration.apply_to_active_products,
      true,
    ),
    draft: getBooleanConfigValue(
      record?.applyToDraftProducts ??
        configuration.applyToDraftProducts ??
        configuration.apply_to_draft_products,
      String(includeDraftFallback) !== "false",
    ),
    soldout: getBooleanConfigValue(
      record?.applyToSoldoutProducts ??
        configuration.applyToSoldoutProducts ??
        configuration.apply_to_soldout_products,
      true,
    ),
  };
}

function getBooleanConfigValue(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return !["false", "0", "off", "no", "disabled"].includes(
    String(value).toLowerCase(),
  );
}

function filterVariantsByProductStatus(variants, record) {
  const filters = getProductStateFilters(record);

  return (variants || []).filter((variant) => {
    const status = String(variant?.product?.status || "").toUpperCase();
    const totalInventory = Number(variant?.product?.totalInventory);
    const soldout = Number.isFinite(totalInventory) && totalInventory <= 0;

    if (soldout && !filters.soldout) return false;
    if (status === "DRAFT") return filters.draft;
    if (!status || status === "ACTIVE") return filters.active;
    return false;
  });
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
  if (nextCompareAtPrice !== undefined) {
    update.variant.compareAtPrice = nextCompareAtPrice;
  }

  return Object.keys(update.variant).length > 1 && update.productId ? update : null;
}

function shouldLogPriceNoChange(variant, taskData) {
  const action = taskData.priceChange?.action;

  if (action === "set_to_compare_at_price") {
    return true;
  }

  if (action === "set_margin") {
    return true;
  }

  return false;
}

function buildOriginalVariantRecord(variant, variantUpdate) {
  return {
    id: variant.id,
    title: variant.title,
    productId: variant.product?.id,
    productTitle: variant.product?.title,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    nextPrice: variantUpdate?.variant.price ?? variant.price,
    nextCompareAtPrice:
      variantUpdate?.variant.compareAtPrice ?? variant.compareAtPrice,
  };
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
  } else if (action === "set_margin") {
    const cost = toNumber(variant.inventoryItem?.unitCost?.amount);
    const margin = toNumber(change.percent);
    if (cost == null || cost <= 0 || margin == null || margin < 0 || margin >= 100) {
      return undefined;
    }
    nextValue = cost / (1 - margin / 100);
  } else if (action === "increase" || action === "decrease") {
    const relativeBase = getRelativeBaseValue(variant, change.relativeTo);
    if (relativeBase != null) {
      nextValue = relativeBase;
    }
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
  if (relativeTo === "actual_price") {
    return toNumber(variant.price);
  }

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

async function applyVariantUpdates(admin, updates, onStepComplete = async () => {}) {
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
              error instanceof Error
                ? error.message
                : "Variant update failed.",
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        errors.push(item.error);
        await onStepComplete();
        continue;
      }

      const result = item.result;
      const userErrors = result?.userErrors || [];
      if (userErrors.length) {
        errors.push(...userErrors.map((error) => error.message));
      } else {
        updatedCount += result?.productVariants?.length || 0;
      }

      await onStepComplete();
    }
  }

  return { errors, updatedCount };
}

async function applyInventoryUpdates(admin, updates, onStepComplete = async () => {}) {
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
        await onStepComplete();
        continue;
      }

      const result = item.result;
      const userErrors = result?.userErrors || [];
      if (userErrors.length) {
        errors.push(...userErrors.map((error) => error.message));
      } else {
        updatedCount += 1;
      }

      await onStepComplete();
    }
  }

  return { errors, updatedCount };
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

/* -------------------- Form options -------------------- */


/* -------------------- Auto re-apply hourly worker -------------------- */

function getObjectValue(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...parsed }
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function isEnabledValue(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;

  return ["1", "true", "yes", "on", "enabled"].includes(
    String(value).toLowerCase(),
  );
}

function isAutoReapplyEnabled(task) {
  const configuration = getObjectValue(task.configuration);

  return (
    Boolean(task.autoReapply || task.autoReapplyChanges) ||
    isEnabledValue(configuration.auto_reapply_changes) ||
    isEnabledValue(configuration.auto_reapply_changes_enabled)
  );
}

function getAutoReapplyLastRun(task) {
  const configuration = getObjectValue(task.configuration);
  const executionSummary = getObjectValue(task.executionSummary);

  return (
    task.autoReapplyLastRunAt ||
    executionSummary.autoReapplyLastRunAt ||
    executionSummary.lastAutoReapplyRunAt ||
    configuration.auto_reapply_last_run_at ||
    ""
  );
}

function getTaskBaseRunTime(task) {
  return (
    getAutoReapplyLastRun(task) ||
    task.completedAt ||
    task.appliedAt ||
    task.updatedAt ||
    task.createdAt ||
    ""
  );
}

function getConfiguredReapplyMinute(record) {
  const configuration = getObjectValue(record?.configuration);
  const minute = Number(
    configuration.reapplyMinute ??
      configuration.reapply_minute ??
      DEFAULT_REPORT_SETTINGS.reapplyMinute,
  );

  if (!Number.isFinite(minute)) return Number(DEFAULT_REPORT_SETTINGS.reapplyMinute);
  return Math.max(0, Math.min(59, Math.trunc(minute)));
}

function getNextHourlyRunMs(baseMs, minute) {
  const base = new Date(baseMs);
  const next = new Date(baseMs + AUTO_REAPPLY_INTERVAL_MS);
  next.setUTCMinutes(minute, 0, 0);

  if (next.getTime() <= base.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }

  return next.getTime();
}

function getDateMs(value) {
  if (!value) return null;

  const date = new Date(value);
  const ms = date.getTime();

  return Number.isNaN(ms) ? null : ms;
}

function isAutoReapplyDue(task, nowMs = Date.now()) {
  if (!isAutoReapplyEnabled(task)) return false;

  const executionSummary = getObjectValue(task.executionSummary);
  const lockStartedAtMs = getDateMs(executionSummary.autoReapplyStartedAt);

  if (
    executionSummary.autoReapplyRunning === true &&
    lockStartedAtMs &&
    nowMs - lockStartedAtMs < AUTO_REAPPLY_RUNNING_LOCK_MS
  ) {
    return false;
  }

  const baseRunMs = getDateMs(getTaskBaseRunTime(task));

  if (!baseRunMs) return true;

  return nowMs >= getNextAutoReapplyRunMs(task, baseRunMs);
}

function getShopifyApiVersion() {
  return (
    process.env.SHOPIFY_API_VERSION ||
    process.env.SHOPIFY_ADMIN_API_VERSION ||
    DEFAULT_SHOPIFY_API_VERSION
  );
}

function normalizeShopDomain(shop) {
  return String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();
}

function createCronAdminClient(shop, accessToken) {
  const normalizedShop = normalizeShopDomain(shop);
  const apiVersion = getShopifyApiVersion();
  const endpoint = `https://${normalizedShop}/admin/api/${apiVersion}/graphql.json`;

  return {
    async graphql(query, options = {}) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options.variables || {},
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Shopify GraphQL failed for ${normalizedShop}: ${response.status} ${body}`,
        );
      }

      return response;
    },
  };
}

async function getShopAccessToken(shop) {
  const normalizedShop = normalizeShopDomain(shop);

  const shopRecord = await db.shop.findUnique({
    where: { shop: normalizedShop },
    select: { accessToken: true, installed: true },
  });

  if (!shopRecord?.installed || !shopRecord?.accessToken) {
    return "";
  }

  return shopRecord.accessToken;
}

function compactAutoReapplySummary(execution) {
  return {
    ok: Boolean(execution?.ok),
    analyzedVariants: execution?.analyzedVariants || 0,
    variantUpdates: execution?.variantUpdates || 0,
    inventoryUpdates: execution?.inventoryUpdates || 0,
    updatedVariants: execution?.updatedVariants || 0,
    updatedInventoryItems: execution?.updatedInventoryItems || 0,
    totalPriceChanges: execution?.totalPriceChanges || 0,
    skippedVariants: execution?.skippedVariants || 0,
    skippedProducts: execution?.skippedProducts || 0,
    errors: execution?.errors || [],
    error: execution?.error || "",
    cappedAt: execution?.cappedAt || MAX_TASK_VARIANTS,
  };
}

function createAutoReapplyProgressUpdater(task) {
  let lastWriteAt = 0;
  let lastWrittenProgress = 0;

  return async (progress, summary = {}, options = {}) => {
    const safeProgress = Math.max(
      0,
      Math.min(100, Math.round(Number(progress) || 0)),
    );
    const now = Date.now();

    const shouldWrite =
      options.force ||
      safeProgress >= 95 ||
      safeProgress - lastWrittenProgress >= PROGRESS_UPDATE_MIN_DELTA ||
      now - lastWriteAt >= PROGRESS_UPDATE_MIN_INTERVAL_MS;

    if (!shouldWrite) return;

    lastWriteAt = now;
    lastWrittenProgress = safeProgress;

    const latestTask = await db.task.findUnique({
      where: { id: task.id },
      select: { executionSummary: true },
    });

    await db.task.update({
      where: { id: task.id },
      data: {
        executionSummary: {
          ...getObjectValue(latestTask?.executionSummary),
          autoReapplyRunning: true,
          autoReapplyProgress: safeProgress,
          autoReapplyProgressSummary: summary,
        },
      },
    });
  };
}

async function markAutoReapplyStarted(task) {
  const startedAt = new Date().toISOString();

  await db.task.update({
    where: { id: task.id },
    data: {
      executionSummary: {
        ...getObjectValue(task.executionSummary),
        autoReapplyRunning: true,
        autoReapplyStartedAt: startedAt,
        autoReapplyProgress: 0,
        autoReapplyError: "",
      },
    },
  });

  return startedAt;
}

async function markAutoReapplyFinished(task, execution, startedAt) {
  const finishedAt = new Date().toISOString();
  const latestTask = await db.task.findUnique({
    where: { id: task.id },
    select: { executionSummary: true, configuration: true },
  });

  const latestSummary = getObjectValue(latestTask?.executionSummary);
  const latestConfiguration = getObjectValue(latestTask?.configuration);

  await db.task.update({
    where: { id: task.id },
    data: {
      configuration: {
        ...latestConfiguration,
        auto_reapply_last_run_at: finishedAt,
      },
      executionSummary: {
        ...latestSummary,
        autoReapplyRunning: false,
        autoReapplyStartedAt: startedAt,
        autoReapplyFinishedAt: finishedAt,
        autoReapplyLastRunAt: finishedAt,
        lastAutoReapplyRunAt: finishedAt,
        autoReapplyProgress: 100,
        autoReapplySummary: compactAutoReapplySummary(execution),
        autoReapplyError: execution?.ok === false ? execution?.error || "" : "",
      },
    },
  });

  return finishedAt;
}

async function markAutoReapplyFailed(task, error, startedAt) {
  const failedAt = new Date().toISOString();
  const latestTask = await db.task.findUnique({
    where: { id: task.id },
    select: { executionSummary: true },
  });

  await db.task.update({
    where: { id: task.id },
    data: {
      executionSummary: {
        ...getObjectValue(latestTask?.executionSummary),
        autoReapplyRunning: false,
        autoReapplyStartedAt: startedAt,
        autoReapplyFailedAt: failedAt,
        autoReapplyError:
          error instanceof Error ? error.message : "Auto re-apply failed.",
      },
    },
  });
}

async function runSingleAutoReapplyTask(task) {
  const accessToken = await getShopAccessToken(task.shop);

  if (!accessToken) {
    return {
      taskId: task.id,
      shop: task.shop,
      skipped: true,
      reason: "Shop is not installed or access token is missing.",
    };
  }

  const startedAt = await markAutoReapplyStarted(task);

  try {
    const admin = createCronAdminClient(task.shop, accessToken);
    const updateProgress = createAutoReapplyProgressUpdater(task);
    const taskData = {
      ...task,
      autoReapply: true,
      autoReapplyChanges: true,
    };

    const execution = await executeTask(admin, taskData, updateProgress, {
      taskId: task.id,
      shop: task.shop,
      autoReapply: true,
    });

    const finishedAt = await markAutoReapplyFinished(
      task,
      execution,
      startedAt,
    );

    return {
      taskId: task.id,
      shop: task.shop,
      ok: execution?.ok !== false,
      lastRunAt: finishedAt,
      summary: compactAutoReapplySummary(execution),
    };
  } catch (error) {
    await markAutoReapplyFailed(task, error, startedAt);

    return {
      taskId: task.id,
      shop: task.shop,
      ok: false,
      error: error instanceof Error ? error.message : "Auto re-apply failed.",
    };
  }
}

export async function runAutoReapplyTasks(options = {}) {
  const nowMs = Date.now();
  const take = Math.max(1, Number(options.take || AUTO_REAPPLY_BATCH_SIZE));

  const completedTasks = await db.task.findMany({
    where: {
      status: { in: ["Completed", "Complete", "completed", "complete"] },
      OR: [{ autoReapply: true }, { autoReapplyChanges: true }],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: take * 4,
  });

  const dueTasks = completedTasks
    .filter((task) => isAutoReapplyDue(task, nowMs))
    .slice(0, take);

  const results = [];

  for (const task of dueTasks) {
    results.push(await runSingleAutoReapplyTask(task));
  }

  return {
    ok: true,
    checked: completedTasks.length,
    due: dueTasks.length,
    results,
  };
}

let autoReapplyInterval = null;

export function startAutoReapplyCron(options = {}) {
  if (autoReapplyInterval) return autoReapplyInterval;

  const intervalMs = Math.max(
    60 * 1000,
    Number(options.intervalMs || AUTO_REAPPLY_INTERVAL_MS),
  );

  if (options.runImmediately) {
    runAutoReapplyTasks(options).catch((error) => {
      console.error("[auto-reapply] initial run failed", error);
    });
  }

  autoReapplyInterval = setInterval(() => {
    runAutoReapplyTasks(options).catch((error) => {
      console.error("[auto-reapply] scheduled run failed", error);
    });
  }, intervalMs);

  return autoReapplyInterval;
}

export function stopAutoReapplyCron() {
  if (!autoReapplyInterval) return;

  clearInterval(autoReapplyInterval);
  autoReapplyInterval = null;
}

async function runFromCli() {
  const result = await runAutoReapplyTasks();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromCli()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("[auto-reapply] failed", error);
      process.exit(1);
    });
}
