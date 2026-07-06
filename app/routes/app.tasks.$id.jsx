import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Modal,
  Page,
  Pagination,
  ProgressBar,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { styleText } from "node:util";

const LOGS_PER_PAGE = 5;
const TASK_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVE_TASK_STATUSES = [
  "Pending",
  "Processing",
  "Applying",
  "Running",
  "Started",
  "In progress",
  "in_progress",
];

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const taskId = Number(params.id);
  const url = new URL(request.url);
  const selectedProductId = getShopifyNumericId(
    url.searchParams.get("productId"),
  );

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Response("Task not found", { status: 404 });
  }

  let task = await db.task.findFirst({
    where: {
      id: taskId,
      shop: session.shop,
    },
  });

  if (!task) {
    throw new Response("Task not found", { status: 404 });
  }

  if (
    ACTIVE_TASK_STATUSES.includes(task.status) &&
    new Date(task.updatedAt).getTime() <
      Date.now() - TASK_EXECUTION_TIMEOUT_MS
  ) {
    task = await db.task.update({
      where: { id: task.id },
      data: {
        status: "Failed",
        executionSummary: {
          ...(task.executionSummary || {}),
          ok: false,
          progress: 100,
          error: "Task execution timed out before Shopify finished responding.",
        },
        completedAt: new Date(),
      },
    });
  }

  const shopifyStoreHandle = getShopifyStoreHandle(session.shop);

  return json({
    task,
    shop: session.shop,
    shopifyStoreHandle,
    selectedProductId,
    productDetails: selectedProductId
      ? getProductDetails(task, selectedProductId, shopifyStoreHandle)
      : null,
    shopCurrency:
      (
        await db.shop.findUnique({
          where: { shop: session.shop },
          select: { currency: true },
        })
      )?.currency || "",
  });
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const taskId = Number(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Response("Task not found", { status: 404 });
  }

  if (intent !== "delete") {
    return json({ ok: false, message: "Invalid action" }, { status: 400 });
  }

  await db.task.deleteMany({
    where: {
      id: taskId,
      shop: session.shop,
    },
  });

  return json({ ok: true, deleted: true });
};

function humanize(value) {
  if (!value) return "-";

  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase().trim();
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatChange(task) {
  const priceChange = task.priceChange || {};
  const action = humanize(priceChange.action || "change");

  const value =
    priceChange.type === "by_amount"
      ? priceChange.amount
      : priceChange.percent
        ? `${priceChange.percent}%`
        : "";

  return `${action}${value ? ` by ${value}` : ""}`;
}

function getNumberValue(...values) {
  const foundValue = values
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));

  return Number.isFinite(foundValue) ? foundValue : null;
}

function getExecutionProgress(task) {
  const progress = getNumberValue(
    task.progress,
    task.percent,
    task.percentage,
    task.executionProgress,
    task.executionPercent,
    task.executionSummary?.progress,
    task.executionSummary?.percent,
    task.executionSummary?.percentage,
  );

  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  return 0;
}

function getTaskCompletedValue(task) {
  return (
    task.completedAt ||
    task.appliedAt ||
    task.executionSummary?.completedAt ||
    task.executionSummary?.appliedAt ||
    task.executionSummary?.finishedAt ||
    task.executionSummary?.completed ||
    ""
  );
}

function getTaskStatusValue(task) {
  return (
    task.status ||
    task.executionStatus ||
    task.executionSummary?.status ||
    task.executionSummary?.taskStatus ||
    ""
  );
}

function isTaskCompleted(task) {
  const status = normalizeStatus(getTaskStatusValue(task));
  const executionProgress = getExecutionProgress(task);
  const completedValue = getTaskCompletedValue(task);

  return (
    Boolean(completedValue) ||
    executionProgress >= 100 ||
    status === "complete" ||
    status === "completed" ||
    status === "applied" ||
    status === "done" ||
    status === "success" ||
    status === "successful"
  );
}

function isTaskFailed(task) {
  const status = normalizeStatus(getTaskStatusValue(task));

  return (
    status.includes("failed") ||
    status.includes("error") ||
    status.includes("cancel")
  );
}

function isTaskProcessing(task) {
  const status = normalizeStatus(getTaskStatusValue(task));

  if (isTaskCompleted(task) || isTaskFailed(task)) return false;

  return (
    status === "processing" ||
    status === "pending" ||
    status === "applying" ||
    status === "running" ||
    status === "in_progress" ||
    status === "started"
  );
}

function getBaseTaskDisplay(task) {
  const status = getTaskStatusValue(task);
  const normalized = normalizeStatus(status);

if (isTaskCompleted(task)) {
  return {
    label: "Completed",
    tone: "success",
    background: "#D1FADF",
    showProgress: false,
    style: {
      width: "fit-content",
    },
  };
}

  if (isTaskProcessing(task)) {
    return {
      label: "Applying",
      tone: "attention",
      background: "#FEDF89",
      showProgress: true,
       style: {
      width: "fit-content",
    },
    };
  }

  if (!normalized || normalized === "pending") {
    return {
      label: "Pending",
      tone: "attention",
      background: "#FEDF89",
      showProgress: false,
       style: {
      width: "fit-content",
    },
    };
  }

  if (isTaskFailed(task)) {
    return {
      label: humanize(status),
      tone: "critical",
      background: "#FEE4E2",
      showProgress: false,
       style: {
      width: "fit-content",
    },
    };
  }

  return {
    label: humanize(status),
    tone: "info",
    background: "#E0F2FE",
    showProgress: false,
     style: {
      width: "fit-content",
    },
  };
}

function getTaskProgress(task) {
  if (isTaskCompleted(task)) return 100;
  if (isTaskProcessing(task)) return Math.max(getExecutionProgress(task), 1);

  return getExecutionProgress(task);
}

function getDateMs(value) {
  if (!value) return null;

  const date = new Date(value);
  const time = date.getTime();

  return Number.isNaN(time) ? null : time;
}

function getTaskStartedAt(task) {
  return (
    task.startedAt ||
    task.executionSummary?.startedAt ||
    task.executionSummary?.taskStartedAt ||
    task.createdAt
  );
}

function getEstimatedProgress(baseProgress, startedAt, now) {
  const startedAtMs = getDateMs(startedAt);

  if (!startedAtMs) {
    return Math.max(baseProgress, 1);
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  const estimatedProgress = Math.min(95, baseProgress + elapsedSeconds);

  return Math.max(baseProgress, estimatedProgress, 1);
}

function getRollbackStatusValue(task) {
  return (
    task.rollbackStatus ||
    task.rollback?.status ||
    task.rollbackSummary?.status ||
    task.executionSummary?.rollbackStatus ||
    task.executionSummary?.rollback?.status ||
    task.executionSummary?.rollbackSummary?.status ||
    ""
  );
}

function getRollbackStartedValue(task) {
  return (
    task.rollbackStartedAt ||
    task.rollback?.startedAt ||
    task.rollbackSummary?.startedAt ||
    task.executionSummary?.rollbackStartedAt ||
    task.executionSummary?.rollback?.startedAt ||
    task.executionSummary?.rollbackSummary?.startedAt ||
    ""
  );
}

function getRollbackCompletedValue(task) {
  return (
    task.rollbackCompletedAt ||
    task.rolledBackAt ||
    task.rollback?.completedAt ||
    task.rollbackSummary?.completedAt ||
    task.executionSummary?.rollbackCompletedAt ||
    task.executionSummary?.rolledBackAt ||
    task.executionSummary?.rollback?.completedAt ||
    task.executionSummary?.rollbackSummary?.completedAt ||
    ""
  );
}

function getRollbackProgress(task) {
  const progress = getNumberValue(
    task.rollbackProgress,
    task.rollbackPercent,
    task.rollbackPercentage,
    task.rollback?.progress,
    task.rollback?.percent,
    task.rollbackSummary?.progress,
    task.rollbackSummary?.percent,
    task.rollbackSummary?.percentage,
    task.executionSummary?.rollbackProgress,
    task.executionSummary?.rollbackPercent,
    task.executionSummary?.rollbackPercentage,
    task.executionSummary?.rollback?.progress,
    task.executionSummary?.rollback?.percent,
    task.executionSummary?.rollbackSummary?.progress,
    task.executionSummary?.rollbackSummary?.percent,
    task.executionSummary?.rollbackSummary?.percentage,
  );

  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  return 0;
}

function getRollbackState(task) {
  const taskStatus = normalizeStatus(getTaskStatusValue(task));
  const rollbackStatus = normalizeStatus(getRollbackStatusValue(task));
  const rollbackProgress = getRollbackProgress(task);

  const hasStartedAt = Boolean(getRollbackStartedValue(task));
  const hasCompletedAt = Boolean(getRollbackCompletedValue(task));

  const completedStatuses = [
    "complete",
    "completed",
    "rolled_back",
    "rolledback",
    "rollback_complete",
    "rollback_completed",
  ];

  const processingStatuses = [
    "processing",
    "applying",
    "started",
    "running",
    "in_progress",
    "rollback_processing",
    "rollback_started",
    "rollback_running",
    "rollback_in_progress",
  ];

  const failedStatuses = ["failed", "error", "cancelled", "canceled"];

  const isCompleted =
    hasCompletedAt ||
    completedStatuses.includes(rollbackStatus) ||
    taskStatus === "rolled_back" ||
    taskStatus === "rolledback" ||
    taskStatus === "rollback_complete" ||
    taskStatus === "rollback_completed";

  const isFailed =
    failedStatuses.some((status) => rollbackStatus.includes(status)) ||
    failedStatuses.some((status) => taskStatus.includes(`rollback_${status}`));

  const hasRealRollbackStart =
    hasStartedAt ||
    rollbackProgress > 0 ||
    processingStatuses.includes(rollbackStatus) ||
    taskStatus === "rollback_processing" ||
    taskStatus === "rollback_started" ||
    taskStatus === "rollback_running" ||
    taskStatus === "rollback_in_progress";

  const isProcessing =
    !isCompleted &&
    !isFailed &&
    hasRealRollbackStart &&
    (processingStatuses.includes(rollbackStatus) ||
      rollbackStatus === "pending" ||
      taskStatus === "rollback_processing" ||
      taskStatus === "rollback_started" ||
      taskStatus === "rollback_running" ||
      taskStatus === "rollback_in_progress");

  return {
    isCompleted,
    isProcessing,
    isFailed,
    progress: rollbackProgress,
  };
}

function getStatusToneFromDisplay(display) {
  return display?.tone || "info";
}

function getAppliedLabel(task) {
  if (isTaskCompleted(task)) return "Applied";
  if (isTaskProcessing(task)) return "Applying";

  return humanize(getTaskStatusValue(task) || "Pending");
}

function getShopifyStoreHandle(shop) {
  if (!shop) return "";

  return String(shop)
    .replace(/^https?:\/\//, "")
    .replace(".myshopify.com", "")
    .split("/")[0]
    .trim();
}

function getShopifyNumericId(value) {
  if (!value) return "";

  const stringValue = String(value);
  const gidMatch = stringValue.match(/\/(\d+)$/);
  if (gidMatch?.[1]) return gidMatch[1];

  const numberMatch = stringValue.match(/^(\d+)$/);
  if (numberMatch?.[1]) return numberMatch[1];

  return stringValue;
}

function getProductId(record) {
  return getShopifyNumericId(
    record?.productId ??
      record?.product_id ??
      record?.legacyProductId ??
      record?.productLegacyResourceId ??
      record?.productGraphqlId ??
      record?.productGid ??
      record?.product?.id ??
      record?.product?.legacyResourceId ??
      record?.product?.admin_graphql_api_id,
  );
}

function getVariantId(record) {
  return getShopifyNumericId(
    record?.variantId ??
      record?.variant_id ??
      record?.legacyVariantId ??
      record?.variantLegacyResourceId ??
      record?.variantGraphqlId ??
      record?.variantGid ??
      record?.admin_graphql_api_id ??
      record?.variant?.id ??
      record?.variant?.legacyResourceId ??
      record?.id,
  );
}

function getProductTitle(record) {
  return (
    record?.productTitle ||
    record?.product?.title ||
    record?.title ||
    "Product"
  );
}

function getVariantTitle(record) {
  return (
    record?.variantTitle ||
    record?.variant?.title ||
    record?.optionTitle ||
    record?.selectedOptionsTitle ||
    record?.title ||
    "Default Title"
  );
}

function getVariantSku(record) {
  return record?.sku || record?.variant?.sku || "-";
}

function getProductAdminUrl(shopifyStoreHandle, productId) {
  if (!shopifyStoreHandle || !productId) return "";

  return `https://admin.shopify.com/store/${shopifyStoreHandle}/products/${productId}`;
}

function getVariantAdminUrl(shopifyStoreHandle, productId, variantId) {
  if (!shopifyStoreHandle || !productId || !variantId) return "";

  return `https://admin.shopify.com/store/${shopifyStoreHandle}/products/${productId}/variants/${variantId}`;
}

function AdminLink({ url, children }) {
  if (!url) return children;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function buildVariantChanges(record) {
  const changes = [];

  if (record?.cost !== record?.nextCost) {
    changes.push(`Cost: ${record?.cost ?? "-"} -> ${record?.nextCost ?? "-"}`);
  }

  return changes;
}

function formatPriceValue(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function getCurrencySymbol(currencyCode) {
  const symbols = {
    INR: "₹",
    USD: "$",
    EUR: "€",
    GBP: "£",
    CAD: "$",
    AUD: "$",
  };

  return symbols[String(currencyCode || "").toUpperCase()] || "";
}

function formatMoneyValue(value, currencyCode) {
  const formattedValue = formatPriceValue(value);
  const currencySymbol = getCurrencySymbol(currencyCode);

  if (formattedValue === "-" || !currencySymbol) return formattedValue;

  return `${formattedValue} ${currencySymbol}`;
}

function buildVariantChangeItems(record, currencyCode) {
  const changes = [];

  if (record?.price !== record?.nextPrice) {
    changes.push({
      label: "Price",
      text: `Price: ${formatMoneyValue(record?.price, currencyCode)} → ${formatMoneyValue(
        record?.nextPrice,
        currencyCode,
      )}`,
    });
  }

  if (record?.compareAtPrice !== record?.nextCompareAtPrice) {
    changes.push({
      label: "Compare price",
      text: `Compare price: ${formatMoneyValue(
        record?.compareAtPrice,
        currencyCode,
      )} → ${formatMoneyValue(record?.nextCompareAtPrice, currencyCode)}`,
    });
  }

  if (record?.cost !== record?.nextCost) {
    changes.push({
      label: "Cost",
      text: `Cost: ${formatMoneyValue(record?.cost, currencyCode)} → ${formatMoneyValue(
        record?.nextCost,
        currencyCode,
      )}`,
    });
  }

  return changes;
}

function summarizeProductChanges(changeItems) {
  if (!changeItems.length) {
    return {
      primary: "No changes recorded",
      moreCount: 0,
    };
  }

  return {
    primary: changeItems[0].text,
    moreCount: Math.max(changeItems.length - 1, 0),
  };
}

function summarizeVariantValue(variants, field) {
  const values = [
    ...new Set(
      variants
        .map((variant) => formatPriceValue(variant[field]))
        .filter((value) => value !== "-"),
    ),
  ];

  if (!values.length) return "-";
  if (values.length === 1) return values[0];

  return "Multiple";
}

function createProductGroups(task, shopifyStoreHandle, shopCurrency) {
  const groups = new Map();
  const originalVariants = task.executionSummary?.originalVariants || [];
  const originalInventoryItems =
    task.executionSummary?.originalInventoryItems || [];

  function addRecord(record, index, type) {
    const productId = getProductId(record);
    const variantId = getVariantId(record);
    const productTitle = getProductTitle(record);
    const variantTitle = getVariantTitle(record);
    const sku = getVariantSku(record);

    const groupKey = productId
      ? `product-${productId}`
      : `${type}-${variantId || index}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        rowId: groupKey,
        productId,
        productTitle,
        adminUrl: getProductAdminUrl(shopifyStoreHandle, productId),
        variants: [],
        priceChangeCount: 0,
        compareAtChangeCount: 0,
        costChangeCount: 0,
        changeItems: [],
        status: getBaseTaskDisplay(task).label,
      });
    }

    const group = groups.get(groupKey);

    if (record?.price !== record?.nextPrice) group.priceChangeCount += 1;

    if (record?.compareAtPrice !== record?.nextCompareAtPrice) {
      group.compareAtChangeCount += 1;
    }

    if (record?.cost !== record?.nextCost) group.costChangeCount += 1;

    group.changeItems.push(...buildVariantChangeItems(record, shopCurrency));

    group.variants.push({
      rowId: `${groupKey}-${variantId || index}`,
      variantId,
      title: variantTitle,
      sku,
      price: record?.price,
      compareAtPrice: record?.compareAtPrice,
      newSetPrice: record?.nextPrice,
      changes: buildVariantChanges(record),
      adminUrl: getVariantAdminUrl(shopifyStoreHandle, productId, variantId),
      type,
    });
  }

  originalVariants.forEach((variant, index) => {
    addRecord(variant, index, "variant");
  });

  originalInventoryItems.forEach((item, index) => {
    addRecord(item, index, "inventory");
  });

  return Array.from(groups.values()).map((group) => {
    const changes = [
      group.priceChangeCount
        ? `${group.priceChangeCount} variant price change${
            group.priceChangeCount > 1 ? "s" : ""
          }`
        : "",
      group.compareAtChangeCount
        ? `${group.compareAtChangeCount} compare-at price change${
            group.compareAtChangeCount > 1 ? "s" : ""
          }`
        : "",
      group.costChangeCount
        ? `${group.costChangeCount} cost change${
            group.costChangeCount > 1 ? "s" : ""
          }`
        : "",
    ].filter(Boolean);

    return {
      ...group,
      changes: changes.length ? changes : ["No changes recorded"],
      otherChanges: group.variants.flatMap((variant) => variant.changes),
      changeSummary: summarizeProductChanges(group.changeItems),
      price: summarizeVariantValue(group.variants, "price"),
      compareAtPrice: summarizeVariantValue(group.variants, "compareAtPrice"),
      newSetPrice: summarizeVariantValue(group.variants, "newSetPrice"),
      variantCount: group.variants.length,
    };
  });
}

function filterLogs(logs, searchQuery) {
  const query = searchQuery.trim().toLowerCase();

  if (!query) return logs;

  return logs.filter((log) => {
    const searchableText = [
      log.productTitle,
      log.productId,
      log.variantCount,
      log.status,
      ...(log.changes || []),
      log.price,
      log.compareAtPrice,
      log.newSetPrice,
      log.changeSummary?.primary,
      ...(log.variants || []).flatMap((variant) => [
        variant.title,
        variant.sku,
        variant.variantId,
        variant.price,
        variant.compareAtPrice,
        variant.newSetPrice,
        ...(variant.changes || []),
      ]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(query);
  });
}

function getAppliedAt(task) {
  return (
    task.executionSummary?.completedAt ||
    task.executionSummary?.appliedAt ||
    task.completedAt ||
    task.appliedAt ||
    task.updatedAt ||
    task.createdAt
  );
}

function getProductDetails(task, productId, shopifyStoreHandle) {
  const originalVariants = task.executionSummary?.originalVariants || [];
  const originalInventoryItems =
    task.executionSummary?.originalInventoryItems || [];

  const variantRecords = originalVariants
    .filter((variant) => getProductId(variant) === productId)
    .map((variant, index) => {
      const variantId = getVariantId(variant);

      return {
        rowId: `variant-${variantId || index}`,
        variantId,
        title: getVariantTitle(variant),
        sku: getVariantSku(variant),
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        newSetPrice: variant.nextPrice,
        changes: buildVariantChanges(variant),
        adminUrl: getVariantAdminUrl(shopifyStoreHandle, productId, variantId),
      };
    });

  const inventoryRecords = originalInventoryItems
    .filter((item) => getProductId(item) === productId)
    .map((item, index) => {
      const variantId = getVariantId(item);

      return {
        rowId: `inventory-${variantId || index}`,
        variantId,
        title: getVariantTitle(item),
        sku: getVariantSku(item),
        price: item.price,
        compareAtPrice: item.compareAtPrice,
        newSetPrice: item.nextPrice,
        changes: buildVariantChanges(item),
        adminUrl: getVariantAdminUrl(shopifyStoreHandle, productId, variantId),
      };
    });

  const allRecords = [...variantRecords, ...inventoryRecords];

  if (!allRecords.length) return null;

  const firstOriginalRecord =
    originalVariants.find((variant) => getProductId(variant) === productId) ||
    originalInventoryItems.find((item) => getProductId(item) === productId);

  return {
    productId,
    productTitle: getProductTitle(firstOriginalRecord),
    adminUrl: getProductAdminUrl(shopifyStoreHandle, productId),
    variants: allRecords.map((record) => ({
      ...record,
      changes: record.changes.length ? record.changes : ["No changes recorded"],
    })),
    appliedAt: getAppliedAt(task),
  };
}

function StatusBadge({ display }) {
  return (
    <span
      style={{
        alignItems: "center",
        background: display.background,
        borderRadius: 8,
        display: "inline-flex",
        fontWeight: 600,
        gap: 4,
        lineHeight: 1,
        padding: "6px 10px",
      }}
    >
      {display.tone === "attention" ? (
        <span
          aria-hidden="true"
          style={{
            background: "#B98900",
            borderRadius: "50%",
            display: "inline-block",
            height: 8,
            width: 8,
          }}
        />
      ) : null}
      {display.label}
    </span>
  );
}

function DetailRow({ label, value, children }) {
  return (
    <Box paddingBlock="300" borderBlockEndWidth="025" borderColor="border">
      <InlineStack gap="800" blockAlign="center" wrap={false}>
        <Box minWidth="220px">
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
        </Box>

        {children || (
          <Text as="p" fontWeight="regular">
            {value}
          </Text>
        )}
      </InlineStack>
    </Box>
  );
}

function ProductDetailsView({ task, productDetails, navigate }) {
  const statusLabel = getAppliedLabel(task);
  const statusTone = getStatusToneFromDisplay(getBaseTaskDisplay(task));

  return (
    <Page
      title="Price change details"
      titleMetadata={<Badge tone={statusTone}>{statusLabel}</Badge>}
      backAction={{
        content: "Task details",
        onAction: () => navigate(`/app/tasks/${task.id}`),
      }}
    >
      <TitleBar title="Price change details" />

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <DetailRow label="Product">
                <Text as="p" fontWeight="regular">
                  <AdminLink url={productDetails?.adminUrl}>
                    {productDetails?.productTitle || "-"}
                  </AdminLink>
                </Text>
              </DetailRow>

              <DetailRow
                label="Applied"
                value={formatDate(productDetails?.appliedAt)}
              />
            </Card>

            <Card padding="0">
              <Box padding="400">
                <Text as="h2" variant="headingMd">
                  Variants
                </Text>
              </Box>

              <IndexTable
                resourceName={{ singular: "variant", plural: "variants" }}
                itemCount={productDetails?.variants?.length || 0}
                selectable={false}
                headings={[
                  { title: "Title" },
                  { title: "SKU" },
                  { title: "Price" },
                  { title: "Compare price" },
                  { title: "New set price" },
                  { title: "Other changes" },
                ]}
              >
                {(productDetails?.variants || []).map((variant, index) => (
                  <IndexTable.Row
                    id={variant.rowId}
                    key={variant.rowId}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <Text as="span" fontWeight="regular">
                        <AdminLink url={variant.adminUrl}>
                          {variant.title}
                        </AdminLink>
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text as="span">{variant.sku || "-"}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text as="span">{formatPriceValue(variant.price)}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text as="span">
                        {formatPriceValue(variant.compareAtPrice)}
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text as="span">
                        {formatPriceValue(variant.newSetPrice)}
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text as="span">
                        {variant.changes.length
                          ? variant.changes.join(", ")
                          : "-"}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>

              {!productDetails?.variants?.length ? (
                <Box padding="400">
                  <Text as="p" tone="subdued">
                    No variant details found for this product.
                  </Text>
                </Box>
              ) : null}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default function TaskDetailsPage() {
  const { task, shopifyStoreHandle, selectedProductId, productDetails, shopCurrency } =
    useLoaderData();

  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const deleteFetcher = useFetcher();
  const submit = useSubmit();

  const rollbackState = getRollbackState(task);
  const taskCompleted = isTaskCompleted(task);
  const taskProcessing = isTaskProcessing(task);

  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [clientRollbackStarted, setClientRollbackStarted] = useState(false);
  const [progressTick, setProgressTick] = useState(Date.now());

  const rollbackCompleted = rollbackState.isCompleted;
  const rollbackFailed = rollbackState.isFailed;

  const rollbackProcessing =
    !rollbackCompleted &&
    !rollbackFailed &&
    (rollbackState.isProcessing || clientRollbackStarted);

  const baseStatusDisplay = getBaseTaskDisplay(task);

  const statusDisplay = rollbackProcessing
    ? {
        label: "Canceling",
        tone: "attention",
        background: "#FEDF89",
        showProgress: true,
      }
    : baseStatusDisplay;

  const statusTone = getStatusToneFromDisplay(statusDisplay);
  const logStatusLabel =
    taskProcessing || rollbackProcessing
      ? statusDisplay.label
      : getAppliedLabel(task);

  const rawServerProgress = rollbackProcessing
    ? Math.max(rollbackState.progress || 1, 1)
    : getTaskProgress(task);
  const serverProgress = taskProcessing
    ? getEstimatedProgress(rawServerProgress, getTaskStartedAt(task), progressTick)
    : rawServerProgress;

  const [visibleProgress, setVisibleProgress] = useState(serverProgress);

  const logs = useMemo(
    () => createProductGroups(task, shopifyStoreHandle, shopCurrency),
    [task, shopifyStoreHandle, shopCurrency],
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredLogs = useMemo(
    () => filterLogs(logs, searchQuery),
    [logs, searchQuery],
  );

  const totalPages = Math.max(
    1,
    Math.ceil(filteredLogs.length / LOGS_PER_PAGE),
  );

  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * LOGS_PER_PAGE;
  const paginatedLogs = filteredLogs.slice(
    pageStart,
    pageStart + LOGS_PER_PAGE,
  );

  const shouldPoll =
    !selectedProductId && (taskProcessing || rollbackProcessing);

  const openRollbackModal = () => {
    setRollbackModalOpen(true);
  };

  const closeRollbackModal = () => {
    if (rollbackProcessing) return;
    setRollbackModalOpen(false);
  };

  const confirmRollback = () => {
    setRollbackModalOpen(false);
    setClientRollbackStarted(true);
    setVisibleProgress(1);
    submit(null, {
      method: "post",
      action: `/app/tasks/${task.id}/rollback`,
    });
  };

  const handleDelete = () => {
    deleteFetcher.submit(
      { intent: "delete" },
      {
        method: "post",
        action: `/app/tasks/${task.id}`,
      },
    );
  };

  const pageSecondaryActions = rollbackCompleted
    ? [
        {
          content: deleteFetcher.state === "idle" ? "Delete" : "Deleting...",
          destructive: true,
          disabled: deleteFetcher.state !== "idle",
          onAction: handleDelete,
        },
      ]
    : [
        {
          content: rollbackProcessing ? "Rollback processing..." : "Rollback",
          disabled: rollbackProcessing || !taskCompleted,
          onAction: openRollbackModal,
        },
      ];

  useEffect(() => {
    if (deleteFetcher.data?.deleted) {
      navigate("/app/tasks");
    }
  }, [deleteFetcher.data, navigate]);

  useEffect(() => {
    if (rollbackCompleted || rollbackFailed) {
      setClientRollbackStarted(false);
      setRollbackModalOpen(false);
    }
  }, [rollbackCompleted, rollbackFailed]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setVisibleProgress((currentProgress) => {
      if (rollbackProcessing) {
        if (currentProgress >= 100 || currentProgress <= 0) {
          return serverProgress;
        }

        return Math.max(currentProgress, serverProgress, 1);
      }

      if (taskProcessing) {
        if (currentProgress >= 100 || currentProgress <= 0) {
          return Math.max(serverProgress, 1);
        }

        return Math.max(currentProgress, serverProgress, 1);
      }

      return serverProgress;
    });
  }, [rollbackProcessing, taskProcessing, serverProgress]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const timer = setInterval(() => {
      setProgressTick(Date.now());
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(timer);
  }, [revalidator, shouldPoll]);

  if (selectedProductId) {
    return (
      <ProductDetailsView
        task={task}
        productDetails={productDetails}
        navigate={navigate}
      />
    );
  }

  return (
    <Page
      title="Task details"
      backAction={{ content: "Tasks", onAction: () => navigate("/app/tasks") }}
      secondaryActions={pageSecondaryActions}
    >
      <TitleBar title="Task details" />

      <Modal
        open={rollbackModalOpen}
        onClose={closeRollbackModal}
        title="Confirm rollback"
        primaryAction={{
          content: "Yes, rollback",
          destructive: true,
          onAction: confirmRollback,
          disabled: rollbackProcessing,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: closeRollbackModal,
            disabled: rollbackProcessing,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to rollback this task? This will revert the
              product changes made by this task.
            </Text>

            <Text as="p" tone="subdued">
              Click Yes only when you want to restore the previous product
              values.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <DetailRow label="Changes" value={formatChange(task)} />

              <DetailRow
                label="Change type"
                value={humanize(task.applyChangesTo || "products")}
              />

              <DetailRow label="Apply to" value={humanize(task.applyScope)} />

              <DetailRow label="Exclude" value={humanize(task.excludeScope)} />

              <DetailRow label="Status">
                <BlockStack gap="100">
                  <StatusBadge display={statusDisplay} />

                  {statusDisplay.showProgress ? (
                    <BlockStack gap="100">
                      <Box maxWidth="320px" style={{ display:"none"}}>
                        <ProgressBar
                          progress={visibleProgress}
                          size="small"
                          tone="primary"
                        />
                      </Box>
                      <Text as="p" tone="subdued">
                        Progress: {visibleProgress}%
                      </Text>
                    </BlockStack>
                  ) : null}
                </BlockStack>
              </DetailRow>

              <DetailRow label="Created at" value={formatDate(task.createdAt)} />
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Logs
                </Text>

                <TextField
                  label="Product name"
                  labelHidden
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Product name"
                  clearButton
                  onClearButtonClick={() => setSearchQuery("")}
                  autoComplete="off"
                />

                <IndexTable
                  resourceName={{ singular: "log", plural: "logs" }}
                  itemCount={paginatedLogs.length}
                  selectable={false}
                  headings={[
                    { title: "Product" },
                    { title: "Changes" },
                    { title: "Status" },
                    { title: "" },
                  ]}
                >
                  {paginatedLogs.map((log, index) => (
                    <IndexTable.Row
                      id={log.rowId}
                      key={log.rowId}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="regular">
                          <AdminLink url={log.adminUrl}>
                            {log.productTitle}
                          </AdminLink>
                        </Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <BlockStack gap="100">
                          <Text as="span">{log.changeSummary.primary}</Text>
                          {log.changeSummary.moreCount > 0 ? (
                            <Text as="span" tone="subdued">
                              and {log.changeSummary.moreCount} more
                            </Text>
                          ) : null}
                        </BlockStack>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Badge tone={statusTone}>{logStatusLabel}</Badge>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Button
                          size="slim"
                          disabled={!log.productId}
                          url={
                            log.productId
                              ? `/app/tasks/${task.id}?productId=${log.productId}`
                              : undefined
                          }
                        >
                          Details
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>

                {!filteredLogs.length ? (
                  <Box padding="400">
                    <Text as="p" tone="subdued">
                      {searchQuery
                        ? "No logs found for your search."
                        : "No product changes were recorded for this task."}
                    </Text>
                  </Box>
                ) : null}

                {filteredLogs.length > LOGS_PER_PAGE ? (
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={safeCurrentPage > 1}
                      onPrevious={() =>
                        setCurrentPage((page) => Math.max(1, page - 1))
                      }
                      hasNext={safeCurrentPage < totalPages}
                      onNext={() =>
                        setCurrentPage((page) =>
                          Math.min(totalPages, page + 1),
                        )
                      }
                      label={`Page ${safeCurrentPage} of ${totalPages}`}
                    />
                  </InlineStack>
                ) : null}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
