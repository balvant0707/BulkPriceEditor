// app/routes/app.settings.jsx
import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Card,
  Frame,
  Layout,
  Page,
  PageActions,
  Select,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const SETTINGS_KEY = "price_editor";
const DEFAULT_SETTINGS = {
  includeDraftProducts: "true",
  reapplyMinute: "20",
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const storedSettings = await loadSettings(shop);

  return json({
    settings: {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
    },
    hasSettingsStorage: await hasSettingsStorage(),
  });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const formData = await request.formData();

  const includeDraftProducts = String(
    formData.get("includeDraftProducts") || DEFAULT_SETTINGS.includeDraftProducts,
  );
  const reapplyMinute = clampMinute(formData.get("reapplyMinute"));

  const settings = {
    includeDraftProducts: includeDraftProducts === "false" ? "false" : "true",
    reapplyMinute: String(reapplyMinute),
  };

  const savedToDb = await saveSettings(shop, settings);

  return json({
    ok: true,
    savedToDb,
    settings,
    message: savedToDb
      ? "Settings saved."
      : "Settings updated in the UI, but no settings Prisma model was found for permanent storage.",
  });
}

function normalizeShop(shop) {
  return String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();
}

function clampMinute(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return Number(DEFAULT_SETTINGS.reapplyMinute);

  return Math.max(0, Math.min(59, Math.trunc(number)));
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;

  if (typeof value === "object") return value;

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getSettingsModel() {
  return (
    db.priceEditorSetting ||
    db.priceeditorsetting ||
    db.appSetting ||
    db.appsetting ||
    db.setting ||
    db.settings ||
    null
  );
}

async function hasSettingsStorage() {
  return Boolean(getSettingsModel());
}

async function loadSettings(shop) {
  const settingsModel = getSettingsModel();

  if (!settingsModel || !shop) return {};

  try {
    let row = null;

    if (settingsModel.findUnique) {
      try {
        row = await settingsModel.findUnique({
          where: {
            shop_key: {
              shop,
              key: SETTINGS_KEY,
            },
          },
        });
      } catch {
        row = null;
      }
    }

    if (!row && settingsModel.findFirst) {
      row = await settingsModel.findFirst({
        where: {
          shop,
          key: SETTINGS_KEY,
        },
      });
    }

    const data = safeJsonParse(row?.value || row?.settings || row?.data, {});

    return {
      includeDraftProducts:
        data.includeDraftProducts ??
        data.include_draft_products ??
        row?.includeDraftProducts ??
        row?.include_draft_products ??
        DEFAULT_SETTINGS.includeDraftProducts,
      reapplyMinute:
        data.reapplyMinute ??
        data.reapply_minute ??
        row?.reapplyMinute ??
        row?.reapply_minute ??
        DEFAULT_SETTINGS.reapplyMinute,
    };
  } catch (error) {
    console.error("[settings.loader] Failed to load settings", error);
    return {};
  }
}

async function saveSettings(shop, settings) {
  const settingsModel = getSettingsModel();

  if (!settingsModel || !shop) return false;

  const payload = {
    includeDraftProducts: settings.includeDraftProducts,
    include_draft_products: settings.includeDraftProducts,
    reapplyMinute: settings.reapplyMinute,
    reapply_minute: settings.reapplyMinute,
  };

  try {
    if (settingsModel.upsert) {
      try {
        await settingsModel.upsert({
          where: {
            shop_key: {
              shop,
              key: SETTINGS_KEY,
            },
          },
          update: {
            value: JSON.stringify(payload),
          },
          create: {
            shop,
            key: SETTINGS_KEY,
            value: JSON.stringify(payload),
          },
        });

        return true;
      } catch {
        // Some Prisma models may not use a JSON/string `value` column.
      }

      try {
        await settingsModel.upsert({
          where: {
            shop_key: {
              shop,
              key: SETTINGS_KEY,
            },
          },
          update: payload,
          create: {
            shop,
            key: SETTINGS_KEY,
            ...payload,
          },
        });

        return true;
      } catch {
        // Fall through to update/create fallback.
      }
    }

    const existing = settingsModel.findFirst
      ? await settingsModel.findFirst({ where: { shop, key: SETTINGS_KEY } })
      : null;

    if (existing?.id && settingsModel.update) {
      await settingsModel.update({
        where: { id: existing.id },
        data: existing.value !== undefined ? { value: JSON.stringify(payload) } : payload,
      });

      return true;
    }

    if (settingsModel.create) {
      await settingsModel.create({
        data: {
          shop,
          key: SETTINGS_KEY,
          value: JSON.stringify(payload),
        },
      });

      return true;
    }

    return false;
  } catch (error) {
    console.error("[settings.action] Failed to save settings", error);
    return false;
  }
}

export default function SettingsPage() {
  const { settings, hasSettingsStorage } = useLoaderData();
  const fetcher = useFetcher();
  const navigation = useNavigation();

  const [includeDraftProducts, setIncludeDraftProducts] = useState(
    String(settings.includeDraftProducts ?? DEFAULT_SETTINGS.includeDraftProducts),
  );
  const [reapplyMinute, setReapplyMinute] = useState(
    String(settings.reapplyMinute ?? DEFAULT_SETTINGS.reapplyMinute),
  );
  const [toast, setToast] = useState("");

  const initialState = useMemo(
    () => ({
      includeDraftProducts: String(
        settings.includeDraftProducts ?? DEFAULT_SETTINGS.includeDraftProducts,
      ),
      reapplyMinute: String(settings.reapplyMinute ?? DEFAULT_SETTINGS.reapplyMinute),
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
      <Page title="Settings">
        <TitleBar title="Settings" />

        <fetcher.Form method="post">
          <Layout>
            {!hasSettingsStorage ? (
              <Layout.Section>
                <Banner tone="warning" title="Settings storage model not found">
                  <Text as="p">
                    Add a Prisma settings model if you want these values to stay
                    saved after reload. The UI component will still render correctly.
                  </Text>
                </Banner>
              </Layout.Section>
            ) : null}

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
