// app/routes/app._index.jsx
import { json } from "@remix-run/node";
import {
  Page,
  Card,
  Text,
  Button,
  BlockStack,
  Box,
  Link,
  InlineStack,
  Divider,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({});
};

function StatusRow({ label, count, url = "#" }) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <Link url={url}>
        <Text as="span" tone="magic" fontWeight="medium">
          {label}
        </Text>
      </Link>

      <Text as="span" variant="bodyMd" fontWeight="bold" tone="base">
        {count}
      </Text>
    </InlineStack>
  );
}

function SummaryCard({
  title,
  description,
  actionLabel,
  actionUrl,
  rows,
  badgeTone = "info",
  badgeLabel = "Manage",
  learnMoreUrl = "#",
}) {
  return (
    <Card>
      <Box padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" wrap={false}>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {title}
                </Text>
                <Badge tone={badgeTone}>{badgeLabel}</Badge>
              </InlineStack>

              <Text as="p" variant="bodyMd" tone="subdued">
                {description}
              </Text>
            </BlockStack>

            <Button variant="plain" url={actionUrl}>
              {actionLabel}
            </Button>
          </InlineStack>

          <Divider />

          <BlockStack gap="300">
            {rows.map((row) => (
              <StatusRow
                key={row.label}
                label={row.label}
                count={row.count}
                url={row.url}
              />
            ))}
          </BlockStack>

          <InlineStack>
            <Button url={learnMoreUrl}>Learn more</Button>
          </InlineStack>
        </BlockStack>
      </Box>
    </Card>
  );
}

function WhatsNewCard() {
  const updates = [
    {
      text: "You can now choose which minute of the hour auto-reapply runs for sales and tasks.",
      date: "Jun'26",
    },
    {
      text: "You can now edit markets that share a catalog with other markets.",
      date: "Jun'26",
    },
    {
      text: "You can now exclude discounted products alongside other exclusions.",
      date: "May'26",
    },
  ];

  return (
    <Card>
      <Box padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              What&apos;s new
            </Text>
            <Badge tone="success">Latest updates</Badge>
          </InlineStack>

          <BlockStack gap="300">
            {updates.map((item, index) => (
              <InlineStack key={index} gap="300" blockAlign="start" wrap={false}>
                <Box
                  width="8px"
                  minHeight="8px"
                  borderRadius="full"
                  background="bg-fill-info"
                  padding="025"
                />
                <Text as="p" variant="bodyMd" tone="subdued">
                  {item.text}{" "}
                  <Link url="#" removeUnderline>
                    Learn more
                  </Link>{" "}
                  <Text as="span" tone="subdued">
                    ({item.date})
                  </Text>
                </Text>
              </InlineStack>
            ))}
          </BlockStack>

          <InlineStack>
            <Button url="#">View full changelog</Button>
          </InlineStack>
        </BlockStack>
      </Box>
    </Card>
  );
}

function HelpCard() {
  return (
    <Card>
      <Box padding="500">
        <InlineStack align="space-between" blockAlign="center" gap="500" wrap>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Need help?
              </Text>
              <Badge tone="attention">Support</Badge>
            </InlineStack>

            <Text as="p" variant="bodyMd" tone="subdued">
              We are here for you. For assistance, click support button in the
              corner of your screen. We also provide comprehensive documentation
              with answers to most common questions.
            </Text>

            <InlineStack gap="300" blockAlign="center" wrap>
              <Button url="#">Contact support</Button>
              <Link url="#" removeUnderline>
                View documentation
              </Link>
            </InlineStack>
          </BlockStack>

          <div className="ppe-help-icon" aria-hidden="true">
            ?
          </div>
        </InlineStack>
      </Box>
    </Card>
  );
}

export default function Index() {
  return (
    <Page fullWidth>
      <TitleBar title="Platmart Price Editor" />

      <style>{`
        .ppe-wrapper {
          max-width: 1040px;
          margin: 0 auto;
          padding: 28px 20px 36px;
        }

        .ppe-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .ppe-help-icon {
          width: 96px;
          height: 96px;
          border-radius: 18px;
          flex: 0 0 96px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 48px;
          font-weight: 600;
          line-height: 1;
          box-shadow: 0 18px 35px rgba(124, 58, 237, 0.22);
          background: linear-gradient(135deg, #3827ff 0%, #9c4fd9 48%, #ff7a59 100%);
        }

        .ppe-footer {
          margin-top: 32px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
        }

        @media (max-width: 768px) {
          .ppe-wrapper {
            padding: 20px 12px 30px;
          }

          .ppe-grid {
            grid-template-columns: 1fr;
          }

          .ppe-help-icon {
            width: 74px;
            height: 74px;
            flex-basis: 74px;
            font-size: 36px;
          }
        }
      `}</style>

      <div className="ppe-wrapper">
        <BlockStack gap="500">
          <Card>
            <Box
              padding="500"
              background="bg-surface-secondary"
              borderRadius="300"
            >
              <BlockStack gap="200">
                <Text as="h1" variant="headingLg">
                  Platmart Price Editor
                </Text>

                <Text as="p" variant="bodyMd" tone="subdued">
                  Manage bulk price tasks, manual sales, scheduled sales,
                  changelog updates, and support from one clean dashboard.
                </Text>
              </BlockStack>
            </Box>
          </Card>

          <div className="ppe-grid">
            <SummaryCard
              title="Tasks"
              description="Bulk edit prices in your shop."
              actionLabel="Create task"
              actionUrl="/app/tasks/new"
              badgeTone="info"
              badgeLabel="Bulk edit"
              rows={[
                { label: "All tasks", count: 0, url: "/app/tasks" },
                {
                  label: "Completed",
                  count: 0,
                  url: "/app/tasks?status=completed",
                },
                {
                  label: "Archived",
                  count: 0,
                  url: "/app/tasks?status=archived",
                },
                {
                  label: "Canceled",
                  count: 0,
                  url: "/app/tasks?status=canceled",
                },
              ]}
            />

            <SummaryCard
              title="Sales"
              description="Run manual or scheduled sales."
              actionLabel="Create sale"
              actionUrl="/app/sales/new"
              badgeTone="success"
              badgeLabel="Sales"
              rows={[
                { label: "All sales", count: 0, url: "/app/sales" },
                { label: "Active", count: 0, url: "/app/sales?status=active" },
                {
                  label: "Scheduled",
                  count: 0,
                  url: "/app/sales?status=scheduled",
                },
                {
                  label: "Completed",
                  count: 0,
                  url: "/app/sales?status=completed",
                },
              ]}
            />
          </div>

          <WhatsNewCard />

          <HelpCard />

          <div className="ppe-footer">
            <Link url="#" removeUnderline>
              Terms of Service
            </Link>
            <Text as="span" tone="subdued">
              ·
            </Text>
            <Link url="#" removeUnderline>
              Privacy Policy
            </Link>
          </div>
        </BlockStack>
      </div>
    </Page>
  );
}