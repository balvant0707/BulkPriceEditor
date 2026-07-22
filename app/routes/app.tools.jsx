// app/routes/app.tools.jsx
import { json } from "@remix-run/node";
import {
  Outlet,
  useLoaderData,
  useLocation,
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
  getLatestReportUrl,
} from "../lib/product-reports.server";
import {
  normalizeShop,
  REPORT_TYPES,
} from "../lib/product-reports";
import { withShopifyEmbeddedParams } from "../lib/shopify-embedded-url";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);

  return json({
    latestMarginReportUrl: await getLatestReportUrl(shop, REPORT_TYPES.margin),
    latestDiscountReportUrl: await getLatestReportUrl(shop, REPORT_TYPES.discount),
  });
}

function ToolCard({
  title,
  description,
  latestReportUrl,
  locationSearch,
}) {
  const currentReportUrl = latestReportUrl
    ? withShopifyEmbeddedParams(latestReportUrl, locationSearch)
    : "";

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
          <Button url={currentReportUrl || undefined} disabled={!currentReportUrl}>
            View latest report
          </Button>
        </div>
      </BlockStack>
    </Card>
  );
}

export default function ToolsPage() {
  const { latestMarginReportUrl, latestDiscountReportUrl } = useLoaderData();
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
            latestReportUrl={latestMarginReportUrl}
            locationSearch={location.search}
          />
        </Layout.Section>

        <Layout.Section>
          <ToolCard
            title="View products with discount"
            description="Find products that still have compare-at prices set - from manual edits or other apps. Review them before running a cleanup task."
            latestReportUrl={latestDiscountReportUrl}
            locationSearch={location.search}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
