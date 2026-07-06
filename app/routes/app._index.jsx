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
import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import { useState } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

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
  { id: "archived", label: "Archived", url: "/app/tasks?status=archived" },
  { id: "canceled", label: "Canceled", url: "/app/tasks?status=canceled" },
];

const saleStatDefinitions = [
  { id: "all", label: "All sales", url: "/app/sales" },
  { id: "active", label: "Active", url: "/app/sales?status=active" },
  { id: "scheduled", label: "Scheduled", url: "/app/sales?status=scheduled" },
  { id: "completed", label: "Completed", url: "/app/sales?status=completed" },
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

  const status = String(sale.status || "").toLowerCase();

  if (statusId === "completed") {
    return (
      status === "complete" ||
      status === "completed" ||
      status === "finished" ||
      status === "ended"
    );
  }

  return status === statusId;
}

function buildStats(definitions, records, matcher) {
  return definitions.map((definition) => ({
    ...definition,
    value: records.filter((record) => matcher(record, definition.id)).length,
  }));
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const [tasks, sales] = await Promise.all([
    db.task.findMany({
      where: { shop: session.shop },
      select: { status: true },
    }),
    db.sale.findMany({
      where: { shop: session.shop },
      select: { status: true },
    }),
  ]);

  return json({
    taskStats: buildStats(taskStatDefinitions, tasks, taskMatchesStatus),
    saleStats: buildStats(saleStatDefinitions, sales, saleMatchesStatus),
  });
};

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
  const { taskStats, saleStats } = useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const nextPath = navigation.location?.pathname;
  const [pendingPath, setPendingPath] = useState("");
  const openingPath = nextPath || pendingPath;

  const openPage = (path) => {
    setPendingPath(path);
    navigate(path);
  };

  return (
    <>
      <TitleBar title="Pryxo Price Editor" />

      <Page title="Pryxo Price Editor">
        <Layout>
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
