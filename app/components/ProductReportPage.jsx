import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  IndexTable,
  InlineGrid,
  InlineStack,
  Link,
  Page,
  Pagination,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

const REPORT_TYPES = {
  margin: "margin",
  discount: "discount",
};

export default function ProductReportPage({ type }) {
  const loaderData = useLoaderData() || {};
  const rows = Array.isArray(loaderData.rows) ? loaderData.rows : [];
  const totalRows = Number(loaderData.totalRows || 0);
  const totalPages = Number(loaderData.totalPages || 1);
  const currentPage = Number(loaderData.currentPage || 1);
  const query = loaderData.query || "";
  const filter = loaderData.filter || "all";
  const dateFrom = loaderData.dateFrom || "";
  const dateTo = loaderData.dateTo || "";
  const shopifyStoreHandle = loaderData.shopifyStoreHandle || "";
  const submit = useSubmit();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(query || "");
  const [filterValue, setFilterValue] = useState(filter || "all");
  const [dateFromValue, setDateFromValue] = useState(dateFrom || "");
  const [dateToValue, setDateToValue] = useState(dateTo || "");
  const title =
    type === REPORT_TYPES.margin
      ? "Products Margin Report"
      : "Products Discount Report";
  const reportDescription =
    type === REPORT_TYPES.margin
      ? "Review price, cost, and gross margin for each variant."
      : "Review variants that still have compare-at prices and discount values.";

  useEffect(() => {
    setQueryValue(query || "");
  }, [query]);

  useEffect(() => {
    setFilterValue(filter || "all");
  }, [filter]);

  useEffect(() => {
    setDateFromValue(dateFrom || "");
  }, [dateFrom]);

  useEffect(() => {
    setDateToValue(dateTo || "");
  }, [dateTo]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (queryValue === (query || "")) return;
      updateSearch({ q: queryValue, page: "" });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [queryValue]);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.set("export", "csv");
    return `?${params.toString()}`;
  }, [searchParams]);

  const handleFilterChange = (value) => {
    setFilterValue(value);
    updateSearch({ margin: value === "all" ? "" : value, page: "" });
  };

  const handleDateFromChange = (value) => {
    setDateFromValue(value);
    updateSearch({ dateFrom: value, page: "" });
  };

  const handleDateToChange = (value) => {
    setDateToValue(value);
    updateSearch({ dateTo: value, page: "" });
  };

  const handlePrevious = () => {
    updateSearch({ page: currentPage > 2 ? String(currentPage - 1) : "" });
  };

  const handleNext = () => {
    updateSearch({ page: String(currentPage + 1) });
  };

  const handleExportCsv = () => {
    window.location.assign(exportUrl);
  };

  const updateSearch = (updates) => {
    const params = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }

    submit(params, { method: "get", replace: true });
  };

  const rowMarkup = rows.map((row, index) => (
    <IndexTable.Row id={String(row.id)} key={row.id} position={index}>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Link
            url={getProductAdminUrl(shopifyStoreHandle, row.productId)}
            external
          >
            {row.productTitle || "-"}
          </Link>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span">{row.variantTitle || "-"}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone={row.sku ? undefined : "subdued"}>
          {row.sku || "-"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="start" numeric>
          {formatMoney(row.price, row.currencyCode)}
        </Text>
      </IndexTable.Cell>
      {type === REPORT_TYPES.margin ? (
        <>
          <IndexTable.Cell>
            <Text as="span" alignment="start" align="start" numeric>
              {formatMoney(row.cost, row.currencyCode)}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>{renderMargin(row.marginPercent)}</IndexTable.Cell>
        </>
      ) : (
        <>
          <IndexTable.Cell>
            <Text as="span"alignment="start" align="start" numeric>
              {formatMoney(row.compareAtPrice, row.currencyCode)}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" alignment="start" align="start" numeric>
              {formatDiscount(row.discountPercent)}
            </Text>
          </IndexTable.Cell>
        </>
      )}
    </IndexTable.Row>
  ));

  return (
    <Page
      title={title}
      backAction={{ content: "Tools", onAction: () => navigate("/app/tools") }}
      secondaryActions={[
        {
          content: "Export CSV",
          onAction: handleExportCsv,
        },
      ]}
      fullWidth
    >
      <TitleBar title="Pryxo Bulk Price Editor" />

      <Card padding="0">
        <BlockStack gap="0">
          <Box padding="400" background="bg-surface-secondary">
            <InlineGrid
              columns={{
                xs: "1fr",
                sm: type === REPORT_TYPES.margin
                  ? "minmax(220px, 1fr) 180px 180px 180px"
                  : "minmax(220px, 1fr) 180px 180px",
              }}
              gap="400"
            >
              <TextField
                label="Search Products"
                value={queryValue}
                onChange={setQueryValue}
                placeholder="Product, variant, or SKU"
                autoComplete="off"
              />

              {type === REPORT_TYPES.margin ? (
                <Select
                  label="Margin"
                  options={[
                    { label: "All", value: "all" },
                    { label: "With margin", value: "with_margin" },
                    { label: "Without margin", value: "without_margin" },
                  ]}
                  value={filterValue}
                  onChange={handleFilterChange}
                />
              ) : null}

              <TextField
                label="From date"
                type="date"
                value={dateFromValue}
                onChange={handleDateFromChange}
                max={dateToValue || undefined}
                autoComplete="off"
              />

              <TextField
                label="To date"
                type="date"
                value={dateToValue}
                onChange={handleDateToChange}
                min={dateFromValue || undefined}
                autoComplete="off"
              />
            </InlineGrid>
          </Box>

          <Divider />

          <Box paddingBlockStart="200">
            <IndexTable
              resourceName={{ singular: "row", plural: "rows" }}
              itemCount={rows.length}
              selectable={false}
              headings={
                type === REPORT_TYPES.margin
                  ? [
                      { title: "Product" },
                      { title: "Variant" },
                      { title: "SKU" },
                      { title: "Price" },
                      { title: "Cost" },
                      { title: "Margin" },
                    ]
                  : [
                      { title: "Product" },
                      { title: "Variant" },
                      { title: "SKU" },
                      { title: "Price" },
                      { title: "Compare at price" },
                      { title: "Discount" },
                    ]
              }
            >
              {rowMarkup}
            </IndexTable>
          </Box>

            {!rows.length ? (
              <Box padding="500">
                <Text as="p" tone="subdued">
                  No report rows found.
                </Text>
              </Box>
            ) : null}

          <Divider />

          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" tone="subdued">
                {formatRangeLabel(totalRows, currentPage, rows.length)}
              </Text>
              <Pagination
                hasPrevious={currentPage > 1}
                onPrevious={handlePrevious}
                hasNext={currentPage < totalPages}
                onNext={handleNext}
              />
            </InlineStack>
          </Box>
        </BlockStack>
      </Card>
    </Page>
  );
}

function formatMoney(value, currencyCode) {
  if (value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${currencyCode || ""} ${number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function formatPercent(value) {
  if (value == null) return "-";
  return `${Number(value).toFixed(2)}%`;
}

function formatDiscount(value) {
  if (value == null) return "-";
  return `${Number(value).toFixed(2)}% off`;
}

function renderMargin(value) {
  if (value == null) {
    return <Badge tone="attention">No cost</Badge>;
  }

  const number = Number(value);
  return (
    <InlineStack align="start">
      <Badge tone={number < 0 ? "critical" : "success"}>
        {formatPercent(number)}
      </Badge>
    </InlineStack>
  );
}

function getProductAdminUrl(shopifyStoreHandle, productId) {
  const numericId = String(productId || "").split("/").pop();
  if (!shopifyStoreHandle || !numericId) return "#";
  return `https://admin.shopify.com/store/${shopifyStoreHandle}/products/${numericId}`;
}

function formatRangeLabel(totalRows, currentPage, rowCount) {
  if (!totalRows) return "0 rows";
  const start = (currentPage - 1) * 25 + 1;
  const end = start + rowCount - 1;
  return `${start}-${end} of ${totalRows}`;
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
