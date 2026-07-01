// app/routes/app._index.jsx
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

const statsRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 0",
  borderBottom: "1px solid #EBEBEB",
};

const statsValueStyle = {
  fontWeight: 600,
  color: "#202223",
};

const taskStats = [
  { label: "All tasks", value: 0, url: "/app/tasks" },
  { label: "Completed", value: 0, url: "/app/tasks?status=completed" },
  { label: "Archived", value: 0, url: "/app/tasks?status=archived" },
  { label: "Canceled", value: 0, url: "/app/tasks?status=canceled" },
];

const saleStats = [
  { label: "All sales", value: 0, url: "/app/sales" },
  { label: "Active", value: 0, url: "/app/sales?status=active" },
  { label: "Scheduled", value: 0, url: "/app/sales?status=scheduled" },
  { label: "Completed", value: 0, url: "/app/sales?status=completed" },
];

const changelogItems = [
  {
    text: "You can now choose which minute of the hour auto-reapply runs for sales and tasks.",
    month: "Jun'26",
    url: "https://platmart.io/changelog/2026-06-19-reapply-minute",
  },
  {
    text: "You can now edit markets that share a catalog with other markets.",
    month: "Jun'26",
    url: "https://platmart.io/changelog/2026-06-05-shared-catalog-editing",
  },
  {
    text: "You can now exclude discounted products alongside other exclusions.",
    month: "May'26",
    url: "https://platmart.io/changelog/2026-05-21-exclude-discounted",
  },
];

function StatsCard({
  title,
  description,
  actionLabel,
  actionUrl,
  stats,
  learnMoreUrl,
}) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>

          <Button url={actionUrl} variant="plain">
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

        <Box paddingBlockStart="200">
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
      <BlockStack gap="400">
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

        <Box paddingBlockStart="200">
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
          <BlockStack gap="400">
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
            source="/images/needhelp.png"
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
    <Box paddingBlockStart="400" paddingBlockEnd="400">
      <Divider />

      <Box paddingBlockStart="400">
        <InlineStack align="center" gap="200">
          <Link url="https://platmart.io/terms/" external>
            Terms of Service
          </Link>

          <Text as="span" tone="subdued">
            ・
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
              actionUrl="/app/tasks/new"
              stats={taskStats}
              learnMoreUrl="https://help.platmart.io/article/28-how-to-use-tasks"
            />
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <StatsCard
              title="Sales"
              description="Run manual or scheduled sales."
              actionLabel="Create sale"
              actionUrl="/app/sales/new"
              stats={saleStats}
              learnMoreUrl="https://help.platmart.io/article/29-how-to-use-sales"
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