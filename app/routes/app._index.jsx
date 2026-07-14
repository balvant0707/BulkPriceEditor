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
  List,
  Divider,
  Image,
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
  { id: "pending", label: "Pending", url: "/app/tasks" },
  { id: "applying", label: "Applying", url: "/app/tasks" },
  { id: "completed", label: "Completed", url: "/app/tasks?status=completed" },
  { id: "cancelled", label: "Cancelled", url: "/app/tasks?status=cancelled" },
];

const saleStatDefinitions = [
  { id: "all", label: "All sales", url: "/app/sales" },
  { id: "pending", label: "Pending", url: "/app/sales" },
  { id: "applying", label: "Applying", url: "/app/sales" },
  { id: "active", label: "Active", url: "/app/sales?status=active" },
  { id: "scheduled", label: "Scheduled", url: "/app/sales?status=scheduled" },
  { id: "completed", label: "Completed", url: "/app/sales?status=completed" },
  { id: "canceling", label: "Canceling", url: "/app/sales?status=completed" },
  { id: "canceled", label: "Canceled", url: "/app/sales?status=completed" },
  { id: "failed", label: "Failed", url: "/app/sales?status=completed" },
];

const changelogItems = [
  {
    text: "You can now choose which minute of the hour auto-reapply runs for sales and tasks.",
    month: "Jun'26",
    url: "",
  },
  {
    text: "You can now edit markets that share a catalog with other markets.",
    month: "Jun'26",
    url: "",
  },
  {
    text: "You can now exclude discounted products alongside other exclusions.",
    month: "May'26",
    url: "",
  },
];

function taskMatchesStatus(task, statusId) {
  if (statusId === "all") {
    return true;
  }

  const status = String(task.status || "").toLowerCase();

  if (statusId === "pending") {
    return status === "pending";
  }

  if (statusId === "applying") {
    return status === "applying";
  }

  if (statusId === "completed") {
    return (
      status === "complete" ||
      status.includes("completed") ||
      status.includes("success")
    );
  }

  if (statusId === "cancelled") {
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

  if (statusId === "pending") {
    return status === SALE_STATUS.PENDING;
  }

  if (statusId === "applying") {
    return status === SALE_STATUS.APPLYING;
  }

  if (statusId === "canceling") {
    return status === SALE_STATUS.CANCELING;
  }

  if (statusId === "canceled") {
    return status === SALE_STATUS.CANCELED;
  }

  if (statusId === "failed") {
    return status === SALE_STATUS.FAILED;
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
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
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

function OverviewCard({ stats }) {
  return (
    <Card>
      <InlineStack gap="800" align="start" wrap>
        <BlockStack gap="100">
          <Text as="p" tone="subdued">
            Total changes
          </Text>
          <Text as="p" variant="headingLg">
            {stats.totalChanges}
          </Text>
        </BlockStack>

        <BlockStack gap="100">
          <Text as="p" tone="subdued">
            Saved time
          </Text>
          <Text as="p" variant="headingLg">
            {stats.savedTime}
          </Text>
          <Text as="p" tone="subdued">
            Estimated at 30 seconds per manual change.
          </Text>
        </BlockStack>
      </InlineStack>
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

function WhatsNewCard() {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h2" variant="headingMd">
          What&apos;s new
        </Text>

        <List type="bullet">
          {changelogItems.map((item) => (
            <List.Item key={item.url}>
              {item.text}{" "}
              <Link url={item.url} external>
                Learn more
              </Link>{" "}
              ({item.month})
            </List.Item>
          ))}
        </List>

        <Box>
          <Button url="https://app.bulkpriceeditor.com/changelog" external>
            View full changelog
          </Button>
        </Box>
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
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Need help?
              </Text>

              <Text as="p" tone="subdued">
                We are here for you. For assistance, contact our support team or
                check the documentation for common setup questions.
              </Text>
            </BlockStack>

            <InlineStack gap="300" align="start" wrap>
              <Button
                url="https://help.platmart.io/collection/170-platmart-price-editor"
                external
              >
                View documentation
              </Button>

              <Button url="https://platmart.io/contact" external>
                Contact support
              </Button>
            </InlineStack>
          </BlockStack>
        </Box>

        <Box width="140px">
          <Image
            source="/image/needhelp.png"
            alt="Need help"
            style={{
              width: "120px",
              height: "120px",
              borderRadius: "24px",
              objectFit: "cover",
            }}
          />
        </Box>
      </InlineStack>
    </Card>
  );
}

function FooterLinks() {
  return (
    <Box paddingBlockStart="200" paddingBlockEnd="200">
      <Divider />

      <Box paddingBlockStart="200">
        <InlineStack align="center" gap="200">
          <Link url="https://platmart.io/terms/" external>
            Terms of Service
          </Link>

          <Text as="span" tone="subdued">
            /
          </Text>

          <Link url="https://platmart.io/privacy/" external>
            Privacy Policy
          </Link>
        </InlineStack>
      </Box>
    </Box>
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
          <Layout.Section>
            <OverviewCard stats={overviewStats} />
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
            <WhatsNewCard />
          </Layout.Section>

          <Layout.Section>
            <HelpCard />
          </Layout.Section>

          <Layout.Section>
            <FooterLinks />
          </Layout.Section>
        </Layout>
      </Page>
    </>
  );
}
