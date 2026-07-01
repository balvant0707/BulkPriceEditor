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
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return json({});
}

export async function action({ request }) {
  await authenticate.admin(request);

  const formData = await request.formData();

  // Later you can save formData in DB here.
  // Example:
  // const priceAction = formData.get("price_change_action");

  return redirect("/app");
}

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

function ResourcePickerPreview({ type }) {
  return (
    <Box paddingBlockStart="300">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="end" wrap={false}>
          <Box width="100%">
            <TextField
              label=""
              labelHidden
              placeholder={`Search ${type}`}
              autoComplete="off"
            />
          </Box>

          <Button>Browse</Button>
        </InlineStack>

        <Text as="p" tone="subdued" variant="bodySm">
          Product/collection picker placeholder. You can connect this with
          Shopify Resource Picker or your custom search API.
        </Text>
      </BlockStack>
    </Box>
  );
}

function TagsPickerPreview() {
  return (
    <Box paddingBlockStart="300">
      <BlockStack gap="200">
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
      </BlockStack>
    </Box>
  );
}

function ConditionalResourceFields({ selected }) {
  if (selected === "selected_collections") {
    return <ResourcePickerPreview type="collections" />;
  }

  if (
    selected === "selected_products" ||
    selected === "selected_products_with_variants"
  ) {
    return <ResourcePickerPreview type="products" />;
  }

  if (selected === "selected_tags") {
    return <TagsPickerPreview />;
  }

  return null;
}

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

  const shouldShowChangeType =
    action === "increase" || action === "decrease";

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
          <input
            type="hidden"
            name="apply_changes_to"
            value={applyChangesTo}
          />

          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                <SectionCard title="Change type">
                  <ButtonGroup variant="segmented">
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

                  <ConditionalResourceFields selected={applyTo[0]} />
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

                  <ConditionalResourceFields selected={exclude[0]} />
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