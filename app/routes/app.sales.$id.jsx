import { json, redirect } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
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
import {
  endSaleRecord,
  executeSaleConditionChangeRecord,
} from "../lib/sales.server";
import {
  canRollbackSale,
  getSaleProgressValue,
  getSaleStatusDisplay,
  normalizeSaleStatus,
  SALE_STATUS,
} from "../lib/sale-status";

const LOGS_PER_PAGE = 8;
const EDIT_SALE_URL = "/app/sales/new";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const saleId = Number(params.id);

  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new Response("Sale not found", { status: 404 });
  }

  const sale = await db.sale.findFirst({
    where: {
      id: saleId,
      shop: session.shop,
    },
  });

  if (!sale) {
    throw new Response("Sale not found", { status: 404 });
  }

  const shopCurrency =
    (
      await db.shop.findUnique({
        where: { shop: session.shop },
        select: { currency: true },
      })
    )?.currency || "";

  return json({ sale, shop: session.shop, shopCurrency });
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const saleId = Number(params.id);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (!Number.isInteger(saleId) || saleId <= 0) {
    throw new Response("Sale not found", { status: 404 });
  }

  const sale = await db.sale.findFirst({
    where: {
      id: saleId,
      shop: session.shop,
    },
  });

  if (!sale) {
    throw new Response("Sale not found", { status: 404 });
  }

  if (intent === "check_changes") {
    if (normalizeSaleStatus(sale.status) !== SALE_STATUS.COMPLETED) {
      return json(
        { ok: false, message: "Only active sales can check changes." },
        { status: 400 },
      );
    }

    await db.sale.updateMany({
      where: { id: sale.id, shop: session.shop },
      data: {
        status: "checking_changes",
        executionSummary: {
          ...(sale.executionSummary || {}),
          status: "Checking changes",
          progress: 0,
        },
      },
    });

    const tracked = await executeSaleConditionChangeRecord(admin, sale);
    const checkedAt = new Date().toISOString();

    await db.sale.updateMany({
      where: { id: sale.id, shop: session.shop },
      data: {
        status: SALE_STATUS.COMPLETED,
        executionSummary: {
          ...(sale.executionSummary || {}),
          originalVariants: tracked.originalVariants,
          originalMarketPrices:
            tracked.originalMarketPrices ||
            sale.executionSummary?.originalMarketPrices ||
            [],
          progress: 100,
          trackConditionLastRunAt: checkedAt,
          trackConditionLastResult: {
            ok: tracked.ok,
            analyzedVariants: tracked.analyzedVariants,
            addedVariants: tracked.addedVariants,
            removedVariants: tracked.removedVariants,
            taggedProducts: tracked.taggedProducts,
            errors: tracked.errors,
          },
          logs: [
            ...((sale.executionSummary || {}).logs || []),
            ...(tracked.logs || []),
          ],
        },
      },
    });

    return json({ ok: tracked.ok });
  }

  if (intent === "rollback_sale") {
    if (canRollbackSale(sale)) {
      await db.sale.updateMany({
        where: { id: sale.id, shop: session.shop },
        data: {
          status: SALE_STATUS.CANCELING,
          executionSummary: {
            ...(sale.executionSummary || {}),
            status: "Canceling",
            progress: 5,
            rollbackStartedAt: new Date().toISOString(),
          },
        },
      });

      const ended = await endSaleRecord(admin, sale);

      await db.sale.updateMany({
        where: { id: sale.id, shop: session.shop },
        data: {
          status: ended.ok ? SALE_STATUS.CANCELED : SALE_STATUS.FAILED,
          executionSummary: {
            ...(sale.executionSummary || {}),
            status: ended.ok ? "Canceled" : "Failed",
            progress: 100,
            rollback: ended,
            ended,
            errors: ended.errors || [],
            rollbackCompletedAt: new Date().toISOString(),
          },
          completedAt: new Date(),
        },
      });

      return json({ ok: ended.ok });
    }

    return json(
      { ok: false, message: "Only completed sales with rollback data can be rolled back." },
      { status: 400 },
    );
  }

  if (intent === "duplicate_sale") {
    const copy = await db.sale.create({
      data: {
        shop: session.shop,
        title: `${sale.title} copy`,
        status: SALE_STATUS.PENDING,
        changeType: sale.changeType,
        applyToFixedPrices: sale.applyToFixedPrices,
        markets: sale.markets,
        priceChange: sale.priceChange,
        compareAtPriceChange: sale.compareAtPriceChange,
        applyScope: sale.applyScope,
        excludeScope: sale.excludeScope,
        discountedScope: sale.discountedScope,
        applyResources: sale.applyResources,
        excludeResources: sale.excludeResources,
        tagRules: sale.tagRules,
        schedule: sale.schedule,
        configuration: sale.configuration,
        addTagsEnabled: sale.addTagsEnabled,
        removeTagsEnabled: sale.removeTagsEnabled,
        trackConditionChanges: sale.trackConditionChanges,
        autoReapplyChanges: sale.autoReapplyChanges,
      },
    });

    return redirect(`${EDIT_SALE_URL}?id=${copy.id}`);
  }

  return json({ ok: false, message: "Invalid action." }, { status: 400 });
};

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "-";
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

function formatChange(change, label, currencyCode) {
  const action = String(change?.action || "").toLowerCase();
  if (!action) return "";
  if (action === "reset_compare_at_price") return "Reset compare at price";
  if (action === "set_to_price") return "Set compare at price to price";
  if (action === "set_new_value") {
    return change.amount
      ? `Set ${label} to ${change.amount}${currencyCode ? ` ${currencyCode}` : ""}`
      : `Set ${label}`;
  }

  const actionLabel =
    action === "increase" ? "Increase" : action === "decrease" ? "Decrease" : humanize(action);
  const value =
    change.type === "by_amount"
      ? `${change.amount || ""}${currencyCode ? ` ${currencyCode}` : ""}`
      : change.percent
        ? `${change.percent}%`
        : change.amount;

  return `${actionLabel} ${label}${value ? ` by ${value}` : ""}`;
}

function getSaleChanges(sale, currencyCode) {
  return [
    formatChange(sale.priceChange, "price", currencyCode),
    formatChange(sale.compareAtPriceChange, "compare at price", currencyCode),
  ].filter(Boolean);
}

function getResourceTitles(items = []) {
  return items.map((item) => item.title).filter(Boolean);
}

function getMarketLabel(market) {
  if (!market) return "";

  const currencyCode =
    market.currencyCode ||
    market.currencySettings?.baseCurrency?.currencyCode ||
    "";
  return `${market.name || market.label || "Market"}${currencyCode ? ` (${currencyCode})` : ""}`;
}

function getSaleMarkets(sale) {
  return Array.isArray(sale.markets) ? sale.markets : [];
}

function getTagRuleTitles(sale, key) {
  return getResourceTitles(sale.tagRules?.[key] || []);
}

function formatScope(scope, resources = {}) {
  const normalized = String(scope || "").toLowerCase().trim();

  if (normalized === "whole_store") return "Whole store";
  if (normalized === "nothing") return "Nothing";
  if (normalized === "selected_collections") {
    return getResourceTitles(resources.collections).join(", ") || "Selected collections";
  }
  if (normalized === "selected_products") {
    return getResourceTitles(resources.products).join(", ") || "Selected products";
  }
  if (normalized === "selected_products_with_variants") {
    return getResourceTitles(resources.variants).join(", ") || "Selected product variants";
  }
  if (normalized === "selected_tags") {
    return getResourceTitles(resources.tags).join(", ") || "Selected tags";
  }

  return humanize(scope);
}

function formatDiscountedScope(sale) {
  const scope = String(sale.discountedScope || "").toLowerCase().trim();
  if (!scope || scope === "nothing") return "Nothing";
  if (scope === "products_on_sale") return "Products on sale";
  if (scope === "product_types_on_sale" || scope === "variants_on_sale") {
    return "Product variants on sale";
  }
  return humanize(scope);
}

function formatSchedule(sale) {
  const lines = [];
  if (sale.startAt) lines.push(`From ${formatDate(sale.startAt)}`);
  if (sale.endAt) lines.push(`Until ${formatDate(sale.endAt)}`);
  return lines.length ? lines : ["Not scheduled"];
}

function FieldBadges({ items }) {
  if (!items.length) {
    return (
      <Text as="span" tone="subdued">
        -
      </Text>
    );
  }

  return (
    <InlineStack gap="150" wrap>
      {items.map((item) => (
        <Badge key={item}>{item}</Badge>
      ))}
    </InlineStack>
  );
}

function ReapplyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M1.5 7.25a.75.75 0 0 0 1.5 0 3 3 0 0 1 3-3h6.566l-1.123 1.248a.75.75 0 1 0 1.115 1.004l2.25-2.5a.75.75 0 0 0-.028-1.032l-2.25-2.25a.749.749 0 1 0-1.06 1.06l.97.97h-6.44a4.5 4.5 0 0 0-4.5 4.5" />
      <path d="M14.5 8.75a.75.75 0 0 0-1.5 0 3 3 0 0 1-3 3h-6.566l1.123-1.248a.75.75 0 1 0-1.115-1.004l-2.25 2.5a.75.75 0 0 0 .028 1.032l2.25 2.25a.749.749 0 1 0 1.06-1.06l-.97-.97h6.44a4.5 4.5 0 0 0 4.5-4.5" />
    </svg>
  );
}

function TrackingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M7.377.5c-.926 0-1.676.75-1.676 1.676v.688c0 .056-.043.17-.198.251q-.23.12-.448.262c-.147.097-.268.076-.318.048l-.6-.346a1.676 1.676 0 0 0-2.29.613l-.622 1.08a1.675 1.675 0 0 0 .613 2.289l.648.374c.048.028.124.12.119.29l-.003.177q0 .144.008.288c.009.175-.07.27-.119.299l-.653.377a1.676 1.676 0 0 0-.613 2.29l.623 1.08a1.68 1.68 0 0 0 2.29.613l.7-.405c.048-.028.166-.048.312.043q.173.107.353.202c.155.08.198.195.198.251v.811c0 .926.75 1.676 1.676 1.676h1.246c.926 0 1.676-.75 1.676-1.676v-.81a.75.75 0 1 0-1.5 0v.81a.176.176 0 0 1-.176.176h-1.246a.176.176 0 0 1-.176-.176v-.81c0-.73-.462-1.3-1.003-1.582a4 4 0 0 1-.255-.146c-.514-.32-1.23-.428-1.855-.068l-.7.405a.177.177 0 0 1-.241-.065l-.623-1.08a.175.175 0 0 1 .064-.24l.653-.377c.637-.368.899-1.062.867-1.677a4 4 0 0 1-.006-.21q0-.064.002-.127c.02-.604-.245-1.278-.868-1.638l-.648-.374a.175.175 0 0 1-.064-.24l.623-1.08a.175.175 0 0 1 .24-.064l.6.346c.638.368 1.37.247 1.888-.09a4 4 0 0 1 .323-.19c.54-.282 1.003-.852 1.003-1.58v-.688c0-.097.078-.176.176-.176h1.246c.097 0 .176.079.176.176v.688c0 .728.462 1.298 1.003 1.58q.166.087.323.19c.517.337 1.25.458 1.888.09l.6-.346a.175.175 0 0 1 .24.064l.623 1.08a.175.175 0 0 1-.064.24l-.648.374c-.623.36-.888 1.034-.868 1.638l.002.128c0 .082-.002.247-.006.309a.75.75 0 0 0 1.498.078 9 9 0 0 0 .005-.563c-.005-.171.07-.263.12-.291l.647-.374a1.677 1.677 0 0 0 .613-2.29l-.623-1.079a1.676 1.676 0 0 0-2.29-.613l-.6.346c-.049.028-.17.048-.318-.048a5 5 0 0 0-.448-.262c-.155-.081-.197-.195-.197-.251v-.688c0-.926-.75-1.676-1.676-1.676z"></path><path fill-rule="evenodd" d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6m0-1.5a1.5 1.5 0 1 0-.001-3.001 1.5 1.5 0 0 0 .001 3.001"></path><path d="M12.035 9.839a.501.501 0 0 0-.785.411v4.5a.5.5 0 0 0 .785.411l3.25-2.25a.5.5 0 0 0 0-.822z"></path></svg>
  );
}

function getSaleLogs(sale) {
  return sale.executionSummary?.logs || [];
}

function getShopifyNumericId(id) {
  const match = String(id || "").match(/(\d+)$/);
  return match ? match[1] : "";
}

function getAdminProductUrl(shop, productId) {
  const numericId = getShopifyNumericId(productId);
  if (!numericId) return "";
  return `https://${shop}/admin/products/${numericId}`;
}

function getAdminVariantUrl(shop, productId, variantId) {
  const productNumericId = getShopifyNumericId(productId);
  const variantNumericId = getShopifyNumericId(variantId);
  if (!productNumericId || !variantNumericId) return "";
  return `https://${shop}/admin/products/${productNumericId}/variants/${variantNumericId}`;
}

function saleUsesVariantLogLinks(sale) {
  return [sale.applyScope, sale.excludeScope]
    .map((scope) => String(scope || "").toLowerCase())
    .includes("selected_products_with_variants");
}

function getEstimatedProcessingProgress(sale, baseProgress) {
  const normalizedStatus = normalizeSaleStatus(sale.status);
  if (
    normalizedStatus !== SALE_STATUS.APPLYING &&
    normalizedStatus !== SALE_STATUS.CANCELING
  ) {
    return baseProgress;
  }

  const startedAt =
    sale.executionSummary?.processingStartedAt ||
    sale.executionSummary?.rollbackStartedAt ||
    sale.startedAt ||
    sale.updatedAt ||
    sale.createdAt;
  const startedMs = new Date(startedAt || "").getTime();
  if (!Number.isFinite(startedMs)) return Math.max(baseProgress, 1);

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  return Math.min(99, Math.max(baseProgress, elapsedSeconds + 1));
}

function DetailRow({ label, value, children }) {
  return (
    <Box paddingBlock="400" borderBlockEndWidth="025" borderColor="border">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(160px, 260px) minmax(0, 1fr)",
          gap: 24,
          alignItems: "start",
        }}
      >
        <Text as="dt" fontWeight="semibold">
          {label}
        </Text>
        <Box>
          {children || (
            <Text as="dd" fontWeight="semibold">
              {value || "-"}
            </Text>
          )}
        </Box>
      </div>
    </Box>
  );
}

export default function SaleDetailsPage() {
  const { sale, shop, shopCurrency } = useLoaderData();
  const navigate = useNavigate();
  const actionFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const rawProgress = getSaleProgressValue(sale);
  const statusDisplay = getSaleStatusDisplay(sale);
  const logs = useMemo(() => getSaleLogs(sale), [sale]);
  const filteredLogs = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return logs;

    return logs.filter((log) =>
      [log.productTitle, log.variantTitle, ...(log.changes || [])]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [logs, searchQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedLogs = filteredLogs.slice(
    (safeCurrentPage - 1) * LOGS_PER_PAGE,
    safeCurrentPage * LOGS_PER_PAGE,
  );
  const isSubmitting = actionFetcher.state !== "idle";
  const normalizedStatus = normalizeSaleStatus(sale.status);
  const progress = getEstimatedProcessingProgress(sale, rawProgress);
  const isCompletedSale = normalizedStatus === SALE_STATUS.COMPLETED;
  const isBusySale = [
    SALE_STATUS.PENDING,
    SALE_STATUS.APPLYING,
    SALE_STATUS.CANCELING,
    SALE_STATUS.CHECKING_CHANGES,
  ].includes(normalizedStatus);
  const processFetcher = useFetcher();
  const saleMarkets = getSaleMarkets(sale);
  const useVariantLogLinks = saleUsesVariantLogLinks(sale);
  const tagsToAdd = getTagRuleTitles(sale, "add");
  const tagsToRemove = getTagRuleTitles(sale, "remove");
  const showExcludeDiscounted =
    String(sale.discountedScope || "").toLowerCase().trim() !== "nothing";

  useEffect(() => {
    if (![SALE_STATUS.PENDING, SALE_STATUS.APPLYING, SALE_STATUS.CANCELING, SALE_STATUS.CHECKING_CHANGES].includes(normalizedStatus)) {
      return undefined;
    }

    const interval = setInterval(() => revalidator.revalidate(), 1000);
    return () => clearInterval(interval);
  }, [revalidator, normalizedStatus]);

  useEffect(() => {
    if (
      normalizedStatus !== SALE_STATUS.PENDING ||
      processFetcher.state !== "idle"
    ) {
      return;
    }

    processFetcher.submit(null, {
      method: "post",
      action: `/app/sales/process/${sale.id}`,
    });
  }, [normalizedStatus, processFetcher, sale.id]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const submitAction = (intent) => {
    const formData = new FormData();
    formData.set("intent", intent);
    actionFetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <TitleBar title="Pryxo Bulk Price Editor" />

      <Page
        title={sale.title}
        backAction={{
          content: "Sales",
          url: "/app/sales",
        }}
        primaryAction={{
          content: "Edit sale",
          disabled: isBusySale,
          onAction: () => navigate(`${EDIT_SALE_URL}?id=${sale.id}`),
        }}
        actionGroups={[
          {
            title: "Actions",
            actions: [
              {
                content: "Check changes",
                disabled: isSubmitting || !isCompletedSale,
                onAction: () => submitAction("check_changes"),
              },
              {
                content: "Disable",
                destructive: true,
                disabled: isSubmitting || !canRollbackSale(sale),
                onAction: () => setRollbackConfirmOpen(true),
              },
              {
                content: "Duplicate",
                disabled: isSubmitting,
                onAction: () => submitAction("duplicate_sale"),
              },
            ],
          },
        ]}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {actionFetcher.data?.message && actionFetcher.data?.ok === false ? (
                <Banner tone="critical">{actionFetcher.data.message}</Banner>
              ) : null}

              {processFetcher.data?.error ? (
                <Banner tone="critical">{processFetcher.data.error}</Banner>
              ) : null}

              <Card>
                <DetailRow label="Changes">
                  <BlockStack gap="300">
                    {getSaleChanges(sale, shopCurrency).map((change) => (
                      <Text as="p" key={change}>
                        {change}
                      </Text>
                    ))}

                    {sale.autoReapplyChanges ? (
                      <InlineStack gap="150" blockAlign="center" wrap={false}>
                        <ReapplyIcon />
                        <Text as="p" tone="subdued">
                          Automatically re-apply price changes (every hour, up to 10,000 changes)
                        </Text>
                      </InlineStack>
                    ) : null}

                  </BlockStack>
                </DetailRow>

                <DetailRow label="Change type">
                  <BlockStack gap="100">
                    <Text as="p" fontWeight="semibold">
                      {humanize(sale.changeType || "products")}
                    </Text>
                    {sale.changeType === "markets" && saleMarkets.length ? (
                      <BlockStack gap="050">
                        {saleMarkets.map((market) => (
                          <Text as="p" key={market.id || market.name}>
                            - {market.name || market.label}
                          </Text>
                        ))}
                      </BlockStack>
                    ) : null}
                    {sale.changeType === "markets" && sale.applyToFixedPrices ? (
                      <Text as="p" tone="subdued">
                        Applies only to fixed market prices.
                      </Text>
                    ) : null}
                  </BlockStack>
                </DetailRow>

                <DetailRow label="Apply to">
                  <BlockStack gap="300">
                    <Text as="p" fontWeight="semibold">
                      {formatScope(sale.applyScope, sale.applyResources || {})}
                    </Text>
                    {sale.trackConditionChanges ? (
                      <InlineStack gap="150" blockAlign="center" wrap={false}>
                        <TrackingIcon />
                        <Text as="p" tone="subdued">
                          Tracking changes in condition automatically (every hour)
                        </Text>
                      </InlineStack>
                    ) : null}
                  </BlockStack>
                </DetailRow>

                <DetailRow
                  label="Exclude"
                  value={formatScope(sale.excludeScope, sale.excludeResources || {})}
                />

                {showExcludeDiscounted ? (
                  <DetailRow label="Exclude discounted" value={formatDiscountedScope(sale)} />
                ) : null}

                <DetailRow label="Schedule">
                  <BlockStack gap="100">
                    {formatSchedule(sale).map((line) => (
                      <Text as="p" key={line}>
                        {line}
                      </Text>
                    ))}
                  </BlockStack>
                </DetailRow>

                <DetailRow label="Status">
                  <BlockStack gap="150">
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>
                      {statusDisplay.showProgress ? (
                        <Text as="span" tone="subdued">
                          Progress: {progress}%
                        </Text>
                      ) : null}
                    </InlineStack>
                    {statusDisplay.showProgress ? (
                      <ProgressBar progress={progress} size="small" />
                    ) : null}
                  </BlockStack>
                </DetailRow>

                {saleMarkets.length ? (
                  <DetailRow label="Markets">
                    <FieldBadges items={saleMarkets.map(getMarketLabel).filter(Boolean)} />
                  </DetailRow>
                ) : null}

                <DetailRow label="Created at" value={formatDate(sale.createdAt)} />
                <DetailRow label="Started at" value={formatDate(sale.startedAt)} />

                {sale.addTagsEnabled && tagsToAdd.length ? (
                  <DetailRow label="Add tags">
                    <FieldBadges items={tagsToAdd} />
                  </DetailRow>
                ) : null}

                {sale.removeTagsEnabled && tagsToRemove.length ? (
                  <DetailRow label="Remove tags">
                    <FieldBadges items={tagsToRemove} />
                  </DetailRow>
                ) : null}
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
                    ]}
                  >
                    {paginatedLogs.map((log, index) => (
                      <IndexTable.Row
                        id={`${log.variantId || log.id || index}`}
                        key={`${log.variantId || log.id || index}`}
                        position={index}
                      >
                        <IndexTable.Cell>
                          {useVariantLogLinks && log.variantId ? (
                            <a
                              href={getAdminVariantUrl(shop, log.productId, log.variantId)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {log.variantTitle || log.productTitle || "Product variant"}
                            </a>
                          ) : log.productId ? (
                            <a
                              href={getAdminProductUrl(shop, log.productId)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {log.productTitle || "Product"}
                            </a>
                          ) : (
                            <Text as="span">{log.productTitle || "Product"}</Text>
                          )}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            {(log.changes || []).map((change) => (
                              <Text as="span" key={change}>
                                {change}
                              </Text>
                            ))}
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone="success">{log.status || "Applied"}</Badge>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>

                  {!filteredLogs.length ? (
                    <Box padding="400">
                      <Text as="p" tone="subdued">
                        {searchQuery
                          ? "No logs found for your search."
                          : "No product changes were recorded for this sale."}
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
                          setCurrentPage((page) => Math.min(totalPages, page + 1))
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

      <Modal
        open={rollbackConfirmOpen}
        onClose={() => setRollbackConfirmOpen(false)}
        title="Rollback sale?"
        primaryAction={{
          content: "Disable",
          destructive: true,
          loading: isSubmitting,
          onAction: () => {
            setRollbackConfirmOpen(false);
            submitAction("rollback_sale");
          },
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setRollbackConfirmOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This restores the original product, market, and tag values saved when
            the sale was applied.
          </Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
