// app/routes/app.sales.new.jsx
import React, { useMemo, useState } from "react";
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
  ResourceList,
  ResourceItem,
  Thumbnail,
  Tag,
  PageActions,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

const BACK_URL = "/app/sales";

const marketOptions = [
  { label: "India (INR) - no dedicated catalog", value: "india", disabled: true },
  { label: "International (INR)", value: "international" },
];

const sampleProducts = [
  {
    id: "p1",
    title: "Classic Cotton T-Shirt",
    subtitle: "12 variants",
    image:
      "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png",
  },
  {
    id: "p2",
    title: "Premium Hoodie",
    subtitle: "8 variants",
    image:
      "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-2_large.png",
  },
  {
    id: "p3",
    title: "Canvas Tote Bag",
    subtitle: "4 variants",
    image:
      "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-3_large.png",
  },
];

const sampleCollections = [
  {
    id: "c1",
    title: "Summer Collection",
    subtitle: "48 products",
    image:
      "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-1_large.png",
  },
  {
    id: "c2",
    title: "New Arrivals",
    subtitle: "32 products",
    image:
      "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-2_large.png",
  },
  {
    id: "c3",
    title: "Best Sellers",
    subtitle: "24 products",
    image:
      "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-collection-3_large.png",
  },
];

const sampleTags = [
  { id: "t1", title: "sale-active", subtitle: "Product tag" },
  { id: "t2", title: "summer-sale", subtitle: "Product tag" },
  { id: "t3", title: "clearance", subtitle: "Product tag" },
  { id: "t4", title: "best-seller", subtitle: "Product tag" },
];

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
  { label: "Products on sale", value: "products_on_sale" },
  { label: "Product variants on sale", value: "product_variants_on_sale" },
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
              {item.image ? (
                <Thumbnail source={item.image} alt={item.title} size="small" />
              ) : null}
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {item.title}
                </Text>
                {item.subtitle ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {item.subtitle}
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
  type,
  title,
  items,
  selectedItems,
  onClose,
  onSelect,
}) {
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    return items.filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase())
    );
  }, [items, query]);

  const selectedIds = selectedItems.map((item) => item.id);

  return (
    <Modal
      open={active}
      onClose={onClose}
      title={title}
      primaryAction={{
        content: "Done",
        onAction: onClose,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label={`Search ${type}`}
            labelHidden
            placeholder={`Search ${type}`}
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />

          <ResourceList
            resourceName={{ singular: type, plural: `${type}s` }}
            items={filteredItems}
            renderItem={(item) => {
              const selected = selectedIds.includes(item.id);

              return (
                <ResourceItem
                  id={item.id}
                  media={
                    item.image ? (
                      <Thumbnail source={item.image} alt={item.title} size="small" />
                    ) : undefined
                  }
                  onClick={() => onSelect(item)}
                  accessibilityLabel={`Select ${item.title}`}
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="p" fontWeight="semibold">
                        {item.title}
                      </Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {item.subtitle}
                      </Text>
                    </BlockStack>

                    <Button size="slim" pressed={selected}>
                      {selected ? "Selected" : "Select"}
                    </Button>
                  </InlineStack>
                </ResourceItem>
              );
            }}
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function ConditionPicker({
  value,
  selectedCollections,
  selectedProducts,
  selectedTags,
  onOpenPicker,
  onRemoveCollection,
  onRemoveProduct,
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

  if (value === "selected_products" || value === "selected_products_with_variants") {
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

export default function NewSalePage() {
  const today = new Date().toISOString().slice(0, 10);

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

  const [applyCollections, setApplyCollections] = useState([]);
  const [applyProducts, setApplyProducts] = useState([]);
  const [applyTags, setApplyTags] = useState([]);

  const [excludeCollections, setExcludeCollections] = useState([]);
  const [excludeProducts, setExcludeProducts] = useState([]);
  const [excludeTags, setExcludeTags] = useState([]);

  const [tagsToAdd, setTagsToAdd] = useState([{ id: "t1", title: "sale-active" }]);
  const [tagsToRemove, setTagsToRemove] = useState([]);

  const [picker, setPicker] = useState({
    active: false,
    mode: null,
    type: null,
  });

  const setField = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const openPicker = (mode, type) => {
    setPicker({ active: true, mode, type });
  };

  const closePicker = () => {
    setPicker({ active: false, mode: null, type: null });
  };

  const getPickerItems = () => {
    if (picker.type === "collection") return sampleCollections;
    if (picker.type === "product") return sampleProducts;
    return sampleTags;
  };

  const getPickerTitle = () => {
    if (picker.type === "collection") return "Browse collections";
    if (picker.type === "product") return "Browse products";
    return "Browse tags";
  };

  const getSelectedItems = () => {
    if (picker.mode === "apply" && picker.type === "collection") return applyCollections;
    if (picker.mode === "apply" && picker.type === "product") return applyProducts;
    if (picker.mode === "apply" && picker.type === "tag") return applyTags;

    if (picker.mode === "exclude" && picker.type === "collection") return excludeCollections;
    if (picker.mode === "exclude" && picker.type === "product") return excludeProducts;
    if (picker.mode === "exclude" && picker.type === "tag") return excludeTags;

    if (picker.mode === "add-tags") return tagsToAdd;
    if (picker.mode === "remove-tags") return tagsToRemove;

    return [];
  };

  const toggleItem = (item) => {
    const toggle = (setter) => {
      setter((current) => {
        const exists = current.some((selected) => selected.id === item.id);
        return exists
          ? current.filter((selected) => selected.id !== item.id)
          : [...current, item];
      });
    };

    if (picker.mode === "apply" && picker.type === "collection") toggle(setApplyCollections);
    if (picker.mode === "apply" && picker.type === "product") toggle(setApplyProducts);
    if (picker.mode === "apply" && picker.type === "tag") toggle(setApplyTags);

    if (picker.mode === "exclude" && picker.type === "collection") toggle(setExcludeCollections);
    if (picker.mode === "exclude" && picker.type === "product") toggle(setExcludeProducts);
    if (picker.mode === "exclude" && picker.type === "tag") toggle(setExcludeTags);

    if (picker.mode === "add-tags") toggle(setTagsToAdd);
    if (picker.mode === "remove-tags") toggle(setTagsToRemove);
  };

  const canCreate = form.title.trim() && form.pricePercent.trim();

  return (
    <>
      <TitleBar
        title="New sale"
        primaryAction={{
          content: "Create",
          disabled: !canCreate,
        }}
      />

      <Page
        title="New sale"
        backAction={{ content: "Sales", url: BACK_URL }}
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

                    <ChoiceList
                      title="Markets"
                      allowMultiple
                      choices={marketOptions}
                      selected={form.markets}
                      onChange={setField("markets")}
                    />
                  </BlockStack>
                ) : null}
              </SectionCard>

              <SectionCard title="Price">
                <FormLayout>
                  <FormLayout.Group>
                    <Select
                      label="Action"
                      options={[
                        { label: "Decrease", value: "decrease" },
                        { label: "Set new price", value: "set_new_value" },
                      ]}
                      value={form.priceAction}
                      onChange={setField("priceAction")}
                    />

                    <Select
                      label="Change type"
                      options={[
                        { label: "By percent", value: "by_percent" },
                        { label: "By amount", value: "by_amount" },
                      ]}
                      value={form.priceChangeType}
                      onChange={setField("priceChangeType")}
                    />
                  </FormLayout.Group>

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
                      suffix="INR"
                      value={form.priceAmount}
                      onChange={setField("priceAmount")}
                      autoComplete="off"
                    />
                  )}

                  <Select
                    label="Rounding"
                    options={[
                      { label: "No rounding", value: "none" },
                      { label: "Round to whole number", value: "round_to_whole" },
                      { label: "Override cents", value: "override_cents" },
                      { label: "Set price ending", value: "set_ending" },
                    ]}
                    value={form.priceRounding}
                    onChange={setField("priceRounding")}
                  />

                  {form.priceRounding === "override_cents" ? (
                    <TextField
                      label="Override cents"
                      prefix="0."
                      type="number"
                      min={0}
                      max={99}
                      value={form.priceCents}
                      onChange={setField("priceCents")}
                      autoComplete="off"
                    />
                  ) : null}
                </FormLayout>
              </SectionCard>

              <SectionCard title="Compare at price">
                <FormLayout>
                  <Select
                    label="Action"
                    options={[
                      {
                        label: "Don’t change compare at price",
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

                  {form.compareAction === "set_new_value" ? (
                    <>
                      <Select
                        label="Change type"
                        options={[
                          { label: "By percent", value: "by_percent" },
                          { label: "By amount", value: "by_amount" },
                        ]}
                        value={form.compareChangeType}
                        onChange={setField("compareChangeType")}
                      />

                      {form.compareChangeType === "by_percent" ? (
                        <TextField
                          label="Percent"
                          placeholder="0"
                          suffix="%"
                          value={form.comparePercent}
                          onChange={setField("comparePercent")}
                          autoComplete="off"
                        />
                      ) : (
                        <TextField
                          label="Amount"
                          placeholder="0.00"
                          suffix="INR"
                          value={form.compareAmount}
                          onChange={setField("compareAmount")}
                          autoComplete="off"
                        />
                      )}
                    </>
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
                  selectedTags={applyTags}
                  onOpenPicker={(type) => openPicker("apply", type)}
                  onRemoveCollection={(id) =>
                    setApplyCollections((items) => items.filter((item) => item.id !== id))
                  }
                  onRemoveProduct={(id) =>
                    setApplyProducts((items) => items.filter((item) => item.id !== id))
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

              <PageActions
                primaryAction={{
                  content: "Create",
                  disabled: !canCreate,
                  onAction: () => {
                    console.log("Sale payload:", {
                      form,
                      applyCollections,
                      applyProducts,
                      applyTags,
                      excludeCollections,
                      excludeProducts,
                      excludeTags,
                      tagsToAdd,
                      tagsToRemove,
                    });
                  },
                }}
                secondaryActions={[
                  {
                    content: "Cancel",
                    url: BACK_URL,
                  },
                ]}
              />
            </BlockStack>
          </Layout.Section>
        </Layout>

        <PickerModal
          active={picker.active}
          type={picker.type || "item"}
          title={getPickerTitle()}
          items={getPickerItems()}
          selectedItems={getSelectedItems()}
          onClose={closePicker}
          onSelect={toggleItem}
        />
      </Page>
    </>
  );
}