// app/routes/app.tools.jsx
import { json } from "@remix-run/node";
import {
  useFetcher,
  useLoaderData,
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
import db from "../db.server";
import { authenticate } from "../shopify.server";

const REPORT_TYPES = {
  margin: "margin",
  discount: "discount",
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);

  return json({
    latestMarginReportUrl: await getLatestReportUrl(shop, REPORT_TYPES.margin),
    latestDiscountReportUrl: await getLatestReportUrl(shop, REPORT_TYPES.discount),
  });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "generate_margin_report") {
    const report = await createReportRecord(shop, REPORT_TYPES.margin);

    return json({
      ok: true,
      type: REPORT_TYPES.margin,
      message: report.created
        ? "Margin report generation started."
        : "Margin report action received. Add your report generation logic to this action.",
      latestReportUrl: report.url,
    });
  }

  if (intent === "generate_discount_report") {
    const report = await createReportRecord(shop, REPORT_TYPES.discount);

    return json({
      ok: true,
      type: REPORT_TYPES.discount,
      message: report.created
        ? "Discount report generation started."
        : "Discount report action received. Add your report generation logic to this action.",
      latestReportUrl: report.url,
    });
  }

  return json({ ok: false, message: "Unknown action." }, { status: 400 });
}

function normalizeShop(shop) {
  return String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();
}

function getReportModel(type) {
  if (type === REPORT_TYPES.margin) {
    return (
      db.marginReport ||
      db.marginreport ||
      db.productMarginReport ||
      db.productmarginreport ||
      db.report ||
      null
    );
  }

  if (type === REPORT_TYPES.discount) {
    return (
      db.discountReport ||
      db.discountreport ||
      db.productDiscountReport ||
      db.productdiscountreport ||
      db.report ||
      null
    );
  }

  return null;
}

function getReportPath(type, id) {
  if (!id) return "";

  if (type === REPORT_TYPES.margin) {
    return `/app/tools/margin-reports/${id}`;
  }

  if (type === REPORT_TYPES.discount) {
    return `/app/tools/discount-reports/${id}`;
  }

  return "";
}

async function getLatestReportUrl(shop, type) {
  const model = getReportModel(type);

  if (!model?.findFirst || !shop) return "";

  try {
    const where = model === db.report ? { shop, type } : { shop };
    const report = await model.findFirst({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });

    return report?.id ? getReportPath(type, report.id) : "";
  } catch (error) {
    console.error(`[tools.loader] Failed to load latest ${type} report`, error);
    return "";
  }
}

async function createReportRecord(shop, type) {
  const model = getReportModel(type);

  if (!model?.create || !shop) {
    return {
      created: false,
      url: "",
    };
  }

  try {
    const createData =
      model === db.report
        ? { shop, type, status: "Pending" }
        : { shop, status: "Pending" };

    const report = await model.create({ data: createData });

    return {
      created: true,
      url: getReportPath(type, report.id),
    };
  } catch (error) {
    console.error(`[tools.action] Failed to create ${type} report`, error);
    return {
      created: false,
      url: "",
    };
  }
}

function ToolCard({
  title,
  description,
  generateIntent,
  latestReportUrl,
  onMessage,
}) {
  const fetcher = useFetcher();
  const isGenerating = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) {
      onMessage(fetcher.data.message);
    }
  }, [fetcher.data, onMessage]);

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

          <Button url={latestReportUrl || undefined} disabled={!latestReportUrl}>
            View latest report
          </Button>
        </ButtonGroup>
      </BlockStack>
    </Card>
  );
}

export default function ToolsPage() {
  const { latestMarginReportUrl, latestDiscountReportUrl } = useLoaderData();
  const [toast, setToast] = useState("");

  return (
    <Frame>
      <Page title="Tools">
        <TitleBar title="Tools" />

        <Layout>
          <Layout.Section>
            <ToolCard
              title="View products margin"
              description="Analyze gross margins across your catalog. See price, cost, and margin for each variant to identify pricing opportunities."
              generateIntent="generate_margin_report"
              latestReportUrl={latestMarginReportUrl}
              onMessage={setToast}
            />
          </Layout.Section>

          <Layout.Section>
            <ToolCard
              title="View products with discount"
              description="Find products that still have compare-at prices set - from manual edits or other apps. Review them before running a cleanup task."
              generateIntent="generate_discount_report"
              latestReportUrl={latestDiscountReportUrl}
              onMessage={setToast}
            />
          </Layout.Section>
        </Layout>
      </Page>

      {toast ? <Toast content={toast} onDismiss={() => setToast("")} /> : null}
    </Frame>
  );
}
