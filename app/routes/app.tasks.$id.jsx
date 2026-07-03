import { json } from "@remix-run/node";
import {
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const LOGS_PER_PAGE = 10;

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const taskId = Number(params.id);

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

  return json({
    task,
    shop: session.shop,
    shopifyStoreHandle: getShopifyStoreHandle(session.shop),
  });
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
      label: "Applying",
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

  if (normalizeStatus(task.status) === "processing") return 10;
  if (normalizeStatus(task.status) === "complete") return 100;

  return 0;
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

function StatusBadge({ display }) {
  return (
    <span
      style={{
        alignItems: "center",
        background: display.background,
        borderRadius: 8,
        display: "inline-flex",
        fontWeight: 700,
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
          <Text as="p" fontWeight="semibold">
            {value}
          </Text>
        )}
      </InlineStack>
    </Box>
  );
}

export default function TaskDetailsPage() {
  const { task, shopifyStoreHandle } = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const logs = useMemo(
    () => createProductGroups(task, shopifyStoreHandle),
    [task, shopifyStoreHandle],
  );

  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(logs.length / LOGS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * LOGS_PER_PAGE;
  const paginatedLogs = logs.slice(pageStart, pageStart + LOGS_PER_PAGE);

  const status = task.status || "Pending";
  const statusDisplay = getStatusDisplay(status);
  const statusTone = statusDisplay.tone;
  const serverProgress = getTaskProgress(task);
  const [visibleProgress, setVisibleProgress] = useState(serverProgress);
  const normalizedStatus = normalizeStatus(status);
  const shouldPoll = ["pending", "processing"].includes(normalizedStatus);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setVisibleProgress((currentProgress) => {
      if (normalizedStatus === "processing") {
        return Math.max(currentProgress, serverProgress, 10);
      }

      return serverProgress;
    });
  }, [normalizedStatus, serverProgress]);

  useEffect(() => {
    if (normalizedStatus !== "processing") return undefined;

    const timer = setInterval(() => {
      setVisibleProgress((currentProgress) =>
        currentProgress >= 99 ? currentProgress : currentProgress + 1,
      );
    }, 800);

    return () => clearInterval(timer);
  }, [normalizedStatus]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const timer = setInterval(() => {
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(timer);
  }, [revalidator, shouldPoll]);

  return (
    <Page
      title="Task details"
      backAction={{ content: "Tasks", onAction: () => navigate("/app/tasks") }}
      secondaryActions={[
        {
          content: "Rollback",
          url: `/app/tasks/${task.id}/rollback`,
          disabled: !["complete", "completed"].includes(normalizedStatus),
        },
      ]}
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
                    <Text as="p" tone="subdued" fontWeight="semibold">
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

                  {logs.length ? (
                    <Text as="p" tone="subdued">
                      Showing {pageStart + 1}-
                      {Math.min(pageStart + LOGS_PER_PAGE, logs.length)} of{" "}
                      {logs.length}
                    </Text>
                  ) : null}
                </InlineStack>

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
                        <BlockStack gap="050">
                          <Text as="span" fontWeight="semibold">
                            {log.adminUrl ? (
                              <Link url={log.adminUrl} external>
                                {log.productTitle}
                              </Link>
                            ) : (
                              log.productTitle
                            )}
                          </Text>

                          {log.productId ? (
                            <Text as="span" tone="subdued">
                              Product ID: {log.productId}
                            </Text>
                          ) : null}
                        </BlockStack>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Text as="span">{log.variantCount}</Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Text as="span">{log.changes.join(", ")}</Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Badge tone={statusTone}>{log.status}</Badge>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Button
                          size="slim"
                          disabled={!log.productId}
                          url={
                            log.productId
                              ? `/app/tasks/${task.id}/products/${log.productId}`
                              : undefined
                          }
                        >
                          Product Details
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>

                {!logs.length ? (
                  <Box padding="400">
                    <Text as="p" tone="subdued">
                      No product changes were recorded for this task.
                    </Text>
                  </Box>
                ) : null}

                {logs.length > LOGS_PER_PAGE ? (
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