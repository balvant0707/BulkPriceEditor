// app/routes/app.tools.jsx
import { json } from "@remix-run/node";
import {
  Outlet,
  useFetcher,
  useLoaderData,
  useLocation,
} from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  BlockStack,
  Button,
  ButtonGroup,
  Card,
  Frame,
  Layout,
  Page,
  Text,
  Toast,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  generateProductReport,
  getLatestReportUrl,
} from "../lib/product-reports.server";
import {
  normalizeShop,
  REPORT_TYPES,
} from "../lib/product-reports";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);

  return json({
    latestMarginReportUrl: await getLatestReportUrl(shop, REPORT_TYPES.margin),
    latestDiscountReportUrl: await getLatestReportUrl(shop, REPORT_TYPES.discount),
  });
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (!shop) {
    return json({ ok: false, message: "Shop is required." }, { status: 400 });
  }

  if (intent === "generate_margin_report") {
    const report = await generateProductReport(admin, shop, REPORT_TYPES.margin);

    return json({
      ok: true,
      type: REPORT_TYPES.margin,
      message: `Margin report generated with ${report.totalRows} rows.`,
      latestReportUrl: report.url,
    });
  }

  if (intent === "generate_discount_report") {
    const report = await generateProductReport(admin, shop, REPORT_TYPES.discount);

    return json({
      ok: true,
      type: REPORT_TYPES.discount,
      message: `Discount report generated with ${report.totalRows} rows.`,
      latestReportUrl: report.url,
    });
  }

  return json({ ok: false, message: "Unknown action." }, { status: 400 });
}

function ToolCard({
  title,
  description,
  generateIntent,
  latestReportUrl,
  onReportGenerated,
  onMessage,
}) {
  const fetcher = useFetcher();
  const isGenerating = fetcher.state !== "idle";
  const currentReportUrl = fetcher.data?.latestReportUrl || latestReportUrl;

  useEffect(() => {
    if (fetcher.data?.message) {
      onMessage(fetcher.data.message);
    }

    if (fetcher.data?.latestReportUrl) {
      onReportGenerated(fetcher.data.latestReportUrl);
    }
  }, [fetcher.data, onMessage, onReportGenerated]);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>

        <Text as="p" tone="subdued">
          {description}
        </Text>

        <ButtonGroup>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={generateIntent} />
            <Button submit loading={isGenerating} disabled={isGenerating}>
              Generate report
            </Button>
          </fetcher.Form>

          <Button url={currentReportUrl || undefined} disabled={!currentReportUrl}>
            View latest report
          </Button>
        </ButtonGroup>
      </BlockStack>
    </Card>
  );
}

export default function ToolsPage() {
  const { latestMarginReportUrl, latestDiscountReportUrl } = useLoaderData();
  const location = useLocation();
  const [toast, setToast] = useState("");
  const [marginReportUrl, setMarginReportUrl] = useState(latestMarginReportUrl);
  const [discountReportUrl, setDiscountReportUrl] = useState(
    latestDiscountReportUrl,
  );

  if (location.pathname !== "/app/tools") {
    return <Outlet />;
  }

  return (
    <Frame>
      <Page title="Pryxo Bulk Price Editor">
        <TitleBar title="Tools" />

        <Layout>
          <Layout.Section>
            <ToolCard
              title="View products margin"
              description="Analyze gross margins across your catalog. See price, cost, and margin for each variant to identify pricing opportunities."
              generateIntent="generate_margin_report"
              latestReportUrl={marginReportUrl}
              onReportGenerated={setMarginReportUrl}
              onMessage={setToast}
            />
          </Layout.Section>

          <Layout.Section>
            <ToolCard
              title="View products with discount"
              description="Find products that still have compare-at prices set - from manual edits or other apps. Review them before running a cleanup task."
              generateIntent="generate_discount_report"
              latestReportUrl={discountReportUrl}
              onReportGenerated={setDiscountReportUrl}
              onMessage={setToast}
            />
          </Layout.Section>
        </Layout>
      </Page>

      {toast ? <Toast content={toast} onDismiss={() => setToast("")} /> : null}
    </Frame>
  );
}
