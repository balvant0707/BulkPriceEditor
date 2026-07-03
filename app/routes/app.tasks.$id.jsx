import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
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
  Link,
  Page,
  Pagination,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const LOGS_PER_PAGE = 10;

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const taskId = Number(params.id);
  const url = new URL(request.url);
  const selectedProductId = getShopifyNumericId(url.searchParams.get("productId"));

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Response("Task not found", { status: 404 });
  }

  const task = await db.task.findFirst({
    where: {
      id: taskId,
      shop: session.shop,
    },
  });

  if (!task) {
    throw new Response("Task not found", { status: 404 });
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

function normalizeStatus(status) {
  return String(status || "Pending").toLowerCase();
}

function getStatusDisplay(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "complete" || normalized === "completed") {
    return {
      label: "Completed",
      tone: "success",
      background: "#D1FADF",
    };
  }

  if (normalized === "processing" || normalized === "applying") {
    return {
      label: "Processing",
      tone: "attention",
      background: "#FEDF89",
      showProgress: true,
    };
  }

  if (normalized === "pending") {
    return {
      label: "Pending",
      tone: "attention",
      background: "#FEDF89",
    };
  }

  if (
    normalized.includes("failed") ||
    normalized.includes("cancel") ||
    normalized.includes("error")
  ) {
    return {
      label: humanize(status),
      tone: "critical",
      background: "#FEE4E2",
    };
  }

  return {
    label: humanize(status),
    tone: "info",
    background: "#E0F2FE",
  };
}

function getTaskProgress(task) {
  const progress = Number(task.executionSummary?.progress);

  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  if (normalizeStatus(task.status) === "processing") return 1;
  if (normalizeStatus(task.status) === "complete") return 100;

  return 0;
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

function getRollbackProgress(task) {
  const possibleValues = [
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
  ];

  const progress = possibleValues
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));

  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  return 0;
}

function getRollbackState(task) {
  const taskStatus = normalizeStatus(task.status);
  const rollbackStatus = normalizeStatus(getRollbackStatusValue(task));
  const combinedStatus = `${taskStatus} ${rollbackStatus}`;

  const isCompleted =
    rollbackStatus === "complete" ||
    rollbackStatus === "completed" ||
    rollbackStatus === "rolled_back" ||
    rollbackStatus === "rolledback" ||
    rollbackStatus === "rollback_complete" ||
    rollbackStatus === "rollback_completed" ||
    taskStatus === "rolled_back" ||
    taskStatus === "rolledback" ||
    taskStatus === "rollback_complete" ||
    taskStatus === "rollback_completed" ||
    (combinedStatus.includes("rollback") &&
      (combinedStatus.includes("complete") ||
        combinedStatus.includes("completed") ||
        combinedStatus.includes("rolled")));

  const isProcessing =
    !isCompleted &&
    (rollbackStatus === "processing" ||
      rollbackStatus === "applying" ||
      rollbackStatus === "pending" ||
      rollbackStatus === "started" ||
      taskStatus === "rollback_processing" ||
      taskStatus === "rollback_pending" ||
      taskStatus === "rollback_started" ||
      (combinedStatus.includes("rollback") &&
        (combinedStatus.includes("processing") ||
          combinedStatus.includes("pending") ||
          combinedStatus.includes("started") ||
          combinedStatus.includes("applying"))));

  return {
    isCompleted,
    isProcessing,
    progress: getRollbackProgress(task),
  };
}

function getStatusTone(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "complete" || normalized === "completed") return "success";

  if (
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("cancel")
  ) {
    return "critical";
  }

  if (normalized === "processing" || normalized === "applying") {
    return "attention";
  }

  return "info";
}

function getAppliedLabel(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "complete" || normalized === "completed") return "Applied";
  if (normalized === "processing" || normalized === "applying") return "Applying";

  return humanize(status || "Pending");
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

function buildVariantChanges(record) {
  const changes = [];

  if (record?.price !== record?.nextPrice) {
    changes.push(`Price: ${record?.price ?? "-"} -> ${record?.nextPrice ?? "-"}`);
  }

  if (record?.compareAtPrice !== record?.nextCompareAtPrice) {
    changes.push(
      `Compare at: ${record?.compareAtPrice ?? "-"} -> ${
        record?.nextCompareAtPrice ?? "-"
      }`,
    );
  }

  if (record?.cost !== record?.nextCost) {
    changes.push(`Cost: ${record?.cost ?? "-"} -> ${record?.nextCost ?? "-"}`);
  }

  return changes;
}

function createProductGroups(task, shopifyStoreHandle) {
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
        status: task.status || "Pending",
      });
    }

    const group = groups.get(groupKey);
    const changes = buildVariantChanges(record);

    if (record?.price !== record?.nextPrice) group.priceChangeCount += 1;

    if (record?.compareAtPrice !== record?.nextCompareAtPrice) {
      group.compareAtChangeCount += 1;
    }

    if (record?.cost !== record?.nextCost) group.costChangeCount += 1;

    group.variants.push({
      rowId: `${groupKey}-${variantId || index}`,
      variantId,
      title: variantTitle,
      sku,
      changes,
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
      ...(log.variants || []).flatMap((variant) => [
        variant.title,
        variant.sku,
        variant.variantId,
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
  const statusLabel = getAppliedLabel(task.status);
  const statusTone = getStatusTone(task.status);

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
                  {productDetails?.adminUrl ? (
                    <Link url={productDetails.adminUrl} external>
                      {productDetails.productTitle}
                    </Link>
                  ) : (
                    productDetails?.productTitle || "-"
                  )}
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
                  { title: "Changes" },
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
                        {variant.adminUrl ? (
                          <Link url={variant.adminUrl} external>
                            {variant.title}
                          </Link>
                        ) : (
                          variant.title
                        )}
                      </Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text as="span">{variant.sku || "-"}</Text>
                    </IndexTable.Cell>

                    <IndexTable.Cell>
                      <Text as="span">{variant.changes.join(", ")}</Text>
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
  const { task, shopifyStoreHandle, selectedProductId, productDetails } =
    useLoaderData();

  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const deleteFetcher = useFetcher();

  const rollbackState = getRollbackState(task);
  const normalizedStatus = normalizeStatus(task.status);
  const [clientRollbackStarted, setClientRollbackStarted] = useState(false);

  const rollbackCompleted = rollbackState.isCompleted;
  const rollbackProcessing =
    !rollbackCompleted && (rollbackState.isProcessing || clientRollbackStarted);

  const logs = useMemo(
    () => createProductGroups(task, shopifyStoreHandle),
    [task, shopifyStoreHandle],
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

  const status = task.status || "Pending";
  const defaultStatusDisplay = getStatusDisplay(status);
  const statusDisplay = rollbackProcessing
    ? {
        label: "Processing",
        tone: "attention",
        background: "#FEDF89",
        showProgress: true,
      }
    : defaultStatusDisplay;

  const statusTone = statusDisplay.tone;
  const serverProgress = rollbackProcessing
    ? Math.max(rollbackState.progress || 1, 1)
    : getTaskProgress(task);

  const [visibleProgress, setVisibleProgress] = useState(serverProgress);

  const shouldPoll =
    ["pending", "processing"].includes(normalizedStatus) || rollbackProcessing;

  const handleRollback = () => {
    setClientRollbackStarted(true);
    setVisibleProgress(1);
    navigate(`/app/tasks/${task.id}/rollback`);
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
          content:
            deleteFetcher.state === "idle" ? "Delete" : "Deleting...",
          destructive: true,
          disabled: deleteFetcher.state !== "idle",
          onAction: handleDelete,
        },
      ]
    : [
        {
          content: rollbackProcessing ? "Rollback processing..." : "Rollback",
          disabled:
            rollbackProcessing ||
            !["complete", "completed"].includes(normalizedStatus),
          onAction: handleRollback,
        },
      ];

  useEffect(() => {
    if (deleteFetcher.data?.deleted) {
      navigate("/app/tasks");
    }
  }, [deleteFetcher.data, navigate]);

  useEffect(() => {
    if (rollbackCompleted) {
      setClientRollbackStarted(false);
    }
  }, [rollbackCompleted]);

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

      if (normalizedStatus === "processing") {
        if (currentProgress >= 100 || currentProgress <= 0) {
          return Math.max(serverProgress, 1);
        }

        return Math.max(currentProgress, serverProgress, 1);
      }

      return serverProgress;
    });
  }, [normalizedStatus, rollbackProcessing, serverProgress]);

  useEffect(() => {
    if (!rollbackProcessing && normalizedStatus !== "processing") {
      return undefined;
    }

    const timer = setInterval(() => {
      setVisibleProgress((currentProgress) =>
        currentProgress >= 99 ? currentProgress : currentProgress + 1,
      );
    }, 800);

    return () => clearInterval(timer);
  }, [normalizedStatus, rollbackProcessing]);

  useEffect(() => {
    if (!shouldPoll || selectedProductId) return undefined;

    const timer = setInterval(() => {
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(timer);
  }, [revalidator, shouldPoll, selectedProductId]);

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
                    <Text as="p" tone="subdued">
                      Progress: {visibleProgress}%
                    </Text>
                  ) : null}
                </BlockStack>
              </DetailRow>

              <DetailRow label="Created at" value={formatDate(task.createdAt)} />
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Logs
                  </Text>

                  {filteredLogs.length ? (
                    <Text as="p" tone="subdued">
                      Showing {pageStart + 1}-
                      {Math.min(
                        pageStart + LOGS_PER_PAGE,
                        filteredLogs.length,
                      )}{" "}
                      of {filteredLogs.length}
                    </Text>
                  ) : null}
                </InlineStack>

                <TextField
                  label="Search logs"
                  labelHidden
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Search by product, variant, SKU, status, or changes"
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
                    { title: "Variants" },
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
                          {log.adminUrl ? (
                            <Link url={log.adminUrl} external>
                              {log.productTitle}
                            </Link>
                          ) : (
                            log.productTitle
                          )}
                        </Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Text as="span">{log.variantCount}</Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Text as="span">{log.changes.join(", ")}</Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Badge tone={statusTone}>{statusDisplay.label}</Badge>
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