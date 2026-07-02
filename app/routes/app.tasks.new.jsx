// app/routes/app.tasks.new.jsx
import { json, redirect } from "@remix-run/node";
import { Form, useFetcher, useNavigation } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  ButtonGroup,
  Select,
  TextField,
  FormLayout,
  ChoiceList,
  Checkbox,
  BlockStack,
  InlineStack,
  Box,
  Banner,
  Divider,
  Modal,
  Tag,
  Badge,
  Spinner,
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return json({});
}

export async function action({ request }) {
  await authenticate.admin(request);

  // Later save this data in DB.
  // Example:
  // const formData = await request.formData();
  // const selectedCollections = formData.getAll("apply_collection_ids[]");
  // const selectedProducts = formData.getAll("apply_product_ids[]");
  // const selectedVariants = formData.getAll("apply_variant_ids[]");

  return redirect("/app");
}

/* -------------------- Form options -------------------- */

const priceActionOptions = [
  { label: "Do not change price", value: "" },
  { label: "Increase price", value: "increase" },
  { label: "Decrease price", value: "decrease" },
  { label: "Set new price", value: "set_new_value" },
  { label: "Set to compare at price", value: "set_to_compare_at_price" },
  { label: "Set margin", value: "set_margin" },
];

const compareAtActionOptions = [
  { label: "Do not change compare at price", value: "" },
  { label: "Increase compare at price", value: "increase" },
  { label: "Decrease compare at price", value: "decrease" },
  { label: "Set new compare on price", value: "set_new_value" },
  { label: "Set to price", value: "set_to_price" },
  { label: "Reset compare at price", value: "reset_compare_at_price" },
];

const costActionOptions = [
  { label: "Do not change cost per item", value: "" },
  { label: "Increase cost per item", value: "increase" },
  { label: "Decrease cost per item", value: "decrease" },
  { label: "Set new cost per item", value: "set_new_value" },
  { label: "Reset cost per item", value: "reset_cost_per_item" },
];

const changeTypeOptions = [
  { label: "By percent", value: "by_percent" },
  { label: "By amount", value: "by_amount" },
];

const priceRelativeOptions = [
  { label: "Not selected", value: "" },
  { label: "Cost per item", value: "cost_per_item" },
];

const compareRelativeOptions = [
  { label: "Not selected", value: "" },
  { label: "Actual price", value: "actual_price" },
  { label: "Cost per item", value: "cost_per_item" },
];

const roundingOptions = [
  { label: "No rounding", value: "none" },
  { label: "Round to whole number", value: "round_to_whole" },
  { label: "Override cents", value: "override_cents" },
  { label: "Set price ending", value: "set_ending" },
];

const applyToChoices = [
  { label: "Whole store", value: "whole_store" },
  { label: "Selected collections", value: "selected_collections" },
  { label: "Selected products", value: "selected_products" },
  {
    label: "Selected products with variants",
    value: "selected_products_with_variants",
  },
  { label: "All store products not on sale", value: "products_on_sale" },
  { label: "Selected tags", value: "selected_tags" },
];

const excludeChoices = [
  { label: "Nothing", value: "nothing" },
  { label: "Selected collections", value: "selected_collections" },
  { label: "Selected products", value: "selected_products" },
  {
    label: "Selected products with variants",
    value: "selected_products_with_variants",
  },
  { label: "Selected tags", value: "selected_tags" },
];

const excludeDiscountedChoices = [
  { label: "Nothing", value: "nothing" },
  { label: "All products on sale", value: "products_on_sale" },
  { label: "All product types on sale", value: "product_types_on_sale" },
];

/* -------------------- Small UI helpers -------------------- */

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

function SelectedResourceTags({ items, onRemove, emptyText }) {
  if (!items.length) {
    return (
      <Text as="p" tone="subdued" variant="bodySm">
        {emptyText}
      </Text>
    );
  }

  return (
    <InlineStack gap="150" wrap>
      {items.map((item) => (
        <Tag key={item.id} onRemove={() => onRemove(item.id)}>
          {item.productTitle ? `${item.productTitle} - ${item.title}` : item.title}
        </Tag>
      ))}
    </InlineStack>
  );
}

function ConditionScopeInputs({ sectionPrefix, selectedCondition }) {
  if (sectionPrefix === "apply" && selectedCondition === "whole_store") {
    return <input type="hidden" name="apply_scope" value="all_products_in_store" />;
  }

  if (sectionPrefix === "apply" && selectedCondition === "products_on_sale") {
    return (
      <input
        type="hidden"
        name="apply_sale_filter"
        value="all_store_products_not_on_sale"
      />
    );
  }

  if (sectionPrefix === "exclude" && selectedCondition === "nothing") {
    return <input type="hidden" name="exclude_scope" value="none" />;
  }

  return null;
}

function DiscountedExclusionInputs({ selected }) {
  const selectedValue = selected?.[0] || "nothing";

  if (selectedValue === "nothing") {
    return <input type="hidden" name="discounted_exclusion_scope" value="none" />;
  }

  if (selectedValue === "products_on_sale") {
    return (
      <input
        type="hidden"
        name="discounted_exclusion_scope"
        value="all_products_on_sale"
      />
    );
  }

  if (selectedValue === "product_types_on_sale") {
    return (
      <input
        type="hidden"
        name="discounted_exclusion_scope"
        value="all_product_types_on_sale"
      />
    );
  }

  return null;
}

/* -------------------- Polaris popup modal -------------------- */

function ResourcePickerModal({
  active,
  resourceType,
  title,
  searchPlaceholder,
  initialQuery = "",
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
    setQuery(initialQuery);
    setTempSelectedIds([]);
    autoLoadLockRef.current = false;
  }, [active, resourceType, initialQuery]);

  useEffect(() => {
    if (!loadingMore) {
      autoLoadLockRef.current = false;
    }
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

  const modalTitle =
    title ||
    (resourceType === "collection"
      ? "Add collections"
      : resourceType === "variant"
        ? "Add product variants"
        : resourceType === "tag"
          ? "Add product tags"
          : "Add products");

  const resourceLabel =
    resourceType === "collection"
      ? "collections"
      : resourceType === "variant"
        ? "variants"
        : resourceType === "tag"
          ? "tags"
          : "products";

  const leftHeader =
    resourceType === "tag" ? "Product tag" : "Item";

  const rightHeader =
    resourceType === "collection"
      ? "Products"
      : resourceType === "variant"
        ? "Price"
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

  const handleClose = () => {
    setQuery("");
    setTempSelectedIds([]);
    onClose();
  };

  const handleAdd = () => {
    const selected = items.filter((item) => tempSelectedIds.includes(item.id));
    onAdd(selected);
    setQuery("");
    setTempSelectedIds([]);
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    onSearch(value);
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
    <Modal
      open={active}
      onClose={handleClose}
      title={modalTitle}
      large
    >
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
              height: "min(680px, calc(100vh - 170px))",
              minHeight: 520,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flexShrink: 0 }}>
              <Box paddingBlockEnd="300">
                <TextField
                  label={searchPlaceholder}
                  labelHidden
                  placeholder={searchPlaceholder}
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
                  {leftHeader}
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

            <div style={{ flexShrink: 0 }}>
              <Box
                paddingBlockStart="400"
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

/* -------------------- Resource picker field -------------------- */

function ResourcePickerField({
  sectionPrefix,
  selectedCondition,
  selectedCollections,
  setSelectedCollections,
  selectedProducts,
  setSelectedProducts,
  selectedVariants,
  setSelectedVariants,
  selectedTags,
  setSelectedTags,
}) {
  const [activePicker, setActivePicker] = useState(null);
  const [resourceItems, setResourceItems] = useState([]);
  const [pageInfo, setPageInfo] = useState({
    hasNextPage: false,
    endCursor: null,
  });
  const [resourceError, setResourceError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [fieldQueries, setFieldQueries] = useState({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestIdRef = useRef(0);
  const latestRequestIdRef = useRef("");
  const fetcher = useFetcher();

  const collectionMode = selectedCondition === "selected_collections";
  const productMode = selectedCondition === "selected_products";
  const variantMode = selectedCondition === "selected_products_with_variants";
  const tagMode = selectedCondition === "selected_tags";

  const removeCollection = (id) => {
    setSelectedCollections((items) => items.filter((item) => item.id !== id));
  };

  const removeProduct = (id) => {
    setSelectedProducts((items) => items.filter((item) => item.id !== id));
  };

  const removeVariant = (id) => {
    setSelectedVariants((items) => items.filter((item) => item.id !== id));
  };

  const removeTag = (id) => {
    setSelectedTags((items) => items.filter((item) => item.id !== id));
  };

  const addUniqueItems = (currentItems, newItems) => {
    const existingIds = new Set(currentItems.map((item) => item.id));
    return [
      ...currentItems,
      ...newItems.filter((item) => !existingIds.has(item.id)),
    ];
  };

  const buildResourceUrl = (type, query = "", after = "") => {
    requestIdRef.current += 1;
    latestRequestIdRef.current = String(requestIdRef.current);
    const params = new URLSearchParams({
      type,
      requestId: latestRequestIdRef.current,
    });

    if (query.trim()) params.set("query", query.trim());
    if (after) params.set("after", after);

    return `/app/resource-picker?${params.toString()}`;
  };

  const openPicker = (type, query = "") => {
    setActivePicker(type);
    setResourceItems([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setResourceError("");
    setSearchQuery(query);
    setIsLoadingMore(false);
    fetcher.load(buildResourceUrl(type, query));
  };

  const openPickerFromSearch = (type, query) => {
    setFieldQueries((current) => ({ ...current, [type]: query }));
    openPicker(type, query);
  };

  const getPickerTitle = (type) => {
    if (type === "collection") return "Store Select Collection";
    if (type === "variant") return "Store Product Variant";
    if (type === "tag") return "Store Product Tags";
    return "Store Select Product";
  };

  const searchResources = (query) => {
    if (!activePicker) return;

    setResourceItems([]);
    setPageInfo({ hasNextPage: false, endCursor: null });
    setResourceError("");
    setSearchQuery(query);
    setIsLoadingMore(false);
    fetcher.load(buildResourceUrl(activePicker, query));
  };

  const loadNextPage = () => {
    if (
      !activePicker ||
      !pageInfo.hasNextPage ||
      !pageInfo.endCursor ||
      isLoadingMore ||
      fetcher.state !== "idle"
    ) {
      return;
    }

    setResourceError("");
    setIsLoadingMore(true);
    fetcher.load(buildResourceUrl(activePicker, searchQuery, pageInfo.endCursor));
  };

  useEffect(() => {
    if (!fetcher.data) return;

    const nextItems = fetcher.data.items || [];
    const responseType = fetcher.data.type || "";
    const responseQuery = fetcher.data.query || "";
    const responseAfter = fetcher.data.after || "";
    const responseRequestId = fetcher.data.requestId || "";

    if (
      responseRequestId !== latestRequestIdRef.current ||
      responseType !== activePicker ||
      responseQuery !== searchQuery.trim()
    ) {
      return;
    }

    setResourceError(fetcher.data.error || "");
    setPageInfo(
      fetcher.data.pageInfo || { hasNextPage: false, endCursor: null },
    );
    setResourceItems((currentItems) =>
      responseAfter ? addUniqueItems(currentItems, nextItems) : nextItems,
    );
    setIsLoadingMore(false);
  }, [activePicker, fetcher.data, searchQuery]);

  const isInitialLoading =
    fetcher.state !== "idle" && !isLoadingMore && resourceItems.length === 0;

  if (collectionMode) {
    return (
      <Box paddingBlockStart="300">
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search collections"
                value={fieldQueries.collection || ""}
                onFocus={() => openPicker("collection", fieldQueries.collection || "")}
                onChange={(value) => openPickerFromSearch("collection", value)}
                autoComplete="off"
              />
            </Box>

            <Button onClick={() => openPicker("collection")}>Browse</Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedCollections}
            onRemove={removeCollection}
            emptyText="No collections selected."
          />

          {selectedCollections.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_collection_ids[]`}
              value={item.id}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "collection"}
            resourceType="collection"
            title={getPickerTitle("collection")}
            searchPlaceholder="Search collections"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedCollections}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedCollections((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  if (productMode) {
    return (
      <Box paddingBlockStart="300">
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search products"
                value={fieldQueries.product || ""}
                onFocus={() => openPicker("product", fieldQueries.product || "")}
                onChange={(value) => openPickerFromSearch("product", value)}
                autoComplete="off"
              />
            </Box>

            <Button onClick={() => openPicker("product")}>Browse</Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedProducts}
            onRemove={removeProduct}
            emptyText="No products selected."
          />

          {selectedProducts.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_product_ids[]`}
              value={item.id}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "product"}
            resourceType="product"
            title={getPickerTitle("product")}
            searchPlaceholder="Search products"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedProducts}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedProducts((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  if (variantMode) {
    return (
      <Box paddingBlockStart="300">
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search product variants"
                value={fieldQueries.variant || ""}
                onFocus={() => openPicker("variant", fieldQueries.variant || "")}
                onChange={(value) => openPickerFromSearch("variant", value)}
                autoComplete="off"
              />
            </Box>

            <Button onClick={() => openPicker("variant")}>Browse</Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedVariants}
            onRemove={removeVariant}
            emptyText="No product variants selected."
          />

          {selectedVariants.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_variant_ids[]`}
              value={item.id}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "variant"}
            resourceType="variant"
            title={getPickerTitle("variant")}
            searchPlaceholder="Search product variants"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedVariants}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedVariants((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  if (tagMode) {
    return (
      <Box paddingBlockStart="300">
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <Box width="100%">
              <TextField
                label=""
                labelHidden
                placeholder="Search product tags"
                value={fieldQueries.tag || ""}
                onFocus={() => openPicker("tag", fieldQueries.tag || "")}
                onChange={(value) => openPickerFromSearch("tag", value)}
                autoComplete="off"
              />
            </Box>

            <Button onClick={() => openPicker("tag", fieldQueries.tag || "")}>
              Browse
            </Button>
          </InlineStack>

          <SelectedResourceTags
            items={selectedTags}
            onRemove={removeTag}
            emptyText="No product tags selected."
          />

          {selectedTags.map((item) => (
            <input
              key={item.id}
              type="hidden"
              name={`${sectionPrefix}_tag_names[]`}
              value={item.title}
            />
          ))}

          <ResourcePickerModal
            active={activePicker === "tag"}
            resourceType="tag"
            title={getPickerTitle("tag")}
            searchPlaceholder="Search product tags"
            initialQuery={searchQuery}
            items={resourceItems}
            pageInfo={pageInfo}
            loading={isInitialLoading}
            loadingMore={isLoadingMore}
            error={resourceError}
            selectedItems={selectedTags}
            onClose={() => setActivePicker(null)}
            onSearch={searchResources}
            onLoadNext={loadNextPage}
            onAdd={(items) => {
              setSelectedTags((current) => addUniqueItems(current, items));
              setActivePicker(null);
            }}
          />
        </BlockStack>
      </Box>
    );
  }

  return null;
}

/* -------------------- Price fields -------------------- */

function RoundingFields({ prefix }) {
  const [rounding, setRounding] = useState("none");
  const [nearest, setNearest] = useState(false);
  const [cents, setCents] = useState("99");
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
        onChange={setRounding}
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
        <BlockStack gap="200">
          <Box width="160px">
            <TextField
              label="Cents value"
              name={`${prefix}_override_cents_value`}
              type="number"
              min={0}
              max={99}
              prefix="0."
              value={cents}
              onChange={setCents}
              autoComplete="off"
            />
          </Box>

          <Text as="p" tone="subdued">
            E.g. 10.25 &gt; 10.{String(cents || "00").padStart(2, "0").slice(0, 2)}
          </Text>
        </BlockStack>
      )}

      {rounding === "set_ending" && (
        <BlockStack gap="200">
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            {endingDigits.map((digit, index) => (
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
              )
            ))}
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

function PriceChangeFields({
  fieldPrefix,
  actionOptions,
  defaultAction = "",
  showRelative = false,
  relativeOptions = priceRelativeOptions,
  currency = "INR",
}) {
  const [action, setAction] = useState(defaultAction);
  const [relativeTo, setRelativeTo] = useState("");
  const [changeType, setChangeType] = useState("by_percent");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");

  const isPriceField = fieldPrefix === "price";
  const isCompareAtPriceField = fieldPrefix === "compare_at_price";
  const isCostPerItemField = fieldPrefix === "cost_per_item";
  const isIncreaseOrDecrease = action === "increase" || action === "decrease";
  const isCompareNoFieldsAction =
    isCompareAtPriceField &&
    (action === "set_to_price" || action === "reset_compare_at_price");

  const shouldShowRelative =
    showRelative && isIncreaseOrDecrease;

  const shouldShowChangeType = isIncreaseOrDecrease;

  const shouldShowPercent =
    (isPriceField && action === "set_margin") ||
    (isIncreaseOrDecrease && changeType === "by_percent");

  const shouldShowAmount =
    (action === "set_new_value" && !isCompareAtPriceField && !isCostPerItemField) ||
    (isCompareAtPriceField && action === "set_new_value") ||
    (isCostPerItemField && action === "set_new_value") ||
    (isIncreaseOrDecrease && changeType === "by_amount");

  const shouldShowRounding =
    ((isPriceField || isCompareAtPriceField) && action === "") ||
    (isCostPerItemField && action === "") ||
    (isIncreaseOrDecrease && !isCompareNoFieldsAction);

  return (
    <BlockStack gap="200">
      <FormLayout>
        <FormLayout.Group>
          <Select
            label="Action"
            name={`${fieldPrefix}_change_action`}
            options={actionOptions}
            value={action}
            onChange={setAction}
          />

          {shouldShowRelative && (
            <Select
              label="Relative to"
              name={`${fieldPrefix}_change_relative_to`}
              options={relativeOptions}
              value={relativeTo}
              onChange={setRelativeTo}
            />
          )}
        </FormLayout.Group>

        {shouldShowChangeType && (
          <Select
            label="Change type"
            name={`${fieldPrefix}_change_type`}
            options={changeTypeOptions}
            value={changeType}
            onChange={setChangeType}
          />
        )}

        {shouldShowPercent && (
          <TextField
            label="Percent"
            name={`${fieldPrefix}_change_percent`}
            placeholder="0"
            suffix="%"
            value={percent}
            onChange={setPercent}
            autoComplete="off"
          />
        )}

        {shouldShowAmount && (
          <TextField
            label="Amount"
            name={`${fieldPrefix}_change_amount`}
            placeholder="0.00"
            suffix={currency}
            value={amount}
            onChange={setAmount}
            autoComplete="off"
          />
        )}
      </FormLayout>

      {shouldShowRounding && (
        <>
          <Divider />
          <RoundingFields prefix={fieldPrefix} />
        </>
      )}
    </BlockStack>
  );
}

/* -------------------- Main page -------------------- */

export default function NewTaskPage() {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  const [applyChangesTo, setApplyChangesTo] = useState("products");
  const [applyToFixedPrices, setApplyToFixedPrices] = useState(false);
  const [selectedMarkets, setSelectedMarkets] = useState([]);

  const [applyTo, setApplyTo] = useState(["whole_store"]);
  const [exclude, setExclude] = useState(["nothing"]);
  const [excludeDiscounted, setExcludeDiscounted] = useState(["nothing"]);
  const [autoReapply, setAutoReapply] = useState(false);

  const [applyCollections, setApplyCollections] = useState([]);
  const [applyProducts, setApplyProducts] = useState([]);
  const [applyVariants, setApplyVariants] = useState([]);
  const [applyTags, setApplyTags] = useState([]);

  const [excludeCollections, setExcludeCollections] = useState([]);
  const [excludeProducts, setExcludeProducts] = useState([]);
  const [excludeVariants, setExcludeVariants] = useState([]);
  const [excludeTags, setExcludeTags] = useState([]);

  const submitTaskForm = () => {
    if (typeof document === "undefined") return;

    const form = document.getElementById("task-create-form");
    if (form) {
      form.requestSubmit();
    }
  };

  return (
    <>
      <TitleBar title="New task" />

      <Page
        title="New task"
        narrowWidth
        backAction={{
          content: "Back",
          url: "/app",
        }}
        primaryAction={{
          content: isSubmitting ? "Saving..." : "Save",
          onAction: submitTaskForm,
          loading: isSubmitting,
          disabled: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Discard",
            url: "/app",
            disabled: isSubmitting,
          },
        ]}
      >
        <Form method="post" id="task-create-form">
          <input type="hidden" name="apply_changes_to" value={applyChangesTo} />

          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                <SectionCard title="Change type">
                  <ButtonGroup segmented>
                    <Button
                      pressed={applyChangesTo === "products"}
                      onClick={() => setApplyChangesTo("products")}
                    >
                      Product prices
                    </Button>

                    <Button
                      pressed={applyChangesTo === "markets"}
                      onClick={() => setApplyChangesTo("markets")}
                    >
                      Market prices
                    </Button>
                  </ButtonGroup>

                  {applyChangesTo === "markets" && (
                    <BlockStack gap="300">
                      <Text as="p">
                        Bulk edit Shopify Markets price lists.{" "}
                        <a
                          href="https://help.platmart.io/article/104-bulk-edit-shopify-markets-price-lists"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Learn more
                        </a>
                      </Text>

                      <Checkbox
                        label="Apply changes only to fixed prices"
                        name="apply_to_fixed_prices"
                        checked={applyToFixedPrices}
                        onChange={setApplyToFixedPrices}
                      />

                      <ChoiceList
                        title="Markets"
                        allowMultiple
                        name="selected_market_ids"
                        selected={selectedMarkets}
                        onChange={setSelectedMarkets}
                        choices={[
                          {
                            label: "India (INR) - no dedicated catalog",
                            value: "india",
                            disabled: true,
                          },
                          {
                            label: "International (INR)",
                            value: "international",
                          },
                        ]}
                      />
                    </BlockStack>
                  )}
                </SectionCard>

                <SectionCard title="Price">
                  <PriceChangeFields
                    fieldPrefix="price"
                    actionOptions={priceActionOptions}
                    defaultAction="decrease"
                    showRelative
                    relativeOptions={priceRelativeOptions}
                    currency="INR"
                  />
                </SectionCard>

                <SectionCard title="Compare at price">
                  <PriceChangeFields
                    fieldPrefix="compare_at_price"
                    actionOptions={compareAtActionOptions}
                    defaultAction=""
                    showRelative
                    relativeOptions={compareRelativeOptions}
                    currency="INR"
                  />
                </SectionCard>

                <SectionCard title="Cost per item">
                  <PriceChangeFields
                    fieldPrefix="cost_per_item"
                    actionOptions={costActionOptions}
                    defaultAction=""
                    showRelative={false}
                    currency="INR"
                  />
                </SectionCard>

                <SectionCard title="Apply to">
                  <ChoiceList
                    title=""
                    titleHidden
                    name="condition"
                    selected={applyTo}
                    onChange={setApplyTo}
                    choices={applyToChoices}
                  />
                  <ConditionScopeInputs
                    sectionPrefix="apply"
                    selectedCondition={applyTo[0]}
                  />

                  <ResourcePickerField
                    sectionPrefix="apply"
                    selectedCondition={applyTo[0]}
                    selectedCollections={applyCollections}
                    setSelectedCollections={setApplyCollections}
                    selectedProducts={applyProducts}
                    setSelectedProducts={setApplyProducts}
                    selectedVariants={applyVariants}
                    setSelectedVariants={setApplyVariants}
                    selectedTags={applyTags}
                    setSelectedTags={setApplyTags}
                  />
                </SectionCard>

                <SectionCard title="Exclude">
                  <ChoiceList
                    title=""
                    titleHidden
                    name="exclude"
                    selected={exclude}
                    onChange={setExclude}
                    choices={excludeChoices}
                  />
                  <ConditionScopeInputs
                    sectionPrefix="exclude"
                    selectedCondition={exclude[0]}
                  />

                  <ResourcePickerField
                    sectionPrefix="exclude"
                    selectedCondition={exclude[0]}
                    selectedCollections={excludeCollections}
                    setSelectedCollections={setExcludeCollections}
                    selectedProducts={excludeProducts}
                    setSelectedProducts={setExcludeProducts}
                    selectedVariants={excludeVariants}
                    setSelectedVariants={setExcludeVariants}
                    selectedTags={excludeTags}
                    setSelectedTags={setExcludeTags}
                  />
                </SectionCard>

                <SectionCard title="Exclude discounted">
                  <ChoiceList
                    title=""
                    titleHidden
                    name="exclude_discounted"
                    selected={excludeDiscounted}
                    onChange={setExcludeDiscounted}
                    choices={excludeDiscountedChoices}
                  />
                  <DiscountedExclusionInputs selected={excludeDiscounted} />
                </SectionCard>

                <SectionCard title="Advanced">
                  <input
                    type="hidden"
                    name="auto_reapply_changes_enabled"
                    value={autoReapply ? "enabled" : "disabled"}
                  />
                  <Checkbox
                    label="Automatically re-apply price changes (every hour)"
                    name="auto_reapply_changes"
                    checked={autoReapply}
                    onChange={setAutoReapply}
                    helpText="Prevents third-party apps from overriding prices after task completion. Works for tasks with up to 10,000 price changes."
                  />
                </SectionCard>

                <InlineStack align="end" gap="200">
                  <Button url="/app" disabled={isSubmitting}>
                    Discard
                  </Button>

                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Saving..." : "Save"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Layout.Section>
          </Layout>
        </Form>
      </Page>
    </>
  );
}
