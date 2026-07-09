import {
  useLoaderData,
  useNavigate,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
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
  const {
    rows,
    totalRows,
    totalPages,
    currentPage,
    query,
    filter,
    report,
    shopifyStoreHandle,
  } = useLoaderData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState(query || "");
  const [filterValue, setFilterValue] = useState(filter || "all");
  const title =
    type === REPORT_TYPES.margin
      ? "Products Margin Report"
      : "Products Discount Report";

  useEffect(() => {
    setQueryValue(query || "");
  }, [query]);

  useEffect(() => {
    setFilterValue(filter || "all");
  }, [filter]);

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

  const handlePrevious = () => {
    updateSearch({ page: currentPage > 2 ? String(currentPage - 1) : "" });
  };

  const handleNext = () => {
    updateSearch({ page: String(currentPage + 1) });
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
        <Link url={getProductAdminUrl(shopifyStoreHandle, row.productId)}>
          {row.productTitle || "-"}
        </Link>
      </IndexTable.Cell>
      <IndexTable.Cell>{row.variantTitle || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{row.sku || "-"}</IndexTable.Cell>
      <IndexTable.Cell>{formatMoney(row.price, row.currencyCode)}</IndexTable.Cell>
      {type === REPORT_TYPES.margin ? (
        <>
          <IndexTable.Cell>{formatMoney(row.cost, row.currencyCode)}</IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" tone={getMarginTone(row.marginPercent)}>
              {formatPercent(row.marginPercent)}
            </Text>
          </IndexTable.Cell>
        </>
      ) : (
        <>
          <IndexTable.Cell>
            {formatMoney(row.compareAtPrice, row.currencyCode)}
          </IndexTable.Cell>
          <IndexTable.Cell>{formatDiscount(row.discountPercent)}</IndexTable.Cell>
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
          url: exportUrl,
        },
      ]}
      fullWidth
    >
      <TitleBar title={title} />

      <Card padding="0">
        <Box padding="400">
          <BlockStack gap="400">
            <InlineGrid
              columns={type === REPORT_TYPES.margin ? "1fr 240px" : "1fr"}
              gap="400"
            >
              <TextField
                label="Search"
                labelHidden
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
            </InlineGrid>

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

            {!rows.length ? (
              <Box paddingBlock="400">
                <Text as="p" tone="subdued">
                  No report rows found.
                </Text>
              </Box>
            ) : null}

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

            <Text as="p" tone="subdued">
              Generated {formatDate(report.generatedAt || report.createdAt)}
            </Text>
          </BlockStack>
        </Box>
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

function getMarginTone(value) {
  if (value == null) return "subdued";
  return Number(value) < 0 ? "critical" : "success";
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
