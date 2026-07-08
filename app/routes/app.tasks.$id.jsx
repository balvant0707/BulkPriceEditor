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
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const LOGS_PER_PAGE = 4;
const TASK_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 500;
const ROLLBACK_PROGRESS_SPEED_PER_SECOND = 50;
const ROLLBACK_PROGRESS_CAP = 98;
const PENDING_PROGRESS_SPEED_PER_SECOND = 50;
const ACTIVE_TASK_STATUSES = [
  "Pending",
  "Applying",
  "Cancelling",
];

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
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
  const shopCurrency =
    (
      await db.shop.findUnique({
        where: { shop: session.shop },
        select: { currency: true },
      })
    )?.currency || "";
  const selectedCollections = isCollectionScope(task)
    ? await getSelectedCollectionDetails(admin, task, shopifyStoreHandle)
    : [];

  return json({
    task,
    shop: session.shop,
    shopifyStoreHandle,
    selectedProductId,
    selectedCollections,
    productDetails: selectedProductId
      ? getProductDetails(
          task,
          selectedProductId,
          shopifyStoreHandle,
          shopCurrency,
        )
      : null,
    shopCurrency,
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

function normalizeStatusKey(status) {
  return normalizeStatus(status).replace(/[\s-]+/g, "_");
}

function isFailedOrCanceledStatus(status) {
  const normalized = normalizeStatus(status);

  return (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    (normalized.includes("cancel") &&
      !normalized.includes("canceling") &&
      !normalized.includes("cancelling"))
  );
}

function getCanceledStatusLabel(status) {
  return normalizeStatus(status).includes("cancel")
    ? "Cancelled"
    : humanize(status);
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
  const changes = [
    formatChangePayload(task.priceChange, "price"),
    formatChangePayload(task.compareAtPriceChange, "compare at price"),
    formatChangePayload(task.costPerItemChange, "cost per item"),
  ].filter(Boolean);

  return changes.length ? changes.join(", ") : "Change";
}

function formatChangePayload(change, label) {
  const action = String(change?.action || "").toLowerCase();
  if (!action) return "";

  if (action === "reset_compare_at_price") return "Reset compare at price";
  if (action === "reset_cost_per_item") return "Reset cost per item";
  if (action === "set_to_price") return "Set compare at price to price";
  if (action === "set_to_compare_at_price") {
    return "Set price to compare at price";
  }
  if (action === "set_margin") {
    return change.percent
      ? `Set ${label} margin to ${change.percent}%`
      : `Set ${label} margin`;
  }

  const actionLabel =
    action === "increase"
      ? "Increase"
      : action === "decrease"
        ? "Decrease"
        : action === "set_new_value"
          ? "Set"
          : humanize(action);

  const value =
    change.type === "by_amount"
      ? change.amount
      : change.percent
        ? `${change.percent}%`
        : change.amount;

  if (action === "set_new_value") {
    return value ? `Set ${label} to ${value}` : `Set ${label}`;
  }

  const valueText = value ? ` by ${value}` : "";

  return `${actionLabel} ${label}${valueText}`;
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

  if (isFailedOrCanceledStatus(status)) return false;

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
  return isFailedOrCanceledStatus(getTaskStatusValue(task));
}

function isTaskProcessing(task) {
  const status = normalizeStatus(getTaskStatusValue(task));

  if (isTaskCompleted(task) || isTaskFailed(task)) return false;

  return (
    status === "applying"
  );
}

function isTaskPending(task) {
  const status = normalizeStatus(getTaskStatusValue(task));

  return !isTaskCompleted(task) && !isTaskFailed(task) && status === "pending";
}

function getBaseTaskDisplay(task) {
  const status = getTaskStatusValue(task);
  const normalized = normalizeStatus(status);

  if (isTaskFailed(task)) {
    return {
      label: getCanceledStatusLabel(status),
      tone: "critical",
      background: "#FEE4E2",
      showProgress: false,
      style: {
        width: "fit-content",
      },
    };
  }

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

  if (isTaskPending(task) || !normalized) {
    return {
      label: "Pending",
      tone: "attention",
      background: "#FEDF89",
      showPendingSpinner: true,
      showProgress: true,
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
      showPendingSpinner: true,
      showProgress: true,
      style: {
        width: "fit-content",
      },
    };
  }

  if (!normalized) {
    return {
      label: "Pending",
      tone: "attention",
      background: "#FEDF89",
      showPendingSpinner: true,
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

function getRollbackSummary(task) {
  return (
    task.rollback ||
    task.rollbackSummary ||
    task.executionSummary?.rollback ||
    task.executionSummary?.rollbackSummary ||
    {}
  );
}

function getRollbackState(task) {
  const taskStatus = normalizeStatus(getTaskStatusValue(task));
  const rollbackStatus = normalizeStatus(getRollbackStatusValue(task));
  const taskStatusKey = normalizeStatusKey(getTaskStatusValue(task));
  const rollbackStatusKey = normalizeStatusKey(getRollbackStatusValue(task));
  const rollbackProgress = getRollbackProgress(task);
  const rollbackSummary = getRollbackSummary(task);

  const hasStartedAt = Boolean(getRollbackStartedValue(task));
  const hasCompletedAt = Boolean(getRollbackCompletedValue(task));
  const hasSuccessfulRollback =
    rollbackSummary?.ok === true &&
    (rollbackProgress >= 100 ||
      Boolean(rollbackSummary.completedAt) ||
      Boolean(rollbackSummary.rolledBackAt));

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
    "rolling_back",
    "rollback_processing",
    "rollback_started",
    "rollback_running",
    "rollback_in_progress",
    "canceling",
    "cancelling",
  ];

  const failedStatuses = ["failed", "error", "cancelled", "canceled"];

  const isCompleted =
    hasCompletedAt ||
    hasSuccessfulRollback ||
    completedStatuses.includes(rollbackStatusKey) ||
    ((taskStatusKey === "cancelled" || taskStatusKey === "canceled") &&
      rollbackSummary?.ok === true) ||
    taskStatusKey === "rolled_back" ||
    taskStatusKey === "rollback_complete" ||
    taskStatusKey === "rollback_completed" ||
    taskStatus.includes("rolled back") ||
    taskStatus.includes("rollback complete");

  const isFailed =
    !isCompleted &&
    (failedStatuses.some((status) => rollbackStatus.includes(status)) ||
      failedStatuses.some((status) => rollbackStatusKey.includes(status)) ||
      taskStatusKey.includes("rollback_failed") ||
      taskStatus.includes("rollback failed"));

  const hasRealRollbackStart =
    hasStartedAt ||
    rollbackProgress > 0 ||
    processingStatuses.includes(rollbackStatusKey) ||
    processingStatuses.includes(taskStatusKey) ||
    taskStatus.includes("rolling back") ||
    taskStatus.includes("canceling") ||
    taskStatus.includes("cancelling");

  const isProcessing =
    !isCompleted &&
    !isFailed &&
    hasRealRollbackStart &&
    (processingStatuses.includes(rollbackStatusKey) ||
      rollbackStatusKey === "pending" ||
      processingStatuses.includes(taskStatusKey) ||
      taskStatus.includes("rolling back") ||
      taskStatus.includes("canceling") ||
      taskStatus.includes("cancelling"));

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

function getDetailsStatusDisplay(task, rollbackState = null) {
  if (rollbackState?.isCompleted) {
    return {
      label: "Cancelled",
      tone: "success",
      background: "#D1FADF",
      showProgress: false,
    };
  }

  if (rollbackState?.isProcessing) {
    return {
      label: "Cancelling",
      tone: "attention",
      background: "#FEDF89",
      showProgress: true,
    };
  }

  if (rollbackState?.isFailed) {
    return {
      label: getCanceledStatusLabel(
        getRollbackStatusValue(task) || getTaskStatusValue(task) || "Cancel",
      ),
      tone: "critical",
      background: "rgb(185, 184, 184)",
      showProgress: false,
    };
  }

  if (isTaskCompleted(task)) {
    return {
      label: "Completed",
      tone: "success",
      background: "#D1FADF",
      showProgress: false,
    };
  }

  return getBaseTaskDisplay(task);
}

function getLogStatusLabel(task, statusDisplay, rollbackState = null) {
  if (rollbackState?.isProcessing || rollbackState?.isFailed || rollbackState?.isCompleted) {
    return statusDisplay.label;
  }

  if (isTaskProcessing(task)) return statusDisplay.label;
  if (isTaskCompleted(task)) return "Completed";
  if (isTaskFailed(task)) return getCanceledStatusLabel(getTaskStatusValue(task));

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

function getCollectionAdminUrl(shopifyStoreHandle, collectionId) {
  if (!shopifyStoreHandle || !collectionId) return "";

  return `https://admin.shopify.com/store/${shopifyStoreHandle}/collections/${collectionId}`;
}

function isCollectionScope(task) {
  const values = [
    task?.applyScope,
    task?.scope,
    task?.targetScope,
    task?.selectionScope,
    task?.applyTo?.scope,
    task?.selection?.scope,
    task?.target?.scope,
    task?.executionSummary?.applyScope,
    task?.executionSummary?.scope,
    task?.executionSummary?.targetScope,
    task?.executionSummary?.selectionScope,
    task?.executionSummary?.applyTo?.scope,
    task?.executionSummary?.selection?.scope,
    task?.executionSummary?.target?.scope,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return values.includes("collection");
}

function isPlaceholderCollectionTitle(title, collectionId = "") {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  const normalizedId = String(collectionId || "").trim().toLowerCase();

  if (!normalizedTitle) return true;
  if (normalizedId && normalizedTitle === `collection ${normalizedId}`) return true;

  return /^collection\s+\d+$/i.test(normalizedTitle);
}

function parsePossibleArray(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      return parsePossibleArray(parsed);
    } catch {
      return trimmed
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  if (typeof value === "object") {
    if (Array.isArray(value.edges)) {
      return value.edges.map((edge) => edge?.node || edge).filter(Boolean);
    }

    if (Array.isArray(value.nodes)) return value.nodes;
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.collections)) return value.collections;
    if (Array.isArray(value.selectedCollections)) return value.selectedCollections;
    if (Array.isArray(value.selectedCollectionIds)) return value.selectedCollectionIds;
    if (Array.isArray(value.collectionIds)) return value.collectionIds;
    if (Array.isArray(value.selectedCollectionGids)) return value.selectedCollectionGids;
    if (Array.isArray(value.collectionGids)) return value.collectionGids;
    if (Array.isArray(value.resources)) return value.resources;
    if (Array.isArray(value.selectedResources)) return value.selectedResources;
    if (Array.isArray(value.targets)) return value.targets;
    if (Array.isArray(value.data)) return value.data;

    return [value];
  }

  return [value];
}

function readJsonField(value) {
  if (!value || typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getArrayValue(value) {
  const parsed = readJsonField(value);

  if (Array.isArray(parsed)) return parsed;
  if (parsed === undefined || parsed === null || parsed === "") return [];

  return [parsed];
}

function getConfigArray(configuration, name) {
  const value = configuration?.[name];
  return getArrayValue(value);
}

function buildCollectionRecordsFromIds(ids, titles = [], handles = [], counts = [], imageUrls = []) {
  return getArrayValue(ids)
    .map((id, index) => ({
      id,
      title: getArrayValue(titles)[index] || "",
      handle: getArrayValue(handles)[index] || "",
      productsCount: getArrayValue(counts)[index] || "",
      imageUrl: getArrayValue(imageUrls)[index] || "",
    }))
    .filter((record) => record.id || record.title || record.handle);
}

function getCollectionRecordId(record) {
  if (!record) return "";

  if (typeof record === "string" || typeof record === "number") {
    return getShopifyNumericId(record);
  }

  return getShopifyNumericId(
    record?.collectionId ??
      record?.collection_id ??
      record?.legacyResourceId ??
      record?.legacy_resource_id ??
      record?.legacyCollectionId ??
      record?.collectionLegacyResourceId ??
      record?.admin_graphql_api_id ??
      record?.collectionGid ??
      record?.gid ??
      record?.resourceId ??
      record?.resource_id ??
      record?.targetId ??
      record?.target_id ??
      record?.value ??
      record?.id,
  );
}

function getCollectionRecordGid(record) {
  const rawValue =
    typeof record === "object" && record
      ? record.collectionGid ||
        record.gid ||
        record.admin_graphql_api_id ||
        record.resourceId ||
        record.targetId ||
        record.value ||
        record.id
      : record;

  const stringValue = String(rawValue || "");
  if (stringValue.includes("gid://shopify/Collection/")) return stringValue;

  const collectionId = getCollectionRecordId(record);
  return collectionId ? `gid://shopify/Collection/${collectionId}` : "";
}

function getCollectionRecordHandle(record) {
  if (!record || typeof record !== "object") return "";

  return (
    record?.handle ||
    record?.collectionHandle ||
    record?.collection_handle ||
    record?.resourceHandle ||
    record?.targetHandle ||
    ""
  );
}

function getCollectionRecordTitle(record, collectionId = "") {
  if (!record) return "";

  if (typeof record === "string") {
    const trimmed = record.trim();
    const numericId = getShopifyNumericId(trimmed);

    if (
      trimmed.includes("gid://shopify/Collection/") ||
      trimmed === numericId
    ) {
      return "";
    }

    return trimmed;
  }

  return (
    record?.title ||
    record?.name ||
    record?.collectionTitle ||
    record?.collection_title ||
    record?.displayName ||
    record?.label ||
    record?.text ||
    record?.handle ||
    record?.collectionHandle ||
    ""
  );
}

function normalizeCollectionRecord(record, index = 0) {
  const parsedRecord = readJsonField(record);
  const collectionId = getCollectionRecordId(parsedRecord);
  const gid = getCollectionRecordGid(parsedRecord);
  const title = getCollectionRecordTitle(parsedRecord, collectionId);
  const handle = getCollectionRecordHandle(parsedRecord);

  return {
    key: gid || collectionId || handle || title || `collection-${index}`,
    id: collectionId,
    gid,
    title,
    handle,
    raw: parsedRecord,
  };
}

function collectCollectionRecordsFromObject(value, depth = 0) {
  if (!value || depth > 4) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCollectionRecordsFromObject(item, depth + 1));
  }

  if (typeof value === "string") {
    const parsed = readJsonField(value);
    if (parsed !== value) return collectCollectionRecordsFromObject(parsed, depth + 1);
    return value.includes("gid://shopify/Collection/") ? [value] : [];
  }

  if (typeof value !== "object") return [];

  const directId = getCollectionRecordId(value);
  const directGid = getCollectionRecordGid(value);
  const directType = String(value.type || value.resourceType || value.targetType || "").toLowerCase();
  const looksLikeCollection =
    directGid.includes("gid://shopify/Collection/") ||
    directType.includes("collection") ||
    Boolean(value.collectionId || value.collectionGid || value.collectionTitle || value.collectionHandle);

  const found = looksLikeCollection && (directId || directGid || value.title || value.collectionTitle)
    ? [value]
    : [];

  Object.entries(value).forEach(([key, child]) => {
    const normalizedKey = key.toLowerCase();

    if (
      normalizedKey.includes("originalvariant") ||
      normalizedKey.includes("inventoryitem") ||
      normalizedKey.includes("log")
    ) {
      return;
    }

    if (normalizedKey.includes("collection") || normalizedKey.includes("resource") || normalizedKey.includes("target")) {
      found.push(...parsePossibleArray(child));
      return;
    }

    if (typeof child === "object" && child) {
      found.push(...collectCollectionRecordsFromObject(child, depth + 1));
    }
  });

  return found;
}

function getSelectedCollectionRecords(task) {
  if (!isCollectionScope(task)) return [];

  const configuration = task.configuration || {};
  const applyResources = task.applyResources || {};
  const summary = task.executionSummary || {};
  const summaryApplyResources = summary.applyResources || summary.input?.applyResources || {};
  const summaryConfiguration = summary.configuration || summary.input?.configuration || {};

  const records = [
    ...getArrayValue(applyResources.collections),
    ...getArrayValue(applyResources.selectedCollections),
    ...buildCollectionRecordsFromIds(
      applyResources.collectionIds,
      applyResources.collectionTitles,
      applyResources.collectionHandles,
      applyResources.collectionProductsCounts,
      applyResources.collectionImageUrls,
    ),
    ...getArrayValue(summaryApplyResources.collections),
    ...getArrayValue(summaryApplyResources.selectedCollections),
    ...buildCollectionRecordsFromIds(
      summaryApplyResources.collectionIds,
      summaryApplyResources.collectionTitles,
      summaryApplyResources.collectionHandles,
      summaryApplyResources.collectionProductsCounts,
      summaryApplyResources.collectionImageUrls,
    ),
    ...buildCollectionRecordsFromIds(
      getConfigArray(configuration, "apply_collection_ids[]"),
      getConfigArray(configuration, "apply_collection_titles[]"),
      getConfigArray(configuration, "apply_collection_handles[]"),
      getConfigArray(configuration, "apply_collection_products_counts[]"),
      getConfigArray(configuration, "apply_collection_image_urls[]"),
    ),
    ...buildCollectionRecordsFromIds(
      getConfigArray(summaryConfiguration, "apply_collection_ids[]"),
      getConfigArray(summaryConfiguration, "apply_collection_titles[]"),
      getConfigArray(summaryConfiguration, "apply_collection_handles[]"),
      getConfigArray(summaryConfiguration, "apply_collection_products_counts[]"),
      getConfigArray(summaryConfiguration, "apply_collection_image_urls[]"),
    ),
  ].filter(Boolean);

  const unique = new Map();

  records.forEach((record, index) => {
    const collection = normalizeCollectionRecord(record, index);
    const rawRecord = collection.raw;
    const rawType =
      typeof rawRecord === "object" && rawRecord
        ? String(rawRecord.type || rawRecord.resourceType || rawRecord.targetType || "").toLowerCase()
        : "";

    if (
      rawType &&
      !rawType.includes("collection") &&
      (rawType.includes("product") ||
        rawType.includes("variant") ||
        rawType.includes("inventory"))
    ) {
      return;
    }

    const hasRealTitle = !isPlaceholderCollectionTitle(
      collection.title,
      collection.id,
    );

    if (!collection.id && !collection.gid && !collection.handle && !hasRealTitle) {
      return;
    }

    const key = collection.gid || collection.id || collection.handle || collection.title;

    if (!unique.has(key)) {
      unique.set(key, collection.raw);
    }
  });

  return Array.from(unique.values());
}

function escapeShopifySearchValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .trim();
}

async function fetchCollectionByText(admin, collection) {
  if (!admin?.graphql) return null;

  const title = collection.title && !collection.title.startsWith("Collection ")
    ? collection.title
    : "";
  const handle = collection.handle || "";

  if (!title && !handle) return null;

  const queryText = handle
    ? `handle:${escapeShopifySearchValue(handle)}`
    : `title:'${escapeShopifySearchValue(title)}'`;

  try {
    const response = await admin.graphql(
      `#graphql
      query CollectionByText($query: String!) {
        collections(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            legacyResourceId
          }
        }
      }`,
      { variables: { query: queryText } },
    );
    const payload = await response.json();
    return payload?.data?.collections?.nodes?.[0] || null;
  } catch (error) {
    console.error("Failed to search selected collection:", error);
    return null;
  }
}

async function getSelectedCollectionDetails(admin, task, shopifyStoreHandle) {
  const records = getSelectedCollectionRecords(task);

  if (!records.length) return [];

  const collectionMap = new Map();

  records.forEach((record, index) => {
    const collection = normalizeCollectionRecord(record, index);
    const hasRealTitle = !isPlaceholderCollectionTitle(collection.title, collection.id);

    collectionMap.set(collection.key, {
      ...collection,
      title: hasRealTitle ? collection.title : "",
      verified: false,
      adminUrl: getCollectionAdminUrl(shopifyStoreHandle, collection.id),
    });
  });

  const idsToFetch = Array.from(
    new Set(
      Array.from(collectionMap.values())
        .filter((collection) => collection.gid)
        .map((collection) => collection.gid),
    ),
  );

  if (idsToFetch.length && admin?.graphql) {
    try {
      const response = await admin.graphql(
        `#graphql
        query SelectedCollections($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Collection {
              id
              title
              handle
              legacyResourceId
            }
          }
        }`,
        { variables: { ids: idsToFetch } },
      );
      const payload = await response.json();
      const nodes = payload?.data?.nodes || [];
      const foundGids = new Set();

      nodes.forEach((node) => {
        if (!node?.id) return;

        foundGids.add(node.id);

        const collectionId = getShopifyNumericId(node.legacyResourceId || node.id);
        const existingKey = node.id || collectionId;
        const gidKey = `gid://shopify/Collection/${collectionId}`;
        const current =
          collectionMap.get(existingKey) ||
          collectionMap.get(collectionId) ||
          collectionMap.get(gidKey) ||
          {};

        collectionMap.set(existingKey, {
          ...current,
          key: existingKey,
          id: collectionId,
          gid: node.id,
          title: node.title || node.handle || `Collection ${collectionId}`,
          handle: node.handle || current.handle || "",
          verified: true,
          adminUrl: getCollectionAdminUrl(shopifyStoreHandle, collectionId),
        });

        if (collectionId && collectionMap.has(collectionId)) {
          collectionMap.delete(collectionId);
        }
        if (gidKey !== existingKey && collectionMap.has(gidKey)) {
          collectionMap.delete(gidKey);
        }
      });

      Array.from(collectionMap.entries()).forEach(([key, collection]) => {
        if (collection.gid && !foundGids.has(collection.gid) && !collection.title && !collection.handle) {
          collectionMap.delete(key);
        }
      });
    } catch (error) {
      console.error("Failed to load selected collection details:", error);
    }
  }

  for (const [key, collection] of Array.from(collectionMap.entries())) {
    if (collection.verified || collection.id || !admin?.graphql) continue;
    if (!collection.title && !collection.handle) {
      collectionMap.delete(key);
      continue;
    }

    const node = await fetchCollectionByText(admin, collection);
    if (!node?.id) {
      if (!collection.title || isPlaceholderCollectionTitle(collection.title, collection.id)) {
        collectionMap.delete(key);
      }
      continue;
    }

    const collectionId = getShopifyNumericId(node.legacyResourceId || node.id);
    collectionMap.set(key, {
      ...collection,
      id: collectionId,
      gid: node.id,
      title: node.title || collection.title || node.handle || `Collection ${collectionId}`,
      handle: node.handle || collection.handle || "",
      verified: true,
      adminUrl: getCollectionAdminUrl(shopifyStoreHandle, collectionId),
    });
  }

  return Array.from(collectionMap.values()).filter((collection) => {
    const hasRealTitle = !isPlaceholderCollectionTitle(collection.title, collection.id);

    if (collection.verified) return true;
    if (collection.handle) return true;

    return hasRealTitle;
  });
}

function AdminLink({ url, children }) {
  if (!url) return children;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function buildVariantChanges(record, currencyCode) {
  return buildVariantChangeItems(record, currencyCode).map((change) => change.text);
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

function shouldShowPriceNoChange(task) {
  return ["set_to_compare_at_price", "set_margin"].includes(
    task.priceChange?.action,
  );
}

function summarizeProductChanges(changeItems, noChangeLabel = "") {
  if (!changeItems.length) {
    return {
      primary: noChangeLabel || "No changes recorded",
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

  const recordsByVariantId = new Map();

  originalVariants.forEach((v) => {
    const variantId = getVariantId(v);
    if (variantId) {
      recordsByVariantId.set(variantId, { ...recordsByVariantId.get(variantId), ...v });
    }
  });

  originalInventoryItems.forEach((i) => {
    const variantId = getVariantId(i);
    if (variantId) {
      recordsByVariantId.set(variantId, { ...recordsByVariantId.get(variantId), ...i });
    }
  });

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
      cost: record?.cost,
      newSetCost: record?.nextCost,
      changes: buildVariantChanges(record, shopCurrency),
      adminUrl: getVariantAdminUrl(shopifyStoreHandle, productId, variantId),
      type,
    });
  }

  Array.from(recordsByVariantId.values()).forEach((record, index) => {
    addRecord(record, index, "variant");
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
      changes: changes.length
        ? changes
        : [shouldShowPriceNoChange(task) ? "Price: no change" : "No changes recorded"],
      otherChanges: group.variants.flatMap((variant) => variant.changes),
      changeSummary: summarizeProductChanges(
        group.changeItems,
        shouldShowPriceNoChange(task) ? "Price: no change" : "",
      ),
      price: summarizeVariantValue(group.variants, "price"),
      compareAtPrice: summarizeVariantValue(group.variants, "compareAtPrice"),
      newSetPrice: summarizeVariantValue(group.variants, "newSetPrice"),
      cost: summarizeVariantValue(group.variants, "cost"),
      newSetCost: summarizeVariantValue(group.variants, "newSetCost"),
      variantCount: group.variants.length,
    };
  });
}

function parseLogList(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch {
      return value.trim() ? [{ message: value }] : [];
    }
  }

  return typeof value === "object" ? [value] : [];
}

function getTaskLogRecords(task) {
  return [
    task.logs,
    task.log,
    task.taskLogs,
    task.executionLogs,
    task.rollbackLogs,
    task.rollbackLog,
    task.rollback?.logs,
    task.rollback?.log,
    task.rollbackSummary?.logs,
    task.rollbackSummary?.log,
    task.executionSummary?.logs,
    task.executionSummary?.log,
    task.executionSummary?.taskLogs,
    task.executionSummary?.executionLogs,
    task.executionSummary?.rollbackLogs,
    task.executionSummary?.rollbackLog,
    task.executionSummary?.rollback?.logs,
    task.executionSummary?.rollback?.log,
    task.executionSummary?.rollbackSummary?.logs,
    task.executionSummary?.rollbackSummary?.log,
  ].flatMap(parseLogList);
}

function getLogMessage(record) {
  const changes = Array.isArray(record?.changes)
    ? record.changes.filter(Boolean).join(", ")
    : record?.changes;

  return (
    record?.message ||
    record?.log ||
    record?.description ||
    record?.summary ||
    record?.action ||
    changes ||
    "Log recorded"
  );
}

function createFallbackLogGroups(task, shopifyStoreHandle) {
  return getTaskLogRecords(task).map((record, index) => {
    const productId = getProductId(record);

    return {
      rowId: `raw-log-${record?.id || productId || index}`,
      productId,
      productTitle: getProductTitle(record),
      adminUrl: getProductAdminUrl(shopifyStoreHandle, productId),
      changes: [getLogMessage(record)],
      otherChanges: [],
      changeSummary: {
        primary: getLogMessage(record),
        moreCount: 0,
      },
      price: formatPriceValue(record?.price),
      compareAtPrice: formatPriceValue(record?.compareAtPrice),
      newSetPrice: formatPriceValue(record?.nextPrice || record?.newSetPrice),
      variantCount: Number(record?.variantCount || 0),
      variants: [],
      status: getCanceledStatusLabel(record?.status || getTaskStatusValue(task)),
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
      log.cost,
      log.newSetCost,
      log.changeSummary?.primary,
      ...(log.variants || []).flatMap((variant) => [
        variant.title,
        variant.sku,
        variant.variantId,
        variant.price,
        variant.compareAtPrice,
        variant.newSetPrice,
        variant.cost,
        variant.newSetCost,
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

function getProductDetails(task, productId, shopifyStoreHandle, shopCurrency = "") {
  const originalVariants = task.executionSummary?.originalVariants || [];
  const originalInventoryItems =
    task.executionSummary?.originalInventoryItems || [];

  const recordsByVariantId = new Map();

  originalVariants
    .filter((v) => getProductId(v) === productId)
    .forEach((v) => {
      const variantId = getVariantId(v);
      if (variantId) {
        recordsByVariantId.set(variantId, { ...recordsByVariantId.get(variantId), ...v });
      }
    });

  originalInventoryItems
    .filter((i) => getProductId(i) === productId)
    .forEach((i) => {
      const variantId = getVariantId(i);
      if (variantId) {
        recordsByVariantId.set(variantId, { ...recordsByVariantId.get(variantId), ...i });
      }
    });

  const allRecords = Array.from(recordsByVariantId.values()).map((record, index) => {
    const variantId = getVariantId(record);
    return {
      rowId: `variant-${variantId || index}`,
      variantId,
      title: getVariantTitle(record),
      sku: getVariantSku(record),
      price: record.price,
      compareAtPrice: record.compareAtPrice,
      newSetPrice: record.nextPrice,
      cost: record.cost,
      newSetCost: record.nextCost,
      changes: buildVariantChanges(record, shopCurrency),
      adminUrl: getVariantAdminUrl(shopifyStoreHandle, productId, variantId),
    };
  });

  if (!allRecords.length) return null;

  const firstOriginalRecord = allRecords[0];

  return {
    productId,
    productTitle: getProductTitle(firstOriginalRecord),
    adminUrl: getProductAdminUrl(shopifyStoreHandle, productId),
    variants: allRecords.map((record) => ({
      ...record,
      changes: record.changes.length
        ? record.changes
        : [shouldShowPriceNoChange(task) ? "Price: no change" : "No changes recorded"],
    })),
    appliedAt: getAppliedAt(task),
  };
}

function StatusBadge({ display }) {
  const showPendingSpinner = Boolean(display.showPendingSpinner);

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
      {showPendingSpinner ? (
        <Spinner accessibilityLabel="Task status loading" size="small" />
      ) : display.tone === "attention" ? (
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

function ApplyToDetails({ task, selectedCollections }) {
  const applyScopeLabel = humanize(task.applyScope);

  if (!selectedCollections?.length) {
    return (
      <Text as="p" fontWeight="regular">
        {applyScopeLabel}
      </Text>
    );
  }

  return (
    <BlockStack gap="200">
      <Text as="p" fontWeight="semibold">
        {applyScopeLabel}
      </Text>

      <BlockStack gap="150">
        {selectedCollections.map((collection, index) => (
          <InlineStack
            key={collection.key || collection.id || index}
            gap="300"
            blockAlign="center"
            wrap={false}
          >
            <span
              aria-hidden="true"
              style={{
                alignItems: "center",
                border: "1px solid #D9D9D9",
                borderRadius: 8,
                color: "#6D7175",
                display: "inline-flex",
                flex: "0 0 48px",
                height: 48,
                justifyContent: "center",
                width: 48,
              }}
            >
              ◇
            </span>

            <Text as="p" fontWeight="regular">
              <AdminLink url={collection.adminUrl}>
                {collection.title || collection.handle || "Collection"}
              </AdminLink>
            </Text>
          </InlineStack>
        ))}
      </BlockStack>
    </BlockStack>
  );
}

function ProductDetailsView({ task, productDetails, navigate }) {
  const rollbackState = getRollbackState(task);
  const statusDisplay = getDetailsStatusDisplay(task, rollbackState);
  const statusTone = getStatusToneFromDisplay(statusDisplay);
  const rowStatusLabel = getLogStatusLabel(task, statusDisplay, rollbackState);

  return (
    <Page
      title="Price change details"
      titleMetadata={<Badge tone={statusTone}>{statusDisplay.label}</Badge>}
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

              <DetailRow label="Status">
                <StatusBadge display={statusDisplay} />
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
                  { title: "Changes" },
                  { title: "Status" },
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
                      <Text as="span">
                        {variant.changes.length
                          ? variant.changes.join(", ")
                          : "-"}
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Badge tone={statusTone}>{rowStatusLabel}</Badge>
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
  const {
    task,
    shopifyStoreHandle,
    selectedProductId,
    productDetails,
    selectedCollections,
    shopCurrency,
  } = useLoaderData();

  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const deleteFetcher = useFetcher();
  const submit = useSubmit();

  const rollbackState = getRollbackState(task);
  const taskCompleted = isTaskCompleted(task);
  const taskProcessing = isTaskProcessing(task);
  const taskPending = isTaskPending(task);

  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [clientRollbackStarted, setClientRollbackStarted] = useState(false);

  const rollbackCompleted = rollbackState.isCompleted;
  const rollbackFailed = rollbackState.isFailed;

  const rollbackProcessing =
    !rollbackCompleted &&
    !rollbackFailed &&
    (rollbackState.isProcessing || clientRollbackStarted);

  const baseStatusDisplay = getBaseTaskDisplay(task);

  const statusDisplay = rollbackProcessing
    ? {
        label: "Cancelling",
        tone: "attention",
        background: "#FEDF89",
        showProgress: true,
      }
    : rollbackCompleted
      ? {
          label: "Cancelled",
          tone: "success",
          background: "#D1FADF",
          showProgress: false,
        }
      : rollbackFailed
        ? {
            label: getCanceledStatusLabel(getRollbackStatusValue(task) || getTaskStatusValue(task) || "Cancel"),
            tone: "critical",
            background: "#FEE4E2",
            showProgress: false,
          }
        : baseStatusDisplay;

  const statusTone = getStatusToneFromDisplay(statusDisplay);
  const logStatusLabel = getLogStatusLabel(task, statusDisplay, rollbackState);

  const rawServerProgress = rollbackProcessing
    ? Math.max(rollbackState.progress || 0, 0)
    : getTaskProgress(task);
  const serverProgress = rawServerProgress;
  const [visibleProgress, setVisibleProgress] = useState(serverProgress);

  const logs = useMemo(() => {
    const productLogs = createProductGroups(task, shopifyStoreHandle, shopCurrency);
    const fallbackLogs = createFallbackLogGroups(task, shopifyStoreHandle);

    return productLogs.length ? productLogs : fallbackLogs;
  }, [task, shopifyStoreHandle, shopCurrency]);

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
    !selectedProductId && (taskPending || taskProcessing || rollbackProcessing);

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
    setVisibleProgress(0);
    const formData = new FormData();
    formData.set("redirectTo", `/app/tasks/${task.id}`);
    submit(formData, {
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

  const pageSecondaryActions = rollbackProcessing || rollbackFailed
    ? []
    : rollbackCompleted
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
            content: "Rollback",
            disabled: !taskCompleted,
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
    setVisibleProgress(serverProgress);
  }, [serverProgress]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const timer = setInterval(() => {
      revalidator.revalidate();
    }, POLL_INTERVAL_MS);

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

              <DetailRow label="Apply to">
                <ApplyToDetails
                  task={task}
                  selectedCollections={selectedCollections}
                />
              </DetailRow>

              <DetailRow label="Exclude" value={humanize(task.excludeScope)} />

              <DetailRow label="Status">
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <StatusBadge display={statusDisplay} />

                  {statusDisplay.showProgress ? (
                    <>
                      <Box maxWidth="320px">
                        <ProgressBar
                          progress={visibleProgress}
                          size="small"
                          tone="primary"
                        />
                      </Box>
                      <Text as="span" tone="subdued">
                        Progress: {visibleProgress}%
                      </Text>
                    </>
                  ) : null}
                </InlineStack>
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
