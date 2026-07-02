// app/routes/app.sales.new.jsx
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

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

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(MARKETS_QUERY);
    const payload = await response.json();

    if (payload.errors) {
      return json({
        markets: [],
        marketsError: "Unable to load Shopify Markets.",
        shopCurrency: "USD",
      });
    }

    return json({
      markets: normalizeMarkets(payload.data?.markets?.nodes),
      marketsError: "",
      shopCurrency: payload.data?.shop?.currencyCode || "USD",
    });
  } catch {
    return json({
      markets: [],
      marketsError: "Unable to load Shopify Markets.",
      shopCurrency: "USD",
    });
  }
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
        <InlineStack align="space-between" blockAlign="center">
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
        <InlineStack align="space-between" blockAlign="center">
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
        <InlineStack align="space-between" blockAlign="center">
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
        <InlineStack align="space-between" blockAlign="center">
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
  onRoundingChange,
  onCentsChange,
}) {
  const [nearest, setNearest] = useState(false);
  const [endingDigits, setEndingDigits] = useState(["*", ".", "9", "9"]);

  const updateEndingDigit = (index, value) => {
    const nextValue = value.slice(-1);

    setEndingDigits((current) =>
      current.map((digit, digitIndex) =>
        digitIndex === index ? nextValue : digit,
      ),
    );
  };

  const addEndingDigit = () => {
    setEndingDigits((current) => [...current, "9"]);
  };

  const removeEndingDigit = () => {
    setEndingDigits((current) =>
      current.length > 1 ? current.slice(0, current.length - 1) : current,
    );
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
          onChange={setNearest}
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

export default function NewSalePage() {
  const {
    markets = [],
    marketsError = "",
    shopCurrency = "USD",
  } = useLoaderData();
  const resourceFetcher = useFetcher();
  const today = new Date().toISOString().slice(0, 10);
  const marketOptions = useMemo(
    () => markets.map((market) => ({ label: market.label, value: market.id })),
    [markets],
  );

  const [form, setForm] = useState({
    title: "",
    changeType: "products",
    applyToFixedPrices: false,
    markets: [],

    priceAction: "decrease",
    priceChangeType: "by_percent",
    pricePercent: "",
    priceAmount: "",
    priceRounding: "none",
    priceCents: "99",

    compareAction: "set_to_price",
    compareChangeType: "by_percent",
    comparePercent: "",
    compareAmount: "",
    compareRounding: "none",
    compareCents: "99",

    applyCondition: "whole_store",
    excludeCondition: "nothing",
    excludeDiscounted: "nothing",

    startDate: today,
    startTime: "09:00",
    setEndDate: false,
    endDate: today,
    endTime: "18:00",

    addTagsEnabled: false,
    removeTagsEnabled: false,
    trackConditionChanges: false,
    autoReapplyChanges: false,
  });
  const selectedMarketDetails = useMemo(
    () => markets.filter((market) => form.markets.includes(market.id)),
    [markets, form.markets],
  );

  const [applyCollections, setApplyCollections] = useState([]);
  const [applyProducts, setApplyProducts] = useState([]);
  const [applyVariants, setApplyVariants] = useState([]);
  const [applyTags, setApplyTags] = useState([]);

  const [excludeCollections, setExcludeCollections] = useState([]);
  const [excludeProducts, setExcludeProducts] = useState([]);
  const [excludeVariants, setExcludeVariants] = useState([]);
  const [excludeTags, setExcludeTags] = useState([]);

  const [tagsToAdd, setTagsToAdd] = useState([{ id: "t1", title: "sale-active" }]);
  const [tagsToRemove, setTagsToRemove] = useState([]);

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
  const requestIdRef = useRef(0);
  const latestRequestIdRef = useRef("");

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

  const isInitialResourceLoading =
    resourceFetcher.state !== "idle" && !isLoadingMore && resourceItems.length === 0;

  const canCreate = form.title.trim();
  const handleCreateSale = () => {
    console.log("Sale payload:", {
      form,
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
    });
  };

  return (
    <>
      <TitleBar title="New sale" />

      <Page
        title="New sale"
        backAction={{ content: "Sales", url: BACK_URL }}
        primaryAction={{
          content: "Create",
          disabled: !canCreate,
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

                  {form.priceAction === "decrease" ? (
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
                        onRoundingChange={setField("priceRounding")}
                        onCentsChange={setField("priceCents")}
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
                      onRoundingChange={setField("compareRounding")}
                      onCentsChange={setField("compareCents")}
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
                  <FormLayout.Group>
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
                      helpText="Your local time will depend on your store timezone."
                      autoComplete="off"
                    />
                  </FormLayout.Group>

                  <Checkbox
                    label="Set end date"
                    checked={form.setEndDate}
                    onChange={setField("setEndDate")}
                  />

                  {form.setEndDate ? (
                    <FormLayout.Group>
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
                    </FormLayout.Group>
                  ) : null}
                </FormLayout>
              </SectionCard>

              <SectionCard title="Advanced">
                <BlockStack gap="400">
                  <Checkbox
                    label="Add tags while sale is active"
                    checked={form.addTagsEnabled}
                    onChange={setField("addTagsEnabled")}
                  />

                  {form.addTagsEnabled ? (
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
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
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" fontWeight="semibold">
                          Tags to remove
                        </Text>
                        <Button onClick={() => openPicker("remove-tags", "tag")}>
                          Browse tags
                        </Button>
                      </InlineStack>

                      <InlineStack gap="200" wrap>
                        {tagsToRemove.length ? (
                          tagsToRemove.map((tag) => (
                            <Tag
                              key={tag.id}
                              onRemove={() =>
                                setTagsToRemove((items) =>
                                  items.filter((item) => item.id !== tag.id)
                                )
                              }
                            >
                              {tag.title}
                            </Tag>
                          ))
                        ) : (
                          <Text as="p" tone="subdued">
                            No remove tags selected.
                          </Text>
                        )}
                      </InlineStack>

                      <Text as="p" tone="subdued" variant="bodySm">
                        Tags will be removed when the sale is activated and restored
                        upon completion.
                      </Text>
                    </BlockStack>
                  ) : null}

                  <Divider />

                  <Checkbox
                    label="Track changes in condition automatically (every hour)"
                    helpText="New matching products will be added, non matching products will be excluded."
                    checked={form.trackConditionChanges}
                    onChange={setField("trackConditionChanges")}
                  />

                  <Checkbox
                    label="Automatically re-apply price changes (every hour)"
                    helpText="Prevents third-party apps from overriding prices for active sale."
                    checked={form.autoReapplyChanges}
                    onChange={setField("autoReapplyChanges")}
                  />
                </BlockStack>
              </SectionCard>

              {!canCreate ? (
                <Banner tone="info">
                  Add a sale title and discount percent to enable the create button.
                </Banner>
              ) : null}

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
