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
  Tabs,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { endSaleRecord } from "../lib/sales.server";

const CREATE_SALE_URL = "/app/sales/new";
const SALES_URL = "/app/sales";
const HELP_URL = "https://help.platmart.io/article/29-how-to-use-sales";
const PAGE_SIZE = 10;
const SALE_TABS = [
  { id: "all", content: "All sales" },
  { id: "active", content: "Active" },
  { id: "scheduled", content: "Scheduled" },
  { id: "completed", content: "Completed" },
  { id: "failed", content: "Failed" },
];
const PROGRESS_STATUSES = ["scheduled", "activating", "ending", "checking_changes"];

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
    if (isActiveSale(sale)) {
      return json(
        { ok: false, message: "End the active sale before deleting it." },
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

  if (intent === "end_sale") {
    if (!isActiveSale(sale)) {
      return json(
        { ok: false, message: "Only active sales can be ended." },
        { status: 400 },
      );
    }

    const ended = await endSaleRecord(admin, sale);

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: session.shop,
      },
      data: {
        status: ended.ok ? "completed" : "failed",
        executionSummary: {
          ...(sale.executionSummary || {}),
          ended,
        },
        completedAt: new Date(),
      },
    });

    return json({
      ok: ended.ok,
      ended: true,
      message: ended.ok ? "Sale ended." : "Sale end completed with errors.",
    });
  }

  return json({ ok: false, message: "Unknown action." }, { status: 400 });
};

function saleMatchesTab(sale, activeTab) {
  if (activeTab === "all") return true;

  const status = normalizeStatus(sale.status);

  if (activeTab === "completed") {
    return ["complete", "completed", "finished", "ended"].includes(status);
  }

  return status === activeTab;
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase().trim();
}

function isActiveSale(sale) {
  return normalizeStatus(sale.status) === "active";
}

function getSaleStatusDisplay(sale) {
  const status = normalizeStatus(sale.status);
  const progress = getSaleProgress(sale);

  if (PROGRESS_STATUSES.includes(status)) {
    return {
      label: humanize(status),
      tone: "attention",
      showProgress: true,
      progress,
    };
  }

  if (status === "active") {
    return { label: "Active", tone: "success", showProgress: false, progress: 100 };
  }
  if (status === "scheduled") return { label: "Scheduled", tone: "attention" };
  if (status === "failed") return { label: "Failed", tone: "critical" };
  if (["complete", "completed", "finished", "ended"].includes(status)) {
    return { label: "Completed", tone: "success", showProgress: false, progress: 100 };
  }

  return {
    label: status ? humanize(status) : "Pending",
    tone: "subdued",
    showProgress: progress > 0 && progress < 100,
    progress,
  };
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
  return [price, compareAt].filter(Boolean).join(", ") || "Sale";
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

function saleMatchesSearch(sale, query) {
  const text = [
    sale.title,
    sale.status,
    sale.changeType,
    getSaleChangeText(sale),
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(searchParams.get("q") || "");
  const [deleteSale, setDeleteSale] = useState(null);
  const [endSale, setEndSale] = useState(null);

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
      setEndSale(null);
    }
  }, [actionFetcher.data]);

  useEffect(() => {
    const hasProgressSale = sales.some((sale) => getSaleStatusDisplay(sale).showProgress);
    if (!hasProgressSale) return undefined;

    const interval = setInterval(() => revalidator.revalidate(), 1500);
    return () => clearInterval(interval);
  }, [revalidator, sales]);

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
    actionFetcher.submit(formData, { method: "post", action: SALES_URL });
  };

  const rowMarkup = paginatedSales.map((sale, index) => {
    const statusDisplay = getSaleStatusDisplay(sale);
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
            <Text as="span" variant="bodySm" tone="subdued">
              {getSaleChangeText(sale)}
            </Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>{humanize(sale.changeType || "products")}</IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={statusDisplay.tone}>{statusDisplay.label}</Badge>
              {statusDisplay.showProgress ? (
                <Text as="span" tone="subdued" variant="bodySm">
                  {statusDisplay.progress}%
                </Text>
              ) : null}
            </InlineStack>
            {statusDisplay.showProgress ? (
              <Box maxWidth="140px">
                <ProgressBar progress={statusDisplay.progress} size="small" />
              </Box>
            ) : null}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>{formatDate(sale.startAt || sale.createdAt)}</IndexTable.Cell>
        <IndexTable.Cell>{formatDate(sale.endAt)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued">
            {sale.executionSummary?.updatedVariants || 0}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200" wrap={false}>
            <Button size="slim" url={`/app/sales/${sale.id}`}>
              View
            </Button>
            <Button size="slim" url={`/app/sales/new?id=${sale.id}`}>
              Edit
            </Button>
            {isActiveSale(sale) ? (
              <Button
                size="slim"
                loading={isSubmitting}
                onClick={() => setEndSale(sale)}
              >
                End
              </Button>
            ) : null}
            {!isActiveSale(sale) ? (
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
                    placeholder="Search sales by title, status, or change"
                    autoComplete="off"
                  />
                </Box>
                <IndexTable
                  resourceName={{ singular: "sale", plural: "sales" }}
                  itemCount={paginatedSales.length}
                  selectable={false}
                  headings={[
                    { title: "Sale" },
                    { title: "Type" },
                    { title: "Status" },
                    { title: "Start" },
                    { title: "End" },
                    { title: "Updated variants" },
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
        open={Boolean(endSale)}
        onClose={() => setEndSale(null)}
        title="End sale?"
        primaryAction={{
          content: "End sale",
          destructive: true,
          loading: actionFetcher.state !== "idle",
          onAction: () => submitSaleAction("end_sale", endSale),
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setEndSale(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This restores the product prices saved when the sale started.
          </Text>
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
