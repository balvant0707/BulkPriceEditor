// app/routes/app.settings.jsx
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  BlockStack,
  Box,
  Card,
  Frame,
  Layout,
  Page,
  PageActions,
  Select,
  TextField,
  Toast,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { loadSettings, saveSettings } from "../lib/product-reports.server";
import {
  DEFAULT_REPORT_SETTINGS,
  normalizeShop,
} from "../lib/product-reports";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const storedSettings = await loadSettings(shop);

  return json({
    settings: {
      ...DEFAULT_REPORT_SETTINGS,
      ...storedSettings,
    },
  });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const formData = await request.formData();

  if (!shop) {
    return json({ ok: false, message: "Shop is required." }, { status: 400 });
  }

  const includeDraftProducts = String(
    formData.get("includeDraftProducts") ||
      DEFAULT_REPORT_SETTINGS.includeDraftProducts,
  );
  const reapplyMinute = clampMinute(formData.get("reapplyMinute"));
  const settings = {
    includeDraftProducts: includeDraftProducts === "false" ? "false" : "true",
    reapplyMinute: String(reapplyMinute),
  };

  await saveSettings(shop, settings);

  return json({
    ok: true,
    settings,
    message: "Configuration saved.",
  });
}

function clampMinute(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return Number(DEFAULT_REPORT_SETTINGS.reapplyMinute);
  }

  return Math.max(0, Math.min(59, Math.trunc(number)));
}

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();
  const navigation = useNavigation();

  const [includeDraftProducts, setIncludeDraftProducts] = useState(
    String(
      settings.includeDraftProducts ??
        DEFAULT_REPORT_SETTINGS.includeDraftProducts,
    ),
  );
  const [reapplyMinute, setReapplyMinute] = useState(
    String(settings.reapplyMinute ?? DEFAULT_REPORT_SETTINGS.reapplyMinute),
  );
  const [toast, setToast] = useState("");

  const initialState = useMemo(
    () => ({
      includeDraftProducts: String(
        settings.includeDraftProducts ??
          DEFAULT_REPORT_SETTINGS.includeDraftProducts,
      ),
      reapplyMinute: String(
        settings.reapplyMinute ?? DEFAULT_REPORT_SETTINGS.reapplyMinute,
      ),
    }),
    [settings.includeDraftProducts, settings.reapplyMinute],
  );

  const isSaving =
    navigation.state !== "idle" ||
    fetcher.state === "submitting" ||
    fetcher.state === "loading";
  const isDirty =
    includeDraftProducts !== initialState.includeDraftProducts ||
    String(reapplyMinute) !== String(initialState.reapplyMinute);

  useEffect(() => {
    if (fetcher.data?.message) {
      setToast(fetcher.data.message);
    }
  }, [fetcher.data]);

  const productFilteringOptions = [
    { label: "Active and draft products", value: "true" },
    { label: "Active products only", value: "false" },
  ];

  return (
    <Frame>
      <Page title="Pryxo Bulk Price Editor">
        <TitleBar title="Settings" />

        <fetcher.Form method="post">
          <Layout>
            <Layout.AnnotatedSection title="Product filtering">
              <Card>
                <Box padding="400">
                  <Select
                    label="Apply price changes to"
                    name="includeDraftProducts"
                    options={productFilteringOptions}
                    value={includeDraftProducts}
                    onChange={setIncludeDraftProducts}
                  />
                </Box>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection
              title="Auto-reapply timing"
              description="Adjust the schedule for reapplying price changes in your sales and tasks."
            >
              <Card>
                <Box padding="400">
                  <BlockStack gap="200">
                    <TextField
                      label="Reapply minute"
                      name="reapplyMinute"
                      type="number"
                      value={String(reapplyMinute)}
                      onChange={(value) => setReapplyMinute(value)}
                      min={0}
                      max={59}
                      step={1}
                      autoComplete="off"
                      helpText="Choose which minute of the hour (0-59) the reapply runs. If another app overwrites your prices at the same time each hour, set this to just after it runs - that shortens the gap where your discounts go missing."
                    />
                  </BlockStack>
                </Box>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.Section>
              <PageActions
                primaryAction={{
                  content: "Save",
                  submit: true,
                  loading: isSaving,
                  disabled: isSaving || !isDirty,
                }}
              />
            </Layout.Section>
          </Layout>
        </fetcher.Form>
      </Page>

      {toast ? <Toast content={toast} onDismiss={() => setToast("")} /> : null}
    </Frame>
  );
}
