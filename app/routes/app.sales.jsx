// app/routes/app.sales.jsx
import { json } from "@remix-run/node";
import {
  Outlet,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  FooterHelp,
  IndexTable,
  InlineStack,
  Layout,
  Link,
  Modal,
  Page,
  Pagination,
  ProgressBar,
  Spinner,
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { endSaleRecord } from "../lib/sales.server";
import {
  canDeleteSale,
  canRollbackSale,
  getSaleProgressValue,
  getSaleStatusDisplay,
  normalizeSaleStatus,
  SALE_STATUS,
} from "../lib/sale-status";

const CREATE_SALE_URL = "/app/sales/new";
const SALES_URL = "/app/sales";
const HELP_URL = "https://help.platmart.io/article/29-how-to-use-sales";
const PAGE_SIZE = 10;
const SALE_TABS = [
  { id: "all", content: "All" },
  { id: "active", content: "Active" },
  { id: "scheduled", content: "Scheduled" },
  { id: "completed", content: "Completed" },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const sales = await db.sale.findMany({
    where: { shop: session.shop },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 250,
  });

  return json({ sales });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const saleId = Number(formData.get("saleId"));

  if (!Number.isInteger(saleId) || saleId <= 0) {
    return json({ ok: false, message: "Sale not found." }, { status: 400 });
  }

  const sale = await db.sale.findFirst({
    where: {
      id: saleId,
      shop: session.shop,
    },
  });

  if (!sale) {
    return json({ ok: false, message: "Sale not found." }, { status: 404 });
  }

  if (intent === "delete_sale") {
    if (!canDeleteSale(sale)) {
      return json(
        { ok: false, message: "Only canceled or failed sales can be deleted." },
        { status: 400 },
      );
    }

    await db.sale.deleteMany({
      where: {
        id: sale.id,
        shop: session.shop,
      },
    });

    return json({ ok: true, deleted: true, message: "Sale deleted." });
  }

  if (intent === "cancel_scheduled") {
    if (normalizeSaleStatus(sale.status) !== SALE_STATUS.SCHEDULED) {
      return json(
        { ok: false, message: "Only scheduled sales can be canceled." },
        { status: 400 },
      );
    }

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: session.shop,
      },
      data: {
        status: SALE_STATUS.CANCELED,
        executionSummary: {
          ...(sale.executionSummary || {}),
          ok: true,
          status: "Canceled",
          progress: 100,
          canceledAt: new Date().toISOString(),
        },
        completedAt: new Date(),
      },
    });

    return json({ ok: true, canceled: true, message: "Scheduled sale canceled." });
  }

  if (intent === "rollback_sale") {
    if (!canRollbackSale(sale)) {
      return json(
        { ok: false, message: "Only completed sales with rollback data can be rolled back." },
        { status: 400 },
      );
    }

    await db.sale.updateMany({
      where: { id: sale.id, shop: session.shop, status: sale.status },
      data: {
        status: SALE_STATUS.CANCELING,
        executionSummary: {
          ...(sale.executionSummary || {}),
          status: "Canceling",
          progress: 0,
          rollbackStartedAt: new Date().toISOString(),
        },
      },
    });

    const ended = await endSaleRecord(admin, sale);

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: session.shop,
        status: SALE_STATUS.CANCELING,
      },
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

    return json({
      ok: ended.ok,
      rollback: true,
      message: ended.ok ? "Sale canceled." : "Sale rollback completed with errors.",
    });
  }

  return json({ ok: false, message: "Unknown action." }, { status: 400 });
};

function saleMatchesTab(sale, activeTab) {
  if (activeTab === "all") return true;

  const status = normalizeSaleStatus(sale.status);

  if (activeTab === "completed") {
    return [
      SALE_STATUS.COMPLETED,
      SALE_STATUS.CANCELING,
      SALE_STATUS.CANCELED,
      SALE_STATUS.FAILED,
    ].includes(status);
  }

  if (activeTab === "active") {
    return [SALE_STATUS.PENDING, SALE_STATUS.APPLYING].includes(status);
  }

  return status === activeTab;
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSaleChangeText(sale) {
  const price = formatChange(sale.priceChange, "price");
  const compareAt = formatChange(sale.compareAtPriceChange, "compare at price");
  const changes = [price, compareAt].filter(Boolean);
  if (sale.autoReapplyChanges) changes.push("Auto re-apply changes");
  return changes;
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

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.5 3.5a5 5 0 1 0 3.16 8.87l2.98 2.99a.75.75 0 1 0 1.06-1.06l-2.99-2.98A5 5 0 0 0 8.5 3.5Zm-3.5 5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function formatChange(change, label) {
  const action = String(change?.action || "").toLowerCase();
  if (!action) return "";
  if (action === "reset_compare_at_price") return "Reset compare at price";
  if (action === "set_to_price") return "Set compare at price to price";
  if (action === "set_new_value") {
    return change.amount ? `Set ${label} to ${change.amount}` : `Set ${label}`;
  }

  const actionLabel =
    action === "increase" ? "Increase" : action === "decrease" ? "Decrease" : humanize(action);
  const value =
    change.type === "by_amount"
      ? change.amount
      : change.percent
        ? `${change.percent}%`
        : change.amount;

  return `${actionLabel} ${label}${value ? ` by ${value}` : ""}`;
}

function getSaleChangesForSearch(sale) {
  return getSaleChangeText(sale).join(" ");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getResourceTitles(items = []) {
  return items.map((item) => item.title || item.name || item.label).filter(Boolean);
}

function formatApplyScope(sale) {
  const scope = String(sale.applyScope || "whole_store").toLowerCase();
  const resources = sale.applyResources || {};

  if (scope === "whole_store") return "Whole store";
  if (scope === "selected_products") {
    return getResourceTitles(resources.products).join(", ") || "Selected products";
  }
  if (scope === "selected_products_with_variants") {
    return getResourceTitles(resources.variants).join(", ") || "Selected product variants";
  }
  if (scope === "selected_collections") {
    return getResourceTitles(resources.collections).join(", ") || "Selected collections";
  }
  if (scope === "selected_tags") {
    return getResourceTitles(resources.tags).join(", ") || "Selected tags";
  }

  return humanize(scope);
}

function getMarketNames(sale) {
  return (Array.isArray(sale.markets) ? sale.markets : [])
    .map((market) => market.name || market.label)
    .filter(Boolean);
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
  return Math.min(99, Math.max(baseProgress, elapsedSeconds));
}

function saleMatchesSearch(sale, query) {
  const applyResources = sale.applyResources || {};
  const excludeResources = sale.excludeResources || {};
  const resourceText = [
    ...(applyResources.products || []),
    ...(applyResources.variants || []),
    ...(applyResources.collections || []),
    ...(applyResources.tags || []),
    ...(excludeResources.products || []),
    ...(excludeResources.variants || []),
    ...(excludeResources.collections || []),
    ...(excludeResources.tags || []),
    ...(Array.isArray(sale.markets) ? sale.markets : []),
  ]
    .map((item) => [item.title, item.name, item.label].filter(Boolean).join(" "))
    .join(" ");
  const text = [
    sale.title,
    sale.status,
    sale.changeType,
    getSaleChangesForSearch(sale),
    formatApplyScope(sale),
    resourceText,
  ]
    .join(" ")
    .toLowerCase();

  return text.includes(query.toLowerCase());
}

export default function SalesPage() {
  const { sales } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const actionFetcher = useFetcher();
  const processFetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(searchParams.get("q") || "");
  const [deleteSale, setDeleteSale] = useState(null);
  const [rollbackSale, setRollbackSale] = useState(null);
  const [cancelSale, setCancelSale] = useState(null);
  const [optimisticAction, setOptimisticAction] = useState(null);
  const [progressTick, setProgressTick] = useState(0);

  const isOpeningNewSale =
    navigation.location?.pathname === CREATE_SALE_URL ||
    location.pathname === CREATE_SALE_URL;
  const requestedTab = searchParams.get("status") || "all";
  const pageParam = Number(searchParams.get("page") || 1);
  const activeTab = SALE_TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "all";
  const selectedTabIndex = Math.max(
    SALE_TABS.findIndex((tab) => tab.id === activeTab),
    0,
  );
  const tabs = useMemo(
    () =>
      SALE_TABS.map((tab) => ({
        ...tab,
        url: tab.id === "all" ? SALES_URL : `${SALES_URL}?status=${tab.id}`,
      })),
    [],
  );
  const filteredSales = useMemo(
    () =>
      sales.filter(
        (sale) =>
          saleMatchesTab(sale, activeTab) &&
          (!queryValue || saleMatchesSearch(sale, queryValue)),
      ),
    [sales, activeTab, queryValue],
  );
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(pageParam, 1), totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedSales = filteredSales.slice(startIndex, startIndex + PAGE_SIZE);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (queryValue) params.set("q", queryValue);
    else params.delete("q");
    params.delete("page");
    setSearchParams(params, { replace: true });
  }, [queryValue]);

  useEffect(() => {
    if (actionFetcher.data?.ok) {
      setDeleteSale(null);
      setRollbackSale(null);
      setCancelSale(null);
      setOptimisticAction(null);
      revalidator.revalidate();
    }
  }, [actionFetcher.data, revalidator]);

  useEffect(() => {
    const hasProgressSale = sales.some(
      (sale) =>
        getSaleStatusDisplay(sale).showProgress ||
        normalizeSaleStatus(sale.status) === SALE_STATUS.PENDING,
    );
    if (!hasProgressSale) return undefined;

    const interval = setInterval(() => revalidator.revalidate(), 1500);
    return () => clearInterval(interval);
  }, [revalidator, sales]);

  useEffect(() => {
    const pendingSale = sales.find(
      (sale) => normalizeSaleStatus(sale.status) === SALE_STATUS.PENDING,
    );

    if (!pendingSale || processFetcher.state !== "idle") return;

    processFetcher.submit(null, {
      method: "post",
      action: `/app/sales/process/${pendingSale.id}`,
    });
  }, [processFetcher, sales]);

  useEffect(() => {
    const hasActiveProgress =
      Boolean(optimisticAction) ||
      processFetcher.state !== "idle" ||
      actionFetcher.state !== "idle" ||
      sales.some((sale) => getSaleStatusDisplay(sale).showProgress);

    if (!hasActiveProgress) return undefined;

    const interval = setInterval(() => setProgressTick((tick) => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [actionFetcher.state, optimisticAction, processFetcher.state, sales]);

  if (location.pathname !== SALES_URL) {
    return <Outlet />;
  }

  const handleTabChange = (selectedIndex) => {
    const selectedTab = SALE_TABS[selectedIndex];
    const nextParams = new URLSearchParams(searchParams);

    if (selectedTab.id === "all") nextParams.delete("status");
    else nextParams.set("status", selectedTab.id);
    nextParams.delete("page");

    setSearchParams(nextParams);
  };

  const updatePage = (page) => {
    const nextParams = new URLSearchParams(searchParams);
    if (page <= 1) nextParams.delete("page");
    else nextParams.set("page", String(page));
    setSearchParams(nextParams);
  };

  const submitSaleAction = (intent, sale) => {
    const formData = new FormData();
    formData.set("intent", intent);
    formData.set("saleId", String(sale.id));
    if (intent === "rollback_sale") {
      setRollbackSale(null);
      setOptimisticAction({
        intent,
        saleId: String(sale.id),
        startedAt: new Date().toISOString(),
      });
    }
    actionFetcher.submit(formData, { method: "post", action: SALES_URL });
  };

  const rowMarkup = paginatedSales.map((sale, index) => {
    const isOptimisticRollback =
      optimisticAction?.intent === "rollback_sale" &&
      optimisticAction.saleId === String(sale.id);
    const visibleSale = isOptimisticRollback
      ? {
          ...sale,
          status: SALE_STATUS.CANCELING,
          executionSummary: {
            ...(sale.executionSummary || {}),
            status: "Canceling",
            progress: 0,
            rollbackStartedAt: optimisticAction.startedAt,
          },
        }
      : sale;
    const statusDisplay = getSaleStatusDisplay(visibleSale);
    void progressTick;
    const progress = getEstimatedProcessingProgress(
      visibleSale,
      getSaleProgressValue(visibleSale),
    );
    const normalizedStatus = normalizeSaleStatus(sale.status);
    const isSubmitting =
      actionFetcher.state !== "idle" &&
      String(actionFetcher.formData?.get("saleId")) === String(sale.id);

    return (
      <IndexTable.Row id={String(sale.id)} key={sale.id} position={index}>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              <Link url={`/app/sales/${sale.id}`} removeUnderline>
                {sale.title}
              </Link>
            </Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            {getSaleChangeText(sale).map((change) => (
              change === "Auto re-apply changes" ? (
                <InlineStack key={change} gap="150" blockAlign="center" wrap={false}>
                  <ReapplyIcon />
                  <Text as="span" tone="subdued">
                    {change}
                  </Text>
                </InlineStack>
              ) : (
                <Text as="span" key={change} fontWeight="semibold">
                  {change}
                </Text>
              )
            ))}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" fontWeight="semibold">
              {sale.changeType === "markets" ? "Markets" : "Products"}
            </Text>
            {sale.changeType === "markets" ? (
              <Text as="span" tone="subdued" variant="bodySm">
                {getMarketNames(sale).map((name) => `- ${name}`).join(", ") || "Selected markets"}
              </Text>
            ) : null}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" fontWeight="semibold">
            {formatApplyScope(sale)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span">From {formatDate(sale.startAt || sale.createdAt)}</Text>
            {sale.endAt ? <Text as="span">Until {formatDate(sale.endAt)}</Text> : null}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="150">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>
              {statusDisplay.showProgress ? (
                <InlineStack gap="150" blockAlign="center" wrap={false}>
                  <Spinner size="small" accessibilityLabel={`${statusDisplay.label} sale`} />
                  <Text as="span" tone="subdued" variant="bodySm">
                    {progress}%
                  </Text>
                </InlineStack>
              ) : null}
            </InlineStack>
            {statusDisplay.showProgress ? <ProgressBar progress={progress} size="small" /> : null}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200" wrap={false}>
            <Button size="slim" url={`/app/sales/${sale.id}`}>
              Details
            </Button>
            {normalizedStatus === SALE_STATUS.SCHEDULED ? (
              <Button
                size="slim"
                loading={isSubmitting}
                onClick={() => setCancelSale(sale)}
              >
                Cancel
              </Button>
            ) : null}
            {canRollbackSale(sale) ? (
              <Button
                size="slim"
                loading={isSubmitting}
                onClick={() => setRollbackSale(sale)}
              >
                Disable
              </Button>
            ) : null}
            {canDeleteSale(sale) ? (
              <Button
                size="slim"
                tone="critical"
                loading={isSubmitting}
                onClick={() => setDeleteSale(sale)}
              >
                Delete
              </Button>
            ) : null}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <>
      <TitleBar title="Pryxo Bulk Price Editor">
      </TitleBar>

      <Page
        title="Sales"
        primaryAction={{
          content: "Create sale",
          onAction: () => navigate(CREATE_SALE_URL),
          loading: isOpeningNewSale,
          disabled: isOpeningNewSale,
        }}
        fullWidth
      >
        <Layout>
          <Layout.Section>
            {sales.length ? (
              <Card padding="0">
                <Tabs
                  tabs={tabs}
                  selected={selectedTabIndex}
                  onSelect={handleTabChange}
                />
                <Box padding="400" borderBlockStartWidth="025" borderColor="border">
                  <TextField
                    label="Search sales"
                    labelHidden
                    value={queryValue}
                    onChange={setQueryValue}
                    placeholder="Search sales by name, selected products, collections, or tags"
                    prefix={<SearchIcon />}
                    autoComplete="off"
                  />
                </Box>
                <IndexTable
                  resourceName={{ singular: "sale", plural: "sales" }}
                  itemCount={paginatedSales.length}
                  selectable={false}
                  headings={[
                    { title: "Title" },
                    { title: "Changes" },
                    { title: "Type" },
                    { title: "Apply to" },
                    { title: "Schedule" },
                    { title: "Status" },
                    { title: "Actions" },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
                {!paginatedSales.length ? (
                  <Box padding="500">
                    <Text as="p" tone="subdued">
                      No sales found.
                    </Text>
                  </Box>
                ) : null}
                <Box padding="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" tone="subdued">
                      {filteredSales.length
                        ? `${startIndex + 1}-${Math.min(
                            startIndex + PAGE_SIZE,
                            filteredSales.length,
                          )} of ${filteredSales.length}`
                        : "0 sales"}
                    </Text>
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => updatePage(currentPage - 1)}
                      hasNext={currentPage < totalPages}
                      onNext={() => updatePage(currentPage + 1)}
                    />
                  </InlineStack>
                </Box>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  heading="Manage sales"
                  image="/image/sale.svg"
                  action={{
                    content: "Create first sale",
                    onAction: () => navigate(CREATE_SALE_URL),
                    loading: isOpeningNewSale,
                    disabled: isOpeningNewSale,
                  }}
                  secondaryAction={{
                    content: "Learn more",
                    url: HELP_URL,
                    external: true,
                  }}
                >
                  <p>
                    Create manual or scheduled sales that will start and stop at
                    the specified time.
                  </p>
                </EmptyState>
              </Card>
            )}
          </Layout.Section>
        </Layout>

        <FooterHelp>
          Learn more about{" "}
          <Link url={HELP_URL} external removeUnderline>
            sales
          </Link>
        </FooterHelp>
      </Page>

      <Modal
        open={Boolean(rollbackSale)}
        onClose={() => setRollbackSale(null)}
        title="Rollback sale?"
        primaryAction={{
          content: "Rollback",
          destructive: true,
          loading: actionFetcher.state !== "idle",
          onAction: () => submitSaleAction("rollback_sale", rollbackSale),
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setRollbackSale(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This restores the original product, market, and tag values saved when the sale was applied.
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(cancelSale)}
        onClose={() => setCancelSale(null)}
        title="Cancel scheduled sale?"
        primaryAction={{
          content: "Cancel sale",
          destructive: true,
          loading: actionFetcher.state !== "idle",
          onAction: () => submitSaleAction("cancel_scheduled", cancelSale),
        }}
        secondaryActions={[
          {
            content: "Keep sale",
            onAction: () => setCancelSale(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">This cancels the sale before it is applied.</Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={Boolean(deleteSale)}
        onClose={() => setDeleteSale(null)}
        title="Delete sale?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: actionFetcher.state !== "idle",
          onAction: () => submitSaleAction("delete_sale", deleteSale),
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteSale(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">This deletes the saved sale record.</Text>
        </Modal.Section>
      </Modal>
    </>
  );
}
