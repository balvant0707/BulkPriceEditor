// app/routes/app._index.jsx
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  InlineStack,
  BlockStack,
  Box,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "@remix-run/react";
import { useState } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { withShopifyEmbeddedParams } from "../lib/shopify-embedded-url";
import { normalizeSaleStatus, SALE_STATUS } from "../lib/sale-status";

const statsRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "5px 0",
};

const statsValueStyle = {
  fontWeight: 600,
  color: "#202223",
};

const taskStatDefinitions = [
  { id: "all", label: "All tasks", url: "/app/tasks" },
  { id: "completed", label: "Completed", url: "/app/tasks?status=completed" },
  { id: "archived", label: "Archived", url: "/app/tasks" },
  { id: "canceled", label: "Canceled", url: "/app/tasks?status=cancelled" },
];

const saleStatDefinitions = [
  { id: "all", label: "All sales", url: "/app/sales" },
  { id: "active", label: "Active", url: "/app/sales?status=active" },
  { id: "scheduled", label: "Scheduled", url: "/app/sales?status=scheduled" },
  { id: "completed", label: "Completed", url: "/app/sales?status=completed" },
];

const recommendedApps = [
  {
    name: "Fomoify Sales Popup & Proof",
    description:
      "Increase trust using real-time sales popups and conversion proof nudges.",
    category: "Social Proof",
    url: "https://apps.shopify.com/fomoify-sales-popup-proof",
    image: "/image/CKapsur_zpUDEAE=.png",
  },
  {
    name: "MixBox - Box & Bundle Builder",
    description:
      "Build custom bundles and boxed products to increase average order value.",
    category: "Bundle",
    url: "https://apps.shopify.com/mixbox-box-bundle-builder",
    image: "/image/CL-nruWY_pMDEAE=.png",
  },
  {
    name: "Nex AI SEO Product Description",
    description:
      "Generate SEO-friendly content to improve visibility and conversion.",
    category: "SEO",
    url: "https://apps.shopify.com/ai-seo-product-description",
    image: "/image/CJbj1a_i9pQDEAE=.png",
  },
  {
    name: "CartLift: Cart Drawer & Upsell",
    description:
      "Create a high-converting cart drawer with upsells and progress offers.",
    category: "Upsell",
    url: "https://apps.shopify.com/cartlift-slide-cart-drawer-upsell",
    image: "/image/b55a28208623440fd6a8987892e4aec3_200x200.png",
  },
];

function taskMatchesStatus(task, statusId) {
  if (statusId === "all") {
    return true;
  }

  const status = String(task.status || "").toLowerCase();

  if (statusId === "completed") {
    return (
      status === "complete" ||
      status.includes("completed") ||
      status.includes("success")
    );
  }

  if (statusId === "archived") {
    return status.includes("archived");
  }

  if (statusId === "canceled") {
    return (
      status.includes("cancel") ||
      status.includes("rollback") ||
      status.includes("rolled back") ||
      status.includes("failed") ||
      status.includes("error")
    );
  }

  return false;
}

function saleMatchesStatus(sale, statusId) {
  if (statusId === "all") {
    return true;
  }

  const status = normalizeSaleStatus(sale.status);

  if (statusId === "completed") {
    return status === SALE_STATUS.COMPLETED;
  }

  if (statusId === "active") {
    return status === SALE_STATUS.COMPLETED;
  }

  if (statusId === "scheduled") {
    return status === SALE_STATUS.SCHEDULED;
  }

  return status === statusId;
}

function buildStats(definitions, records, matcher) {
  return definitions.map((definition) => ({
    ...definition,
    value: records.filter((record) => matcher(record, definition.id)).length,
  }));
}

function getExecutionSummary(record) {
  return record?.executionSummary &&
    typeof record.executionSummary === "object" &&
    !Array.isArray(record.executionSummary)
    ? record.executionSummary
    : {};
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return 0;
}

function getRecordChangeCount(record) {
  const summary = getExecutionSummary(record);
  const rollback = getExecutionSummary({ executionSummary: summary.rollback });
  const ended = getExecutionSummary({ executionSummary: summary.ended });
  const logChanges = Array.isArray(summary.logs)
    ? summary.logs.reduce(
        (sum, log) => sum + Math.max(1, Array.isArray(log?.changes) ? log.changes.length : 0),
        0,
      )
    : undefined;

  return firstFiniteNumber(
    summary.totalPriceChanges,
    summary.updatedVariants,
    summary.variantUpdates,
    summary.updatedInventoryItems,
    summary.addedVariants,
    summary.removedVariants,
    summary.taggedProducts,
    rollback.updatedVariants,
    rollback.totalPriceChanges,
    ended.updatedVariants,
    ended.totalPriceChanges,
    logChanges,
  );
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatSavedTime(totalChanges) {
  const totalMinutes = Math.round(totalChanges * 0.5);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function buildOverviewStats(tasks, sales) {
  const totalChanges = [...tasks, ...sales].reduce(
    (sum, record) => sum + getRecordChangeCount(record),
    0,
  );

  return {
    totalChanges: formatInteger(totalChanges),
    savedTime: formatSavedTime(totalChanges),
  };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const [tasks, sales] = await Promise.all([
    db.task.findMany({
      where: { shop: session.shop },
      select: { status: true, executionSummary: true },
    }),
    db.sale.findMany({
      where: { shop: session.shop },
      select: { status: true, executionSummary: true },
    }),
  ]);

  return json({
    overviewStats: buildOverviewStats(tasks, sales),
    taskStats: buildStats(taskStatDefinitions, tasks, taskMatchesStatus),
    saleStats: buildStats(saleStatDefinitions, sales, saleMatchesStatus),
  });
};

function MetricCard({ title, value }) {
  return (
    <Card>
      <Box paddingBlock="300">
        <BlockStack gap="200" align="center" inlineAlign="center">
          <Text as="h2" variant="headingMd" alignment="center">
            {title}
          </Text>
          <Text as="p" variant="headingLg" alignment="center">
            {value}
          </Text>
        </BlockStack>
      </Box>
    </Card>
  );
}

function StatsCard({
  title,
  description,
  actionLabel,
  actionLoading = false,
  onAction,
  stats,
  learnMoreUrl,
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>

          <Button
            onClick={onAction}
            variant="plain"
            loading={actionLoading}
            disabled={actionLoading}
          >
            {actionLabel}
          </Button>
        </InlineStack>

        <Text as="p" tone="subdued">
          {description}
        </Text>

        <BlockStack gap="0">
          {stats.map((item) => (
            <div key={item.label} style={statsRowStyle}>
              <Link url={item.url} monochrome>
                {item.label}
              </Link>

              <span style={statsValueStyle}>{item.value}</span>
            </div>
          ))}
        </BlockStack>

        <Box>
          <Button url={learnMoreUrl} external>
            Learn more
          </Button>
        </Box>
      </BlockStack>
    </Card>
  );
}

function RecommendedAppsSection() {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Recommended Our Growth Apps
        </Text>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
          }}
        >
          {recommendedApps.map((app) => (
            <div
              key={app.name}
              style={{
                border: "1px solid #e1e3e5",
                padding: 20,
                minHeight: 194,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 16,
                background: "#ffffff",
              }}
            >
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="start" gap="300">
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    <img
                      src={app.image}
                      alt=""
                      width="48"
                      height="48"
                      style={{
                        borderRadius: 6,
                        flex: "0 0 auto",
                        objectFit: "cover",
                      }}
                    />

                    <Text as="h3" variant="headingMd">
                      {app.name}
                    </Text>
                  </InlineStack>

                  <Box
                    background="bg-fill-secondary"
                    paddingBlock="150"
                    paddingInline="300"
                    borderRadius="200"
                  >
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {app.category}
                    </Text>
                  </Box>
                </InlineStack>

                <Text as="p" tone="subdued">
                  {app.description}
                </Text>
              </BlockStack>

              <div>
                <Button url={app.url} external variant="primary">
                  View app
                </Button>
              </div>
            </div>
          ))}
        </div>
      </BlockStack>
    </Card>
  );
}

function HelpCard() {
  return (
    <Card>
      <InlineStack gap="500" align="space-between" blockAlign="center" wrap>
        <Box width="calc(100% - 180px)">
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Need help?
            </Text>

            <Text as="p">
              We are here for you. For assistance, click support button in the
              corner of your screen. We also provide a comprehensive
              documentation with answers to most common questions.
            </Text>

            <InlineStack gap="300" align="start" wrap>
              <Button url="https://platmart.io/contact" external>
                Contact support
              </Button>

              <Button
                url="https://help.platmart.io/collection/170-platmart-price-editor"
                variant="plain"
                external
              >
                View documentation
              </Button>
            </InlineStack>
          </BlockStack>
        </Box>

        <Box
          width="128px"
          minHeight="128px"
          borderRadius="300"
          background="bg-fill-info"
        >
          <div
            aria-hidden="true"
            style={{
              width: 128,
              height: 128,
              borderRadius: 16,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontSize: 72,
              lineHeight: 1,
              background:
                "linear-gradient(135deg, #2457ff 0%, #7c3aed 52%, #ff7a59 100%)",
            }}
          >
            ?
          </div>
        </Box>
      </InlineStack>
    </Card>
  );
}

export default function AppIndex() {
  const { overviewStats, taskStats, saleStats } = useLoaderData();
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const nextPath = navigation.location?.pathname;
  const [pendingPath, setPendingPath] = useState("");
  const openingPath = nextPath || pendingPath;

  const openPage = (path) => {
    const target = withShopifyEmbeddedParams(path, location.search);
    setPendingPath(path);
    navigate(target);
  };

  return (
    <>
      <TitleBar title="Pryxo Price Editor" />

      <Page title="Pryxo Price Editor">
        <Layout>
          <Layout.Section variant="oneHalf">
            <MetricCard
              title="Total price changes"
              value={overviewStats.totalChanges}
            />
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <MetricCard
              title="Saved time"
              value={overviewStats.savedTime}
            />
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <StatsCard
              title="Tasks"
              description="Bulk edit prices in your shop."
              actionLabel="Create task"
              onAction={() => openPage("/app/tasks/new")}
              actionLoading={openingPath === "/app/tasks/new"}
              stats={taskStats}
              learnMoreUrl="#"
            />
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <StatsCard
              title="Sales"
              description="Run manual or scheduled sales."
              actionLabel="Create sale"
              onAction={() => openPage("/app/sales/new")}
              actionLoading={openingPath === "/app/sales/new"}
              stats={saleStats}
              learnMoreUrl="#"
            />
          </Layout.Section>

          <Layout.Section>
            <RecommendedAppsSection />
          </Layout.Section>

          <Layout.Section>
            <HelpCard />
          </Layout.Section>
        </Layout>
      </Page>
    </>
  );
}
