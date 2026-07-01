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
        <Text as="span" variant="bodyMd">
          {label}
        </Text>
      </Link>

      <Text as="span" variant="bodyMd" fontWeight="semibold">
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
  learnMoreUrl = "#",
}) {
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" wrap={false}>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                {title}
              </Text>

              <Text as="p" variant="bodyMd">
                {description}
              </Text>
            </BlockStack>

            <Button variant="plain" url={actionUrl}>
              {actionLabel}
            </Button>
          </InlineStack>

          <BlockStack gap="350">
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
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            What&apos;s new
          </Text>

          <ul className="ppe-news-list">
            <li>
              <Text as="span" variant="bodyMd">
                You can now choose which minute of the hour auto-reapply runs for
                sales and tasks.{" "}
                <Link url="#" removeUnderline>
                  Learn more
                </Link>{" "}
                (Jun&apos;26)
              </Text>
            </li>

            <li>
              <Text as="span" variant="bodyMd">
                You can now edit markets that share a catalog with other
                markets.{" "}
                <Link url="#" removeUnderline>
                  Learn more
                </Link>{" "}
                (Jun&apos;26)
              </Text>
            </li>

            <li>
              <Text as="span" variant="bodyMd">
                You can now exclude discounted products alongside other
                exclusions (collections, products, or tags).{" "}
                <Link url="#" removeUnderline>
                  Learn more
                </Link>{" "}
                (May&apos;26)
              </Text>
            </li>
          </ul>

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
      <Box padding="400">
        <InlineStack align="space-between" blockAlign="center" gap="500" wrap>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Need help?
            </Text>

            <Text as="p" variant="bodyMd">
              We are here for you. For assistance, click support button in the
              corner of your screen. We also provide a comprehensive
              documentation with answers to most common questions.
            </Text>

            <InlineStack gap="300" blockAlign="center">
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
          max-width: 950px;
          margin: 0 auto;
          padding: 24px 16px 32px;
        }

        .ppe-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .ppe-news-list {
          margin: 0;
          padding-left: 20px;
          display: grid;
          gap: 8px;
        }

        .ppe-help-icon {
          width: 100px;
          height: 100px;
          border-radius: 12px;
          flex: 0 0 100px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 48px;
          line-height: 1;
          border: 3px solid rgba(255, 255, 255, 0.9);
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.2);
          background: linear-gradient(135deg, #3827ff 0%, #9c4fd9 48%, #ff7a59 100%);
        }

        .ppe-footer {
          margin-top: 36px;
          display: flex;
          justify-content: center;
          gap: 10px;
        }

        @media (max-width: 768px) {
          .ppe-grid {
            grid-template-columns: 1fr;
          }

          .ppe-help-icon {
            width: 76px;
            height: 76px;
            flex-basis: 76px;
            font-size: 36px;
          }
        }
      `}</style>

      <div className="ppe-wrapper">
        <BlockStack gap="500">
          <Text as="h1" variant="headingMd">
            Platmart Price Editor
          </Text>

          <div className="ppe-grid">
            <SummaryCard
              title="Tasks"
              description="Bulk edit prices in your shop."
              actionLabel="Create task"
              actionUrl="/app/tasks/new"
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