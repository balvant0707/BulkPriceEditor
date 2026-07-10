import { json, redirect } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  ActionList,
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Pagination,
  Popover,
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

const LOGS_PER_PAGE = 8;
const ACTIVE_STATUSES = ["activating", "ending", "checking_changes"];
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
    if (normalizeStatus(sale.status) !== "active") {
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
        status: sale.status,
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

  if (intent === "disable_sale") {
    if (normalizeStatus(sale.status) === "active") {
      await db.sale.updateMany({
        where: { id: sale.id, shop: session.shop },
        data: {
          status: "ending",
          executionSummary: {
            ...(sale.executionSummary || {}),
            status: "Ending",
            progress: 0,
          },
        },
      });

      const ended = await endSaleRecord(admin, sale);

      await db.sale.updateMany({
        where: { id: sale.id, shop: session.shop },
        data: {
          status: ended.ok ? "completed" : "failed",
          executionSummary: {
            ...(sale.executionSummary || {}),
            progress: 100,
            ended,
          },
          completedAt: new Date(),
        },
      });

      return json({ ok: ended.ok });
    }

    await db.sale.updateMany({
      where: { id: sale.id, shop: session.shop },
      data: {
        status: "completed",
        executionSummary: {
          ...(sale.executionSummary || {}),
          ok: true,
          status: "Disabled",
          progress: 100,
          disabledAt: new Date().toISOString(),
        },
        completedAt: new Date(),
      },
    });

    return json({ ok: true });
  }

  if (intent === "duplicate_sale") {
    const copy = await db.sale.create({
      data: {
        shop: session.shop,
        title: `${sale.title} copy`,
        status: "draft",
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

function normalizeStatus(status) {
  return String(status || "").toLowerCase().trim();
}

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

function getNumberValue(...values) {
  const found = values.map((value) => Number(value)).find(Number.isFinite);
  return Number.isFinite(found) ? found : null;
}

function getSaleProgress(sale) {
  const progress = getNumberValue(
    sale.executionSummary?.progress,
    sale.executionSummary?.percent,
    sale.executionSummary?.percentage,
  );

  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  if (["active", "completed"].includes(normalizeStatus(sale.status))) return 100;
  return 0;
}

function getSaleStatusDisplay(sale) {
  const status = normalizeStatus(sale.status);
  const progress = getSaleProgress(sale);

  if (ACTIVE_STATUSES.includes(status)) {
    return { label: humanize(status), tone: "attention", showProgress: true };
  }

  if (status === "active") return { label: "Active", tone: "success", showProgress: false };
  if (status === "scheduled") return { label: "Scheduled", tone: "attention", showProgress: true };
  if (status === "failed") return { label: "Failed", tone: "critical", showProgress: false };
  if (["complete", "completed", "finished", "ended"].includes(status)) {
    return { label: "Completed", tone: "success", showProgress: false };
  }

  return {
    label: status ? humanize(status) : "Pending",
    tone: "attention",
    showProgress: progress < 100,
  };
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
  const normalized = normalizeStatus(scope);

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
  const scope = normalizeStatus(sale.discountedScope);
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const progress = getSaleProgress(sale);
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
  const isActiveSale = normalizeStatus(sale.status) === "active";
  const isCompletedSale = ["complete", "completed", "finished", "ended"].includes(
    normalizeStatus(sale.status),
  );
  const saleMarkets = getSaleMarkets(sale);
  const tagsToAdd = getTagRuleTitles(sale, "add");
  const tagsToRemove = getTagRuleTitles(sale, "remove");

  useEffect(() => {
    if (!statusDisplay.showProgress) return undefined;

    const interval = setInterval(() => revalidator.revalidate(), 1000);
    return () => clearInterval(interval);
  }, [revalidator, statusDisplay.showProgress]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const submitAction = (intent) => {
    const formData = new FormData();
    formData.set("intent", intent);
    actionFetcher.submit(formData, { method: "post" });
    setActionsOpen(false);
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
    onAction: () => navigate(`${EDIT_SALE_URL}?id=${sale.id}`),
  }}
  secondaryActions={[
    {
      content: "Check changes",
      disabled: isSubmitting || !isActiveSale,
      onAction: () => submitAction("check_changes"),
    },
    {
      content: "Disable",
      destructive: true,
      disabled: isSubmitting || isCompletedSale,
      onAction: () => submitAction("disable_sale"),
    },
    {
      content: "Duplicate",
      disabled: isSubmitting,
      onAction: () => submitAction("duplicate_sale"),
    },
  ]}
>
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <DetailRow label="Changes">
                  <BlockStack gap="300">
                    {getSaleChanges(sale, shopCurrency).map((change) => (
                      <Text as="p" key={change}>
                        {change}
                      </Text>
                    ))}

                    {sale.autoReapplyChanges ? (
                          <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                marginTop: "8px",
                              }}
                            >
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
                    
                              <Text as="p" tone="subdued">
                                Automatically re-apply price changes (every hour, up to 10,000 changes)
                              </Text>
                            </div>
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
                      <Text as="p" tone="subdued">
                        Tracking changes in condition automatically (every hour)
                      </Text>
                    ) : null}
                  </BlockStack>
                </DetailRow>

                <DetailRow
                  label="Exclude"
                  value={formatScope(sale.excludeScope, sale.excludeResources || {})}
                />

                <DetailRow label="Exclude discounted" value={formatDiscountedScope(sale)} />

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
                  </BlockStack>
                </DetailRow>

                {saleMarkets.length ? (
                  <DetailRow label="Markets">
                    <FieldBadges items={saleMarkets.map(getMarketLabel).filter(Boolean)} />
                  </DetailRow>
                ) : null}

                <DetailRow label="Created at" value={formatDate(sale.createdAt)} />
                <DetailRow label="Started at" value={formatDate(sale.startedAt)} />

                {sale.completedAt ? (
                  <DetailRow label="Completed at" value={formatDate(sale.completedAt)} />
                ) : null}

                {tagsToAdd.length ? (
                  <DetailRow label="Add tags">
                    <FieldBadges items={tagsToAdd} />
                  </DetailRow>
                ) : null}

                {tagsToRemove.length ? (
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
                          {log.productId ? (
                            <Button
                              variant="plain"
                              url={getAdminProductUrl(shop, log.productId)}
                              external
                            >
                              {log.productTitle || "Product"}
                            </Button>
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
    </>
  );
}
