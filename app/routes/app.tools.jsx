// app/routes/app.tools.jsx
import { json, redirect } from "@remix-run/node";
import {
  Outlet,
  useLocation,
  useSubmit,
} from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  generateProductReport,
} from "../lib/product-reports.server";
import {
  normalizeShop,
  REPORT_TYPES,
} from "../lib/product-reports";
import { withShopifyEmbeddedParams } from "../lib/shopify-embedded-url";

export async function loader({ request }) {
  await authenticate.admin(request);

  return json({});
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const formData = await request.formData();
  const reportType = formData.get("reportType");

  if (!Object.values(REPORT_TYPES).includes(reportType)) {
    throw new Response("Invalid report type", { status: 400 });
  }

  const report = await generateProductReport(admin, shop, reportType);
  const url = new URL(request.url);

  return redirect(withShopifyEmbeddedParams(report.url, url.search, shop));
}

function ToolCard({
  title,
  description,
  reportType,
}) {
  const submit = useSubmit();

  const handleViewLatestReport = () => {
    const formData = new FormData();
    formData.set("reportType", reportType);
    submit(formData, { method: "post" });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>

        <Text as="p" tone="subdued">
          {description}
        </Text>

        <div>
          <Button onClick={handleViewLatestReport}>View latest report</Button>
        </div>
      </BlockStack>
    </Card>
  );
}

export default function ToolsPage() {
  const location = useLocation();

  if (location.pathname !== "/app/tools") {
    return <Outlet />;
  }

  return (
    <Page title="Tools">
      <TitleBar title="Pryxo Bulk Price Editor" />

      <Layout>
        <Layout.Section>
          <ToolCard
            title="View products margin"
            description="Analyze gross margins across your catalog. See price, cost, and margin for each variant to identify pricing opportunities."
            reportType={REPORT_TYPES.margin}
          />
        </Layout.Section>

        <Layout.Section>
          <ToolCard
            title="View products with discount"
            description="Find products that still have compare-at prices set - from manual edits or other apps. Review them before running a cleanup task."
            reportType={REPORT_TYPES.discount}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
