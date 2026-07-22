// app/routes/app._index.jsx
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Icon,
  Text,
  Button,
  InlineGrid,
  InlineStack,
  BlockStack,
  Box,
  Link,
} from "@shopify/polaris";
import {
  ChartHistogramGrowthIcon,
  ClockIcon,
  DiscountIcon,
  ProductIcon,
} from "@shopify/polaris-icons";
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

const dashboardMetricIconStyle = {
  width: 52,
  height: 52,
  borderRadius: 12,
  display: "grid",
  placeItems: "center",
  flex: "0 0 52px",
};

const dashboardMetricCardStyle = {
  minHeight: 200,
  height: 200,
  display: "flex",
  flexDirection: "column",
};

const dashboardMetricCardInnerStyle = {
  height: "100%",
};

const dashboardMetricContentStyle = {
  height: 140,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  overflow: "hidden",
};

const dashboardMetricTextLineStyle = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  minWidth: 0,
  whiteSpace: "nowrap",
};

const dashboardSparklineStyle = {
  width: 120,
  height: 56,
  flex: "0 0 120px",
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
  { id: "completed", label: "Completed", url: "/app/sales?status=Canceled" },
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

function getPeriodBounds() {
  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - 30);
  const previousStart = new Date(now);
  previousStart.setDate(previousStart.getDate() - 60);

  return { now, currentStart, previousStart };
}

function isInRange(date, start, end) {
  if (!date) {
    return false;
  }

  const value = new Date(date).getTime();
  return value >= start.getTime() && value < end.getTime();
}

function countRecordsInRange(records, start, end) {
  return records.filter((record) => isInRange(record.createdAt, start, end)).length;
}

function sumChangesInRange(records, start, end) {
  return records.reduce((sum, record) => {
    if (!isInRange(record.createdAt, start, end)) {
      return sum;
    }

    return sum + getRecordChangeCount(record);
  }, 0);
}

function getTrendLabel(currentValue, previousValue) {
  if (!currentValue && !previousValue) {
    return "No changes";
  }

  if (!previousValue) {
    return currentValue ? "New" : "No changes";
  }

  const percent = Math.round(((currentValue - previousValue) / previousValue) * 100);
  return `${percent >= 0 ? "up " : "down "}${Math.abs(percent)}%`;
}

function buildDailySeries(records, getDate, getValue = () => 1, days = 12) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const buckets = new Map();

  for (let index = 0; index < days; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    buckets.set(date.toISOString().slice(0, 10), 0);
  }

  for (const record of records) {
    const rawDate = getDate(record);
    if (!rawDate) continue;

    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime()) || date < start || date > now) continue;

    const key = date.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + Math.max(0, Number(getValue(record)) || 0));
  }

  return [...buckets.entries()].map(([date, value]) => ({ date, value }));
}

function buildOverviewStats(tasks, sales, taskAuditLogs) {
  const { now, currentStart, previousStart } = getPeriodBounds();
  const totalTaskChanges = taskAuditLogs.length;
  const totalSaleChanges = sales.reduce(
    (sum, sale) => sum + getRecordChangeCount(sale),
    0,
  );
  const totalChanges = totalTaskChanges + totalSaleChanges;
  const currentTaskChanges = countRecordsInRange(taskAuditLogs, currentStart, now);
  const previousTaskChanges = countRecordsInRange(taskAuditLogs, previousStart, currentStart);
  const currentSaleChanges = sumChangesInRange(sales, currentStart, now);
  const previousSaleChanges = sumChangesInRange(sales, previousStart, currentStart);
  const currentChanges = currentTaskChanges + currentSaleChanges;
  const previousChanges = previousTaskChanges + previousSaleChanges;
  const changeRecords = [
    ...taskAuditLogs.map((log) => ({ createdAt: log.createdAt, value: 1 })),
    ...sales.map((sale) => ({
      createdAt: sale.createdAt,
      value: getRecordChangeCount(sale),
    })),
  ];
  const changesChart = buildDailySeries(
    changeRecords,
    (record) => record.createdAt,
    (record) => record.value,
  );

  return {
    tasks: tasks.length,
    sales: sales.length,
    changes: totalChanges,
    totalChanges: formatInteger(totalChanges),
    savedTime: formatSavedTime(totalChanges),
    tasksTrend: getTrendLabel(
      countRecordsInRange(tasks, currentStart, now),
      countRecordsInRange(tasks, previousStart, currentStart),
    ),
    salesTrend: getTrendLabel(
      countRecordsInRange(sales, currentStart, now),
      countRecordsInRange(sales, previousStart, currentStart),
    ),
    changesTrend: getTrendLabel(currentChanges, previousChanges),
    savedTimeTrend: getTrendLabel(
      Math.round(currentChanges * 0.5),
      Math.round(previousChanges * 0.5),
    ),
    tasksChart: buildDailySeries(tasks, (task) => task.createdAt),
    salesChart: buildDailySeries(sales, (sale) => sale.createdAt),
    changesChart,
    savedTimeChart: changesChart.map((point) => ({
      ...point,
      value: Math.round(point.value * 0.5),
    })),
  };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const [tasks, sales, taskAuditLogs] = await Promise.all([
    db.task.findMany({
      where: { shop: session.shop },
      select: { status: true, executionSummary: true, createdAt: true },
    }),
    db.sale.findMany({
      where: { shop: session.shop },
      select: { status: true, executionSummary: true, createdAt: true },
    }),
    db.taskAuditLog.findMany({
      where: { shop: session.shop, action: "applied" },
      select: { createdAt: true },
    }),
  ]);

  return json({
    overviewStats: buildOverviewStats(tasks, sales, taskAuditLogs),
    taskStats: buildStats(taskStatDefinitions, tasks, taskMatchesStatus),
    saleStats: buildStats(saleStatDefinitions, sales, saleMatchesStatus),
  });
};

function MetricCard({ title, value, subtitle, icon, color, trend = "No changes", chart = [] }) {
  const isQuietTrend = trend === "No changes";

  return (
    <div style={dashboardMetricCardStyle}>
      <div style={dashboardMetricCardInnerStyle}>
      <Card>
      <div style={dashboardMetricContentStyle}>
        <InlineStack align="space-between" blockAlign="start" gap="400" wrap={false}>
          <div style={{ ...dashboardMetricIconStyle, background: color.background, color: color.foreground }}>
            <Icon source={icon} />
          </div>
          <DashboardSparkline color={color.foreground} data={chart} flat={isQuietTrend} />
        </InlineStack>
        <div style={dashboardMetricTextLineStyle}>
          <Text as="span" fontWeight="semibold">
            {title}
          </Text>
          <Text as="span" variant="headingXl">
            {value}
          </Text>
          <Text as="span">{subtitle}</Text>
        </div>
        <Text as="span" tone={isQuietTrend ? "subdued" : trend.startsWith("down") ? "critical" : "success"} fontWeight="semibold">
          {isQuietTrend ? trend : `${trend} from last 30 days`}
        </Text>
      </div>
    </Card>
      </div>
    </div>
  );
}

function DashboardSparkline({ color, data = [], flat = false }) {
  const safeData = Array.isArray(data) ? data : [];
  const values = safeData.length ? safeData.map((point) => Math.max(0, Number(point.value) || 0)) : [0];
  const maxValue = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = 8 + index * (104 / Math.max(1, values.length - 1));
    const y = 8 + 38 - (value / maxValue) * 38;
    return { x, y };
  });
  const linePoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaPoints = `${linePoints} 112,54 8,54`;

  if (flat || !values.some(Boolean)) {
    return (
      <svg viewBox="0 0 120 56" role="img" aria-label="No change chart" style={dashboardSparklineStyle}>
        <line x1="8" y1="30" x2="112" y2="30" stroke={color} strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 120 56" role="img" aria-label="Trend chart" style={dashboardSparklineStyle}>
      <polygon points={areaPoints} fill={color} opacity="0.08" />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatsCard({
  title,
  description,
  actionLabel,
  actionLoading = false,
  onAction,
  stats,
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
            variant="primary"
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
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 10,
            overflowX: "auto",
          }}
        >
          {recommendedApps.map((app) => (
            <div
              key={app.name}
              style={{
                border: "1px solid #e1e3e5",
                padding: 10,
                minHeight: 200,
                minWidth: 220,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 5,
                background: "#ffffff",
              }}
            >
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center" gap="300">
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

                <Text as="p" fontWeight="semibold">
                  {app.name}
                </Text>

                <Text as="p" tone="subdued">
                  {app.description}
                </Text>
              </BlockStack>

              <div>
                <Button url={app.url} external variant="primary" target="_blank">
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
      <InlineStack gap="500" align="space-between" paddingBlockEnd="500" blockAlign="center" wrap>
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
              <Button url="#" external>
                Contact support
              </Button>

              <Button
                url="#"
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
      <TitleBar title="Pryxo Bulk Price Editor" />

      <Page title="Dashboard">
        <Layout>
          <Layout.Section>
            <Box paddingBlockEnd="00">
              <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                <MetricCard
                  title="Tasks"
                  value={formatInteger(overviewStats.tasks || 0)}
                  subtitle="items"
                  icon={ProductIcon}
                  color={{ background: "#dff7ee", foreground: "#008060" }}
                  trend={overviewStats.tasksTrend}
                  chart={overviewStats.tasksChart}
                />
                <MetricCard
                  title="Sales"
                  value={formatInteger(overviewStats.sales || 0)}
                  subtitle="items"
                  icon={DiscountIcon}
                  color={{ background: "#ede9fe", foreground: "#5b21b6" }}
                  trend={overviewStats.salesTrend}
                  chart={overviewStats.salesChart}
                />
                <MetricCard
                  title="Changes"
                  value={overviewStats.totalChanges}
                  subtitle="items"
                  icon={ChartHistogramGrowthIcon}
                  color={{ background: "#fff7ed", foreground: "#c2410c" }}
                  trend={overviewStats.changesTrend}
                  chart={overviewStats.changesChart}
                />
                <MetricCard
                  title="Saved time"
                  value={overviewStats.savedTime}
                  subtitle="saved"
                  icon={ClockIcon}
                  color={{ background: "#dbeafe", foreground: "#1d4ed8" }}
                  trend={overviewStats.savedTimeTrend}
                  chart={overviewStats.savedTimeChart}
                />
              </InlineGrid>
            </Box>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <StatsCard
              title="Tasks"
              description="Bulk edit prices in your shop."
              actionLabel="Create task"
              onAction={() => openPage("/app/tasks/new")}
              actionLoading={openingPath === "/app/tasks/new"}
              stats={taskStats}
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
