// app/routes/app.tasks.jsx
import { json } from "@remix-run/node";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigation,
  useRevalidator,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import {
  Page,
  Card,
  Text,
  Button,
  BlockStack,
  Box,
  Link,
  InlineStack,
  EmptyState,
  Layout,
  IndexTable,
  Badge,
  Spinner,
  Tabs,
  TextField,
  Pagination,
  Modal,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { withShopifyEmbeddedParams } from "../lib/shopify-embedded-url";
import { commitFlashSession, getFlashSession } from "../lib/flash.server";
import {
  AUTO_REAPPLY_TEXT,
  formatAutoReapplyInterval,
  isAutoReapplyEnabled,
} from "../lib/task-auto-reapply";

const TASK_HELP_URL = "#";
const NEW_TASK_URL = "/app/tasks/new";
const TASKS_URL = "/app/tasks";
const PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 1000;

const tableToolbarStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  paddingRight: 16,
  paddingTop : 10,
  paddingBottom: 10,
};

const tableTabsStyle = {
  flex: "1 1 360px",
  minWidth: 0,
};

const tableSearchStyle = {
  flex: "0 1 440px",
  minWidth: 280,
};

const TASK_TABS = [
  {
    id: "all",
    content: "All tasks",
  },
  {
    id: "completed",
    content: "Completed",
  },
  {
    id: "scheduled",
    content: "Scheduled",
  },
  {
    id: "cancelled",
    content: "Cancelled",
  },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const flashSession = await getFlashSession(request);
  const toastMessage = flashSession.get("toast") || "";

  const tasks = await db.task.findMany({
    where: {
      shop: session.shop,
    },
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    take: 250,
  });
  const shopCurrency =
    (
      await db.shop.findUnique({
        where: { shop: session.shop },
        select: { currency: true },
      })
    )?.currency || "";

  return json(
    {
      taskCount: tasks.length,
      tasks,
      shopCurrency,
      toastMessage,
    },
    {
      headers: {
        "Set-Cookie": await commitFlashSession(flashSession),
      },
    },
  );
};

function humanize(value) {
  if (!value) return "—";

  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getFirstValue(values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const time = date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();

  return `${monthDay} at ${time}`;
}

function normalizeScheduleStatus(task) {
  return String(task?.scheduleStatus || "").toLowerCase().trim();
}

function isScheduledTask(task) {
  return Boolean(task?.scheduleEnabled || task?.isScheduled);
}

function getScheduleStatusDisplay(task) {
  if (!isScheduledTask(task)) {
    return { label: "No", tone: "subdued" };
  }

  const status = normalizeScheduleStatus(task) || "pending";

  if (status === "running") return { label: "Running", tone: "success" };
  if (status === "completed") return { label: "Completed", tone: "subdued" };
  if (status === "cancelled" || status === "canceled") {
    return { label: "Cancelled", tone: "critical" };
  }

  return { label: "Pending", tone: "attention" };
}

function formatRelativeTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const diffSeconds = Math.max(
    0,
    Math.round((Date.now() - date.getTime()) / 1000),
  );

  if (diffSeconds < 45) return "just now";

  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 2) return "about 1 minute ago";
  if (minutes < 45) return `about ${minutes} minutes ago`;
  if (minutes < 90) return "about 1 hour ago";

  const hours = Math.round(minutes / 60);
  if (hours < 22) return `about ${hours} hours ago`;
  if (hours < 36) return "about 1 day ago";

  const days = Math.round(hours / 24);
  if (days < 26) return `about ${days} days ago`;
  if (days < 45) return "about 1 month ago";

  const months = Math.round(days / 30);
  if (months < 12) return `about ${months} months ago`;

  const years = Math.round(days / 365);
  return years <= 1 ? "about 1 year ago" : `about ${years} years ago`;
}

function getTaskMarkets(task) {
  const markets = Array.isArray(task.selectedMarkets)
    ? task.selectedMarkets
    : Array.isArray(task.markets)
      ? task.markets
      : [];

  return markets.filter((market) => market?.id || market?.name || market?.label);
}

function formatMarketLabel(market) {
  const name = market?.name || market?.label || "Market";
  const currencyCode =
    market?.currencyCode ||
    market?.currencySettings?.baseCurrency?.currencyCode ||
    "";

  return `${name}${currencyCode ? ` (${currencyCode})` : ""}`;
}

function getMarketCurrencyCodes(task) {
  const currencies = [
    ...new Set(
      getTaskMarkets(task)
        .flatMap((market) => [
          market.currencyCode,
          market.currencySettings?.baseCurrency?.currencyCode,
          ...(Array.isArray(market.priceLists)
            ? market.priceLists.map((priceList) => priceList.currencyCode)
            : []),
        ])
        .filter(Boolean),
    ),
  ];

  return currencies;
}

function getMarketCurrencyLabel(task) {
  return getMarketCurrencyCodes(task).join(" / ");
}

function formatChangePayload(change, label, currencyCode = "") {
  const action = String(change?.action || "").toLowerCase();
  if (!action) return "";

  if (action === "reset_compare_at_price") return "Reset compare at price";
  if (action === "reset_cost_per_item") return "Reset cost per item";
  if (action === "set_to_price") return "Set compare at price to price";
  if (action === "set_to_compare_at_price") {
    return "Set price to compare at price";
  }
  if (action === "set_margin") {
    return change.percent
      ? `Set ${label} margin to ${change.percent}%`
      : `Set ${label} margin`;
  }

  const actionLabel =
    action === "increase"
      ? "Increase"
      : action === "decrease"
        ? "Decrease"
        : action === "set_new_value"
          ? "Set"
          : humanize(action);

  const value =
    change.type === "by_amount"
      ? `${change.amount || ""}${currencyCode && change.amount ? ` ${currencyCode}` : ""}`
      : change.percent
        ? `${change.percent}%`
        : change.amount;

  if (action === "set_new_value") {
    const suffix = value && currencyCode ? ` ${currencyCode}` : "";
    return value ? `Set ${label} to ${value}${suffix}` : `Set ${label}`;
  }

  const valueText = value ? ` by ${value}` : "";

  return `${actionLabel} ${label}${valueText}`;
}

function formatTaskChange(task, shopCurrency = "") {
  const customTitle = getFirstValue([
    task.title,
    task.name,
    task.changeTitle,
    task.taskTitle,
  ]);

  if (customTitle) {
    return customTitle;
  }

  const changes = getTaskChangeItems(task, shopCurrency);

  if (changes.length) {
    return changes.join(" ");
  }

  const changeType = String(
    getFirstValue([
      task.changeType,
      task.priceChangeType,
      task.adjustmentType,
      task.operationType,
      task.operation,
      task.action,
    ]) || "",
  ).toLowerCase();

  const value = getFirstValue([
    task.percentage,
    task.percent,
    task.discountPercentage,
    task.adjustmentValue,
    task.changeValue,
    task.value,
    task.amount,
  ]);

  const valueType = String(
    getFirstValue([
      task.valueType,
      task.changeValueType,
      task.adjustmentValueType,
    ]) || "",
  ).toLowerCase();

  const suffix =
    valueType.includes("fixed") ||
    valueType.includes("amount") ||
    valueType.includes("price")
      ? ""
      : "%";

  if (changeType.includes("increase")) {
    return value ? `Increase price by ${value}${suffix}` : "Increase price";
  }

  if (
    changeType.includes("decrease") ||
    changeType.includes("discount") ||
    changeType.includes("reduce")
  ) {
    return value ? `Decrease price by ${value}${suffix}` : "Decrease price";
  }

  if (value) {
    return `Change price by ${value}${suffix}`;
  }

  return `Task #${task.id}`;
}

function getTaskChangeItems(task, shopCurrency = "") {
  const currencyCode =
    String(task.applyChangesTo || "").toLowerCase() === "markets"
      ? getMarketCurrencyLabel(task)
      : shopCurrency;

  return [
    formatChangePayload(task.priceChange, "price", currencyCode),
    formatChangePayload(task.compareAtPriceChange, "compare at price", currencyCode),
    formatChangePayload(task.costPerItemChange, "cost per item"),
  ].filter(Boolean);
}

function AutoReapplyMessage({ task }) {
  const intervalText = formatAutoReapplyInterval(task);

  return (
    <BlockStack gap="050">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginTop: "8px",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M1.5 7.25a.75.75 0 0 0 1.5 0 3 3 0 0 1 3-3h6.566l-1.123 1.248a.75.75 0 1 0 1.115 1.004l2.25-2.5a.75.75 0 0 0-.028-1.032l-2.25-2.25a.749.749 0 1 0-1.06 1.06l.97.97h-6.44a4.5 4.5 0 0 0-4.5 4.5" />
          <path d="M14.5 8.75a.75.75 0 0 0-1.5 0 3 3 0 0 1-3 3h-6.566l1.123-1.248a.75.75 0 1 0-1.115-1.004l-2.25 2.5a.75.75 0 0 0 .028 1.032l2.25 2.25a.749.749 0 1 0 1.06-1.06l-.97-.97h6.44a4.5 4.5 0 0 0 4.5-4.5" />
        </svg>

        <Text as="span" tone="subdued">
          {AUTO_REAPPLY_TEXT} - {intervalText}
        </Text>
      </div>
    </BlockStack>
  );
}

function formatTaskType(task) {
  if (String(task.applyChangesTo || "").toLowerCase() === "markets") {
    return "Markets";
  }

  const type = getFirstValue([
    task.type,
    task.applyChangesTo,
    task.applyToType,
    task.targetType,
    task.resourceType,
  ]);

  if (!type) {
    return "Products";
  }

  const formatted = humanize(type);

  if (formatted.includes("Product")) return "Products";
  if (formatted.includes("Collection")) return "Collections";
  if (formatted.includes("Tag")) return "Tags";

  return formatted;
}

function formatApplyTo(task) {
  const scope = getFirstValue([
    task.applyTo,
    task.applyScope,
    task.targetScope,
    task.selectionType,
    task.appliesTo,
  ]);

  const rawScope = String(scope || "").toLowerCase();

  if (
    rawScope.includes("whole") ||
    rawScope.includes("store") ||
    rawScope.includes("all")
  ) {
    return "Whole store";
  }

  const productCount =
    task.selectedProductsCount ||
    task.productCount ||
    task.selectedProductIds?.length ||
    task.products?.length;

  const collectionCount =
    task.selectedCollectionsCount ||
    task.collectionCount ||
    task.selectedCollectionIds?.length ||
    task.collections?.length;

  const tagCount =
    task.selectedTagsCount ||
    task.tagCount ||
    task.selectedTags?.length ||
    task.tags?.length;

  if (productCount) {
    return `${productCount} product${productCount > 1 ? "s" : ""}`;
  }

  if (collectionCount) {
    return `${collectionCount} collection${collectionCount > 1 ? "s" : ""}`;
  }

  if (tagCount) {
    return `${tagCount} tag${tagCount > 1 ? "s" : ""}`;
  }

  if (scope) {
    return humanize(scope);
  }

  return "Whole store";
}

function getStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized.includes("cancelling") || normalized.includes("canceling")) {
    return "Cancelling";
  }

  if (
    normalized.includes("cancel") ||
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("rolled back") ||
    normalized.includes("rollback")
  ) {
    return "Cancelled";
  }

  if (normalized.includes("pending")) {
    return "Pending";
  }

  if (normalized.includes("applying") || normalized.includes("processing")) {
    return "Applying";
  }

  if (normalized.includes("complete")) {
    return "Completed";
  }

  return humanize(status || "Pending");
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase().trim();
}

function normalizeStatusKey(status) {
  return normalizeStatus(status).replace(/[\s-]+/g, "_");
}

function getStatusTone(status) {
  const normalized = String(status || "").toLowerCase();

  if (
    normalized === "complete" ||
    normalized === "completed" ||
    normalized.includes("completed") ||
    normalized.includes("success")
  ) {
    return "success";
  }

  if (
    normalized.includes("cancel") ||
    normalized.includes("failed") ||
    normalized.includes("error") ||
    normalized.includes("rolled back") ||
    normalized.includes("rollback")
  ) {
    return "critical";
  }

  if (
    normalized.includes("cancelling") ||
    normalized.includes("canceling") ||
    normalized.includes("running") ||
    normalized.includes("processing") ||
    normalized.includes("applying") ||
    normalized.includes("pending")
  ) {
    return "attention";
  }

  return "subdued";
}

function getNumberValue(...values) {
  const foundValue = values
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));

  return Number.isFinite(foundValue) ? foundValue : null;
}

function getProgressValue(...values) {
  const progress = getNumberValue(...values);

  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(progress)));
}

function getRollbackProgress(task) {
  return getProgressValue(
    task.rollbackProgress,
    task.rollbackPercent,
    task.rollbackPercentage,
    task.rollback?.progress,
    task.rollback?.percent,
    task.rollbackSummary?.progress,
    task.rollbackSummary?.percent,
    task.rollbackSummary?.percentage,
    task.executionSummary?.rollbackProgress,
    task.executionSummary?.rollbackPercent,
    task.executionSummary?.rollbackPercentage,
    task.executionSummary?.rollback?.progress,
    task.executionSummary?.rollback?.percent,
    task.executionSummary?.rollbackSummary?.progress,
    task.executionSummary?.rollbackSummary?.percent,
    task.executionSummary?.rollbackSummary?.percentage,
  );
}

function getExecutionProgress(task) {
  return getProgressValue(
    task.progress,
    task.percent,
    task.percentage,
    task.executionProgress,
    task.executionPercent,
    task.executionPercentage,
    task.executionSummary?.progress,
    task.executionSummary?.percent,
    task.executionSummary?.percentage,
  );
}

function getRollbackSummary(task) {
  return (
    task.rollback ||
    task.rollbackSummary ||
    task.executionSummary?.rollback ||
    task.executionSummary?.rollbackSummary ||
    {}
  );
}

function getRollbackStatusKey(task) {
  return normalizeStatusKey(
    task.rollbackStatus ||
      task.rollback?.status ||
      task.rollbackSummary?.status ||
      task.executionSummary?.rollbackStatus ||
      task.executionSummary?.rollback?.status ||
      task.executionSummary?.rollbackSummary?.status ||
      "",
  );
}

function isRollbackCompleted(task) {
  const taskStatus = normalizeStatusKey(task.status);
  const rollbackStatus = getRollbackStatusKey(task);
  const rollback = getRollbackSummary(task);

  return (
    rollbackStatus === "cancelled" ||
    rollbackStatus === "canceled" ||
    ((taskStatus === "cancelled" || taskStatus === "canceled") &&
      rollback.ok === true) ||
    Boolean(rollback.completedAt) ||
    Boolean(rollback.rolledBackAt) ||
    (rollback.progress >= 100 && rollback.ok === true)
  );
}

function isFailedOrCanceledTask(task) {
  const status = normalizeStatus(task.status);

  return (
    (status.includes("cancel") &&
      !status.includes("canceling") &&
      !status.includes("cancelling")) ||
    status.includes("failed") ||
    status.includes("error")
  );
}

function canDeleteTask(task) {
  return isFailedOrCanceledTask(task) || isRollbackCompleted(task);
}

function canRollbackTask(task) {
  const status = normalizeStatusKey(task.status);

  return (
    !canDeleteTask(task) &&
    !isRollbackProcessing(task) &&
    (status === "complete" || status === "completed")
  );
}

function isRollbackProcessing(task) {
  const taskStatus = String(task.status || "").toLowerCase();
  const rollbackStatus = (task.rollbackStatus || "").toLowerCase();
  const progress = getRollbackProgress(task);

  if (progress >= 100) {
    return false;
  }

  return (
    rollbackStatus.includes("canceling") ||
    rollbackStatus.includes("cancelling") ||
    taskStatus === "canceling" ||
    taskStatus === "cancelling"
  );
}

function isTaskPending(task) {
  if (isScheduledTask(task) && normalizeScheduleStatus(task) === "pending") {
    return true;
  }

  return normalizeStatusKey(task.status) === "pending";
}

function isTaskProcessing(task) {
  const status = String(task.status || "").toLowerCase();
  return status === "applying";
}

function getTaskListStatus(task) {
  if (isScheduledTask(task) && normalizeScheduleStatus(task) === "pending") {
    return {
      label: "Scheduled",
      tone: "info",
      progress: 0,
      showPendingSpinner: false,
      showProgress: false,
    };
  }

  if (isRollbackProcessing(task)) {
    return {
      label: "Cancelling",
      tone: "attention",
      progress: getRollbackProgress(task),
      showProgress: true,
    };
  }

  if (isTaskPending(task)) {
    return {
      label: "Pending",
      tone: "attention",
      progress: getExecutionProgress(task),
      showPendingSpinner: true,
      showProgress: false,
    };
  }

  if (isTaskProcessing(task)) {
    return {
      label: "Applying",
      tone: getStatusTone(task.status),
      progress: getExecutionProgress(task),
      showPendingSpinner: true,
      showProgress: true,
    };
  }

  return {
    label: getStatusLabel(task.status),
    tone: getStatusTone(task.status),
    progress: 0,
    showProgress: false,
  };
}

function taskMatchesTab(task, activeTab) {
  if (activeTab === "all") {
    return true;
  }

  const status = String(task.status || "").toLowerCase();

  if (activeTab === "completed") {
    return (
      status === "complete" ||
      status === "completed" ||
      status.includes("completed") ||
      status.includes("success")
    );
  }

  if (activeTab === "scheduled") {
    return isScheduledTask(task);
  }

  if (activeTab === "cancelled") {
    return (
      (status.includes("cancel") &&
        !status.includes("canceling") &&
        !status.includes("cancelling")) ||
      status.includes("rolled back") ||
      status.includes("rollback") ||
      status.includes("failed") ||
      status.includes("error")
    );
  }

  return true;
}

function getTaskTabCounts(tasks) {
  return TASK_TABS.reduce((counts, tab) => {
    counts[tab.id] = tasks.filter((task) => taskMatchesTab(task, tab.id)).length;
    return counts;
  }, {});
}

function EmptyTasksPage() {
  const navigation = useNavigation();
  const location = useLocation();

  const isOpeningNewTask = navigation.location?.pathname === NEW_TASK_URL;
  const newTaskUrl = withShopifyEmbeddedParams(NEW_TASK_URL, location.search);

  return (
    <Page
      title="Tasks"
      primaryAction={{
        content: "Create task",
        url: newTaskUrl,
        loading: isOpeningNewTask,
        disabled: isOpeningNewTask,
      }}
    >
      <TitleBar title="Boltr Bulk Price Editor" />
      <style>{`
        .Polaris-Modal-Dialog__Modal {
          max-width: 480px;
        }
      `}</style>

      <style>{`
        .Polaris-EmptyState__Image,
        .Polaris-EmptyState__Image img {
          opacity: 1 !important;
          filter: none !important;
        }
      `}</style>

      <Layout>
        <Layout.Section>
          <Card>
            <Box>
              <EmptyState
                heading="Manage tasks"
                action={{
                  content: "Create first task",
                  url: newTaskUrl,
                  loading: isOpeningNewTask,
                  disabled: isOpeningNewTask,
                }}
                secondaryAction={{
                  content: "Learn more",
                  url: TASK_HELP_URL,
                  external: true,
                }}
                image="/image/createtask.svg"
              >
                <Text as="p" variant="bodyMd" tone="subdued">
                  Create tasks to bulk edit prices in your shop.
                </Text>
              </EmptyState>
            </Box>
          </Card>

          <Box paddingBlockStart="800">
            <InlineStack align="center">
              <Text as="p" variant="bodyMd">
                Learn more about{" "}
                <Link url={TASK_HELP_URL} external removeUnderline>
                  tasks
                </Link>
              </Text>
            </InlineStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function TasksListPage({ tasks }) {
  const { shopCurrency = "", toastMessage } = useLoaderData();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const location = useLocation();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryValue, setQueryValue] = useState("");
  const [rollbackTask, setRollbackTask] = useState(null);
  const [deleteTask, setDeleteTask] = useState(null);

  const isOpeningNewTask = navigation.location?.pathname === NEW_TASK_URL;
  const newTaskUrl = withShopifyEmbeddedParams(NEW_TASK_URL, location.search);

  const requestedTab =
    searchParams.get("status") || searchParams.get("view") || "all";
  const activeTab = TASK_TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "all";
  const pageParam = Number(searchParams.get("page") || 1);

  const selectedTabIndex = Math.max(
    TASK_TABS.findIndex((tab) => tab.id === activeTab),
    0,
  );

  const tabsWithCounts = useMemo(() => {
    const tabCounts = getTaskTabCounts(tasks);

    return TASK_TABS.map((tab) => ({
      ...tab,
      content: `${tab.content} (${tabCounts[tab.id] || 0})`,
      url: tab.id === "all" ? TASKS_URL : `${TASKS_URL}?status=${tab.id}`,
    }));
  }, [tasks]);

  const updateSearchParams = (updates) => {
    const nextParams = new URLSearchParams(searchParams);

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        nextParams.delete(key);
      } else {
        nextParams.set(key, String(value));
      }
    });

    setSearchParams(nextParams);
  };

  const handleTabChange = (selectedIndex) => {
    const selectedTab = tabsWithCounts[selectedIndex];

    updateSearchParams({
      status: selectedTab.id === "all" ? "" : selectedTab.id,
      view: "",
      page: "",
    });
  };

  const handleQueryChange = (value) => {
    setQueryValue(value);
  };

  const filteredTasks = useMemo(() => {
    const query = queryValue.trim().toLowerCase();

    return tasks.filter((task) => {
      const matchesTab = taskMatchesTab(task, activeTab);

      if (!matchesTab) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchableText = [
        formatTaskChange(task, shopCurrency),
        formatTaskType(task),
        formatApplyTo(task),
        getStatusLabel(task.status),
        task.id,
        isScheduledTask(task) ? "scheduled" : "immediate",
        getScheduleStatusDisplay(task).label,
        formatDate(task.startAt),
        formatDate(task.endAt),
        formatDate(task.executedAt),
        formatDate(task.completedAt),
        JSON.stringify(task),
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [tasks, activeTab, queryValue, shopCurrency]);

  const hasActiveTask = useMemo(
    () =>
      tasks.some(
        (task) =>
          isTaskPending(task) || isTaskProcessing(task) || isRollbackProcessing(task),
      ),
    [tasks],
  );

  useEffect(() => {
    if (toastMessage) {
      shopify.toast.show(toastMessage);
    }
  }, [shopify, toastMessage]);

  useEffect(() => {
    if (searchParams.has("q")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("q");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!hasActiveTask) return undefined;

    const interval = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [hasActiveTask, revalidator]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(pageParam, 1), totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;

  const paginatedTasks = filteredTasks.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    updateSearchParams({
      page: currentPage - 1 <= 1 ? "" : currentPage - 1,
    });
  };

  const handleNextPage = () => {
    updateSearchParams({
      page: currentPage + 1,
    });
  };

  const submitTaskAction = (path) => {
    submit(null, {
      method: "post",
      action: path,
    });
  };

  const rowMarkup = paginatedTasks.map((task, index) => {
    const taskStatus = getTaskListStatus(task);
    const changeItems = getTaskChangeItems(task, shopCurrency);
    const visibleChanges = changeItems.length
      ? changeItems
      : [formatTaskChange(task, shopCurrency)];
    const taskMarkets = getTaskMarkets(task);
    const detailsPath = `/app/tasks/${task.id}`;
    const rollbackPath = `/app/tasks/${task.id}/rollback`;
    const deletePath = `/app/tasks/${task.id}/delete`;
    const canRollback = canRollbackTask(task);
    const canDelete = canDeleteTask(task);
    const isDetailsLoading =
      navigation.state !== "idle" &&
      navigation.location?.pathname === detailsPath;
    const isRollbackLoading =
      navigation.state !== "idle" &&
      navigation.formAction?.includes(rollbackPath);
    const isDeleteLoading =
      navigation.state !== "idle" &&
      navigation.formAction?.includes(deletePath);

    return (
      <IndexTable.Row id={String(task.id)} key={task.id} position={index}>
        <IndexTable.Cell>
          <BlockStack gap="100">
            {visibleChanges.map((change, changeIndex) => (
              <Text
                as="span"
                variant="bodyMd"
                key={`${task.id}-change-${changeIndex}`}
              >
                {change || "-"}
              </Text>
            ))}

            {isAutoReapplyEnabled(task) ? <AutoReapplyMessage task={task} /> : null}
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {formatTaskType(task)}
            </Text>

            {String(task.applyChangesTo || "").toLowerCase() === "markets" &&
              taskMarkets.map((market) => (
                <Text
                  as="span"
                  variant="bodyMd"
                  tone="subdued"
                  key={market.id || market.name || market.label}
                >
                  - {formatMarketLabel(market)}
                </Text>
              ))}
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {formatApplyTo(task)}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Badge tone={taskStatus.tone}>
              <InlineStack gap="100" blockAlign="center" wrap={false}>
                {taskStatus.showPendingSpinner ? (
                  <span style={{ display: "inline-flex", transform: "scale(0.75)", transformOrigin: "center" }}>
                    <Spinner
                      accessibilityLabel={`${taskStatus.label} task`}
                      size="small"
                    />
                  </span>
                ) : null}
                <span>{taskStatus.label}</span>
                {taskStatus.showProgress ? (
                  <span>{taskStatus.progress}%</span>
                ) : null}
              </InlineStack>
            </Badge>
          </InlineStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200" wrap={false}>
            <Button size="slim" url={detailsPath} loading={isDetailsLoading}>
              Details
            </Button>

            {!canDelete ? (
              <Button
                size="slim"
                variant={canRollback ? "primary" : undefined}
                loading={isRollbackLoading}
                disabled={!canRollback}
                onClick={() => setRollbackTask(task)}
              >
                Rollback
              </Button>
            ) : null}

            {canDelete ? (
              <Button
                size="slim"
                tone="critical"
                loading={isDeleteLoading}
                onClick={() => setDeleteTask(task)}
              >
                Delete
              </Button>
            ) : null}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Tasks"
      primaryAction={{
        content: "Create task",
        url: newTaskUrl,
        loading: isOpeningNewTask,
        disabled: isOpeningNewTask,
      }}
      fullWidth
    >
      <TitleBar title="Boltr Bulk Price Editor" />

      <Card padding="0">
            <Box borderBlockEndWidth="025" borderColor="border">
              <div style={tableToolbarStyle}>
                <div style={tableTabsStyle}>
                  <Tabs
                    tabs={tabsWithCounts}
                    selected={selectedTabIndex}
                    onSelect={handleTabChange}
                  />
                </div>
                <div style={tableSearchStyle}>
                  <TextField
                    label="Search tasks"
                    labelHidden
                    value={queryValue}
                    onChange={handleQueryChange}
                    placeholder="Search tasks ..."
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setQueryValue("")}
                  />
                </div>
              </div>
            </Box>

            <IndexTable
              resourceName={{
                singular: "task",
                plural: "tasks",
              }}
              itemCount={paginatedTasks.length}
              selectable={false}
              headings={[
                {
                  title: "Changes",
                },
                {
                  title: "Type",
                },
                {
                  title: "Apply to",
                },
                {
                  title: "Status",
                },
                {
                  title: "Actions",
                },
              ]}
            >
              {rowMarkup}
            </IndexTable>

            {filteredTasks.length === 0 ? (
              <Box padding="600">
                <InlineStack align="center">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="headingSm">
                      No tasks found
                    </Text>

                    <Text as="p" variant="bodyMd" tone="subdued">
                      Try changing the tab or search keyword.
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            ) : null}

            {filteredTasks.length > PAGE_SIZE ? (
              <Box
                padding="400"
                borderBlockStartWidth="025"
                borderColor="border"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" tone="subdued">
                    {filteredTasks.length > 0
                      ? `Showing ${startIndex + 1}-${Math.min(
                          endIndex,
                          filteredTasks.length,
                        )} of ${filteredTasks.length} tasks`
                      : "0 tasks"}
                  </Text>
                  <Pagination
                    hasPrevious={currentPage > 1}
                    onPrevious={handlePreviousPage}
                    hasNext={currentPage < totalPages}
                    onNext={handleNextPage}
                  />
                </InlineStack>
              </Box>
            ) : null}
      </Card>

      <Box paddingBlockStart="800">
        <InlineStack align="center">
          <Text as="p" variant="bodyMd">
            Learn more about{" "}
            <Link url={TASK_HELP_URL} external removeUnderline>
              tasks
            </Link>
          </Text>
        </InlineStack>
      </Box>

      <Modal
        open={Boolean(rollbackTask)}
        onClose={() => setRollbackTask(null)}
        title="Rollback task?"
        sectioned={false}
        size="small"
        primaryAction={{
          content: "Rollback",
          loading:
            navigation.state !== "idle" &&
            rollbackTask &&
            navigation.formAction?.includes(
              `/app/tasks/${rollbackTask.id}/rollback`,
            ),
          onAction: () => {
            if (!rollbackTask) return;
            const path = `/app/tasks/${rollbackTask.id}/rollback`;
            setRollbackTask(null);
            submitTaskAction(path);
          },
        }}
        secondaryActions={[
          {
            content: "No",
            onAction: () => setRollbackTask(null),
          },
        ]}
      >
        <div className="task-confirmation-modal">
          <Modal.Section>
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              More recent tasks applied to the same products will be also
              cancelled. Are you sure?
            </Text>
          </Modal.Section>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTask)}
        onClose={() => setDeleteTask(null)}
        title="Delete task?"
        sectioned={false}
        size="small"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading:
            navigation.state !== "idle" &&
            deleteTask &&
            navigation.formAction?.includes(`/app/tasks/${deleteTask.id}/delete`),
          onAction: () => {
            if (!deleteTask) return;
            const path = `/app/tasks/${deleteTask.id}/delete`;
            setDeleteTask(null);
            submitTaskAction(path);
          },
        }}
        secondaryActions={[
          {
            content: "No",
            onAction: () => setDeleteTask(null),
          },
        ]}
      >
        <div className="task-confirmation-modal">
          <Modal.Section>
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              The task will be deleted and you won't be able to recover it. Are
              you sure?
            </Text>
          </Modal.Section>
        </div>
      </Modal>
    </Page>
  );
}

export default function TaskPage() {
  const { taskCount, tasks } = useLoaderData();
  const location = useLocation();

  if (location.pathname !== TASKS_URL) {
    return <Outlet />;
  }

  if (!taskCount || taskCount <= 0) {
    return <EmptyTasksPage />;
  }

  return <TasksListPage tasks={tasks} />
}
