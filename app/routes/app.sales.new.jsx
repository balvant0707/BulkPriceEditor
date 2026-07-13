// app/routes/app.sales.new.jsx
import { json, redirect } from "@remix-run/node";
import {
  useFetcher,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Select,
  ChoiceList,
  Checkbox,
  Button,
  ButtonGroup,
  InlineStack,
  BlockStack,
  FormLayout,
  Divider,
  Box,
  Modal,
  Tag,
  Banner,
  Badge,
  Spinner,
  InlineGrid,
  Popover,
  Scrollable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { withShopifyEmbeddedParams } from "../lib/shopify-embedded-url";
import {
  createSaleExecutionSummary,
  SALE_STATUS,
} from "../lib/sale-status";

const BACK_URL = "/app/sales";

const MARKETS_QUERY = `#graphql
  query GetMarkets {
    shop {
      currencyCode
    }
    markets(first: 50) {
      nodes {
        id
        name
        handle
        enabled
        primary
        catalogs(first: 10) {
          nodes {
            id
            title
            priceList {
              id
            }
          }
        }
        currencySettings {
          baseCurrency {
            currencyCode
          }
        }
        regions(first: 20) {
          nodes {
            name
            ... on MarketRegionCountry {
              code
            }
          }
        }
      }
    }
  }
`;

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const saleId = getRecordId(params.id || new URL(request.url).searchParams.get("id"));
  const sale = saleId
    ? await db.sale.findFirst({
      where: {
        id: saleId,
        shop: session.shop,
      },
    })
    : null;

  if (saleId && !sale) {
    throw new Response("Sale not found", { status: 404 });
  }

  try {
    const response = await admin.graphql(MARKETS_QUERY);
    const payload = await response.json();

    if (payload.errors) {
      return json({
        markets: [],
        marketsError: "Unable to load Shopify Markets.",
        shopCurrency: "USD",
        sale,
      });
    }

    return json({
      markets: normalizeMarkets(payload.data?.markets?.nodes),
      marketsError: "",
      shopCurrency: payload.data?.shop?.currencyCode || "USD",
      sale,
    });
  } catch {
    return json({
      markets: [],
      marketsError: "Unable to load Shopify Markets.",
      shopCurrency: "USD",
      sale,
    });
  }
}

export async function action({ request, params }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const payload = JSON.parse(String(formData.get("payload") || "{}"));
  const form = payload.form || {};
  const title = String(form.title || "").trim();
  const saleId = getRecordId(
    String(formData.get("id") || "") ||
    params.id ||
    new URL(request.url).searchParams.get("id"),
  );

  if (!title) {
    return json({ error: "Sale title is required." }, { status: 400 });
  }

  const activeSaleWithSameTitle = await db.sale.findFirst({
    where: {
      shop: session.shop,
      title,
      id: saleId ? { not: saleId } : undefined,
      status: {
        in: [
          SALE_STATUS.COMPLETED,
          "active",
          "Active",
          "complete",
          "Complete",
          "completed",
          "Completed",
        ],
      },
    },
    select: { id: true },
  });

  if (activeSaleWithSameTitle) {
    return json(
      { error: "A sale with this name is already active." },
      { status: 400 },
    );
  }

  const data = buildSaleData(session.shop, title, payload);
  const validationError = validateSaleData(data);
  if (validationError) {
    return json({ error: validationError }, { status: 400 });
  }
  const executionState = prepareSaleExecution(data);
  const saleData = {
    ...data,
    ...executionState,
  };

  if (saleId) {
    const result = await db.sale.updateMany({
      where: {
        id: saleId,
        shop: session.shop,
      },
      data: saleData,
    });

    if (!result.count) {
      throw new Response("Sale not found", { status: 404 });
    }

    return redirect(
      withShopifyEmbeddedParams(`/app/sales/${saleId}`, request, session.shop),
    );
  } else {
    const sale = await db.sale.create({ data: saleData });
    if (sale.executionSummary?.logs?.length) {
      await db.sale.update({
        where: { id: sale.id },
        data: {
          executionSummary: {
            ...(sale.executionSummary || {}),
            logs: sale.executionSummary.logs.map((log) => ({
              ...log,
              saleId: sale.id,
            })),
          },
        },
      });
    }
    return redirect(
      withShopifyEmbeddedParams(`/app/sales/${sale.id}`, request, session.shop),
    );
  }
}

function getRecordId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseScheduleDate(date, time, timezoneOffsetMinutes = null) {
  if (!date || !time) return null;

  const offset = Number(timezoneOffsetMinutes);
  const value = Number.isFinite(offset)
    ? new Date(Date.UTC(...parseDateTimeParts(date, time)) + offset * 60 * 1000)
    : new Date(`${date}T${time}:00`);

  return Number.isNaN(value.getTime()) ? null : value;
}

function parseDateTimeParts(date, time) {
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);

  return [
    Number.isFinite(year) ? year : 1970,
    Number.isFinite(month) ? month - 1 : 0,
    Number.isFinite(day) ? day : 1,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    0,
  ];
}

function buildSaleData(shop, title, payload) {
  const form = payload.form || {};
  const startAt = parseScheduleDate(
    form.startDate,
    form.startTime,
    form.timezoneOffsetMinutes,
  );
  const endAt = form.setEndDate
    ? parseScheduleDate(
        form.endDate,
        form.endTime,
        form.timezoneOffsetMinutes,
      )
    : null;

  return {
    shop,
    title,
    status: "pending",
    changeType: form.changeType || "products",
    applyToFixedPrices: Boolean(form.applyToFixedPrices),
    markets: payload.selectedMarketDetails || [],
    priceChange: {
      action: form.priceAction || "",
      type: form.priceChangeType || "by_percent",
      percent: form.pricePercent || "",
      amount: form.priceAmount || "",
      rounding: {
        mode: form.priceRounding || "none",
        overrideToNearest: Boolean(form.priceOverrideToNearest),
        centsValue: form.priceCents || "",
        endingDigits: form.priceEndingDigits || [],
        endingPattern: (form.priceEndingDigits || []).join(""),
      },
    },
    compareAtPriceChange: {
      action: form.compareAction || "",
      type: form.compareChangeType || "by_percent",
      percent: form.comparePercent || "",
      amount: form.compareAmount || "",
      rounding: {
        mode: form.compareRounding || "none",
        overrideToNearest: Boolean(form.compareOverrideToNearest),
        centsValue: form.compareCents || "",
        endingDigits: form.compareEndingDigits || [],
        endingPattern: (form.compareEndingDigits || []).join(""),
      },
    },
    applyScope: form.applyCondition || "whole_store",
    excludeScope: form.excludeCondition || "nothing",
    discountedScope: form.excludeDiscounted || "nothing",
    applyResources: {
      collections: payload.applyCollections || [],
      products: payload.applyProducts || [],
      variants: payload.applyVariants || [],
      tags: payload.applyTags || [],
    },
    excludeResources: {
      collections: payload.excludeCollections || [],
      products: payload.excludeProducts || [],
      variants: payload.excludeVariants || [],
      tags: payload.excludeTags || [],
    },
    tagRules: {
      add: payload.tagsToAdd || [],
      remove: payload.tagsToRemove || [],
    },
    schedule: {
      startDate: form.startDate || "",
      startTime: form.startTime || "",
      setEndDate: Boolean(form.setEndDate),
      endDate: form.endDate || "",
      endTime: form.endTime || "",
    },
    configuration: payload,
    startAt,
    endAt,
    addTagsEnabled: Boolean(form.addTagsEnabled),
    removeTagsEnabled: Boolean(form.removeTagsEnabled),
    trackConditionChanges: Boolean(form.trackConditionChanges),
    autoReapplyChanges: Boolean(form.autoReapplyChanges),
  };
}

function validateSaleData(saleData) {
  if (saleData.changeType !== "markets") return "";

  const markets = saleData.markets || [];
  if (!markets.length) return "Choose at least one Shopify Market.";
  if (!markets.some((market) => market.priceListIds?.length)) {
    return "Selected Shopify Markets do not have price lists available.";
  }

  return "";
}

function prepareSaleExecution(saleData) {
  const now = new Date();

  if (saleData.startAt && saleData.startAt > now) {
    return {
      status: SALE_STATUS.SCHEDULED,
      executionSummary: createSaleExecutionSummary(SALE_STATUS.SCHEDULED, {
        ok: true,
        progress: 0,
        scheduled: true,
        message:
          "Sale saved as scheduled. The sales cron endpoint activates it automatically.",
      }),
      startedAt: null,
      completedAt: null,
    };
  }

  return {
    status: SALE_STATUS.PENDING,
    executionSummary: createSaleExecutionSummary(SALE_STATUS.PENDING),
    startedAt: null,
    completedAt: null,
  };
}

function normalizeMarkets(markets = []) {
  return markets.map((market) => {
    const currencyCode =
      market.currencySettings?.baseCurrency?.currencyCode || "";
    const regions = market.regions?.nodes || [];
    const currencyLabel = currencyCode ? ` (${currencyCode})` : "";
    const primaryLabel = market.primary ? " - primary" : "";

    return {
      id: market.id,
      name: market.name,
      handle: market.handle || "",
      currencyCode,
      enabled: Boolean(market.enabled),
      primary: Boolean(market.primary),
      regions,
      catalogs: market.catalogs?.nodes || [],
      priceListIds: (market.catalogs?.nodes || [])
        .map((catalog) => catalog.priceList?.id)
        .filter(Boolean),
      label: `${market.name}${currencyLabel}${primaryLabel}`,
    };
  });
}

const applyOptions = [
  { label: "Whole store", value: "whole_store" },
  { label: "Selected collections", value: "selected_collections" },
  { label: "Selected products", value: "selected_products" },
  { label: "Selected products with variants", value: "selected_products_with_variants" },
  { label: "Selected tags", value: "selected_tags" },
];

const excludeOptions = [
  { label: "Nothing", value: "nothing" },
  { label: "Selected collections", value: "selected_collections" },
  { label: "Selected products", value: "selected_products" },
  { label: "Selected products with variants", value: "selected_products_with_variants" },
  { label: "Selected tags", value: "selected_tags" },
];

const excludeDiscountedOptions = [
  { label: "Nothing", value: "nothing" },
  { label: "All products on sale", value: "products_on_sale" },
  { label: "All product types on sale", value: "product_types_on_sale" },
];

const roundingOptions = [
  { label: "No rounding", value: "none" },
  { label: "Round to whole number", value: "round_to_whole" },
  { label: "Override cents", value: "override_cents" },
  { label: "Set price ending", value: "set_ending" },
];

function SectionCard({ title, children }) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        {children}
      </BlockStack>
    </Card>
  );
}

function ResourceAvatar({ title, imageUrl, imageAlt }) {
  const first = String(title || "?").charAt(0).toUpperCase();

  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: "#F3F4F6",
        border: "1px solid #E5E7EB",
        display: "grid",
        placeItems: "center",
        color: "#4B5563",
        fontWeight: 600,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={imageAlt || title || ""}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        first
      )}
    </div>
  );
}

function SelectedList({ items, onRemove, emptyText }) {
  if (!items.length) {
    return (
      <Box
        padding="300"
        background="bg-surface-secondary"
        borderRadius="200"
        borderColor="border"
        borderWidth="025"
      >
        <Text as="p" tone="subdued">
          {emptyText}
        </Text>
      </Box>
    );
  }

  return (
    <BlockStack gap="200">
      {items.map((item) => (
        <Box
          key={item.id}
          padding="300"
          borderColor="border"
          borderWidth="025"
          borderRadius="200"
        >
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <InlineStack gap="300" blockAlign="center">
              <ResourceAvatar
                title={item.productTitle || item.title}
                imageUrl={item.imageUrl}
                imageAlt={item.imageAlt}
              />
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {item.title}
                </Text>
                {item.productTitle || item.subtitle ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {item.productTitle || item.subtitle}
                  </Text>
                ) : null}
              </BlockStack>
            </InlineStack>

            <Button variant="plain" tone="critical" onClick={() => onRemove(item.id)}>
              Remove
            </Button>
          </InlineStack>
        </Box>
      ))}
    </BlockStack>
  );
}

function PickerModal({
  active,
  resourceType,
  title,
  items,
  pageInfo,
  loading,
  loadingMore,
  error,
  selectedItems,
  onClose,
  onAdd,
  onSearch,
  onLoadNext,
  limit = 100,
}) {
  const [query, setQuery] = useState("");
  const [tempSelectedIds, setTempSelectedIds] = useState([]);
  const autoLoadLockRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    setQuery("");
    setTempSelectedIds(selectedItems.map((item) => item.id));
    autoLoadLockRef.current = false;
  }, [active, resourceType, selectedItems]);

  useEffect(() => {
    if (!loadingMore) autoLoadLockRef.current = false;
  }, [loadingMore, pageInfo?.endCursor]);

  const selectedIdSet = useMemo(
    () => new Set(tempSelectedIds),
    [tempSelectedIds],
  );
  const loadedItemIds = useMemo(() => items.map((item) => item.id), [items]);
  const selectedLoadedCount = loadedItemIds.filter((id) =>
    selectedIdSet.has(id),
  ).length;
  const allLoadedSelected =
    loadedItemIds.length > 0 && selectedLoadedCount === loadedItemIds.length;
  const someLoadedSelected =
    selectedLoadedCount > 0 && selectedLoadedCount < loadedItemIds.length;

  const resourceLabel =
    resourceType === "collection"
      ? "collections"
      : resourceType === "variant"
        ? "variants"
        : resourceType === "tag"
          ? "tags"
          : "products";
  const rightHeader =
    resourceType === "collection"
      ? "Products"
      : resourceType === "tag"
        ? ""
        : "Price";
  const addButtonLabel =
    resourceType === "collection"
      ? "Add collections"
      : resourceType === "variant"
        ? "Add variants"
        : resourceType === "tag"
          ? "Add tags"
          : "Add products";
  const listGridColumns =
    resourceType === "tag"
      ? "40px minmax(0, 1fr)"
      : "40px minmax(0, 1fr) 120px";

  const handleToggle = (id) => {
    setTempSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((itemId) => itemId !== id);
      }
      if (current.length >= limit) return current;
      return [...current, id];
    });
  };

  const handleToggleLoadedItems = () => {
    setTempSelectedIds((current) => {
      const loadedIds = new Set(loadedItemIds);
      if (allLoadedSelected) {
        return current.filter((id) => !loadedIds.has(id));
      }

      const nextIds = [...current];
      const nextIdSet = new Set(nextIds);
      for (const id of loadedItemIds) {
        if (nextIds.length >= limit) break;
        if (!nextIdSet.has(id)) {
          nextIds.push(id);
          nextIdSet.add(id);
        }
      }
      return nextIds;
    });
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    onSearch(value);
  };

  const handleAdd = () => {
    onAdd(items.filter((item) => tempSelectedIds.includes(item.id)));
    setQuery("");
    setTempSelectedIds([]);
  };

  const handleClose = () => {
    setQuery("");
    setTempSelectedIds([]);
    onClose();
  };

  const handleListScroll = (event) => {
    if (!pageInfo?.hasNextPage || loadingMore || autoLoadLockRef.current) return;

    const list = event.currentTarget;
    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;

    if (distanceFromBottom <= 80) {
      autoLoadLockRef.current = true;
      onLoadNext();
    }
  };

  return (
    <Modal open={active} onClose={handleClose} title={title} large>
      <Modal.Section>
        {loading ? (
          <div
            style={{
              minHeight: 420,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BlockStack gap="300" inlineAlign="center">
              <Spinner accessibilityLabel={`Loading ${resourceLabel}`} size="large" />
              <Text as="p" tone="subdued">
                Loading {resourceLabel}...
              </Text>
            </BlockStack>
          </div>
        ) : (
          <div
            style={{
              height: "min(700px, calc(100vh - 180px))",
              minHeight: "min(520px, calc(100vh - 180px))",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flexShrink: 0 }}>
              <Box paddingBlockEnd="300">
                <TextField
                  label={`Search ${resourceLabel}`}
                  labelHidden
                  placeholder={`Search ${resourceLabel}`}
                  value={query}
                  onChange={handleQueryChange}
                  autoComplete="off"
                />
              </Box>
            </div>

            {error ? (
              <div style={{ flexShrink: 0 }}>
                <Box paddingBlockEnd="300">
                  <Banner tone="critical">{error}</Banner>
                </Box>
              </div>
            ) : null}

            <div
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                overflow: "hidden",
                background: "#FFFFFF",
                display: "flex",
                flex: "1 1 auto",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: listGridColumns,
                  alignItems: "center",
                  borderBottom: "1px solid #E5E7EB",
                  padding: "12px 16px",
                  background: "#FAFBFB",
                  columnGap: 12,
                  flexShrink: 0,
                }}
              >
                <div onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    label={`Select all loaded ${resourceLabel}`}
                    labelHidden
                    checked={
                      allLoadedSelected
                        ? true
                        : someLoadedSelected
                          ? "indeterminate"
                          : false
                    }
                    disabled={items.length === 0}
                    onChange={handleToggleLoadedItems}
                  />
                </div>

                <Text as="span" tone="subdued" variant="bodySm">
                  {resourceType === "tag" ? "Product tag" : "Item"}
                </Text>

                {rightHeader ? (
                  <div style={{ textAlign: "right" }}>
                    <Text as="span" tone="subdued" variant="bodySm">
                      {rightHeader}
                    </Text>
                  </div>
                ) : null}
              </div>

              <div
                onScroll={handleListScroll}
                style={{
                  flex: "1 1 auto",
                  minHeight: 0,
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  scrollbarGutter: "stable",
                }}
              >
                {items.length === 0 ? (
                  <Box padding="500">
                    <Text as="p" tone="subdued">
                      No {resourceLabel} found.
                    </Text>
                  </Box>
                ) : (
                  items.map((item) => {
                    const checked = selectedIdSet.has(item.id);

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleToggle(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleToggle(item.id);
                          }
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: listGridColumns,
                          alignItems: "center",
                          gap: 12,
                          minHeight: 80,
                          padding: "10px 16px",
                          borderBottom: "1px solid #F1F1F1",
                          cursor: "pointer",
                          background: checked ? "#F6F6F7" : "#FFFFFF",
                        }}
                      >
                        <div onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            label={item.title}
                            labelHidden
                            checked={checked}
                            onChange={() => handleToggle(item.id)}
                          />
                        </div>

                        {resourceType === "tag" ? (
                          <Text as="span" variant="bodyMd">
                            {item.title}
                          </Text>
                        ) : (
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            <ResourceAvatar
                              title={item.productTitle || item.title}
                              imageUrl={item.imageUrl}
                              imageAlt={item.imageAlt}
                            />

                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd">
                                {item.title}
                              </Text>

                              {item.productTitle ? (
                                <Text as="span" tone="subdued" variant="bodySm">
                                  {item.productTitle}
                                </Text>
                              ) : null}

                              {item.status ? (
                                <Box paddingBlockStart="050">
                                  <Badge
                                    tone={
                                      item.status === "Active"
                                        ? "success"
                                        : "attention"
                                    }
                                  >
                                    {item.status}
                                  </Badge>
                                </Box>
                              ) : null}
                            </BlockStack>
                          </InlineStack>
                        )}

                        {resourceType === "tag" ? null : (
                          <div style={{ textAlign: "right" }}>
                            <Text as="span" variant="bodySm">
                              {resourceType === "collection"
                                ? item.productsCount
                                : item.displayPrice || "-"}
                            </Text>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {loadingMore ? (
                  <Box padding="400">
                    <BlockStack gap="200" inlineAlign="center">
                      <Spinner
                        accessibilityLabel={`Loading more ${resourceLabel}`}
                        size="small"
                      />
                      <Text as="p" tone="subdued" variant="bodySm">
                        Loading more {resourceLabel}...
                      </Text>
                    </BlockStack>
                  </Box>
                ) : null}
              </div>
            </div>

            <div
              style={{
                position: "sticky",
                bottom: 0,
                zIndex: 2,
                flexShrink: 0,
                marginTop: 12,
                background: "#FFFFFF",
                borderTop: "1px solid #E5E7EB",
              }}
            >
              <Box
                paddingBlockStart="300"
                paddingInlineStart="050"
                paddingInlineEnd="050"
              >
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <Text as="p" tone="subdued" variant="bodyMd">
                    {tempSelectedIds.length}/{limit} {resourceLabel} selected
                  </Text>

                  <ButtonGroup>
                    <Button onClick={handleClose}>Cancel</Button>
                    <Button
                      variant="primary"
                      onClick={handleAdd}
                      disabled={tempSelectedIds.length === 0 || loading}
                    >
                      {addButtonLabel}
                    </Button>
                  </ButtonGroup>
                </InlineStack>
              </Box>
            </div>
          </div>
        )}
      </Modal.Section>
    </Modal>
  );
}

function InlineTagSearch({
  label,
  selectedTags,
  suggestions,
  query,
  active,
  loading,
  error,
  onQueryChange,
  onFocus,
  onClose,
  onToggleTag,
}) {
  const selectedIds = useMemo(
    () => new Set(selectedTags.map((tag) => tag.id)),
    [selectedTags],
  );

  return (
    <BlockStack gap="200">
      <Popover
        active={active}
        preferredAlignment="left"
        fullWidth
        activator={
          <TextField
            label={label}
            placeholder="Search tags"
            value={query}
            onChange={onQueryChange}
            onFocus={onFocus}
            autoComplete="off"
          />
        }
        onClose={onClose}
      >
        <Box padding="300">
          <BlockStack gap="300">
            <Text as="p" fontWeight="semibold">
              Suggestions
            </Text>

            {error ? <Banner tone="critical">{error}</Banner> : null}

            {loading ? (
              <InlineStack gap="200" blockAlign="center">
                <Spinner accessibilityLabel="Loading tags" size="small" />
                <Text as="span" tone="subdued">
                  Loading tags...
                </Text>
              </InlineStack>
            ) : null}

            {!loading && !suggestions.length ? (
              <Text as="p" tone="subdued">
                No tags found.
              </Text>
            ) : null}

            {suggestions.length ? (
              <Scrollable style={{ maxHeight: 260 }}>
                <BlockStack gap="250">
                  {suggestions.map((tag) => (
                    <Checkbox
                      key={tag.id}
                      label={tag.title}
                      checked={selectedIds.has(tag.id)}
                      onChange={() => onToggleTag(tag)}
                    />
                  ))}
                </BlockStack>
              </Scrollable>
            ) : null}
          </BlockStack>
        </Box>
      </Popover>

      {selectedTags.length ? (
        <InlineStack gap="200" wrap>
          {selectedTags.map((tag) => (
            <Tag key={tag.id} onRemove={() => onToggleTag(tag)}>
              {tag.title}
            </Tag>
          ))}
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}

function ConditionPicker({
  value,
  selectedCollections,
  selectedProducts,
  selectedVariants,
  selectedTags,
  onOpenPicker,
  onRemoveCollection,
  onRemoveProduct,
  onRemoveVariant,
  onRemoveTag,
}) {
  if (value === "selected_collections") {
    return (
      <BlockStack gap="300">
        <InlineStack gap="10px" blockAlign="center">
          <Text as="p" fontWeight="semibold">
            Collections
          </Text>
          <Button onClick={() => onOpenPicker("collection")}>Browse</Button>
        </InlineStack>
        <SelectedList
          items={selectedCollections}
          onRemove={onRemoveCollection}
          emptyText="No collections selected yet."
        />
      </BlockStack>
    );
  }

  if (value === "selected_products") {
    return (
      <BlockStack gap="300">
        <InlineStack gap="10px" blockAlign="center">
          <Text as="p" fontWeight="semibold">
            Products
          </Text>
          <Button onClick={() => onOpenPicker("product")}>Browse</Button>
        </InlineStack>
        <SelectedList
          items={selectedProducts}
          onRemove={onRemoveProduct}
          emptyText="No products selected yet."
        />
      </BlockStack>
    );
  }

  if (value === "selected_products_with_variants") {
    return (
      <BlockStack gap="300">
        <InlineStack gap="10px" blockAlign="center">
          <Text as="p" fontWeight="semibold">
            Product variants
          </Text>
          <Button onClick={() => onOpenPicker("variant")}>Browse</Button>
        </InlineStack>
        <SelectedList
          items={selectedVariants}
          onRemove={onRemoveVariant}
          emptyText="No product variants selected yet."
        />
      </BlockStack>
    );
  }

  if (value === "selected_tags") {
    return (
      <BlockStack gap="300">
        <InlineStack gap="10px" blockAlign="center">
          <Text as="p" fontWeight="semibold">
            Tags
          </Text>
          <Button onClick={() => onOpenPicker("tag")}>Browse tags</Button>
        </InlineStack>

        <InlineStack gap="200" wrap>
          {selectedTags.length ? (
            selectedTags.map((tag) => (
              <Tag key={tag.id} onRemove={() => onRemoveTag(tag.id)}>
                {tag.title}
              </Tag>
            ))
          ) : (
            <Text as="p" tone="subdued">
              No tags selected yet.
            </Text>
          )}
        </InlineStack>
      </BlockStack>
    );
  }

  return null;
}

function SaleRoundingFields({
  prefix,
  rounding,
  cents,
  nearest,
  endingDigits,
  onRoundingChange,
  onCentsChange,
  onNearestChange,
  onEndingDigitsChange,
}) {
  const updateEndingDigit = (index, value) => {
    const nextValue = value.slice(-1);

    onEndingDigitsChange(
      endingDigits.map((digit, digitIndex) =>
        digitIndex === index ? nextValue : digit,
      ),
    );
  };

  const addEndingDigit = () => {
    onEndingDigitsChange([...endingDigits, "9"]);
  };

  const removeEndingDigit = () => {
    if (endingDigits.length > 1) {
      onEndingDigitsChange(endingDigits.slice(0, endingDigits.length - 1));
    }
  };

  return (
    <BlockStack gap="300">
      <Select
        label="Rounding"
        name={`${prefix}_rounding_mode`}
        options={roundingOptions}
        value={rounding}
        onChange={onRoundingChange}
      />

      {(rounding === "override_cents" || rounding === "set_ending") && (
        <Checkbox
          label="To nearest value"
          name={`${prefix}_override_to_nearest`}
          checked={nearest}
          onChange={onNearestChange}
        />
      )}

      {rounding === "override_cents" && (
        <InlineStack gap="600" blockAlign="center" wrap>
          <Box width="160px">
            <TextField
              label="Cents value"
              labelHidden
              name={`${prefix}_override_cents_value`}
              prefix="0."
              type="number"
              min={0}
              max={99}
              value={cents}
              onChange={onCentsChange}
              autoComplete="off"
            />
          </Box>

          <Text as="p" tone="subdued">
            E.g. 10.25 &gt; 10.{String(cents || "00").padStart(2, "0").slice(0, 2)}
          </Text>
        </InlineStack>
      )}

      {rounding === "set_ending" && (
        <BlockStack gap="250">
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            {endingDigits.map((digit, index) =>
              digit === "." ? (
                <Text key={`${prefix}-ending-${index}`} as="span">
                  .
                </Text>
              ) : (
                <Box key={`${prefix}-ending-${index}`} width="44px">
                  <TextField
                    label={`Ending digit ${index + 1}`}
                    labelHidden
                    name={`${prefix}_price_ending_digits[]`}
                    value={digit}
                    maxLength={1}
                    onChange={(value) => updateEndingDigit(index, value)}
                    autoComplete="off"
                  />
                </Box>
              ),
            )}
          </InlineStack>

          <InlineStack gap="200">
            <Button variant="plain" onClick={addEndingDigit}>
              Add digit
            </Button>
            <Text as="span" tone="subdued">
              |
            </Text>
            <Button variant="plain" onClick={removeEndingDigit}>
              Remove digit
            </Button>
          </InlineStack>

          <input
            type="hidden"
            name={`${prefix}_price_ending_pattern`}
            value={endingDigits.join("")}
          />

          <Text as="p" tone="subdued">
            E.g. 10.25 &gt; 10.99
          </Text>
        </BlockStack>
      )}
    </BlockStack>
  );
}

function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getLocalTimeInputValue(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export default function NewSalePage() {
  const {
    markets = [],
    marketsError = "",
    shopCurrency = "USD",
    sale = null,
  } = useLoaderData();
  const resourceFetcher = useFetcher();
  const removeTagFetcher = useFetcher();
  const submit = useSubmit();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const now = useMemo(() => new Date(), []);
  const defaultEndAt = useMemo(() => addHours(now, 1), [now]);
  const today = getLocalDateInputValue(now);
  const initialPayload = sale?.configuration || {};
  const initialForm = initialPayload.form || {};
  const marketOptions = useMemo(
    () => markets.map((market) => ({ label: market.label, value: market.id })),
    [markets],
  );

  const [form, setForm] = useState({
    title: initialForm.title || sale?.title || "",
    changeType: initialForm.changeType || sale?.changeType || "products",
    applyToFixedPrices: Boolean(
      initialForm.applyToFixedPrices ?? sale?.applyToFixedPrices,
    ),
    markets:
      initialForm.markets ||
      sale?.markets?.map((market) => market.id).filter(Boolean) ||
      [],

    priceAction: initialForm.priceAction || "decrease",
    priceChangeType: initialForm.priceChangeType || "by_percent",
    pricePercent: initialForm.pricePercent || "",
    priceAmount: initialForm.priceAmount || "",
    priceRounding: initialForm.priceRounding || "none",
    priceCents: initialForm.priceCents || "99",
    priceOverrideToNearest: Boolean(initialForm.priceOverrideToNearest),
    priceEndingDigits: initialForm.priceEndingDigits || ["*", ".", "9", "9"],

    compareAction: initialForm.compareAction ?? "set_to_price",
    compareChangeType: initialForm.compareChangeType || "by_percent",
    comparePercent: initialForm.comparePercent || "",
    compareAmount: initialForm.compareAmount || "",
    compareRounding: initialForm.compareRounding || "none",
    compareCents: initialForm.compareCents || "99",
    compareOverrideToNearest: Boolean(initialForm.compareOverrideToNearest),
    compareEndingDigits: initialForm.compareEndingDigits || ["*", ".", "9", "9"],

    applyCondition: initialForm.applyCondition || sale?.applyScope || "whole_store",
    excludeCondition:
      initialForm.excludeCondition || sale?.excludeScope || "nothing",
    excludeDiscounted:
      initialForm.excludeDiscounted || sale?.discountedScope || "nothing",

    startDate: initialForm.startDate || sale?.schedule?.startDate || today,
    startTime:
      initialForm.startTime ||
      sale?.schedule?.startTime ||
      getLocalTimeInputValue(now),
    setEndDate: Boolean(initialForm.setEndDate ?? sale?.schedule?.setEndDate),
    endDate:
      initialForm.endDate ||
      sale?.schedule?.endDate ||
      getLocalDateInputValue(defaultEndAt),
    endTime:
      initialForm.endTime ||
      sale?.schedule?.endTime ||
      getLocalTimeInputValue(defaultEndAt),

    addTagsEnabled: Boolean(initialForm.addTagsEnabled ?? sale?.addTagsEnabled),
    removeTagsEnabled: Boolean(
      initialForm.removeTagsEnabled ?? sale?.removeTagsEnabled,
    ),
    trackConditionChanges: Boolean(
      initialForm.trackConditionChanges ?? sale?.trackConditionChanges,
    ),
    autoReapplyChanges: Boolean(
      initialForm.autoReapplyChanges ?? sale?.autoReapplyChanges,
    ),
  });
  const selectedMarketDetails = useMemo(
    () => markets.filter((market) => form.markets.includes(market.id)),
    [markets, form.markets],
  );

  const [applyCollections, setApplyCollections] = useState(
    initialPayload.applyCollections || sale?.applyResources?.collections || [],
  );
  const [applyProducts, setApplyProducts] = useState(
    initialPayload.applyProducts || sale?.applyResources?.products || [],
  );
  const [applyVariants, setApplyVariants] = useState(
    initialPayload.applyVariants || sale?.applyResources?.variants || [],
  );
  const [applyTags, setApplyTags] = useState(
    initialPayload.applyTags || sale?.applyResources?.tags || [],
  );

  const [excludeCollections, setExcludeCollections] = useState(
    initialPayload.excludeCollections || sale?.excludeResources?.collections || [],
  );
  const [excludeProducts, setExcludeProducts] = useState(
    initialPayload.excludeProducts || sale?.excludeResources?.products || [],
  );
  const [excludeVariants, setExcludeVariants] = useState(
    initialPayload.excludeVariants || sale?.excludeResources?.variants || [],
  );
  const [excludeTags, setExcludeTags] = useState(
    initialPayload.excludeTags || sale?.excludeResources?.tags || [],
  );

  const [tagsToAdd, setTagsToAdd] = useState(
    initialPayload.tagsToAdd || sale?.tagRules?.add || [{ id: "t1", title: "sale-active" }],
  );
  const [tagsToRemove, setTagsToRemove] = useState(
    initialPayload.tagsToRemove || sale?.tagRules?.remove || [],
  );

  const [picker, setPicker] = useState({
    active: false,
    mode: null,
    type: null,
  });
  const [resourceItems, setResourceItems] = useState([]);
  const [pageInfo, setPageInfo] = useState({
    hasNextPage: false,
    endCursor: null,
  });
  const [resourceError, setResourceError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [removeTagQuery, setRemoveTagQuery] = useState("");
  const [removeTagSuggestionsOpen, setRemoveTagSuggestionsOpen] = useState(false);
  const [removeTagItems, setRemoveTagItems] = useState([]);
  const [removeTagError, setRemoveTagError] = useState("");
  const requestIdRef = useRef(0);
  const latestRequestIdRef = useRef("");
  const removeTagRequestIdRef = useRef(0);
  const latestRemoveTagRequestIdRef = useRef("");

  useEffect(() => {
    const marketIds = new Set(markets.map((market) => market.id));
    setForm((current) => ({
      ...current,
      markets: current.markets.filter((marketId) => marketIds.has(marketId)),
    }));
  }, [markets]);

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const addUniqueItems = (currentItems, newItems) => {
    const ids = new Set(currentItems.map((item) => item.id));
    return [
      ...currentItems,
      ...newItems.filter((item) => {
        if (ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
      }),
    ];
  };

  const buildResourceUrl = (type, query = "", after = "") => {
    requestIdRef.current += 1;
    latestRequestIdRef.current = String(requestIdRef.current);

    const params = new URLSearchParams({
      type,
      requestId: latestRequestIdRef.current,
    });

    if (query) params.set("query", query);
    if (after) params.set("after", after);

    return `/app/resource-picker?${params.toString()}`;
  };

  const openPicker = (mode, type, query = "") => {
    setPicker({ active: true, mode, type });
    setSearchQuery(query);
    setResourceItems([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setResourceError("");
    setIsLoadingMore(false);
    resourceFetcher.load(buildResourceUrl(type, query));
  };

  const closePicker = () => {
    setPicker({ active: false, mode: null, type: null });
    setSearchQuery("");
    setResourceItems([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setResourceError("");
    setIsLoadingMore(false);
  };

  const searchResources = (query) => {
    if (!picker.type) return;
    setSearchQuery(query);
    setResourceItems([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setResourceError("");
    setIsLoadingMore(false);
    resourceFetcher.load(buildResourceUrl(picker.type, query));
  };

  const loadNextPage = () => {
    if (
      !picker.type ||
      !pageInfo.hasNextPage ||
      !pageInfo.endCursor ||
      isLoadingMore ||
      resourceFetcher.state !== "idle"
    ) {
      return;
    }

    setIsLoadingMore(true);
    resourceFetcher.load(
      buildResourceUrl(picker.type, searchQuery, pageInfo.endCursor),
    );
  };

  const loadRemoveTagSuggestions = (query = "") => {
    removeTagRequestIdRef.current += 1;
    latestRemoveTagRequestIdRef.current = String(removeTagRequestIdRef.current);
    const params = new URLSearchParams({
      type: "tag",
      requestId: latestRemoveTagRequestIdRef.current,
    });

    if (query) params.set("query", query);

    removeTagFetcher.load(`/app/resource-picker?${params.toString()}`);
  };

  const openRemoveTagSuggestions = () => {
    setRemoveTagSuggestionsOpen(true);
    loadRemoveTagSuggestions(removeTagQuery);
  };

  const changeRemoveTagQuery = (value) => {
    setRemoveTagQuery(value);
    setRemoveTagSuggestionsOpen(true);
    loadRemoveTagSuggestions(value);
  };

  const toggleRemoveTag = (tag) => {
    setTagsToRemove((current) => {
      if (current.some((item) => item.id === tag.id)) {
        return current.filter((item) => item.id !== tag.id);
      }

      return [...current, tag];
    });
  };

  const getPickerTitle = () => {
    if (picker.type === "collection") return "Store Select Collection";
    if (picker.type === "product") return "Store Select Product";
    if (picker.type === "variant") return "Store Product Variant";
    return "Store Product Tags";
  };

  const getSelectedItems = () => {
    if (picker.mode === "apply" && picker.type === "collection") return applyCollections;
    if (picker.mode === "apply" && picker.type === "product") return applyProducts;
    if (picker.mode === "apply" && picker.type === "variant") return applyVariants;
    if (picker.mode === "apply" && picker.type === "tag") return applyTags;

    if (picker.mode === "exclude" && picker.type === "collection") return excludeCollections;
    if (picker.mode === "exclude" && picker.type === "product") return excludeProducts;
    if (picker.mode === "exclude" && picker.type === "variant") return excludeVariants;
    if (picker.mode === "exclude" && picker.type === "tag") return excludeTags;

    if (picker.mode === "add-tags") return tagsToAdd;
    if (picker.mode === "remove-tags") return tagsToRemove;

    return [];
  };

  const addPickerItems = (items) => {
    if (picker.mode === "apply" && picker.type === "collection") {
      setApplyCollections((current) => addUniqueItems(current, items));
    }
    if (picker.mode === "apply" && picker.type === "product") {
      setApplyProducts((current) => addUniqueItems(current, items));
    }
    if (picker.mode === "apply" && picker.type === "variant") {
      setApplyVariants((current) => addUniqueItems(current, items));
    }
    if (picker.mode === "apply" && picker.type === "tag") {
      setApplyTags((current) => addUniqueItems(current, items));
    }

    if (picker.mode === "exclude" && picker.type === "collection") {
      setExcludeCollections((current) => addUniqueItems(current, items));
    }
    if (picker.mode === "exclude" && picker.type === "product") {
      setExcludeProducts((current) => addUniqueItems(current, items));
    }
    if (picker.mode === "exclude" && picker.type === "variant") {
      setExcludeVariants((current) => addUniqueItems(current, items));
    }
    if (picker.mode === "exclude" && picker.type === "tag") {
      setExcludeTags((current) => addUniqueItems(current, items));
    }

    if (picker.mode === "add-tags") {
      setTagsToAdd((current) => addUniqueItems(current, items));
    }
    if (picker.mode === "remove-tags") {
      setTagsToRemove((current) => addUniqueItems(current, items));
    }

    closePicker();
  };

  useEffect(() => {
    if (!resourceFetcher.data) return;

    const responseType = resourceFetcher.data.type;
    const responseQuery = resourceFetcher.data.query || "";
    const responseAfter = resourceFetcher.data.after || "";
    const responseRequestId = resourceFetcher.data.requestId || "";

    if (
      responseRequestId !== latestRequestIdRef.current ||
      responseType !== picker.type ||
      responseQuery !== searchQuery
    ) {
      return;
    }

    const nextItems = resourceFetcher.data.items || [];
    setResourceItems((currentItems) =>
      responseAfter ? addUniqueItems(currentItems, nextItems) : nextItems,
    );
    setPageInfo(
      resourceFetcher.data.pageInfo || { hasNextPage: false, endCursor: null },
    );
    setResourceError(resourceFetcher.data.error || "");
    setIsLoadingMore(false);
  }, [resourceFetcher.data, picker.type, searchQuery]);

  useEffect(() => {
    if (!removeTagFetcher.data) return;
    if (removeTagFetcher.data.requestId !== latestRemoveTagRequestIdRef.current) {
      return;
    }

    setRemoveTagItems(removeTagFetcher.data.items || []);
    setRemoveTagError(removeTagFetcher.data.error || "");
  }, [removeTagFetcher.data]);

  const isInitialResourceLoading =
    resourceFetcher.state !== "idle" && !isLoadingMore && resourceItems.length === 0;
  const isRemoveTagLoading =
    removeTagFetcher.state !== "idle" && removeTagItems.length === 0;

  const canCreate = form.title.trim();
  const handleCreateSale = () => {
    const formData = new FormData();

    if (sale?.id) {
      formData.set("id", String(sale.id));
    }

    formData.set("payload", JSON.stringify({
      form: {
        ...form,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      },
      selectedMarketDetails,
      applyCollections,
      applyProducts,
      applyVariants,
      applyTags,
      excludeCollections,
      excludeProducts,
      excludeVariants,
      excludeTags,
      tagsToAdd,
      tagsToRemove,
    }));

    submit(formData, { method: "post" });
  };

  return (
    <>
      <TitleBar title={sale ? "Edit sale" : "New sale"} />

      <Page
        title={sale ? "Edit sale" : "New sale"}
        backAction={{ content: "Sales", url: BACK_URL }}
        primaryAction={{
          content: isSubmitting
            ? sale
              ? "Updating..."
              : "Creating..."
            : sale
              ? "Update"
              : "Create",
          disabled: !canCreate || isSubmitting,
          loading: isSubmitting,
          onAction: handleCreateSale,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            url: BACK_URL,
          },
        ]}
        narrowWidth
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {actionData?.error ? (
                <Banner tone="critical">{actionData.error}</Banner>
              ) : null}

              <Card>
                <TextField
                  label="Title"
                  placeholder="e.g. Summer Sale 2026"
                  helpText="For internal use only"
                  value={form.title}
                  onChange={setField("title")}
                  autoComplete="off"
                />
              </Card>

              <SectionCard title="Change type">
                <ButtonGroup segmented>
                  <Button
                    pressed={form.changeType === "products"}
                    onClick={() => setField("changeType")("products")}
                  >
                    Product prices
                  </Button>
                  <Button
                    pressed={form.changeType === "markets"}
                    onClick={() => setField("changeType")("markets")}
                  >
                    Market prices
                  </Button>
                </ButtonGroup>

                {form.changeType === "markets" ? (
                  <BlockStack gap="300">
                    <Text as="p" tone="subdued">
                      Run sale on specific Shopify Markets.
                    </Text>

                    <Checkbox
                      label="Apply changes only to fixed prices"
                      checked={form.applyToFixedPrices}
                      onChange={setField("applyToFixedPrices")}
                    />

                    {marketsError ? (
                      <Banner tone="critical">{marketsError}</Banner>
                    ) : null}

                    <ChoiceList
                      title="Markets"
                      allowMultiple
                      choices={marketOptions}
                      selected={form.markets}
                      onChange={setField("markets")}
                    />

                    {selectedMarketDetails.map((market) => (
                      <input
                        key={market.id}
                        type="hidden"
                        name="market_ids[]"
                        value={market.id}
                      />
                    ))}
                  </BlockStack>
                ) : null}
              </SectionCard>

              <SectionCard title="Price">
                <FormLayout>
                  <Select
                    label="Action"
                    options={[
                      { label: "Decrease", value: "decrease" },
                      { label: "Set new price", value: "set_new_value" },
                    ]}
                    value={form.priceAction}
                    onChange={setField("priceAction")}
                  />

                  {form.priceAction === "set_new_value" ? (
                    <TextField
                      label="Amount"
                      placeholder="0.00"
                      suffix={shopCurrency}
                      value={form.priceAmount}
                      onChange={setField("priceAmount")}
                      autoComplete="off"
                    />
                  ) : null}

                  {form.priceAction === "increase" ||
                    form.priceAction === "decrease" ? (
                    <>
                      <Select
                        label="Change type"
                        options={[
                          { label: "By percent", value: "by_percent" },
                          { label: "By amount", value: "by_amount" },
                        ]}
                        value={form.priceChangeType}
                        onChange={setField("priceChangeType")}
                      />

                      {form.priceChangeType === "by_percent" ? (
                        <TextField
                          label="Percent"
                          placeholder="0"
                          suffix="%"
                          value={form.pricePercent}
                          onChange={setField("pricePercent")}
                          autoComplete="off"
                        />
                      ) : (
                        <TextField
                          label="Amount"
                          placeholder="0.00"
                          suffix={shopCurrency}
                          value={form.priceAmount}
                          onChange={setField("priceAmount")}
                          autoComplete="off"
                        />
                      )}

                      <SaleRoundingFields
                        prefix="price"
                        rounding={form.priceRounding}
                        cents={form.priceCents}
                        nearest={form.priceOverrideToNearest}
                        endingDigits={form.priceEndingDigits}
                        onRoundingChange={setField("priceRounding")}
                        onCentsChange={setField("priceCents")}
                        onNearestChange={setField("priceOverrideToNearest")}
                        onEndingDigitsChange={setField("priceEndingDigits")}
                      />
                    </>
                  ) : null}
                </FormLayout>
              </SectionCard>

              <SectionCard title="Compare at price">
                <FormLayout>
                  <Select
                    label="Action"
                    options={[
                      {
                        label: "Don't change compare at price",
                        value: "",
                      },
                      {
                        label: "Set new compare at price",
                        value: "set_new_value",
                      },
                      {
                        label: "Set to old price (discount)",
                        value: "set_to_price",
                      },
                    ]}
                    value={form.compareAction}
                    onChange={setField("compareAction")}
                  />

                  {form.compareAction === "" ? (
                    <SaleRoundingFields
                      prefix="compare_at_price"
                      rounding={form.compareRounding}
                      cents={form.compareCents}
                      nearest={form.compareOverrideToNearest}
                      endingDigits={form.compareEndingDigits}
                      onRoundingChange={setField("compareRounding")}
                      onCentsChange={setField("compareCents")}
                      onNearestChange={setField("compareOverrideToNearest")}
                      onEndingDigitsChange={setField("compareEndingDigits")}
                    />
                  ) : null}

                  {form.compareAction === "set_new_value" ? (
                    <TextField
                      label="Amount"
                      placeholder="0.00"
                      suffix={shopCurrency}
                      value={form.compareAmount}
                      onChange={setField("compareAmount")}
                      autoComplete="off"
                    />
                  ) : null}
                </FormLayout>
              </SectionCard>

              <SectionCard title="Apply to">
                <ChoiceList
                  title="Apply to"
                  titleHidden
                  choices={applyOptions}
                  selected={[form.applyCondition]}
                  onChange={(value) => setField("applyCondition")(value[0])}
                />

                <ConditionPicker
                  value={form.applyCondition}
                  selectedCollections={applyCollections}
                  selectedProducts={applyProducts}
                  selectedVariants={applyVariants}
                  selectedTags={applyTags}
                  onOpenPicker={(type) => openPicker("apply", type)}
                  onRemoveCollection={(id) =>
                    setApplyCollections((items) => items.filter((item) => item.id !== id))
                  }
                  onRemoveProduct={(id) =>
                    setApplyProducts((items) => items.filter((item) => item.id !== id))
                  }
                  onRemoveVariant={(id) =>
                    setApplyVariants((items) => items.filter((item) => item.id !== id))
                  }
                  onRemoveTag={(id) =>
                    setApplyTags((items) => items.filter((item) => item.id !== id))
                  }
                />
              </SectionCard>

              <SectionCard title="Exclude">
                <ChoiceList
                  title="Exclude"
                  titleHidden
                  choices={excludeOptions}
                  selected={[form.excludeCondition]}
                  onChange={(value) => setField("excludeCondition")(value[0])}
                />

                <ConditionPicker
                  value={form.excludeCondition}
                  selectedCollections={excludeCollections}
                  selectedProducts={excludeProducts}
                  selectedVariants={excludeVariants}
                  selectedTags={excludeTags}
                  onOpenPicker={(type) => openPicker("exclude", type)}
                  onRemoveCollection={(id) =>
                    setExcludeCollections((items) =>
                      items.filter((item) => item.id !== id)
                    )
                  }
                  onRemoveProduct={(id) =>
                    setExcludeProducts((items) => items.filter((item) => item.id !== id))
                  }
                  onRemoveVariant={(id) =>
                    setExcludeVariants((items) => items.filter((item) => item.id !== id))
                  }
                  onRemoveTag={(id) =>
                    setExcludeTags((items) => items.filter((item) => item.id !== id))
                  }
                />
              </SectionCard>

              <SectionCard title="Exclude discounted">
                <ChoiceList
                  title="Exclude discounted"
                  titleHidden
                  choices={excludeDiscountedOptions}
                  selected={[form.excludeDiscounted]}
                  onChange={(value) => setField("excludeDiscounted")(value[0])}
                />
              </SectionCard>

              <SectionCard title="Schedule">
                <FormLayout>
                  <InlineGrid
                    columns={{
                      xs: "1fr",
                      sm: "1fr 1fr",
                    }}
                    gap="400"
                  >
                    <TextField
                      label="Start date"
                      type="date"
                      value={form.startDate}
                      onChange={setField("startDate")}
                      autoComplete="off"
                    />

                    <TextField
                      label="Start time (GMT-4)"
                      type="time"
                      value={form.startTime}
                      onChange={setField("startTime")}
                      autoComplete="off"
                    />
                  </InlineGrid>

                  <Checkbox
                    label="Set end date"
                    checked={form.setEndDate}
                    onChange={setField("setEndDate")}
                  />

                  {form.setEndDate && (
                    <InlineGrid
                      columns={{
                        xs: "1fr",
                        sm: "1fr 1fr",
                      }}
                      gap="400"
                    >
                      <TextField
                        label="End date"
                        type="date"
                        value={form.endDate}
                        onChange={setField("endDate")}
                        autoComplete="off"
                      />

                      <TextField
                        label="End time (GMT-4)"
                        type="time"
                        value={form.endTime}
                        onChange={setField("endTime")}
                        autoComplete="off"
                      />
                    </InlineGrid>
                  )}
                </FormLayout>
              </SectionCard>


              <SectionCard title="Advanced" style={{ marginBottom: "1rem" }}>
                <BlockStack gap="400">
                  <Checkbox
                    label="Add tags while sale is active"
                    checked={form.addTagsEnabled}
                    onChange={setField("addTagsEnabled")}
                  />

                  {form.addTagsEnabled ? (
                    <BlockStack gap="300">
                      <InlineStack gap="10px" blockAlign="center">
                        <Text as="p" fontWeight="semibold">
                          Tags to add
                        </Text>
                        <Button onClick={() => openPicker("add-tags", "tag")}>
                          Browse tags
                        </Button>
                      </InlineStack>

                      <InlineStack gap="200" wrap>
                        {tagsToAdd.map((tag) => (
                          <Tag
                            key={tag.id}
                            onRemove={() =>
                              setTagsToAdd((items) =>
                                items.filter((item) => item.id !== tag.id)
                              )
                            }
                          >
                            {tag.title}
                          </Tag>
                        ))}
                      </InlineStack>

                      <Text as="p" tone="subdued" variant="bodySm">
                        Tags will be added when the sale is activated and removed
                        upon completion.
                      </Text>
                    </BlockStack>
                  ) : null}

                  <Divider />

                  <Checkbox
                    label="Remove tags while sale is active"
                    checked={form.removeTagsEnabled}
                    onChange={setField("removeTagsEnabled")}
                  />

                  {form.removeTagsEnabled ? (
                    <BlockStack gap="300">
                      <InlineTagSearch
                        label="Tags to remove"
                        selectedTags={tagsToRemove}
                        suggestions={removeTagItems}
                        query={removeTagQuery}
                        active={removeTagSuggestionsOpen}
                        loading={isRemoveTagLoading}
                        error={removeTagError}
                        onQueryChange={changeRemoveTagQuery}
                        onFocus={openRemoveTagSuggestions}
                        onClose={() => setRemoveTagSuggestionsOpen(false)}
                        onToggleTag={toggleRemoveTag}
                      />

                      <Text as="p" tone="subdued" variant="bodySm">
                        Tags will be removed when the sale is activated and restored
                        upon completion.
                      </Text>
                    </BlockStack>
                  ) : null}

                  <Divider />

                  <Checkbox
                    label="Track changes in condition automatically (every hour)"
                    helpText="New matching products will be added, non matching products will be excluded"
                    checked={form.trackConditionChanges}
                    onChange={setField("trackConditionChanges")}
                  />

                  <Checkbox
                    label="Automatically re-apply price changes (every hour)"
                    helpText="Prevents third-party apps from overriding prices for active sale. Works for sales with up to 10,000 price changes."
                    checked={form.autoReapplyChanges}
                    onChange={setField("autoReapplyChanges")}
                  />

                </BlockStack>
              </SectionCard>

            </BlockStack>
          </Layout.Section>
        </Layout>

        <PickerModal
          active={picker.active}
          resourceType={picker.type || "product"}
          title={getPickerTitle()}
          items={resourceItems}
          pageInfo={pageInfo}
          loading={isInitialResourceLoading}
          loadingMore={isLoadingMore}
          error={resourceError}
          selectedItems={getSelectedItems()}
          onClose={closePicker}
          onAdd={addPickerItems}
          onSearch={searchResources}
          onLoadNext={loadNextPage}
        />
      </Page>
    </>
  );
}
