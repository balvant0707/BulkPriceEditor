// app/routes/app.tasks.new.jsx
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
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
import { withShopifyEmbeddedParams } from "../lib/shopify-embedded-url";
import { loadSettings } from "../lib/product-reports.server";
import { DEFAULT_REPORT_SETTINGS } from "../lib/product-reports";
import { getAutoReapplyIntervalConfig } from "../lib/task-auto-reapply";
import { commitFlashSession, getFlashSession } from "../lib/flash.server";
import {
  DISCOUNTED_SKIP_REASONS,
  isVariantDiscounted,
  normalizeDiscountedScope,
  splitVariantsByDiscountedScope,
} from "../lib/task-discounted-exclusion";
import { updateMarketPrices } from "../services/market-pricing.server";
import { hasRequiredMarketScopes } from "../lib/shopify-scopes.server";

const MARKET_SCOPE_ERROR =
  "Shopify Markets permissions are required to update market prices. Reconnect the app to approve read_markets and write_markets.";

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
        catalogs(first: 10) {
          nodes {
            id
            title
            priceList {
              id
              currency
            }
          }
        }
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
const MAX_AUTO_REAPPLY_PRICE_CHANGES = 10000;
const VARIANT_PAGE_SIZE = 100;
const TASK_UPDATE_CONCURRENCY = 4;
const PROGRESS_UPDATE_MIN_INTERVAL_MS = 500;
const PROGRESS_UPDATE_MIN_DELTA = 2;
const GRAPHQL_MAX_RETRIES = 4;
const GRAPHQL_RETRY_BASE_MS = 500;
const TASK_AUDIT_SKIP_REASON_MAX_LENGTH = 500;
const AUTO_REAPPLY_CONFLICT_MESSAGE =
  "You have completed a task with auto-reapply enabled for similar products. Disable auto-reapply on that task first.";

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const settings = await loadSettings(session.shop);
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
        settings: {
          ...DEFAULT_REPORT_SETTINGS,
          ...settings,
        },
        task,
      });
    }

    return json({
      markets: normalizeMarkets(payload.data?.markets?.nodes),
      marketsError: "",
      shopCurrency: payload.data?.shop?.currencyCode || "USD",
      settings: {
        ...DEFAULT_REPORT_SETTINGS,
        ...settings,
      },
      task,
    });
  } catch {
    return json({
      markets: [],
      marketsError: "Unable to load Shopify Markets.",
      shopCurrency: "USD",
      settings: {
        ...DEFAULT_REPORT_SETTINGS,
        ...settings,
      },
      task,
    });
  }
}

export async function action({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  if (!session.shop) {
    throw new Response("Shop is required to create a task.", { status: 401 });
  }

  const flashSession = await getFlashSession(request);
  const formData = await request.formData();
  const taskId = getRecordId(
    getFormValue(formData, "id") || params.id || new URL(request.url).searchParams.get("id"),
  );
  const data = buildTaskData(session.shop, formData);
  const validationError = validateTaskData(data);

  if (validationError) {
    return json({ error: validationError }, { status: 400 });
  }
  if (
    (data.applyChangesTo === "markets" ||
      (data.applyChangesTo === "products" && data.selectedMarkets?.length)) &&
    !(await hasRequiredMarketScopes(admin, session))
  ) {
    return json({ error: MARKET_SCOPE_ERROR }, { status: 400 });
  }

  const estimatedAutoReapplyChanges = estimateTaskDataPriceChanges(data);
  if (
    (data.autoReapply || data.autoReapplyChanges) &&
    estimatedAutoReapplyChanges != null &&
    estimatedAutoReapplyChanges > MAX_AUTO_REAPPLY_PRICE_CHANGES
  ) {
    return json(
      {
        error:
          "Automatic re-apply is only available for tasks affecting up to 10,000 price changes.",
      },
      { status: 400 },
    );
  }

  const autoReapplyConflict = await findConflictingAutoReapplyTask(
    session.shop,
    data,
    taskId,
  );

  if (autoReapplyConflict) {
    return json({ error: AUTO_REAPPLY_CONFLICT_MESSAGE }, { status: 400 });
  }

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

    if (!["Completed", "Complete"].includes(existingTask.status)) {
      return json(
        {
          error:
            "Task cannot be changed until the current status is Completed.",
        },
        { status: 400 },
      );
    }

    await db.task.updateMany({
      where: { id: taskId, shop: session.shop },
      data: {
        ...data,
        status: "Pending",
        executionSummary: { progress: 0 },
        startedAt: new Date(),
        completedAt: null,
      },
    });

    scheduleTaskExecution(admin, taskId, data, session.shop);

    flashSession.flash("toast", "Task updated.");
    return redirect(
      withShopifyEmbeddedParams(`/app/tasks/${taskId}`, request, session.shop),
      {
        headers: {
          "Set-Cookie": await commitFlashSession(flashSession),
        },
      },
    );
  }

  const task = await db.task.create({
    data: {
      ...data,
      status: "Pending",
      executionSummary: { progress: 0 },
      startedAt: new Date(),
    },
  });

  scheduleTaskExecution(admin, task.id, data, session.shop);

  flashSession.flash("toast", "Task created.");
  return redirect(
    withShopifyEmbeddedParams(`/app/tasks/${task.id}`, request, session.shop),
    {
      headers: {
        "Set-Cookie": await commitFlashSession(flashSession),
      },
    },
  );
}

function scheduleTaskExecution(admin, taskId, data, shop) {
  void runTaskExecution(admin, taskId, data, shop);
}

function normalizeApplyingProgress(progress) {
  const value = Math.round(Number(progress) || 0);

  if (value <= 1) return 1;
  if (value >= 100) return 100;

  return Math.max(10, Math.min(90, Math.ceil(value / 10) * 10));
}

function createProgressUpdater(taskId, shop) {
  let lastWriteAt = 0;
  let lastWrittenProgress = 0;
  let latestSummary = { status: "Applying", progress: 0 };

  return async (progress, summary = {}, options = {}) => {
    const safeProgress = normalizeApplyingProgress(progress);
    const now = Date.now();

    latestSummary = {
      ...latestSummary,
      ...summary,
      status: summary.status || latestSummary.status || "Applying",
      progress: safeProgress,
    };

    const shouldWrite =
      options.force ||
      safeProgress >= 95 ||
      safeProgress - lastWrittenProgress >= PROGRESS_UPDATE_MIN_DELTA ||
      now - lastWriteAt >= PROGRESS_UPDATE_MIN_INTERVAL_MS;

    if (!shouldWrite) return;

    lastWriteAt = now;
    lastWrittenProgress = safeProgress;

    await db.task.updateMany({
      where: { id: taskId, shop },
      data: { executionSummary: latestSummary },
    });
  };
}

async function runTaskExecution(admin, taskId, data, shop) {
  const resolvedShop = resolveShop(data, shop);

  if (!resolvedShop) {
    await db.task.update({
      where: { id: taskId },
      data: {
        status: "Completed",
        executionSummary: {
          ok: false,
          progress: 100,
          status: "Completed",
          error: "Task execution failed because the shop is missing.",
        },
        completedAt: new Date(),
      },
    });
    return;
  }

  try {
    const updateProgress = createProgressUpdater(taskId, resolvedShop);

    await db.task.updateMany({
      where: { id: taskId, shop: resolvedShop },
      data: {
        status: "Applying",
        executionSummary: { status: "Applying", progress: 1 },
        startedAt: new Date(),
      },
    });

    await updateProgress(
      5,
      { status: "Applying", message: "Preparing task." },
      { force: true },
    );

    const execution = await executeTask(admin, data, updateProgress, {
      taskId,
      shop: resolvedShop,
    });

    await db.task.updateMany({
      where: { id: taskId, shop: resolvedShop },
      data: {
        status: "Completed",
        autoReapply:
          Boolean(data.autoReapply || data.autoReapplyChanges) &&
          execution.totalPriceChanges <= MAX_AUTO_REAPPLY_PRICE_CHANGES,
        autoReapplyChanges:
          Boolean(data.autoReapply || data.autoReapplyChanges) &&
          execution.totalPriceChanges <= MAX_AUTO_REAPPLY_PRICE_CHANGES,
        executionSummary: {
          ...execution,
          progress: 100,
          status: "Completed",
        },
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await db.task.updateMany({
      where: { id: taskId, shop: resolvedShop },
      data: {
        status: "Completed",
        executionSummary: {
          ok: false,
          progress: 100,
          status: "Completed",
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

function getAllowedExcludeValues(applyScope) {
  const hiddenByApplyScope = {
    selected_collections: new Set(["selected_collections"]),
    selected_products: new Set(["selected_collections", "selected_products"]),
    selected_products_with_variants: new Set([
      "selected_collections",
      "selected_products",
      "selected_products_with_variants",
    ]),
  };
  const hiddenValues = hiddenByApplyScope[applyScope] || new Set();

  return excludeChoices
    .map((choice) => choice.value)
    .filter((value) => !hiddenValues.has(value));
}

function getExcludeChoicesForApply(applyScope) {
  const allowedValues = new Set(getAllowedExcludeValues(applyScope));
  return excludeChoices.filter((choice) => allowedValues.has(choice.value));
}

function normalizeExcludeScopeForApply(excludeScope, applyScope) {
  return getAllowedExcludeValues(applyScope).includes(excludeScope)
    ? excludeScope
    : "nothing";
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

function buildSelectedCollectionRecords(formData, prefix) {
  const ids = getFormValues(formData, `${prefix}_collection_ids[]`);
  const titles = getFormValues(formData, `${prefix}_collection_titles[]`);
  const handles = getFormValues(formData, `${prefix}_collection_handles[]`);
  const productsCounts = getFormValues(
    formData,
    `${prefix}_collection_products_counts[]`,
  );
  const imageUrls = getFormValues(formData, `${prefix}_collection_image_urls[]`);

  return ids.map((id, index) => ({
    id,
    title: titles[index] || "",
    handle: handles[index] || "",
    productsCount: productsCounts[index] || "",
    imageUrl: imageUrls[index] || "",
  }));
}

function buildSelectedProductRecords(formData, prefix) {
  const ids = getFormValues(formData, `${prefix}_product_ids[]`);
  const titles = getFormValues(formData, `${prefix}_product_titles[]`);

  return ids.map((id, index) => ({
    id,
    title: titles[index] || "",
  }));
}

function buildSelectedVariantRecords(formData, prefix) {
  const ids = getFormValues(formData, `${prefix}_variant_ids[]`);
  const titles = getFormValues(formData, `${prefix}_variant_titles[]`);
  const productIds = getFormValues(formData, `${prefix}_variant_product_ids[]`);
  const productTitles = getFormValues(
    formData,
    `${prefix}_variant_product_titles[]`,
  );

  return ids.map((id, index) => ({
    id,
    title: titles[index] || "",
    productId: productIds[index] || "",
    productTitle: productTitles[index] || "",
  }));
}

function buildTaskData(shop, formData) {
  const resolvedShop = String(shop || "").trim();
  if (!resolvedShop) {
    throw new Response("Shop is required to create a task.", { status: 401 });
  }

  const selectedMarketIds = getFormValues(formData, "selected_market_ids[]");
  const selectedMarketHandles = getFormValues(formData, "selected_market_handles[]");
  const selectedMarketCurrencyCodes = getFormValues(
    formData,
    "selected_market_currency_codes[]",
  );
  const selectedMarketNames = getFormValues(formData, "selected_market_names[]");
  const selectedMarketPriceListIds = getFormValues(
    formData,
    "selected_market_price_list_ids[]",
  );
  const selectedMarketPriceListCurrencies = getFormValues(
    formData,
    "selected_market_price_list_currencies[]",
  );
  const applyCollections = buildSelectedCollectionRecords(formData, "apply");
  const excludeCollections = buildSelectedCollectionRecords(formData, "exclude");
  const applyProducts = buildSelectedProductRecords(formData, "apply");
  const excludeProducts = buildSelectedProductRecords(formData, "exclude");
  const applyVariants = buildSelectedVariantRecords(formData, "apply");
  const excludeVariants = buildSelectedVariantRecords(formData, "exclude");
  const applyToActiveProducts = getBooleanFormValue(
    formData,
    "apply_to_active_products",
    true,
  );
  const applyToDraftProducts = getBooleanFormValue(
    formData,
    "apply_to_draft_products",
    true,
  );
  const applyToSoldoutProducts = getBooleanFormValue(
    formData,
    "apply_to_soldout_products",
    true,
  );
  const includeDraftProducts = applyToDraftProducts;
  const reapplyMinute = clampReapplyMinute(
    getFormValue(formData, "reapply_minute", DEFAULT_REPORT_SETTINGS.reapplyMinute),
  );
  const rawAutoReapplyIntervalUnit = getFormValue(
    formData,
    "auto_reapply_interval_unit",
    "hours",
  );
  const autoReapplyIntervalUnit = ["minutes", "hours", "days"].includes(
    rawAutoReapplyIntervalUnit,
  )
    ? rawAutoReapplyIntervalUnit
    : "hours";
  const autoReapplyIntervalValue = clampAutoReapplyIntervalValue(
    getFormValue(formData, "auto_reapply_interval_value", "1"),
    autoReapplyIntervalUnit,
  );
  const configuration = formDataToConfiguration(formData);
  const applyScope = getFormValue(formData, "condition", "whole_store");
  const excludeScope = normalizeExcludeScopeForApply(
    getFormValue(formData, "exclude", "nothing"),
    applyScope,
  );

  return {
    shop: resolvedShop,
    status: "draft",
    applyChangesTo: getFormValue(formData, "apply_changes_to", "products"),
    applyToFixedPrices: getBooleanFormValue(
      formData,
      "apply_to_fixed_prices",
      false,
    ),
    applyToActiveProducts,
    applyToDraftProducts,
    applyToSoldoutProducts,
    selectedMarkets: selectedMarketIds.map((id, index) => {
      const priceListIds = String(selectedMarketPriceListIds[index] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const priceListCurrencies = String(
        selectedMarketPriceListCurrencies[index] || "",
      )
        .split(",")
        .map((value) => value.trim());
      const priceLists = priceListIds.map((priceListId, priceListIndex) => ({
        id: priceListId,
        currencyCode: priceListCurrencies[priceListIndex] || "",
      }));

      return {
        id,
        name: selectedMarketNames[index] || "",
        handle: selectedMarketHandles[index] || "",
        currencyCode: selectedMarketCurrencyCodes[index] || "",
        priceListIds,
        priceLists,
        priceListCurrencies: Object.fromEntries(
          priceLists
            .filter((priceList) => priceList.currencyCode)
            .map((priceList) => [priceList.id, priceList.currencyCode]),
        ),
      };
    }),
    priceChange: buildChangeData(formData, "price"),
    compareAtPriceChange: buildChangeData(formData, "compare_at_price"),
    costPerItemChange: buildChangeData(formData, "cost_per_item"),
    applyScope,
    excludeScope,
    discountedScope: normalizeDiscountedScope(
      getFormValue(formData, "exclude_discounted", "nothing"),
    ),
    applyResources: {
      scope: getFormValue(formData, "apply_scope"),
      saleFilter: getFormValue(formData, "apply_sale_filter"),
      collectionIds: getFormValues(formData, "apply_collection_ids[]"),
      collections: applyCollections,
      productIds: getFormValues(formData, "apply_product_ids[]"),
      products: applyProducts,
      variantIds: getFormValues(formData, "apply_variant_ids[]"),
      variants: applyVariants,
      tagNames: getFormValues(formData, "apply_tag_names[]"),
    },
    excludeResources: {
      scope: getFormValue(formData, "exclude_scope"),
      discountedScope: normalizeDiscountedScope(
        getFormValue(formData, "discounted_exclusion_scope"),
      ),
      collectionIds: getFormValues(formData, "exclude_collection_ids[]"),
      collections: excludeCollections,
      productIds: getFormValues(formData, "exclude_product_ids[]"),
      products: excludeProducts,
      variantIds: getFormValues(formData, "exclude_variant_ids[]"),
      variants: excludeVariants,
      tagNames: getFormValues(formData, "exclude_tag_names[]"),
    },
    configuration: {
      ...configuration,
      includeDraftProducts: String(includeDraftProducts),
      include_draft_products: String(includeDraftProducts),
      applyToActiveProducts: String(applyToActiveProducts),
      apply_to_active_products: String(applyToActiveProducts),
      applyToDraftProducts: String(applyToDraftProducts),
      apply_to_draft_products: String(applyToDraftProducts),
      applyToSoldoutProducts: String(applyToSoldoutProducts),
      apply_to_soldout_products: String(applyToSoldoutProducts),
      reapplyMinute: String(reapplyMinute),
      reapply_minute: String(reapplyMinute),
      autoReapplyIntervalUnit: autoReapplyIntervalUnit,
      auto_reapply_interval_unit: autoReapplyIntervalUnit,
      autoReapplyIntervalValue: String(autoReapplyIntervalValue),
      auto_reapply_interval_value: String(autoReapplyIntervalValue),
    },
    autoReapply: hasFormValue(formData, "auto_reapply_changes"),
    autoReapplyChanges: hasFormValue(formData, "auto_reapply_changes"),
    autoReapplyIntervalUnit,
    autoReapplyIntervalValue,
  };
}

function clampReapplyMinute(value) {
  const minute = Number(value);
  if (!Number.isFinite(minute)) return Number(DEFAULT_REPORT_SETTINGS.reapplyMinute);
  return Math.max(0, Math.min(59, Math.trunc(minute)));
}

function getBooleanFormValue(formData, name, defaultValue = true) {
  const value = getFormValue(formData, name, defaultValue ? "true" : "false");
  return !["false", "0", "off", "no", "disabled"].includes(
    String(value).toLowerCase(),
  );
}

function clampAutoReapplyIntervalValue(value, unit) {
  const number = Number(value);
  const max = unit === "minutes" ? 43200 : unit === "days" ? 30 : 720;

  if (!Number.isFinite(number)) return 1;
  return Math.max(1, Math.min(max, Math.trunc(number)));
}

function validateTaskData(taskData) {
  if (
    !taskData.applyToActiveProducts &&
    !taskData.applyToDraftProducts &&
    !taskData.applyToSoldoutProducts
  ) {
    return "Choose at least one product status to apply changes to.";
  }

  if (taskData.applyChangesTo === "markets") {
    const markets = taskData.selectedMarkets || [];
    if (!markets.length) return "Choose at least one Shopify Market.";
    if (markets.some((market) => !market.priceListIds?.length)) {
      return "Choose a Shopify Market with a price list.";
    }
    if (taskData.costPerItemChange?.action) {
      return "Cost per item changes are available only for Product prices.";
    }
  }

  const changes = [
    ["price", "Price", taskData.priceChange],
    ["compareAtPrice", "Compare at price", taskData.compareAtPriceChange],
    ["costPerItem", "Cost per item", taskData.costPerItemChange],
  ];

  if (!changes.some(([, , change]) => Boolean(change?.action))) {
    return "Choose at least one price, compare-at price, or cost per item action.";
  }

  for (const [field, label, change] of changes) {
    const error = validateChangeData(field, label, change);
    if (error) return error;
  }

  return "";
}

function estimateTaskDataPriceChanges(taskData) {
  if (taskData.applyScope === "selected_products_with_variants") {
    return taskData.applyResources?.variantIds?.length || 0;
  }

  if (taskData.applyScope === "selected_products") {
    return taskData.applyResources?.productIds?.length || 0;
  }

  if (taskData.applyScope === "selected_collections") {
    const totalProducts = (taskData.applyResources?.collections || []).reduce(
      (total, collection) => {
        const count = Number(collection.productsCount);
        return Number.isFinite(count) ? total + count : total;
      },
      0,
    );

    return totalProducts || null;
  }

  return null;
}

async function findConflictingAutoReapplyTask(shop, taskData, taskId = null) {
  if (!taskData.autoReapply && !taskData.autoReapplyChanges) {
    return null;
  }

  const tasks = await db.task.findMany({
    where: {
      shop,
      id: taskId ? { not: taskId } : undefined,
      status: {
        in: ["Completed", "Complete", "completed", "complete"],
      },
      OR: [{ autoReapply: true }, { autoReapplyChanges: true }],
    },
    select: {
      id: true,
      applyScope: true,
      applyResources: true,
    },
  });

  return tasks.find((task) => selectionsOverlap(task, taskData)) || null;
}

function normalizeScope(value) {
  return String(value || "whole_store").toLowerCase().trim();
}

function selectionsOverlap(existing, incoming) {
  const existingScope = normalizeScope(existing.applyScope);
  const incomingScope = normalizeScope(incoming.applyScope);

  if (existingScope === "whole_store" || incomingScope === "whole_store") {
    return true;
  }

  if (existingScope !== incomingScope) {
    return false;
  }

  const existingValues = getSelectionKeys(existing.applyResources, existingScope);
  const incomingValues = getSelectionKeys(incoming.applyResources, incomingScope);

  if (!existingValues.size || !incomingValues.size) {
    return true;
  }

  for (const value of incomingValues) {
    if (existingValues.has(value)) return true;
  }

  return false;
}

function getSelectionKeys(resources = {}, scope = "") {
  const normalizedScope = normalizeScope(scope);
  const values =
    normalizedScope === "selected_collections"
      ? [
          ...(resources.collectionIds || []),
          ...(resources.collections || []).map((item) => item.id || item.gid || item.title),
        ]
      : normalizedScope === "selected_products"
        ? [
            ...(resources.productIds || []),
            ...(resources.products || []).map((item) => item.id || item.gid || item.title),
          ]
        : normalizedScope === "selected_products_with_variants"
          ? [
              ...(resources.variantIds || []),
              ...(resources.variants || []).map((item) => item.id || item.gid || item.title),
            ]
          : normalizedScope === "selected_tags"
            ? [
                ...(resources.tagNames || []),
                ...(resources.tags || []).map((item) => item.id || item.title || item.name),
              ]
            : [];

  return new Set(
    values
      .flat()
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

function validateChangeData(field, label, change) {
  const action = change?.action || "";

  if (!action) return "";

  if (action === "set_new_value") {
    const amount = toNumber(change.amount);
    return amount == null || amount < 0
      ? `${label} requires a valid amount of 0 or greater.`
      : "";
  }

  if (action === "set_margin") {
    if (field !== "price") {
      return "Set margin is supported only for price changes.";
    }

    const margin = toNumber(change.percent);
    return margin == null || margin < 0 || margin >= 100
      ? "Set margin requires a margin percentage from 0 to 99.99."
      : "";
  }

  if (action === "increase" || action === "decrease") {
    if (change.type === "by_amount") {
      const amount = toNumber(change.amount);
      return amount == null || amount < 0
        ? `${label} ${action} requires a valid amount of 0 or greater.`
        : "";
    }

    const percent = toNumber(change.percent);
    return percent == null || percent < 0
      ? `${label} ${action} requires a valid percentage of 0 or greater.`
      : "";
  }

  return "";
}

async function executeTask(
  admin,
  taskData,
  onProgress = async () => {},
  options = {},
) {
  try {
    const shop = resolveShop(taskData, options.shop);

    if (!shop) {
      return {
        ok: false,
        error: "Task execution skipped because the shop is missing.",
        analyzedVariants: 0,
        updatedVariants: 0,
        totalPriceChanges: 0,
      };
    }

    await onProgress(
      5,
      { status: "Applying", message: "Loading target products." },
      { force: true },
    );

    const targetVariants = filterVariantsByProductStatus(
      await loadTargetVariants(admin, taskData),
      taskData,
    );
    await onProgress(20, {
      status: "Applying",
      analyzedVariants: targetVariants.length,
    }, { force: true });

    const excludedVariantIds = await loadExcludedVariantIds(admin, taskData);
    await onProgress(30, {
      status: "Applying",
      analyzedVariants: targetVariants.length,
    }, { force: true });

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
      shop,
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
          shop,
        }),
      );
    });

    const productVariantUpdates = [];
    const inventoryUpdates = [];
    const originalVariants = [];
    const originalInventoryItems = [];

    if (taskData.applyChangesTo === "markets") {
      for (const variant of variants) {
        const inventoryUpdate = buildInventoryUpdate(variant, taskData.costPerItemChange);
        if (!inventoryUpdate) continue;

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

      const marketResult = await updateMarketPrices({
        admin,
        ownerType: "task",
        ownerId: options.taskId,
        shop,
        markets: taskData.selectedMarkets,
        variants,
        priceChange: taskData.priceChange,
        compareAtPriceChange: taskData.compareAtPriceChange,
        applyToFixedPrices: taskData.applyToFixedPrices,
      });
      const marketAuditLogs = marketResult.logs.map((log) => ({
        taskId: options.taskId,
        shop,
        productId: log.productId,
        variantId: log.variantId,
        previousPrice: log.oldPrice,
        newPrice: log.newPrice,
        action: log.status,
        skipReason: log.errors?.join("; ") || null,
      }));
      const inventoryResults = await applyInventoryUpdates(admin, inventoryUpdates);
      const errors = [...marketResult.errors, ...inventoryResults.errors];

      await persistTaskAuditLogs([...auditLogs, ...marketAuditLogs]);
      await onProgress(95, {
        status: "Applying",
        analyzedVariants: variants.length,
        marketUpdates: marketResult.updatedCount,
        inventoryUpdates: inventoryUpdates.length,
        skippedVariants: marketResult.skippedCount,
      }, { force: true });

      return {
        ok: errors.length === 0,
        analyzedVariants: variants.length,
        variantUpdates: marketResult.updatedCount,
        inventoryUpdates: inventoryUpdates.length,
        updatedVariants: marketResult.updatedCount,
        updatedInventoryItems: inventoryResults.updatedCount,
        totalPriceChanges: marketResult.totalPriceChanges,
        skippedVariants: marketResult.skippedCount,
        skippedProducts: countSkippedProducts(skippedLogs),
        logs: [...auditLogs.map(({ taskId, shop, ...log }) => log), ...marketResult.logs],
        originalVariants: marketResult.originalVariants,
        originalMarketPrices: marketResult.originalMarketPrices,
        originalInventoryItems,
        errors,
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
            shop,
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
            shop,
          }),
        );
      }
    }

    await onProgress(40, {
      status: "Applying",
      analyzedVariants: variants.length,
      variantUpdates: productVariantUpdates.length,
      inventoryUpdates: inventoryUpdates.length,
      skippedVariants:
        targetVariants.length -
        variants.length +
        variants.length -
        productVariantUpdates.length,
    }, { force: true });

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
        status: "Applying",
        analyzedVariants: variants.length,
        variantUpdates: 0,
        inventoryUpdates: 0,
        skippedVariants:
          targetVariants.length - variants.length + variants.length - productVariantUpdates.length,
      }, { force: true });
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
    const localMarketResult = taskData.selectedMarkets?.length
      ? await updateMarketPrices({
          admin,
          ownerType: "task",
          ownerId: options.taskId,
          shop,
          markets: taskData.selectedMarkets,
          variants,
          priceChange: taskData.priceChange,
          compareAtPriceChange: taskData.compareAtPriceChange,
          applyToFixedPrices: false,
        })
      : null;
    const localMarketAuditLogs = (localMarketResult?.logs || []).map((log) => ({
      taskId: options.taskId,
      shop,
      productId: log.productId,
      variantId: log.variantId,
      previousPrice: log.oldPrice,
      newPrice: log.newPrice,
      action: log.status,
      skipReason: log.errors?.join("; ") || null,
    }));
    const errors = [
      ...variantResults.errors,
      ...inventoryResults.errors,
      ...(localMarketResult?.errors || []),
    ];
    await persistTaskAuditLogs([...auditLogs, ...localMarketAuditLogs]);

    return {
      ok: errors.length === 0,
      analyzedVariants: variants.length,
      variantUpdates: productVariantUpdates.length + (localMarketResult?.updatedCount || 0),
      inventoryUpdates: inventoryUpdates.length,
      updatedVariants: variantResults.updatedCount + (localMarketResult?.updatedCount || 0),
      updatedInventoryItems: inventoryResults.updatedCount,
      marketUpdates: localMarketResult?.updatedCount || 0,
      totalPriceChanges: productVariantUpdates.length + (localMarketResult?.updatedCount || 0),
      skippedVariants:
        targetVariants.length - variants.length + variants.length - productVariantUpdates.length,
      skippedProducts: countSkippedProducts(skippedLogs),
      logs: [
        ...auditLogs.map(({ taskId, shop, ...log }) => log),
        ...(localMarketResult?.logs || []),
      ],
      originalVariants,
      originalMarketPrices: localMarketResult?.originalMarketPrices || [],
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
  const skippedMissingShop = logs.filter((log) => log.taskId && !log.shop).length;
  if (skippedMissingShop > 0) {
    console.warn(
      `Skipped ${skippedMissingShop} task audit logs because shop was missing.`,
    );
  }

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
      skipReason: truncateTaskAuditValue(log.skipReason),
    }));

  if (!rows.length) return;

  await db.taskAuditLog.createMany({ data: rows });
}

function truncateTaskAuditValue(value, maxLength = TASK_AUDIT_SKIP_REASON_MAX_LENGTH) {
  if (value == null || value === "") return null;

  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function resolveShop(...sources) {
  for (const source of sources) {
    if (!source) continue;

    const shop =
      typeof source === "string"
        ? source
        : source.shop || source.data?.shop || source.session?.shop;

    if (shop && String(shop).trim()) {
      return String(shop).trim();
    }
  }

  return "";
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
  const configuration = record?.configuration || {};
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

const priceActionOptions = [
  { label: "Do not change price", value: "" },
  { label: "Increase price", value: "increase" },
  { label: "Decrease price", value: "decrease" },
  { label: "Set new price", value: "set_new_value" },
  {
    label: "Set price to compare at price",
    value: "set_to_compare_at_price",
  },
  { label: "Set margin", value: "set_margin" },
];

const compareAtActionOptions = [
  { label: "Do not change compare at price", value: "" },
  { label: "Increase compare at price", value: "increase" },
  { label: "Decrease compare at price", value: "decrease" },
  { label: "Set new compare at price", value: "set_new_value" },
  { label: "Set compare at price to price", value: "set_to_price" },
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
  { label: "Products on sale", value: "products_on_sale" },
  { label: "Product variants on sale", value: "variants_on_sale" },
];

function normalizeMarkets(markets = []) {
  return markets.map((market) => {
    const priceLists = (market.catalogs?.nodes || [])
      .map((catalog) => catalog.priceList)
      .filter((priceList) => priceList?.id)
      .map((priceList) => ({
        id: priceList.id,
        currencyCode: priceList.currency || "",
      }));
    const priceListIds = priceLists.map((priceList) => priceList.id);
    const currencyCode =
      priceLists.find((priceList) => priceList.currencyCode)?.currencyCode ||
      market.currencySettings?.baseCurrency?.currencyCode ||
      "";
    const regions = market.regions?.nodes || [];
    const currencyLabel = currencyCode ? ` (${currencyCode})` : "";
    const disabledLabel = currencyCode ? "" : " - no currency";
    const priceListLabel = priceListIds.length ? "" : " - no price list";
    const primaryLabel = market.primary ? " - primary" : "";

    return {
      id: market.id,
      name: market.name,
      handle: market.handle || "",
      currencyCode,
      enabled: Boolean(market.enabled),
      primary: Boolean(market.primary),
      regions,
      catalogs: market.catalogs?.nodes || [],
      priceListIds,
      priceLists,
      priceListCurrencies: Object.fromEntries(
        priceLists
          .filter((priceList) => priceList.currencyCode)
          .map((priceList) => [priceList.id, priceList.currencyCode]),
      ),
      label: `${market.name}${currencyLabel}${disabledLabel}${priceListLabel}${primaryLabel}`,
      disabled: !currencyCode || !priceListIds.length,
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
    return <input type="hidden" name="discounted_exclusion_scope" value="nothing" />;
  }

  if (selectedValue === "products_on_sale") {
    return (
      <input
        type="hidden"
        name="discounted_exclusion_scope"
        value="products_on_sale"
      />
    );
  }

  if (selectedValue === "variants_on_sale") {
    return (
      <input
        type="hidden"
        name="discounted_exclusion_scope"
        value="variants_on_sale"
      />
    );
  }

  return null;
}

function estimateAutoReapplyPriceChanges({
  applyTo,
  selectedCollections,
  selectedProducts,
  selectedVariants,
}) {
  const scope = applyTo?.[0] || "whole_store";

  if (scope === "selected_products_with_variants") {
    return selectedVariants.length;
  }

  if (scope === "selected_products") {
    return selectedProducts.length;
  }

  if (scope === "selected_collections") {
    const count = selectedCollections.reduce((total, collection) => {
      const value = Number(collection.productsCount || collection.products_count);
      return Number.isFinite(value) ? total + value : total;
    }, 0);

    return count || null;
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

                            <BlockStack gap="50">
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
                                  <Badge tone={item.status === "Active" ? "success" : "attention"}>
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
  includeDraftProducts = "true",
  applyToActiveProducts = true,
  applyToDraftProducts = true,
  applyToSoldoutProducts = true,
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
      includeDraftProducts: String(applyToDraftProducts),
      applyToActiveProducts: String(applyToActiveProducts),
      applyToDraftProducts: String(applyToDraftProducts),
      applyToSoldoutProducts: String(applyToSoldoutProducts),
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
            <div key={item.id}>
              <input
                type="hidden"
                name={`${sectionPrefix}_collection_ids[]`}
                value={item.id}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_collection_titles[]`}
                value={item.title || ""}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_collection_handles[]`}
                value={item.handle || ""}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_collection_products_counts[]`}
                value={item.productsCount || ""}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_collection_image_urls[]`}
                value={item.imageUrl || ""}
              />
            </div>
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
            <div key={item.id}>
              <input
                type="hidden"
                name={`${sectionPrefix}_product_ids[]`}
                value={item.id}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_product_titles[]`}
                value={item.title || ""}
              />
            </div>
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
            <div key={item.id}>
              <input
                type="hidden"
                name={`${sectionPrefix}_variant_ids[]`}
                value={item.id}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_variant_titles[]`}
                value={item.title || ""}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_variant_product_ids[]`}
                value={item.productId || ""}
              />
              <input
                type="hidden"
                name={`${sectionPrefix}_variant_product_titles[]`}
                value={item.productTitle || ""}
              />
            </div>
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
  defaultAction = "increase",
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
    action === "set_new_value" || (isIncreaseOrDecrease && changeType === "by_amount");

  const shouldShowRounding =
    (isPriceField && action === "set_margin") ||
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

function collectionConfigToSelectedItems(configuration, prefix) {
  const ids = getConfigArray(configuration, `${prefix}_collection_ids[]`);
  const titles = getConfigArray(configuration, `${prefix}_collection_titles[]`);
  const handles = getConfigArray(configuration, `${prefix}_collection_handles[]`);
  const productsCounts = getConfigArray(
    configuration,
    `${prefix}_collection_products_counts[]`,
  );
  const imageUrls = getConfigArray(configuration, `${prefix}_collection_image_urls[]`);

  return ids.map((id, index) => ({
    id,
    title: titles[index] || id,
    handle: handles[index] || "",
    productsCount: productsCounts[index] || "",
    imageUrl: imageUrls[index] || "",
  }));
}

function tagsToSelectedItems(tags) {
  return tags.map((title) => ({ id: title, title }));
}

export default function NewTaskPage() {
  const {
    markets = [],
    marketsError = "",
    shopCurrency = "USD",
    settings = DEFAULT_REPORT_SETTINGS,
    task = null,
  } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const configuration = task?.configuration || {};
  const includeDraftProducts = getConfigValue(
    configuration,
    "include_draft_products",
    String(settings.includeDraftProducts ?? DEFAULT_REPORT_SETTINGS.includeDraftProducts),
  );
  const initialApplyToActiveProducts = getConfigValue(
    configuration,
    "apply_to_active_products",
    String(task?.applyToActiveProducts ?? true),
  );
  const initialApplyToDraftProducts = getConfigValue(
    configuration,
    "apply_to_draft_products",
    String(task?.applyToDraftProducts ?? includeDraftProducts !== "false"),
  );
  const initialApplyToSoldoutProducts = getConfigValue(
    configuration,
    "apply_to_soldout_products",
    String(task?.applyToSoldoutProducts ?? true),
  );
  const reapplyMinute = getConfigValue(
    configuration,
    "reapply_minute",
    String(settings.reapplyMinute ?? DEFAULT_REPORT_SETTINGS.reapplyMinute),
  );

  const [applyChangesTo, setApplyChangesTo] = useState(
    getConfigValue(configuration, "apply_changes_to", task?.applyChangesTo || "products"),
  );
  const [applyToActiveProducts, setApplyToActiveProducts] = useState(
    initialApplyToActiveProducts !== "false",
  );
  const [applyToDraftProducts, setApplyToDraftProducts] = useState(
    initialApplyToDraftProducts !== "false",
  );
  const [applyToSoldoutProducts, setApplyToSoldoutProducts] = useState(
    initialApplyToSoldoutProducts !== "false",
  );
  const [selectedMarkets, setSelectedMarkets] = useState(
    getConfigArray(configuration, "selected_market_ids[]").length
      ? getConfigArray(configuration, "selected_market_ids[]")
      : task?.selectedMarkets?.map((market) => market.id).filter(Boolean) || [],
  );
  const selectableMarketIds = useMemo(
    () => new Set(markets.filter((market) => !market.disabled).map((market) => market.id)),
    [markets],
  );
  const marketChoices = useMemo(
    () =>
      markets.map((market) => ({
        label: market.label,
        value: market.id,
        disabled: market.disabled,
      })),
    [markets],
  );
  const handleSelectedMarketsChange = (marketIds) => {
    setSelectedMarkets(marketIds.filter((marketId) => selectableMarketIds.has(marketId)));
  };
  const selectedMarketDetails = useMemo(
    () =>
      markets.filter(
        (market) => !market.disabled && selectedMarkets.includes(market.id),
      ),
    [markets, selectedMarkets],
  );
  const localMarketDetails = useMemo(
    () =>
      markets.filter(
        (market) =>
          !market.disabled &&
          market.primary &&
          (market.priceListIds || []).length > 0,
      ),
    [markets],
  );

  useEffect(() => {
    setSelectedMarkets((current) =>
      current.filter((marketId) => selectableMarketIds.has(marketId)),
    );
  }, [selectableMarketIds]);

  const [applyTo, setApplyTo] = useState([
    getConfigValue(configuration, "condition", task?.applyScope || "whole_store"),
  ]);
  const [exclude, setExclude] = useState([
    getConfigValue(configuration, "exclude", task?.excludeScope || "nothing"),
  ]);
  const [excludeDiscounted, setExcludeDiscounted] = useState([
    normalizeDiscountedScope(
      getConfigValue(
        configuration,
        "exclude_discounted",
        task?.discountedScope || "nothing",
      ),
    ),
  ]);
  const [autoReapply, setAutoReapply] = useState(
    Boolean(task?.autoReapplyChanges || configuration.auto_reapply_changes),
  );
  const initialAutoReapplyInterval = getAutoReapplyIntervalConfig(task || {
    configuration,
  });
  const [autoReapplyIntervalUnit, setAutoReapplyIntervalUnit] = useState(
    initialAutoReapplyInterval.unit,
  );
  const [autoReapplyIntervalValue, setAutoReapplyIntervalValue] = useState(
    String(initialAutoReapplyInterval.value),
  );

  const [applyCollections, setApplyCollections] = useState(
    collectionConfigToSelectedItems(configuration, "apply"),
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
    collectionConfigToSelectedItems(configuration, "exclude"),
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
  const estimatedAutoReapplyPriceChanges = estimateAutoReapplyPriceChanges({
    applyTo,
    selectedCollections: applyCollections,
    selectedProducts: applyProducts,
    selectedVariants: applyVariants,
  });
  const autoReapplyUnavailable =
    estimatedAutoReapplyPriceChanges != null &&
    estimatedAutoReapplyPriceChanges > MAX_AUTO_REAPPLY_PRICE_CHANGES;
  const filteredExcludeChoices = useMemo(
    () => getExcludeChoicesForApply(applyTo[0]),
    [applyTo],
  );

  useEffect(() => {
    const marketIds = new Set(markets.map((market) => market.id));

    setSelectedMarkets((current) =>
      current.filter((marketId) => marketIds.has(marketId)),
    );
  }, [markets]);

  useEffect(() => {
    if (autoReapplyUnavailable) {
      setAutoReapply(false);
    }
  }, [autoReapplyUnavailable]);

  useEffect(() => {
    const normalizedExclude = normalizeExcludeScopeForApply(exclude[0], applyTo[0]);

    if (normalizedExclude !== exclude[0]) {
      setExclude([normalizedExclude]);
    }

    if (applyTo[0] === "selected_collections") {
      setExcludeCollections([]);
    }

    if (applyTo[0] === "selected_products") {
      setExcludeCollections([]);
      setExcludeProducts([]);
    }

    if (applyTo[0] === "selected_products_with_variants") {
      setExcludeCollections([]);
      setExcludeProducts([]);
      setExcludeVariants([]);
    }
  }, [applyTo, exclude]);

  const handleApplyChangesToChange = (value) => {
    setApplyChangesTo(value);

    if (value === "products") {
      setSelectedMarkets([]);
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
      <TitleBar title="Pryxo Bulk Price Editor" />

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
              : "Save",
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
          {applyChangesTo === "products"
            ? localMarketDetails.map((market) => (
                <div key={market.id}>
                  <input
                    type="hidden"
                    name="selected_market_ids[]"
                    value={market.id}
                  />
                  <input
                    type="hidden"
                    name="selected_market_names[]"
                    value={market.name}
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
                  <input
                    type="hidden"
                    name="selected_market_price_list_ids[]"
                    value={(market.priceListIds || []).join(",")}
                  />
                  <input
                    type="hidden"
                    name="selected_market_price_list_currencies[]"
                    value={(market.priceLists || [])
                      .map((priceList) => priceList.currencyCode || "")
                      .join(",")}
                  />
                </div>
              ))
            : null}
          <input
            type="hidden"
            name="include_draft_products"
            value={String(applyToDraftProducts)}
          />
          <input
            type="hidden"
            name="apply_to_active_products"
            value={String(applyToActiveProducts)}
          />
          <input
            type="hidden"
            name="apply_to_draft_products"
            value={String(applyToDraftProducts)}
          />
          <input
            type="hidden"
            name="apply_to_soldout_products"
            value={String(applyToSoldoutProducts)}
          />
          <input type="hidden" name="reapply_minute" value={reapplyMinute} />

          <Layout>
            <Layout.Section>
              <BlockStack gap="200">
                {actionData?.error ? (
                  <Banner tone="critical">{actionData.error}</Banner>
                ) : null}

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
                      {marketsError ? (
                        <Banner tone="warning">{marketsError}</Banner>
                      ) : null}

                      {marketChoices.length > 0 ? (
                        <>
                          <ChoiceList
                            title="Markets"
                            allowMultiple
                            selected={selectedMarkets}
                            onChange={handleSelectedMarketsChange}
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
                                name="selected_market_names[]"
                                value={market.name}
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
                              <input
                                type="hidden"
                                name="selected_market_price_list_ids[]"
                                value={(market.priceListIds || []).join(",")}
                              />
                              <input
                                type="hidden"
                                name="selected_market_price_list_currencies[]"
                                value={(market.priceLists || [])
                                  .map((priceList) => priceList.currencyCode || "")
                                  .join(",")}
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
                    defaultAction="increase"
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
                    includeDraftProducts={String(applyToDraftProducts)}
                    applyToActiveProducts={applyToActiveProducts}
                    applyToDraftProducts={applyToDraftProducts}
                    applyToSoldoutProducts={applyToSoldoutProducts}
                  />
                </SectionCard>

                <SectionCard title="Exclude">
                  <ChoiceList
                    title=""
                    titleHidden
                    name="exclude"
                    selected={exclude}
                    onChange={setExclude}
                    choices={filteredExcludeChoices}
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
                    includeDraftProducts={String(applyToDraftProducts)}
                    applyToActiveProducts={applyToActiveProducts}
                    applyToDraftProducts={applyToDraftProducts}
                    applyToSoldoutProducts={applyToSoldoutProducts}
                  />
                </SectionCard>

                <SectionCard title="Apply changes to">
                  <BlockStack gap="200">
                    <Checkbox
                      label="Active Products"
                      checked={applyToActiveProducts}
                      onChange={setApplyToActiveProducts}
                    />
                    <Checkbox
                      label="Draft Products"
                      checked={applyToDraftProducts}
                      onChange={setApplyToDraftProducts}
                    />
                    <Checkbox
                      label="Soldout Products"
                      checked={applyToSoldoutProducts}
                      onChange={setApplyToSoldoutProducts}
                    />
                  </BlockStack>
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

                <SectionCard title="Advanced" paddingBlockEnd="200">
                  <input
                    type="hidden"
                    name="auto_reapply_changes_enabled"
                    value={
                      autoReapply && !autoReapplyUnavailable
                        ? "enabled"
                      : "disabled"
                    }
                  />
                  <Checkbox
                    label="Automatically re-apply price changes"
                    name="auto_reapply_changes"
                    checked={autoReapply && !autoReapplyUnavailable}
                    onChange={setAutoReapply}
                    disabled={autoReapplyUnavailable}
                    helpText="Prevents third-party apps from overriding prices after task completion. The cron checks tasks regularly and re-applies prices only when the selected repeat interval is due. Works for tasks with up to 10,000 price changes."
                  />
                  {autoReapply && !autoReapplyUnavailable ? (
                    <FormLayout>
                      <FormLayout.Group>
                        <TextField
                          label="Repeat every"
                          name="auto_reapply_interval_value"
                          type="number"
                          min={1}
                          max={
                            autoReapplyIntervalUnit === "minutes"
                              ? 43200
                              : autoReapplyIntervalUnit === "days"
                                ? 30
                                : 720
                          }
                          value={autoReapplyIntervalValue}
                          onChange={setAutoReapplyIntervalValue}
                          autoComplete="off"
                        />

                        <Select
                          label="Interval"
                          name="auto_reapply_interval_unit"
                          options={[
                            { label: "Minutes", value: "minutes" },
                            { label: "Hours", value: "hours" },
                            { label: "Days", value: "days" },
                          ]}
                          value={autoReapplyIntervalUnit}
                          onChange={setAutoReapplyIntervalUnit}
                        />
                      </FormLayout.Group>
                    </FormLayout>
                  ) : null}
                  {autoReapplyUnavailable ? (
                    <Banner tone="warning">
                      Automatic re-apply is only available for tasks affecting
                      up to 10,000 price changes.
                    </Banner>
                  ) : null}
                </SectionCard>
              </BlockStack>
            </Layout.Section>
          </Layout>
        </Form>
      </Page>
    </>
  );
}
