// app/routes/app.tasks.new.jsx
import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
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
} from "@shopify/polaris";
import { useMemo, useState } from "react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return json({});
}

export async function action({ request }) {
  await authenticate.admin(request);

  const formData = await request.formData();

  // Later save this data in DB.
  // Example:
  // const selectedCollections = formData.getAll("apply_collection_ids[]");
  // const selectedProducts = formData.getAll("apply_product_ids[]");
  // const selectedVariants = formData.getAll("apply_variant_ids[]");

  return redirect("/app");
}

/* -------------------- Sample resources --------------------
   Replace this static data with Shopify GraphQL data later.
----------------------------------------------------------- */

const SAMPLE_COLLECTIONS = [
  { id: "gid://shopify/Collection/1", title: "Accessories", productsCount: 9 },
  {
    id: "gid://shopify/Collection/2",
    title: "All Products (ChatGPT-AI Product Description)",
    productsCount: 37,
  },
  { id: "gid://shopify/Collection/3", title: "Cloth", productsCount: 11 },
  { id: "gid://shopify/Collection/4", title: "Home page", productsCount: 7 },
  { id: "gid://shopify/Collection/5", title: "Jeans", productsCount: 4 },
  { id: "gid://shopify/Collection/6", title: "New Arrivals", productsCount: 18 },
  { id: "gid://shopify/Collection/7", title: "Best Sellers", productsCount: 24 },
];

const SAMPLE_PRODUCTS = [
  {
    id: "gid://shopify/Product/101",
    title: "Classic Cotton Shirt",
    status: "Active",
    variantsCount: 4,
    variants: [
      { id: "gid://shopify/ProductVariant/1001", title: "Small / White" },
      { id: "gid://shopify/ProductVariant/1002", title: "Medium / White" },
      { id: "gid://shopify/ProductVariant/1003", title: "Large / White" },
      { id: "gid://shopify/ProductVariant/1004", title: "XL / White" },
    ],
  },
  {
    id: "gid://shopify/Product/102",
    title: "Blue Denim Jeans",
    status: "Active",
    variantsCount: 3,
    variants: [
      { id: "gid://shopify/ProductVariant/2001", title: "30 / Blue" },
      { id: "gid://shopify/ProductVariant/2002", title: "32 / Blue" },
      { id: "gid://shopify/ProductVariant/2003", title: "34 / Blue" },
    ],
  },
  {
    id: "gid://shopify/Product/103",
    title: "Leather Wallet",
    status: "Draft",
    variantsCount: 2,
    variants: [
      { id: "gid://shopify/ProductVariant/3001", title: "Brown" },
      { id: "gid://shopify/ProductVariant/3002", title: "Black" },
    ],
  },
  {
    id: "gid://shopify/Product/104",
    title: "Sports Shoes",
    status: "Active",
    variantsCount: 5,
    variants: [
      { id: "gid://shopify/ProductVariant/4001", title: "UK 7 / Black" },
      { id: "gid://shopify/ProductVariant/4002", title: "UK 8 / Black" },
      { id: "gid://shopify/ProductVariant/4003", title: "UK 9 / Black" },
      { id: "gid://shopify/ProductVariant/4004", title: "UK 10 / Black" },
      { id: "gid://shopify/ProductVariant/4005", title: "UK 11 / Black" },
    ],
  },
];

const SAMPLE_PRODUCT_VARIANTS = SAMPLE_PRODUCTS.flatMap((product) =>
  product.variants.map((variant) => ({
    id: variant.id,
    title: variant.title,
    productTitle: product.title,
    productId: product.id,
  })),
);

/* -------------------- Form options -------------------- */

const priceActionOptions = [
  { label: "Don't change price", value: "" },
  { label: "Increase price", value: "increase" },
  { label: "Decrease price", value: "decrease" },
  { label: "Set new price", value: "set_new_value" },
  { label: "Set to compare at price", value: "set_to_compare_at_price" },
  { label: "Set margin", value: "set_margin" },
];

const compareAtActionOptions = [
  { label: "Don't change compare at price", value: "" },
  { label: "Increase compare at price", value: "increase" },
  { label: "Decrease compare at price", value: "decrease" },
  { label: "Set new compare at price", value: "set_new_value" },
  { label: "Set to price", value: "set_to_price" },
  { label: "Reset compare at price", value: "reset_compare_at_price" },
];

const costActionOptions = [
  { label: "Don't change cost per item", value: "" },
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
  { label: "Products on sale", value: "products_on_sale" },
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
  { label: "Products on sale", value: "products_on_sale" },
  { label: "Product variants on sale", value: "product_variants_on_sale" },
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

function ResourceAvatar({ title }) {
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
      }}
    >
      {first}
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

/* -------------------- Polaris popup modal -------------------- */

function ResourcePickerModal({
  active,
  resourceType,
  title,
  searchPlaceholder,
  items,
  selectedItems,
  onClose,
  onAdd,
  limit = 100,
}) {
  const [query, setQuery] = useState("");
  const [tempSelectedIds, setTempSelectedIds] = useState([]);

  const selectedIdSet = useMemo(
    () => new Set(tempSelectedIds),
    [tempSelectedIds],
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return items;

    return items.filter((item) => {
      const mainTitle = String(item.title || "").toLowerCase();
      const productTitle = String(item.productTitle || "").toLowerCase();
      return mainTitle.includes(q) || productTitle.includes(q);
    });
  }, [items, query]);

  const modalTitle =
    title ||
    (resourceType === "collection"
      ? "Add collections"
      : resourceType === "variant"
        ? "Add product variants"
        : "Add products");

  const resourceLabel =
    resourceType === "collection"
      ? "collections"
      : resourceType === "variant"
        ? "variants"
        : "products";

  const leftHeader =
    resourceType === "collection"
      ? "Collection"
      : resourceType === "variant"
        ? "Product variant"
        : "Product";

  const rightHeader =
    resourceType === "collection"
      ? "Products"
      : resourceType === "variant"
        ? "Product"
        : "Variants";

  const addButtonLabel =
    resourceType === "collection"
      ? "Add collections"
      : resourceType === "variant"
        ? "Add variants"
        : "Add products";

  const handleToggle = (id) => {
    setTempSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((itemId) => itemId !== id);
      }

      if (current.length >= limit) return current;

      return [...current, id];
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

  return (
    <Modal
      open={active}
      onClose={handleClose}
      title={modalTitle}
      large
      primaryAction={{
        content: addButtonLabel,
        onAction: handleAdd,
        disabled: tempSelectedIds.length === 0,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label={searchPlaceholder}
            labelHidden
            placeholder={searchPlaceholder}
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />

          <div
            style={{
              border: "1px solid #E5E7EB",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
                alignItems: "center",
                background: "#F6F6F7",
                borderBottom: "1px solid #E5E7EB",
                padding: "8px 16px",
              }}
            >
              <Text as="span" tone="subdued" variant="bodySm">
                {leftHeader}
              </Text>

              <div style={{ textAlign: "right" }}>
                <Text as="span" tone="subdued" variant="bodySm">
                  {rightHeader}
                </Text>
              </div>
            </div>

            <div
              style={{
                maxHeight: 430,
                overflowY: "auto",
              }}
            >
              {filteredItems.length === 0 ? (
                <Box padding="500">
                  <Text as="p" tone="subdued">
                    No {resourceLabel} found.
                  </Text>
                </Box>
              ) : (
                filteredItems.map((item) => {
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
                        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
                        alignItems: "center",
                        gap: 16,
                        padding: "10px 16px",
                        borderBottom: "1px solid #F1F1F1",
                        cursor: "pointer",
                        background: checked ? "#F1F8FF" : "#FFFFFF",
                      }}
                    >
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <div onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            label={item.title}
                            labelHidden
                            checked={checked}
                            onChange={() => handleToggle(item.id)}
                          />
                        </div>

                        <ResourceAvatar title={item.productTitle || item.title} />

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
                              <Badge tone={item.status === "Active" ? "success" : "attention"}>
                                {item.status}
                              </Badge>
                            </Box>
                          ) : null}
                        </BlockStack>
                      </InlineStack>

                      <div style={{ textAlign: "right" }}>
                        <Text as="span" variant="bodySm">
                          {resourceType === "collection"
                            ? item.productsCount
                            : resourceType === "variant"
                              ? item.productTitle
                              : item.variantsCount}
                        </Text>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" tone="subdued">
              {tempSelectedIds.length}/{limit} {resourceLabel} selected
            </Text>

            {selectedItems.length > 0 ? (
              <Text as="p" tone="subdued">
                Already added: {selectedItems.length}
              </Text>
            ) : null}
          </InlineStack>
        </BlockStack>
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
}) {
  const [activePicker, setActivePicker] = useState(null);

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

  const addUniqueItems = (currentItems, newItems) => {
    const existingIds = new Set(currentItems.map((item) => item.id));
    return [...currentItems, ...newItems.filter((item) => !existingIds.has(item.id))];
  };

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
                autoComplete="off"
              />
            </Box>

            <Button onClick={() => setActivePicker("collection")}>Browse</Button>
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
            title="Add collections"
            searchPlaceholder="Search collections"
            items={SAMPLE_COLLECTIONS}
            selectedItems={selectedCollections}
            onClose={() => setActivePicker(null)}
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
                autoComplete="off"
              />
            </Box>

            <Button onClick={() => setActivePicker("product")}>Browse</Button>
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
            title="Add products"
            searchPlaceholder="Search products"
            items={SAMPLE_PRODUCTS}
            selectedItems={selectedProducts}
            onClose={() => setActivePicker(null)}
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
                autoComplete="off"
              />
            </Box>

            <Button onClick={() => setActivePicker("variant")}>Browse</Button>
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
            title="Add product variants"
            searchPlaceholder="Search product variants"
            items={SAMPLE_PRODUCT_VARIANTS}
            selectedItems={selectedVariants}
            onClose={() => setActivePicker(null)}
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
        <InlineStack gap="200" blockAlign="end" wrap={false}>
          <Box width="100%">
            <TextField
              label=""
              labelHidden
              placeholder="Search tags"
              autoComplete="off"
            />
          </Box>

          <Button>Reload tags</Button>
        </InlineStack>
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

  return (
    <BlockStack gap="300">
      <Select
        label="Rounding"
        name={`${prefix}_rounding_mode`}
        options={roundingOptions}
        value={rounding}
        onChange={setRounding}
      />

      {rounding === "round_to_whole" && (
        <Checkbox
          label="To nearest value"
          name={`${prefix}_override_to_nearest`}
          checked={nearest}
          onChange={setNearest}
        />
      )}

      {rounding === "override_cents" && (
        <InlineStack gap="300" blockAlign="center">
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
            Preview: {cents}
          </Text>
        </InlineStack>
      )}

      {rounding === "set_ending" && (
        <Banner tone="info">
          Custom price ending UI can be added here. Example: *.99, *.95, *.00.
        </Banner>
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

  const shouldShowChangeType = action === "increase" || action === "decrease";

  const shouldShowPercent =
    (action === "increase" || action === "decrease" || action === "set_margin") &&
    changeType === "by_percent";

  const shouldShowAmount =
    action === "set_new_value" ||
    ((action === "increase" || action === "decrease") &&
      changeType === "by_amount");

  const shouldShowRounding =
    action !== "" &&
    action !== "reset_compare_at_price" &&
    action !== "reset_cost_per_item";

  return (
    <BlockStack gap="400">
      <FormLayout>
        <FormLayout.Group>
          <Select
            label="Action"
            name={`${fieldPrefix}_change_action`}
            options={actionOptions}
            value={action}
            onChange={setAction}
          />

          {showRelative && (
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

  const [excludeCollections, setExcludeCollections] = useState([]);
  const [excludeProducts, setExcludeProducts] = useState([]);
  const [excludeVariants, setExcludeVariants] = useState([]);

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
      >
        <Form method="post">
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

                  <ResourcePickerField
                    sectionPrefix="apply"
                    selectedCondition={applyTo[0]}
                    selectedCollections={applyCollections}
                    setSelectedCollections={setApplyCollections}
                    selectedProducts={applyProducts}
                    setSelectedProducts={setApplyProducts}
                    selectedVariants={applyVariants}
                    setSelectedVariants={setApplyVariants}
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

                  <ResourcePickerField
                    sectionPrefix="exclude"
                    selectedCondition={exclude[0]}
                    selectedCollections={excludeCollections}
                    setSelectedCollections={setExcludeCollections}
                    selectedProducts={excludeProducts}
                    setSelectedProducts={setExcludeProducts}
                    selectedVariants={excludeVariants}
                    setSelectedVariants={setExcludeVariants}
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
                </SectionCard>

                <SectionCard title="Advanced">
                  <Checkbox
                    label="Automatically re-apply price changes (every hour)"
                    name="auto_reapply_changes"
                    checked={autoReapply}
                    onChange={setAutoReapply}
                    helpText="Prevents third-party apps from overriding prices after task completion. Works for tasks with up to 10,000 price changes."
                  />
                </SectionCard>

                <InlineStack align="end">
                  <Button
                    submit
                    variant="primary"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Creating..." : "Create"}
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