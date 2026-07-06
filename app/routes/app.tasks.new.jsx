// app/routes/app.tasks.new.jsx
import { json, redirect } from "@remix-run/node";
import { Form, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  ButtonGroup,
  Select,
  TextField,
  FormLayout,
  ChoiceList,
  Checkbox,
  BlockStack,
  InlineStack,
  Box,
  Banner,
  Divider,
  Modal,
  Tag,
  Badge,
  Spinner,
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const MARKETS_QUERY = `#graphql
  query GetMarkets {
    shop {
      currencyCode
    }
    markets(first: 50) {
      nodes {
        id
        name
        handle
        enabled
        primary
        currencySettings {
          baseCurrency {
            currencyCode
          }
        }
        regions(first: 20) {
          nodes {
            name
            ... on MarketRegionCountry {
              code
            }
          }
        }
      }
    }
  }
`;

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
      ... on Collection {
        id
        title
        products(first: 100) {
          nodes {
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
        message
      }
    }
  }
`;

const MAX_TASK_VARIANTS = 250;
const VARIANT_PAGE_SIZE = 100;

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const taskId = getRecordId(params.id || new URL(request.url).searchParams.get("id"));
  const task = taskId
    ? await db.task.findFirst({
        where: {
          id: taskId,
          shop: session.shop,
        },
      })
    : null;

  if (taskId && !task) {
    throw new Response("Task not found", { status: 404 });
  }

  try {
    const response = await admin.graphql(MARKETS_QUERY);
    const payload = await response.json();

    if (payload.errors) {
      return json({
        markets: [],
        marketsError: "Unable to load Shopify Markets.",
        shopCurrency: "USD",
        task,
      });
    }

    return json({
      markets: normalizeMarkets(payload.data?.markets?.nodes),
      marketsError: "",
      shopCurrency: payload.data?.shop?.currencyCode || "USD",
      task,
    });
  } catch {
    return json({
      markets: [],
      marketsError: "Unable to load Shopify Markets.",
      shopCurrency: "USD",
      task,
    });
  }
}

export async function action({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const taskId = getRecordId(
    getFormValue(formData, "id") || params.id || new URL(request.url).searchParams.get("id"),
  );
  const data = buildTaskData(session.shop, formData);

  if (taskId) {
    const existingTask = await db.task.findFirst({
      where: {
        id: taskId,
        shop: session.shop,
      },
    });

    if (!existingTask) {
      throw new Response("Task not found", { status: 404 });
    }

    if (existingTask.status !== "Complete") {
      return json(
        {
          error:
            "Task cannot be changed until the current status is Complete.",
        },
        { status: 400 },
      );
    }

    await db.task.update({
      where: { id: taskId },
      data: {
        ...data,
        status: "Processing",
        executionSummary: { progress: 1 },
        startedAt: new Date(),
        completedAt: null,
      },
    });

    scheduleTaskExecution(admin, taskId, data);

    return redirect(`/app/tasks/${taskId}`);
  }

  const task = await db.task.create({
    data: {
      ...data,
      status: "Processing",
      executionSummary: { progress: 1 },
      startedAt: new Date(),
    },
  });

  scheduleTaskExecution(admin, task.id, data);

  return redirect(`/app/tasks/${task.id}`);
}

function scheduleTaskExecution(admin, taskId, data) {
  setTimeout(() => {
    void runTaskExecution(admin, taskId, data);
  }, 100);
}

async function runTaskExecution(admin, taskId, data) {
  try {
    const updateProgress = async (progress, summary = {}) => {
      await db.task.update({
        where: { id: taskId },
        data: {
          executionSummary: {
            ...summary,
            progress,
          },
        },
      });
    };

    await db.task.update({
      where: { id: taskId },
      data: {
        status: "Processing",
        executionSummary: { progress: 10 },
        startedAt: new Date(),
      },
    });

    const execution = await executeTask(admin, data, updateProgress);

    await db.task.update({
      where: { id: taskId },
      data: {
        status: execution.ok ? "Complete" : "Failed",
        executionSummary: {
          ...execution,
          progress: 100,
        },
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await db.task.update({
      where: { id: taskId },
      data: {
        status: "Failed",
        executionSummary: {
          ok: false,
          progress: 100,
          error:
            error instanceof Error ? error.message : "Unable to execute task.",
        },
        completedAt: new Date(),
      },
    });
  }
}

function getRecordId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getFormValue(formData, name, fallback = "") {
  return String(formData.get(name) || fallback);
}

function getFormValues(formData, name) {
  return formData.getAll(name).map((value) => String(value));
}

function hasFormValue(formData, name) {
  return formData.has(name);
}

function formDataToConfiguration(formData) {
  const configuration = {};

  for (const key of formData.keys()) {
    const values = getFormValues(formData, key);
    configuration[key] = key.endsWith("[]") ? values : values[0] || "";
  }

  return configuration;
}

function buildRoundingData(formData, prefix) {
  return {
    mode: getFormValue(formData, `${prefix}_rounding_mode`, "none"),
    overrideToNearest: hasFormValue(formData, `${prefix}_override_to_nearest`),
    centsValue: getFormValue(formData, `${prefix}_override_cents_value`),
    endingDigits: getFormValues(formData, `${prefix}_price_ending_digits[]`),
    endingPattern: getFormValue(formData, `${prefix}_price_ending_pattern`),
  };
}

function buildChangeData(formData, prefix) {
  return {
    action: getFormValue(formData, `${prefix}_change_action`),
    relativeTo: getFormValue(formData, `${prefix}_change_relative_to`),
    type: getFormValue(formData, `${prefix}_change_type`, "by_percent"),
    percent: getFormValue(formData, `${prefix}_change_percent`),
    amount: getFormValue(formData, `${prefix}_change_amount`),
    rounding: buildRoundingData(formData, prefix),
  };
}

function buildTaskData(shop, formData) {
  const selectedMarketIds = getFormValues(formData, "selected_market_ids[]");
  const selectedMarketHandles = getFormValues(formData, "selected_market_handles[]");
  const selectedMarketCurrencyCodes = getFormValues(
    formData,
    "selected_market_currency_codes[]",
  );

  return {
    shop,
    status: "draft",
    applyChangesTo: getFormValue(formData, "apply_changes_to", "products"),
    applyToFixedPrices: hasFormValue(formData, "apply_to_fixed_prices"),
    selectedMarkets: selectedMarketIds.map((id, index) => ({
      id,
      handle: selectedMarketHandles[index] || "",
      currencyCode: selectedMarketCurrencyCodes[index] || "",
    })),
    priceChange: buildChangeData(formData, "price"),
    compareAtPriceChange: buildChangeData(formData, "compare_at_price"),
    costPerItemChange: buildChangeData(formData, "cost_per_item"),
    applyScope: getFormValue(formData, "condition", "whole_store"),
    excludeScope: getFormValue(formData, "exclude", "nothing"),
    discountedScope: getFormValue(formData, "exclude_discounted", "nothing"),
    applyResources: {
      scope: getFormValue(formData, "apply_scope"),
      saleFilter: getFormValue(formData, "apply_sale_filter"),
      collectionIds: getFormValues(formData, "apply_collection_ids[]"),
      productIds: getFormValues(formData, "apply_product_ids[]"),
      variantIds: getFormValues(formData, "apply_variant_ids[]"),
      tagNames: getFormValues(formData, "apply_tag_names[]"),
    },
    excludeResources: {
      scope: getFormValue(formData, "exclude_scope"),
      discountedScope: getFormValue(formData, "discounted_exclusion_scope"),
      collectionIds: getFormValues(formData, "exclude_collection_ids[]"),
      productIds: getFormValues(formData, "exclude_product_ids[]"),
      variantIds: getFormValues(formData, "exclude_variant_ids[]"),
      tagNames: getFormValues(formData, "exclude_tag_names[]"),
    },
    configuration: formDataToConfiguration(formData),
    autoReapplyChanges: hasFormValue(formData, "auto_reapply_changes"),
  };
}

async function executeTask(admin, taskData, onProgress = async () => {}) {
  try {
    if (taskData.applyChangesTo === "markets") {
      return {
        ok: false,
        error:
          "Market price-list updates are not executed yet. Product variant tasks are supported.",
        analyzedVariants: 0,
        updatedVariants: 0,
      };
    }

    const targetVariants = await loadTargetVariants(admin, taskData);
    const excludedVariantIds = await loadExcludedVariantIds(admin, taskData);
    await onProgress(25, {
      analyzedVariants: targetVariants.length,
    });

    const discountedScope = getDiscountedScope(taskData);
    const discountedProductTypes =
      discountedScope === "product_types_on_sale"
        ? getDiscountedProductTypes(targetVariants)
        : new Set();
    const variants = uniqueVariants(targetVariants).filter((variant) => {
      if (excludedVariantIds.has(variant.id)) return false;
      if (
        (taskData.applyScope === "products_on_sale" ||
          discountedScope === "products_on_sale") &&
        isVariantDiscounted(variant)
      ) {
        return false;
      }
      if (
        discountedScope === "product_types_on_sale" &&
        discountedProductTypes.has(getProductType(variant))
      ) {
        return false;
      }
      return true;
    });

    const productVariantUpdates = [];
    const inventoryUpdates = [];
    const originalVariants = [];
    const originalInventoryItems = [];

    for (const variant of variants) {
      const variantUpdate = buildVariantUpdate(variant, taskData);
      if (variantUpdate) {
        productVariantUpdates.push(variantUpdate);
        originalVariants.push({
          id: variant.id,
          title: variant.title,
          productId: variant.product?.id,
          productTitle: variant.product?.title,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          nextPrice: variantUpdate.variant.price ?? variant.price,
          nextCompareAtPrice:
            variantUpdate.variant.compareAtPrice ?? variant.compareAtPrice,
        });
      }

      const inventoryUpdate = buildInventoryUpdate(variant, taskData.costPerItemChange);
      if (inventoryUpdate) {
        inventoryUpdates.push(inventoryUpdate);
        originalInventoryItems.push({
          id: variant.inventoryItem.id,
          variantId: variant.id,
          productId: variant.product?.id,
          productTitle: variant.product?.title,
          cost: variant.inventoryItem.unitCost?.amount,
          nextCost: inventoryUpdate.input.cost,
        });
      }
    }

    await onProgress(40, {
      analyzedVariants: variants.length,
      variantUpdates: productVariantUpdates.length,
      inventoryUpdates: inventoryUpdates.length,
      skippedVariants:
        targetVariants.length - variants.length + variants.length - productVariantUpdates.length,
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

    return {
      ok: errors.length === 0,
      analyzedVariants: variants.length,
      variantUpdates: productVariantUpdates.length,
      inventoryUpdates: inventoryUpdates.length,
      updatedVariants: variantResults.updatedCount,
      updatedInventoryItems: inventoryResults.updatedCount,
      skippedVariants:
        targetVariants.length - variants.length + variants.length - productVariantUpdates.length,
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

function isVariantDiscounted(variant) {
  const price = toNumber(variant.price);
  const compareAtPrice = toNumber(variant.compareAtPrice);
  return compareAtPrice != null && price != null && compareAtPrice > price;
}

function getDiscountedScope(taskData) {
  const values = [
    taskData.discountedScope,
    taskData.excludeResources?.discountedScope,
  ];

  if (values.includes("products_on_sale") || values.includes("all_products_on_sale")) {
    return "products_on_sale";
  }

  if (
    values.includes("product_types_on_sale") ||
    values.includes("all_product_types_on_sale")
  ) {
    return "product_types_on_sale";
  }

  return "nothing";
}

function getProductType(variant) {
  return String(variant.product?.productType || "").trim();
}

function getDiscountedProductTypes(variants) {
  const productTypes = new Set();

  for (const variant of variants) {
    const productType = getProductType(variant);
    if (productType && isVariantDiscounted(variant)) {
      productTypes.add(productType);
    }
  }

  return productTypes;
}

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload.errors) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
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
  return variantsFromNodes(await loadNodes(admin, productIds));
}

async function loadVariantsFromVariantIds(admin, variantIds) {
  return variantsFromNodes(await loadNodes(admin, variantIds));
}

async function loadVariantsFromCollectionIds(admin, collectionIds) {
  return variantsFromNodes(await loadNodes(admin, collectionIds));
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

  if (nextPrice != null) update.variant.price = nextPrice;
  if (nextCompareAtPrice !== undefined) {
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
    { resetValue: null },
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
    if (cost == null || margin == null || margin >= 100) return undefined;
    nextValue = cost / (1 - margin / 100);
  } else if (action === "increase" || action === "decrease") {
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

async function applyVariantUpdates(admin, updates, onStepComplete = async () => {}) {
  const errors = [];
  let updatedCount = 0;
  const byProduct = new Map();

  for (const update of updates) {
    if (!byProduct.has(update.productId)) byProduct.set(update.productId, []);
    byProduct.get(update.productId).push(update.variant);
  }

  for (const [productId, variants] of byProduct) {
    const data = await shopifyGraphql(admin, TASK_PRODUCT_VARIANTS_BULK_UPDATE, {
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

    await onStepComplete();
  }

  return { errors, updatedCount };
}

async function applyInventoryUpdates(admin, updates, onStepComplete = async () => {}) {
  const errors = [];
  let updatedCount = 0;

  for (const update of updates) {
    const data = await shopifyGraphql(admin, TASK_INVENTORY_ITEM_UPDATE, update);
    const result = data.inventoryItemUpdate;
    const userErrors = result?.userErrors || [];
    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
    } else {
      updatedCount += 1;
    }

    await onStepComplete();
  }

  return { errors, updatedCount };
}

/* -------------------- Form options -------------------- */

const priceActionOptions = [
  { label: "Do not change price", value: "" },
  { label: "Increase price", value: "increase" },
  { label: "Decrease price", value: "decrease" },
  { label: "Set new price", value: "set_new_value" },
  { label: "Set to compare at price", value: "set_to_compare_at_price" },
  { label: "Set margin", value: "set_margin" },
];

const compareAtActionOptions = [
  { label: "Do not change compare at price", value: "" },
  { label: "Increase compare at price", value: "increase" },
  { label: "Decrease compare at price", value: "decrease" },
  { label: "Set new compare on price", value: "set_new_value" },
  { label: "Set to price", value: "set_to_price" },
  { label: "Reset compare at price", value: "reset_compare_at_price" },
];

const costActionOptions = [
  { label: "Do not change cost per item", value: "" },
  { label: "Increase cost per item", value: "increase" },
  { label: "Decrease cost per item", value: "decrease" },
  { label: "Set new cost per item", value: "set_new_value" },
  { label: "Reset cost per item", value: "reset_cost_per_item" },
];

const changeTypeOptions = [
  { label: "By percent", value: "by_percent" },
  { label: "By amount", value: "by_amount" },
];

const priceRelativeOptions = [
  { label: "Not selected", value: "" },
  { label: "Cost per item", value: "cost_per_item" },
];

const compareRelativeOptions = [
  { label: "Not selected", value: "" },
  { label: "Actual price", value: "actual_price" },
  { label: "Cost per item", value: "cost_per_item" },
];

const roundingOptions = [
  { label: "No rounding", value: "none" },
  { label: "Round to whole number", value: "round_to_whole" },
  { label: "Override cents", value: "override_cents" },
  { label: "Set price ending", value: "set_ending" },
];

const applyToChoices = [
  { label: "Whole store", value: "whole_store" },
  { label: "Selected collections", value: "selected_collections" },
  { label: "Selected products", value: "selected_products" },
  {
    label: "Selected products with variants",
    value: "selected_products_with_variants",
  },
  { label: "All store products not on sale", value: "products_on_sale" },
  { label: "Selected tags", value: "selected_tags" },
];

const excludeChoices = [
  { label: "Nothing", value: "nothing" },
  { label: "Selected collections", value: "selected_collections" },
  { label: "Selected products", value: "selected_products" },
  {
    label: "Selected products with variants",
    value: "selected_products_with_variants",
  },
  { label: "Selected tags", value: "selected_tags" },
];

const excludeDiscountedChoices = [
  { label: "Nothing", value: "nothing" },
  { label: "All products on sale", value: "products_on_sale" },
  { label: "All product types on sale", value: "product_types_on_sale" },
];

function normalizeMarkets(markets = []) {
  return markets.map((market) => {
    const currencyCode =
      market.currencySettings?.baseCurrency?.currencyCode || "";
    const regions = market.regions?.nodes || [];
    const currencyLabel = currencyCode ? ` (${currencyCode})` : "";
    const primaryLabel = market.primary ? " - primary" : "";

    return {
      id: market.id,
      name: market.name,
      handle: market.handle || "",
      currencyCode,
      enabled: Boolean(market.enabled),
      primary: Boolean(market.primary),
      regions,
      label: `${market.name}${currencyLabel}${primaryLabel}`,
      disabled: true,
    };
  });
}

/* -------------------- Small UI helpers -------------------- */

function SectionCard({ title, children }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        {children}
      </BlockStack>
    </Card>
  );
}

function ResourceAvatar({ title, imageUrl, imageAlt }) {
  const first = String(title || "?").charAt(0).toUpperCase();

  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: "#F3F4F6",
        border: "1px solid #E5E7EB",
        display: "grid",
        placeItems: "center",
        color: "#4B5563",
        fontWeight: 600,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={imageAlt || title || ""}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        first
      )}
    </div>
  );
}

function SelectedResourceTags({ items, onRemove, emptyText }) {
  if (!items.length) {
    return (
      <Text as="p" tone="subdued" variant="bodySm">
        {emptyText}
      </Text>
    );
  }

  return (
    <InlineStack gap="150" wrap>
      {items.map((item) => (
        <Tag key={item.id} onRemove={() => onRemove(item.id)}>
          {item.productTitle ? `${item.productTitle} - ${item.title}` : item.title}
        </Tag>
      ))}
    </InlineStack>
  );
}

function ConditionScopeInputs({ sectionPrefix, selectedCondition }) {
  if (sectionPrefix === "apply" && selectedCondition === "whole_store") {
    return <input type="hidden" name="apply_scope" value="all_products_in_store" />;
  }

  if (sectionPrefix === "apply" && selectedCondition === "products_on_sale") {
    return (
      <input
        type="hidden"
        name="apply_sale_filter"
        value="all_store_products_not_on_sale"
      />
    );
  }

  if (sectionPrefix === "exclude" && selectedCondition === "nothing") {
    return <input type="hidden" name="exclude_scope" value="none" />;
  }

  return null;
}

function DiscountedExclusionInputs({ selected }) {
  const selectedValue = selected?.[0] || "nothing";

  if (selectedValue === "nothing") {
    return <input type="hidden" name="discounted_exclusion_scope" value="none" />;
  }

  if (selectedValue === "products_on_sale") {
    return (
      <input
        type="hidden"
        name="discounted_exclusion_scope"
        value="all_products_on_sale"
      />
    );
  }

  if (selectedValue === "product_types_on_sale") {
    return (
      <input
        type="hidden"
        name="discounted_exclusion_scope"
        value="all_product_types_on_sale"
      />
    );
  }

  return null;
}

/* -------------------- Polaris popup modal -------------------- */

function ResourcePickerModal({
  active,
  resourceType,
  title,
  searchPlaceholder,
  initialQuery = "",
  items,
  pageInfo,
  loading,
  loadingMore,
  error,
  selectedItems,
  onClose,
  onAdd,
  onSearch,
  onLoadNext,
  limit = 100,
}) {
  const [query, setQuery] = useState("");
  const [tempSelectedIds, setTempSelectedIds] = useState([]);
  const autoLoadLockRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    setQuery(initialQuery);
    setTempSelectedIds([]);
    autoLoadLockRef.current = false;
  }, [active, resourceType, initialQuery]);

  useEffect(() => {
    if (!loadingMore) {
      autoLoadLockRef.current = false;
    }
  }, [loadingMore, pageInfo?.endCursor]);

  const selectedIdSet = useMemo(
    () => new Set(tempSelectedIds),
    [tempSelectedIds],
  );
  const loadedItemIds = useMemo(() => items.map((item) => item.id), [items]);
  const selectedLoadedCount = loadedItemIds.filter((id) =>
    selectedIdSet.has(id),
  ).length;
  const allLoadedSelected =
    loadedItemIds.length > 0 && selectedLoadedCount === loadedItemIds.length;
  const someLoadedSelected =
    selectedLoadedCount > 0 && selectedLoadedCount < loadedItemIds.length;

  const modalTitle =
    title ||
    (resourceType === "collection"
      ? "Add collections"
      : resourceType === "variant"
        ? "Add product variants"
        : resourceType === "tag"
          ? "Add product tags"
          : "Add products");

  const resourceLabel =
    resourceType === "collection"
      ? "collections"
      : resourceType === "variant"
        ? "variants"
        : resourceType === "tag"
          ? "tags"
          : "products";

  const leftHeader =
    resourceType === "tag" ? "Product tag" : "Item";

  const rightHeader =
    resourceType === "collection"
      ? "Products"
      : resourceType === "variant"
        ? "Price"
        : resourceType === "tag"
          ? ""
        : "Price";

  const addButtonLabel =
    resourceType === "collection"
      ? "Add collections"
      : resourceType === "variant"
        ? "Add variants"
        : resourceType === "tag"
          ? "Add tags"
          : "Add products";
  const listGridColumns =
    resourceType === "tag"
      ? "40px minmax(0, 1fr)"
      : "40px minmax(0, 1fr) 120px";

  const handleToggle = (id) => {
    setTempSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((itemId) => itemId !== id);
      }

      if (current.length >= limit) return current;

      return [...current, id];
    });
  };

  const handleToggleLoadedItems = () => {
    setTempSelectedIds((current) => {
      const loadedIds = new Set(loadedItemIds);

      if (allLoadedSelected) {
        return current.filter((id) => !loadedIds.has(id));
      }

      const nextIds = [...current];
      const nextIdSet = new Set(nextIds);

      for (const id of loadedItemIds) {
        if (nextIds.length >= limit) break;
        if (!nextIdSet.has(id)) {
          nextIds.push(id);
          nextIdSet.add(id);
        }
      }

      return nextIds;
    });
  };

  const handleClose = () => {
    setQuery("");
    setTempSelectedIds([]);
    onClose();
  };

  const handleAdd = () => {
    const selected = items.filter((item) => tempSelectedIds.includes(item.id));
    onAdd(selected);
    setQuery("");
    setTempSelectedIds([]);
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    onSearch(value);
  };

  const handleListScroll = (event) => {
    if (!pageInfo?.hasNextPage || loadingMore || autoLoadLockRef.current) return;

    const list = event.currentTarget;
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;

    if (distanceFromBottom <= 80) {
      autoLoadLockRef.current = true;
      onLoadNext();
    }
  };

  return (
    <Modal
      open={active}
      onClose={handleClose}
      title={modalTitle}
      large
    >
      <Modal.Section>
        {loading ? (
          <div
            style={{
              minHeight: 420,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BlockStack gap="200" inlineAlign="center">
              <Spinner accessibilityLabel={`Loading ${resourceLabel}`} size="large" />
              <Text as="p" tone="subdued">
                Loading {resourceLabel}...
              </Text>
            </BlockStack>
          </div>
        ) : (
          <div
            style={{
              height: "min(700px, calc(100vh - 180px))",
              minHeight: "min(520px, calc(100vh - 180px))",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flexShrink: 0 }}>
              <Box paddingBlockEnd="200">
                <TextField
                  label={searchPlaceholder}
                  labelHidden
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={handleQueryChange}
                  autoComplete="off"
                />
              </Box>
            </div>

            {error ? (
              <div style={{ flexShrink: 0 }}>
                <Box paddingBlockEnd="200">
                  <Banner tone="critical">{error}</Banner>
                </Box>
              </div>
            ) : null}

            <div
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                overflow: "hidden",
                background: "#FFFFFF",
                display: "flex",
                flex: "1 1 auto",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: listGridColumns,
                  alignItems: "center",
                  borderBottom: "1px solid #E5E7EB",
                  padding: "12px 16px",
                  background: "#FAFBFB",
                  columnGap: 12,
                  flexShrink: 0,
                }}
              >
                <div onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    label={`Select all loaded ${resourceLabel}`}
                    labelHidden
                    checked={
                      allLoadedSelected
                        ? true
                        : someLoadedSelected
                          ? "indeterminate"
                          : false
                    }
                    disabled={items.length === 0}
                    onChange={handleToggleLoadedItems}
                  />
                </div>

                <Text as="span" tone="subdued" variant="bodySm">
                  {leftHeader}
                </Text>

                {rightHeader ? (
                  <div style={{ textAlign: "right" }}>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {rightHeader}
                    </Text>
                  </div>
                ) : null}
              </div>

              <div
                onScroll={handleListScroll}
                style={{
                  flex: "1 1 auto",
                  minHeight: 0,
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  scrollbarGutter: "stable",
                }}
              >
                {items.length === 0 ? (
                  <Box padding="500">
                    <Text as="p" tone="subdued">
                      No {resourceLabel} found.
                    </Text>
                  </Box>
                ) : (
                  items.map((item) => {
                    const checked = selectedIdSet.has(item.id);

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleToggle(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleToggle(item.id);
                          }
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: listGridColumns,
                          alignItems: "center",
                          gap: 12,
                          minHeight: 80,
                          padding: "10px 16px",
                          borderBottom: "1px solid #F1F1F1",
                          cursor: "pointer",
                          background: checked ? "#F6F6F7" : "#FFFFFF",
                        }}
                      >
                        <div onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            label={item.title}
                            labelHidden
                            checked={checked}
                            onChange={() => handleToggle(item.id)}
                          />
                        </div>

                        {resourceType === "tag" ? (
                          <Text as="span" variant="bodyMd">
                            {item.title}
                          </Text>
                        ) : (
                          <InlineStack gap="200" blockAlign="center" wrap={false}>
                            <ResourceAvatar
                              title={item.productTitle || item.title}
                              imageUrl={item.imageUrl}
                              imageAlt={item.imageAlt}
                            />

                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd">
                                {item.title}
                              </Text>

                              {item.productTitle ? (
                                <Text as="span" tone="subdued" variant="bodySm">
                                  {item.productTitle}
                                </Text>
                              ) : null}

                              {item.status ? (
                                <Box paddingBlockStart="050">
                                  <Badge
                                    tone={
                                      item.status === "Active"
                                        ? "success"
                                        : "attention"
                                    }
                                  >
                                    {item.status}
                                  </Badge>
                                </Box>
                              ) : null}
                            </BlockStack>
                          </InlineStack>
                        )}

                        {resourceType === "tag" ? null : (
                          <div style={{ textAlign: "right" }}>
                            <Text as="span" variant="bodySm">
                              {resourceType === "collection"
                                ? item.productsCount
                                : item.displayPrice || "-"}
                            </Text>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {loadingMore ? (
                  <Box padding="200">
                    <BlockStack gap="200" inlineAlign="center">
                      <Spinner
                        accessibilityLabel={`Loading more ${resourceLabel}`}
                        size="small"
                      />
                      <Text as="p" tone="subdued" variant="bodySm">
                        Loading more {resourceLabel}...
                      </Text>
                    </BlockStack>
                  </Box>
                ) : null}
              </div>
            </div>

            <div
              style={{
                position: "sticky",
                bottom: 0,
                zIndex: 2,
                flexShrink: 0,
                marginTop: 12,
                background: "#FFFFFF",
                borderTop: "1px solid #E5E7EB",
              }}
            >
              <Box
                paddingBlockStart="200"
                paddingInlineStart="050"
                paddingInlineEnd="050"
              >
                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <Text as="p" tone="subdued" variant="bodyMd">
                    {tempSelectedIds.length}/{limit} {resourceLabel} selected
                  </Text>

                  <ButtonGroup>
                    <Button onClick={handleClose}>Cancel</Button>
                    <Button
                      variant="primary"
                      onClick={handleAdd}
                      disabled={tempSelectedIds.length === 0 || loading}
                    >
                      {addButtonLabel}
                    </Button>
                  </ButtonGroup>
                </InlineStack>
              </Box>
            </div>
          </div>
        )}
      </Modal.Section>
    </Modal>
  );
}

/* -------------------- Resource picker field -------------------- */

function ResourcePickerField({
  sectionPrefix,
  selectedCondition,
  selectedCollections,
  setSelectedCollections,
  selectedProducts,
  setSelectedProducts,
  selectedVariants,
  setSelectedVariants,
  selectedTags,
  setSelectedTags,
}) {
  const [activePicker, setActivePicker] = useState(null);
  const [resourceItems, setResourceItems] = useState([]);
  const [pageInfo, setPageInfo] = useState({
    hasNextPage: false,
    endCursor: null,
  });
  const [resourceError, setResourceError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fieldQueries, setFieldQueries] = useState({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestIdRef = useRef(0);
  const latestRequestIdRef = useRef("");
  const fetcher = useFetcher();

  const collectionMode = selectedCondition === "selected_collections";
  const productMode = selectedCondition === "selected_products";
  const variantMode = selectedCondition === "selected_products_with_variants";
  const tagMode = selectedCondition === "selected_tags";

  const removeCollection = (id) => {
    setSelectedCollections((items) => items.filter((item) => item.id !== id));
  };

  const removeProduct = (id) => {
    setSelectedProducts((items) => items.filter((item) => item.id !== id));
  };

  const removeVariant = (id) => {
    setSelectedVariants((items) => items.filter((item) => item.id !== id));
  };

  const removeTag = (id) => {
    setSelectedTags((items) => items.filter((item) => item.id !== id));
  };

  const addUniqueItems = (currentItems, newItems) => {
    const existingIds = new Set(currentItems.map((item) => item.id));
    return [
      ...currentItems,
      ...newItems.filter((item) => !existingIds.has(item.id)),
    ];
  };

  const buildResourceUrl = (type, query = "", after = "") => {
    requestIdRef.current += 1;
    latestRequestIdRef.current = String(requestIdRef.current);
    const params = new URLSearchParams({
      type,
      requestId: latestRequestIdRef.current,
    });

    if (query.trim()) params.set("query", query.trim());
    if (after) params.set("after", after);

    return `/app/resource-picker?${params.toString()}`;
  };

  const openPicker = (type, query = "") => {
    setActivePicker(type);
    setResourceItems([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setResourceError("");
    setSearchQuery(query);
    setIsLoadingMore(false);
    fetcher.load(buildResourceUrl(type, query));
  };

  const openPickerFromSearch = (type, query) => {
    setFieldQueries((current) => ({ ...current, [type]: query }));
    openPicker(type, query);
  };

  const getPickerTitle = (type) => {
    if (type === "collection") return "Store Select Collection";
    if (type === "variant") return "Store Product Variant";
    if (type === "tag") return "Store Product Tags";
    return "Store Select Product";
  };

  const searchResources = (query) => {
    if (!activePicker) return;

    setResourceItems([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setResourceError("");
    setSearchQuery(query);
    setIsLoadingMore(false);
    fetcher.load(buildResourceUrl(activePicker, query));
  };

  const loadNextPage = () => {
    if (
      !activePicker ||
      !pageInfo.hasNextPage ||
      !pageInfo.endCursor ||
      isLoadingMore ||
      fetcher.state !== "idle"
    ) {
      return;
    }

    setResourceError("");
    setIsLoadingMore(true);
    fetcher.load(buildResourceUrl(activePicker, searchQuery, pageInfo.endCursor));
  };

  useEffect(() => {
    if (!fetcher.data) return;

    const nextItems = fetcher.data.items || [];
    const responseType = fetcher.data.type || "";
    const responseQuery = fetcher.data.query || "";
    const responseAfter = fetcher.data.after || "";
    const responseRequestId = fetcher.data.requestId || "";

    if (
      responseRequestId !== latestRequestIdRef.current ||
      responseType !== activePicker ||
      responseQuery !== searchQuery.trim()
    ) {
      return;
    }

    setResourceError(fetcher.data.error || "");
    setPageInfo(
      fetcher.data.pageInfo || { hasNextPage: false, endCursor: null },
    );
    setResourceItems((currentItems) =>
      responseAfter ? addUniqueItems(currentItems, nextItems) : nextItems,
    );
    setIsLoadingMore(false);
  }, [activePicker, fetcher.data, searchQuery]);

  const isInitialLoading =
    fetcher.state !== "idle" && !isLoadingMore && resourceItems.length === 0;

  if (collectionMode) {
    return (
      <Box paddingBlockStart="200">
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search collections"
                value={fieldQueries.collection || ""}
                onFocus={() => openPicker("collection", fieldQueries.collection || "")}
                onChange={(value) => openPickerFromSearch("collection", value)}
                autoComplete="off"
              />
            </Box>

            <Button variant="primary" onClick={() => openPicker("collection")}>Browse</Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedCollections}
            onRemove={removeCollection}
            emptyText="No collections selected."
          />

          {selectedCollections.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_collection_ids[]`}
              value={item.id}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "collection"}
            resourceType="collection"
            title={getPickerTitle("collection")}
            searchPlaceholder="Search collections"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedCollections}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedCollections((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  if (productMode) {
    return (
      <Box paddingBlockStart="200">
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search products"
                value={fieldQueries.product || ""}
                onFocus={() => openPicker("product", fieldQueries.product || "")}
                onChange={(value) => openPickerFromSearch("product", value)}
                autoComplete="off"
              />
            </Box>

            <Button variant="primary" onClick={() => openPicker("product")}>Browse</Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedProducts}
            onRemove={removeProduct}
            emptyText="No products selected."
          />

          {selectedProducts.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_product_ids[]`}
              value={item.id}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "product"}
            resourceType="product"
            title={getPickerTitle("product")}
            searchPlaceholder="Search products"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedProducts}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedProducts((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  if (variantMode) {
    return (
      <Box paddingBlockStart="200">
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search product variants"
                value={fieldQueries.variant || ""}
                onFocus={() => openPicker("variant", fieldQueries.variant || "")}
                onChange={(value) => openPickerFromSearch("variant", value)}
                autoComplete="off"
              />
            </Box>

            <Button variant="primary" onClick={() => openPicker("variant")}>Browse</Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedVariants}
            onRemove={removeVariant}
            emptyText="No product variants selected."
          />

          {selectedVariants.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_variant_ids[]`}
              value={item.id}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "variant"}
            resourceType="variant"
            title={getPickerTitle("variant")}
            searchPlaceholder="Search product variants"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedVariants}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedVariants((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  if (tagMode) {
    return (
      <Box paddingBlockStart="200">
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search product tags"
                value={fieldQueries.tag || ""}
                onFocus={() => openPicker("tag", fieldQueries.tag || "")}
                onChange={(value) => openPickerFromSearch("tag", value)}
                autoComplete="off"
              />
            </Box>

            <Button variant="primary" onClick={() => openPicker("tag", fieldQueries.tag || "")}>
              Browse
            </Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedTags}
            onRemove={removeTag}
            emptyText="No product tags selected."
          />

          {selectedTags.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_tag_names[]`}
              value={item.title}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "tag"}
            resourceType="tag"
            title={getPickerTitle("tag")}
            searchPlaceholder="Search product tags"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedTags}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedTags((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  return null;
}

/* -------------------- Price fields -------------------- */

function RoundingFields({ prefix, initialRounding = {} }) {
  const [rounding, setRounding] = useState(initialRounding.mode || "none");
  const [nearest, setNearest] = useState(
    Boolean(initialRounding.overrideToNearest),
  );
  const [cents, setCents] = useState(initialRounding.centsValue || "99");
  const [endingDigits, setEndingDigits] = useState(
    initialRounding.endingDigits?.length
      ? initialRounding.endingDigits
      : ["*", ".", "9", "9"],
  );

  const updateEndingDigit = (index, value) => {
    const nextValue = value.slice(-1);

    setEndingDigits((current) =>
      current.map((digit, digitIndex) =>
        digitIndex === index ? nextValue : digit,
      ),
    );
  };

  const addEndingDigit = () => {
    setEndingDigits((current) => [...current, "9"]);
  };

  const removeEndingDigit = () => {
    setEndingDigits((current) =>
      current.length > 1 ? current.slice(0, current.length - 1) : current,
    );
  };

  return (
    <BlockStack gap="200">
      <Select
        label="Rounding"
        name={`${prefix}_rounding_mode`}
        options={roundingOptions}
        value={rounding}
        onChange={setRounding}
      />

      {(rounding === "override_cents" || rounding === "set_ending") && (
        <Checkbox
          label="To nearest value"
          name={`${prefix}_override_to_nearest`}
          checked={nearest}
          onChange={setNearest}
        />
      )}

      {rounding === "override_cents" && (
        <BlockStack gap="200">
          <Box width="160px">
            <TextField
              label="Cents value"
              name={`${prefix}_override_cents_value`}
              type="number"
              min={0}
              max={99}
              prefix="0."
              value={cents}
              onChange={setCents}
              autoComplete="off"
            />
          </Box>

          <Text as="p" tone="subdued">
            E.g. 10.25 &gt; 10.{String(cents || "00").padStart(2, "0").slice(0, 2)}
          </Text>
        </BlockStack>
      )}

      {rounding === "set_ending" && (
        <BlockStack gap="200">
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            {endingDigits.map((digit, index) => (
              digit === "." ? (
                <Text key={`${prefix}-ending-${index}`} as="span">
                  .
                </Text>
              ) : (
                <Box key={`${prefix}-ending-${index}`} width="44px">
                  <TextField
                    label={`Ending digit ${index + 1}`}
                    labelHidden
                    name={`${prefix}_price_ending_digits[]`}
                    value={digit}
                    maxLength={1}
                    onChange={(value) => updateEndingDigit(index, value)}
                    autoComplete="off"
                  />
                </Box>
              )
            ))}
          </InlineStack>

          <InlineStack gap="200">
            <Button variant="plain" onClick={addEndingDigit}>
              Add digit
            </Button>
            <Text as="span" tone="subdued">
              |
            </Text>
            <Button variant="plain" onClick={removeEndingDigit}>
              Remove digit
            </Button>
          </InlineStack>

          <input
            type="hidden"
            name={`${prefix}_price_ending_pattern`}
            value={endingDigits.join("")}
          />

          <Text as="p" tone="subdued">
            E.g. 10.25 &gt; 10.99
          </Text>
        </BlockStack>
      )}
    </BlockStack>
  );
}

function PriceChangeFields({
  fieldPrefix,
  actionOptions,
  defaultAction = "",
  showRelative = false,
  relativeOptions = priceRelativeOptions,
  currency = "USD",
  initialChange = {},
}) {
  const [action, setAction] = useState(initialChange.action ?? defaultAction);
  const [relativeTo, setRelativeTo] = useState(initialChange.relativeTo || "");
  const [changeType, setChangeType] = useState(
    initialChange.type || "by_percent",
  );
  const [percent, setPercent] = useState(initialChange.percent || "");
  const [amount, setAmount] = useState(initialChange.amount || "");

  const isPriceField = fieldPrefix === "price";
  const isCompareAtPriceField = fieldPrefix === "compare_at_price";
  const isCostPerItemField = fieldPrefix === "cost_per_item";
  const isIncreaseOrDecrease = action === "increase" || action === "decrease";
  const isCompareNoFieldsAction =
    isCompareAtPriceField &&
    (action === "set_to_price" || action === "reset_compare_at_price");

  const shouldShowRelative =
    showRelative && isIncreaseOrDecrease;

  const shouldShowChangeType = isIncreaseOrDecrease;

  const shouldShowPercent =
    (isPriceField && action === "set_margin") ||
    (isIncreaseOrDecrease && changeType === "by_percent");

  const shouldShowAmount =
    (action === "set_new_value" && !isCompareAtPriceField && !isCostPerItemField) ||
    (isCompareAtPriceField && action === "set_new_value") ||
    (isCostPerItemField && action === "set_new_value") ||
    (isIncreaseOrDecrease && changeType === "by_amount");

  const shouldShowRounding =
    ((isPriceField || isCompareAtPriceField) && action === "") ||
    (isCostPerItemField && action === "") ||
    (isIncreaseOrDecrease && !isCompareNoFieldsAction);

  return (
    <BlockStack gap="200">
      <FormLayout>
        <FormLayout.Group>
          <Select
            label="Action"
            name={`${fieldPrefix}_change_action`}
            options={actionOptions}
            value={action}
            onChange={setAction}
          />

          {shouldShowRelative && (
            <Select
              label="Relative to"
              name={`${fieldPrefix}_change_relative_to`}
              options={relativeOptions}
              value={relativeTo}
              onChange={setRelativeTo}
            />
          )}
        </FormLayout.Group>

        {shouldShowChangeType && (
          <Select
            label="Change type"
            name={`${fieldPrefix}_change_type`}
            options={changeTypeOptions}
            value={changeType}
            onChange={setChangeType}
          />
        )}

        {shouldShowPercent && (
          <TextField
            label="Percent"
            name={`${fieldPrefix}_change_percent`}
            placeholder="0"
            suffix="%"
            value={percent}
            onChange={setPercent}
            autoComplete="off"
          />
        )}

        {shouldShowAmount && (
          <TextField
            label="Amount"
            name={`${fieldPrefix}_change_amount`}
            placeholder="0.00"
            suffix={currency}
            value={amount}
            onChange={setAmount}
            autoComplete="off"
          />
        )}
      </FormLayout>

      {shouldShowRounding && (
        <>
          <Divider />
          <RoundingFields
            prefix={fieldPrefix}
            initialRounding={initialChange.rounding}
          />
        </>
      )}
    </BlockStack>
  );
}

/* -------------------- Main page -------------------- */

function getConfigArray(configuration, name) {
  const value = configuration?.[name];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function getConfigValue(configuration, name, fallback = "") {
  const value = configuration?.[name];
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

function idsToSelectedItems(ids) {
  return ids.map((id) => ({ id, title: id }));
}

function tagsToSelectedItems(tags) {
  return tags.map((title) => ({ id: title, title }));
}

export default function NewTaskPage() {
  const {
    markets = [],
    marketsError = "",
    shopCurrency = "USD",
    task = null,
  } = useLoaderData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const configuration = task?.configuration || {};

  const [applyChangesTo, setApplyChangesTo] = useState(
    getConfigValue(configuration, "apply_changes_to", task?.applyChangesTo || "products"),
  );
  const [applyToFixedPrices, setApplyToFixedPrices] = useState(
    Boolean(task?.applyToFixedPrices || configuration.apply_to_fixed_prices),
  );
  const [selectedMarkets, setSelectedMarkets] = useState(
    getConfigArray(configuration, "selected_market_ids[]").length
      ? getConfigArray(configuration, "selected_market_ids[]")
      : task?.selectedMarkets?.map((market) => market.id).filter(Boolean) || [],
  );
  const marketChoices = useMemo(
    () =>
      markets.map((market) => ({
        label: market.label,
        value: market.id,
      })),
    [markets],
  );
  const selectedMarketDetails = useMemo(
    () => markets.filter((market) => selectedMarkets.includes(market.id)),
    [markets, selectedMarkets],
  );

  const [applyTo, setApplyTo] = useState([
    getConfigValue(configuration, "condition", task?.applyScope || "whole_store"),
  ]);
  const [exclude, setExclude] = useState([
    getConfigValue(configuration, "exclude", task?.excludeScope || "nothing"),
  ]);
  const [excludeDiscounted, setExcludeDiscounted] = useState([
    getConfigValue(
      configuration,
      "exclude_discounted",
      task?.discountedScope || "nothing",
    ),
  ]);
  const [autoReapply, setAutoReapply] = useState(
    Boolean(task?.autoReapplyChanges || configuration.auto_reapply_changes),
  );

  const [applyCollections, setApplyCollections] = useState(
    idsToSelectedItems(getConfigArray(configuration, "apply_collection_ids[]")),
  );
  const [applyProducts, setApplyProducts] = useState(
    idsToSelectedItems(getConfigArray(configuration, "apply_product_ids[]")),
  );
  const [applyVariants, setApplyVariants] = useState(
    idsToSelectedItems(getConfigArray(configuration, "apply_variant_ids[]")),
  );
  const [applyTags, setApplyTags] = useState(
    tagsToSelectedItems(getConfigArray(configuration, "apply_tag_names[]")),
  );

  const [excludeCollections, setExcludeCollections] = useState(
    idsToSelectedItems(getConfigArray(configuration, "exclude_collection_ids[]")),
  );
  const [excludeProducts, setExcludeProducts] = useState(
    idsToSelectedItems(getConfigArray(configuration, "exclude_product_ids[]")),
  );
  const [excludeVariants, setExcludeVariants] = useState(
    idsToSelectedItems(getConfigArray(configuration, "exclude_variant_ids[]")),
  );
  const [excludeTags, setExcludeTags] = useState(
    tagsToSelectedItems(getConfigArray(configuration, "exclude_tag_names[]")),
  );

  useEffect(() => {
    const marketIds = new Set(markets.map((market) => market.id));

    setSelectedMarkets((current) =>
      current.filter((marketId) => marketIds.has(marketId)),
    );
  }, [markets]);

  const handleApplyChangesToChange = (value) => {
    setApplyChangesTo(value);

    if (value === "products") {
      setSelectedMarkets([]);
      setApplyToFixedPrices(false);
    }
  };

  const submitTaskForm = () => {
    if (typeof document === "undefined") return;

    const form = document.getElementById("task-create-form");
    if (form) {
      form.requestSubmit();
    }
  };

  return (
    <>
      <TitleBar title={task ? "Edit task" : "New task"} />

      <Page
        title={task ? "Edit task" : "New task"}
        narrowWidth
        backAction={{
          content: "Back",
          url: "/app",
        }}
        primaryAction={{
          content: isSubmitting
            ? task
              ? "Updating..."
              : "Running..."
            : task
              ? "Update"
              : "Run task",
          onAction: submitTaskForm,
          loading: isSubmitting,
          disabled: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Discard",
            url: "/app",
            disabled: isSubmitting,
          },
        ]}
      >
        <Form method="post" id="task-create-form">
          {task?.id ? <input type="hidden" name="id" value={task.id} /> : null}
          <input type="hidden" name="apply_changes_to" value={applyChangesTo} />

          <Layout>
            <Layout.Section>
              <BlockStack gap="200">
                <SectionCard title="Change type">
                  <ButtonGroup segmented>
                    <Button
                      pressed={applyChangesTo === "products"}
                      onClick={() => handleApplyChangesToChange("products")}
                    >
                      Product prices
                    </Button>

                    <Button
                      pressed={applyChangesTo === "markets"}
                      onClick={() => handleApplyChangesToChange("markets")}
                    >
                      Market prices
                    </Button>
                  </ButtonGroup>

                  {applyChangesTo === "markets" && (
                    <BlockStack>
                      <Text as="p">
                        Bulk edit Shopify Markets price lists.{" "}
                        <a
                          href="https://help.platmart.io/article/104-bulk-edit-shopify-markets-price-lists"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Learn more
                        </a>
                      </Text>

                      <Checkbox
                        label="Apply changes only to fixed prices"
                        name="apply_to_fixed_prices"
                        checked={applyToFixedPrices}
                        onChange={setApplyToFixedPrices}
                      />

                      {marketsError ? (
                        <Banner tone="warning">{marketsError}</Banner>
                      ) : null}

                      {marketChoices.length > 0 ? (
                        <>
                          <ChoiceList
                            title="Markets"
                            allowMultiple
                            selected={selectedMarkets}
                            onChange={setSelectedMarkets}
                            choices={marketChoices}
                          />

                          {selectedMarketDetails.map((market) => (
                            <div key={market.id}>
                              <input
                                type="hidden"
                                name="selected_market_ids[]"
                                value={market.id}
                              />
                              <input
                                type="hidden"
                                name="selected_market_handles[]"
                                value={market.handle}
                              />
                              <input
                                type="hidden"
                                name="selected_market_currency_codes[]"
                                value={market.currencyCode}
                              />
                            </div>
                          ))}
                        </>
                      ) : (
                        <Text as="p" tone="subdued">
                          No Shopify Markets price lists found.
                        </Text>
                      )}
                    </BlockStack>
                  )}
                </SectionCard>

                <SectionCard title="Price">
                  <PriceChangeFields
                    fieldPrefix="price"
                    actionOptions={priceActionOptions}
                    defaultAction="decrease"
                    showRelative
                    relativeOptions={priceRelativeOptions}
                    currency={shopCurrency}
                    initialChange={task?.priceChange}
                  />
                </SectionCard>

                <SectionCard title="Compare at price">
                  <PriceChangeFields
                    fieldPrefix="compare_at_price"
                    actionOptions={compareAtActionOptions}
                    defaultAction=""
                    showRelative
                    relativeOptions={compareRelativeOptions}
                    currency={shopCurrency}
                    initialChange={task?.compareAtPriceChange}
                  />
                </SectionCard>

                <SectionCard title="Cost per item">
                  <PriceChangeFields
                    fieldPrefix="cost_per_item"
                    actionOptions={costActionOptions}
                    defaultAction=""
                    showRelative={false}
                    currency={shopCurrency}
                    initialChange={task?.costPerItemChange}
                  />
                </SectionCard>

                <SectionCard title="Apply to">
                  <ChoiceList
                    title=""
                    titleHidden
                    name="condition"
                    selected={applyTo}
                    onChange={setApplyTo}
                    choices={applyToChoices}
                  />
                  <ConditionScopeInputs
                    sectionPrefix="apply"
                    selectedCondition={applyTo[0]}
                  />

                  <ResourcePickerField
                    sectionPrefix="apply"
                    selectedCondition={applyTo[0]}
                    selectedCollections={applyCollections}
                    setSelectedCollections={setApplyCollections}
                    selectedProducts={applyProducts}
                    setSelectedProducts={setApplyProducts}
                    selectedVariants={applyVariants}
                    setSelectedVariants={setApplyVariants}
                    selectedTags={applyTags}
                    setSelectedTags={setApplyTags}
                  />
                </SectionCard>

                <SectionCard title="Exclude">
                  <ChoiceList
                    title=""
                    titleHidden
                    name="exclude"
                    selected={exclude}
                    onChange={setExclude}
                    choices={excludeChoices}
                  />
                  <ConditionScopeInputs
                    sectionPrefix="exclude"
                    selectedCondition={exclude[0]}
                  />

                  <ResourcePickerField
                    sectionPrefix="exclude"
                    selectedCondition={exclude[0]}
                    selectedCollections={excludeCollections}
                    setSelectedCollections={setExcludeCollections}
                    selectedProducts={excludeProducts}
                    setSelectedProducts={setExcludeProducts}
                    selectedVariants={excludeVariants}
                    setSelectedVariants={setExcludeVariants}
                    selectedTags={excludeTags}
                    setSelectedTags={setExcludeTags}
                  />
                </SectionCard>

                <SectionCard title="Exclude discounted">
                  <ChoiceList
                    title=""
                    titleHidden
                    name="exclude_discounted"
                    selected={excludeDiscounted}
                    onChange={setExcludeDiscounted}
                    choices={excludeDiscountedChoices}
                  />
                  <DiscountedExclusionInputs selected={excludeDiscounted} />
                </SectionCard>

                <SectionCard title="Advanced">
                  <input
                    type="hidden"
                    name="auto_reapply_changes_enabled"
                    value={autoReapply ? "enabled" : "disabled"}
                  />
                  <Checkbox
                    label="Automatically re-apply price changes (every hour)"
                    name="auto_reapply_changes"
                    checked={autoReapply}
                    onChange={setAutoReapply}
                    helpText="Prevents third-party apps from overriding prices after task completion. Works for tasks with up to 10,000 price changes."
                  />
                </SectionCard>

                <InlineStack align="end" gap="200">
                  <Button url="/app" disabled={isSubmitting}>
                    Discard
                  </Button>

                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Running..." : task ? "Update" : "Run task"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Layout.Section>
          </Layout>
        </Form>
      </Page>
    </>
  );
}
