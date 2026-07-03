import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "@remix-run/react";
import { useEffect, useState } from "react";
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

function normalizeStatus(status) {
  return String(status || "Pending").toLowerCase();
}

function getStatusDisplay(status) {
  const normalized = normalizeStatus(status);

  if (normalized === "complete" || normalized === "completed") {
    return {
      label: "Completed",
      tone: "success",
      background: "#D1FADF",
    };
  }

  if (normalized === "processing" || normalized === "applying") {
    return {
      label: "Applying",
      tone: "attention",
      background: "#FEDF89",
      showProgress: true,
    };
  }

  if (normalized === "pending") {
    return {
      label: "Pending",
      tone: "attention",
      background: "#FEDF89",
    };
  }

  if (
    normalized.includes("failed") ||
    normalized.includes("cancel") ||
    normalized.includes("error")
  ) {
    return {
      label: humanize(status),
      tone: "critical",
      background: "#FEE4E2",
    };
  }

  return {
    label: humanize(status),
    tone: "info",
    background: "#E0F2FE",
  };
}

function getTaskProgress(task) {
  const progress = Number(task.executionSummary?.progress);

  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  if (normalizeStatus(task.status) === "processing") return 10;
  if (normalizeStatus(task.status) === "complete") return 100;

  return 0;
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

function StatusBadge({ display }) {
  return (
    <span
      style={{
        alignItems: "center",
        background: display.background,
        borderRadius: 8,
        display: "inline-flex",
        fontWeight: 700,
        gap: 4,
        lineHeight: 1,
        padding: "6px 10px",
      }}
    >
      {display.tone === "attention" ? (
        <span
          aria-hidden="true"
          style={{
            background: "#B98900",
            borderRadius: "50%",
            display: "inline-block",
            height: 8,
            width: 8,
          }}
        />
      ) : null}
      {display.label}
    </span>
  );
}

function DetailRow({ label, value, children }) {
  return (
    <Box paddingBlock="300" borderBlockEndWidth="025" borderColor="border">
      <InlineStack gap="800" blockAlign="center" wrap={false}>
        <Box minWidth="220px">
          <Text as="p" fontWeight="semibold">
            {label}
          </Text>
        </Box>
        {children || (
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
  const revalidator = useRevalidator();
  const logs = getLogs(task);
  const status = task.status || "Pending";
  const statusDisplay = getStatusDisplay(status);
  const statusTone = statusDisplay.tone;
  const serverProgress = getTaskProgress(task);
  const [visibleProgress, setVisibleProgress] = useState(serverProgress);
  const normalizedStatus = normalizeStatus(status);
  const shouldPoll = ["pending", "processing"].includes(normalizeStatus(status));

  useEffect(() => {
    setVisibleProgress((currentProgress) => {
      if (normalizedStatus === "processing") {
        return Math.max(currentProgress, serverProgress, 10);
      }

      return serverProgress;
    });
  }, [normalizedStatus, serverProgress]);

  useEffect(() => {
    if (normalizedStatus !== "processing") return undefined;

    const timer = setInterval(() => {
      setVisibleProgress((currentProgress) =>
        currentProgress >= 99 ? currentProgress : currentProgress + 1,
      );
    }, 800);

    return () => clearInterval(timer);
  }, [normalizedStatus]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const timer = setInterval(() => {
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(timer);
  }, [revalidator, shouldPoll]);

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
              <DetailRow label="Status">
                <BlockStack gap="100">
                  <StatusBadge display={statusDisplay} />
                  {statusDisplay.showProgress ? (
                    <Text as="p" tone="subdued" fontWeight="semibold">
                      Progress: {visibleProgress}%
                    </Text>
                  ) : null}
                </BlockStack>
              </DetailRow>
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
