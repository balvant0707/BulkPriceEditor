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

const cardMinHeight = {
  minHeight: "100%",
};

const taskStats = [
  { label: "All tasks", value: 0, url: "/tasks" },
  { label: "Completed", value: 0, url: "/tasks?status=completed" },
  { label: "Archived", value: 0, url: "/tasks?status=archived" },
  { label: "Canceled", value: 0, url: "/tasks?status=canceled" },
];

const saleStats = [
  { label: "All sales", value: 0, url: "/sales" },
  { label: "Active", value: 0, url: "/sales?status=active" },
  { label: "Scheduled", value: 0, url: "/sales?status=scheduled" },
  { label: "Completed", value: 0, url: "/sales?status=completed" },
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
      <div style={cardMinHeight}>
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
                <Link url={item.url} monochrome removeUnderline>
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
      </div>
    </Card>
  );
}

function YouTubeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="#FF0000"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
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
          <Button
            url="https://app.bulkpriceeditor.com/changelog"
            external
          >
            View full changelog
          </Button>
        </Box>
      </BlockStack>
    </Card>
  );
}

function VideoTutorialCard() {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Video tutorials
        </Text>

        <a
          href="https://youtu.be/tgK8qUpq_O4"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            padding: "14px 16px",
            border: "1px solid #DADBDD",
            borderRadius: 10,
            textDecoration: "none",
            color: "inherit",
            background: "#fff",
          }}
        >
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <InlineStack gap="300" blockAlign="center">
              <YouTubeIcon />
              <Text as="span" variant="bodyMd">
                Bulk Edit Shopify Prices by Margin - Here&apos;s How
              </Text>
            </InlineStack>

            <Text as="span" tone="subdued">
              ›
            </Text>
          </InlineStack>
        </a>
      </BlockStack>
    </Card>
  );
}

function HelpCard() {
  const openChat = () => {
    if (typeof window !== "undefined" && window.openChat) {
      window.openChat();
      return;
    }

    window.open(
      "https://help.platmart.io/collection/170-platmart-price-editor",
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Need help?
        </Text>

        <Text as="p" tone="subdued">
          We are here for you. For assistance, click support button in the
          corner of your screen. We also provide comprehensive documentation
          with answers to most common questions.
        </Text>

        <InlineStack gap="300">
          <Button onClick={openChat}>Contact support</Button>

          <Button
            url="https://help.platmart.io/collection/170-platmart-price-editor"
            external
            variant="plain"
          >
            View documentation
          </Button>
        </InlineStack>
      </BlockStack>
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
      <TitleBar title="Platmart Price Editor" />

      <Page title="Platmart Price Editor">
        <Layout>
          <Layout.Section variant="oneHalf">
            <StatsCard
              title="Tasks"
              description="Bulk edit prices in your shop."
              actionLabel="Create task"
              actionUrl="/tasks/new"
              stats={taskStats}
              learnMoreUrl="https://help.platmart.io/article/28-how-to-use-tasks"
            />
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <StatsCard
              title="Sales"
              description="Run manual or scheduled sales."
              actionLabel="Create sale"
              actionUrl="/sales/new"
              stats={saleStats}
              learnMoreUrl="https://help.platmart.io/article/29-how-to-use-sales"
            />
          </Layout.Section>

          <Layout.Section>
            <WhatsNewCard />
          </Layout.Section>

          <Layout.Section>
            <VideoTutorialCard />
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