import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const taskId = Number(params.id);

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Response("Task not found", { status: 404 });
  }

  const task = await db.task.findFirst({
    where: {
      id: taskId,
      shop: session.shop,
    },
  });

  if (!task) {
    throw new Response("Task not found", { status: 404 });
  }

  return json({ task });
};

function humanize(value) {
  if (!value) return "-";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatChange(task) {
  const priceChange = task.priceChange || {};
  const action = humanize(priceChange.action || "change");
  const value =
    priceChange.type === "by_amount"
      ? priceChange.amount
      : priceChange.percent
        ? `${priceChange.percent}%`
        : "";

  return `${action}${value ? ` by ${value}` : ""}`;
}

function getLogs(task) {
  const originalVariants = task.executionSummary?.originalVariants || [];
  const originalInventoryItems =
    task.executionSummary?.originalInventoryItems || [];

  return [
    ...originalVariants.map((variant) => ({
      id: variant.id,
      productTitle: variant.productTitle || "Product",
      changes: [
        variant.price !== variant.nextPrice
          ? `Price: ${variant.price ?? "-"} -> ${variant.nextPrice ?? "-"}`
          : "",
        variant.compareAtPrice !== variant.nextCompareAtPrice
          ? `Compare at: ${variant.compareAtPrice ?? "-"} -> ${
              variant.nextCompareAtPrice ?? "-"
            }`
          : "",
      ].filter(Boolean),
      status: task.status,
    })),
    ...originalInventoryItems.map((item) => ({
      id: item.id,
      productTitle: item.productTitle || "Product",
      changes: [`Cost: ${item.cost ?? "-"} -> ${item.nextCost ?? "-"}`],
      status: task.status,
    })),
  ];
}

function DetailRow({ label, value, badgeTone }) {
  return (
    <Box paddingBlock="300" borderBlockEndWidth="025" borderColor="border">
      <InlineStack gap="800" blockAlign="center" wrap={false}>
        <Box minWidth="220px">
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
        </Box>
        {badgeTone ? (
          <Badge tone={badgeTone}>{value}</Badge>
        ) : (
          <Text as="p" fontWeight="semibold">
            {value}
          </Text>
        )}
      </InlineStack>
    </Box>
  );
}

export default function TaskDetailsPage() {
  const { task } = useLoaderData();
  const navigate = useNavigate();
  const logs = getLogs(task);
  const status = task.status || "Pending";
  const statusTone = status === "Complete" ? "success" : "attention";

  return (
    <Page
      title="Task details"
      backAction={{ content: "Tasks", onAction: () => navigate("/app/tasks") }}
      secondaryActions={[
        {
          content: "Rollback",
          url: `/app/tasks/${task.id}/rollback`,
          disabled: status !== "Complete",
        },
      ]}
    >
      <TitleBar title="Task details" />

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <DetailRow label="Changes" value={formatChange(task)} />
              <DetailRow
                label="Change type"
                value={humanize(task.applyChangesTo || "products")}
              />
              <DetailRow label="Apply to" value={humanize(task.applyScope)} />
              <DetailRow label="Exclude" value={humanize(task.excludeScope)} />
              <DetailRow label="Status" value={status} badgeTone={statusTone} />
              <DetailRow label="Created at" value={formatDate(task.createdAt)} />
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Logs
                </Text>

                <IndexTable
                  resourceName={{ singular: "log", plural: "logs" }}
                  itemCount={logs.length}
                  selectable={false}
                  headings={[
                    { title: "Product" },
                    { title: "Changes" },
                    { title: "Status" },
                    { title: "" },
                  ]}
                >
                  {logs.map((log, index) => (
                    <IndexTable.Row id={log.id} key={log.id} position={index}>
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="semibold">
                          {log.productTitle}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span">{log.changes.join(", ")}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={statusTone}>{log.status}</Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button size="slim" url={`/app/tasks/${task.id}`}>
                          Details
                        </Button>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>

                {!logs.length ? (
                  <Box padding="400">
                    <Text as="p" tone="subdued">
                      No product changes were recorded for this task.
                    </Text>
                  </Box>
                ) : null}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
