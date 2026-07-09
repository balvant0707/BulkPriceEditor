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
import { commitFlashSession, getFlashSession } from "../lib/flash.server";

const TASK_HELP_URL = "#";
const NEW_TASK_URL = "/app/tasks/new";
const TASKS_URL = "/app/tasks";
const PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 1000;
const ROLLBACK_PROGRESS_SPEED_PER_SECOND = 50;
const ROLLBACK_PROGRESS_CAP = 98;
const PENDING_PROGRESS_SPEED_PER_SECOND = 50;

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

  return json(
    {
      taskCount: tasks.length,
      tasks,
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

function formatChangePayload(change, label) {
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
      ? change.amount
      : change.percent
        ? `${change.percent}%`
        : change.amount;

  if (action === "set_new_value") {
    return value ? `Set ${label} to ${value}` : `Set ${label}`;
  }

  const valueText = value ? ` by ${value}` : "";

  return `${actionLabel} ${label}${valueText}`;
}

function formatTaskChange(task) {
  const customTitle = getFirstValue([
    task.title,
    task.name,
    task.changeTitle,
    task.taskTitle,
  ]);

  if (customTitle) {
    return customTitle;
  }

  const changes = getTaskChangeItems(task);

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

function getTaskChangeItems(task) {
  return [
    formatChangePayload(task.priceChange, "price"),
    formatChangePayload(task.compareAtPriceChange, "compare at price"),
    formatChangePayload(task.costPerItemChange, "cost per item"),
  ].filter(Boolean);
}

function formatTaskType(task) {
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

function getTaskProgress(task) {
  return getProgressValue(
    task.progress,
    task.percent,
    task.percentage,
    task.executionProgress,
    task.executionPercent,
    task.executionSummary?.progress,
    task.executionSummary?.percent,
    task.executionSummary?.percentage,
  );
}

function getDateMs(value) {
  if (!value) return null;

  const date = new Date(value);
  const time = date.getTime();

  return Number.isNaN(time) ? null : time;
}

function getTaskStartedAt(task) {
  return (
    task.startedAt ||
    task.executionSummary?.startedAt ||
    task.executionSummary?.taskStartedAt ||
    task.createdAt
  );
}

function getRollbackStartedAt(task) {
  return (
    task.rollbackStartedAt ||
    task.rollback?.startedAt ||
    task.rollbackSummary?.startedAt ||
    task.executionSummary?.rollbackStartedAt ||
    task.executionSummary?.rollback?.startedAt ||
    task.executionSummary?.rollbackSummary?.startedAt ||
    task.startedAt ||
    task.createdAt
  );
}

function getEstimatedProgress(
  baseProgress,
  startedAt,
  now,
  speedPerSecond,
  progressCap,
  minimumProgress = 0,
) {
  const startedAtMs = getDateMs(startedAt);

  if (!startedAtMs) {
    return Math.max(baseProgress, minimumProgress);
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  const estimatedProgress = Math.min(
    progressCap,
    baseProgress + elapsedSeconds * speedPerSecond,
  );

  return Math.max(baseProgress, estimatedProgress, minimumProgress);
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
  return normalizeStatusKey(task.status) === "pending";
}

function isTaskProcessing(task) {
  const status = String(task.status || "").toLowerCase();
  return status === "applying";
}

function getTaskListStatus(task, now = Date.now()) {
  if (isRollbackProcessing(task)) {
    return {
      label: "Cancelling",
      tone: "attention",
      progress: getEstimatedProgress(
        Math.max(getRollbackProgress(task), 0),
        getRollbackStartedAt(task),
        now,
        ROLLBACK_PROGRESS_SPEED_PER_SECOND,
        ROLLBACK_PROGRESS_CAP,
        0,
      ),
      showProgress: true,
    };
  }

  if (isTaskPending(task)) {
    return {
      label: "Pending",
      tone: "attention",
      progress: getEstimatedProgress(
        0,
        getTaskStartedAt(task),
        now,
        PENDING_PROGRESS_SPEED_PER_SECOND,
        100,
        0,
      ),
      showProgress: true,
    };
  }

  if (isTaskProcessing(task)) {
    return {
      label: "Applying",
      tone: getStatusTone(task.status),
      progress: getEstimatedProgress(
        Math.max(getTaskProgress(task), 0),
        getTaskStartedAt(task),
        now,
        PENDING_PROGRESS_SPEED_PER_SECOND,
        100,
        0,
      ),
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

  const isOpeningNewTask = navigation.location?.pathname === NEW_TASK_URL;

  return (
    <Page
      title="Tasks"
      primaryAction={{
        content: "Create task",
        url: NEW_TASK_URL,
        loading: isOpeningNewTask,
        disabled: isOpeningNewTask,
      }}
    >
      <TitleBar title="Tasks" />
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
                  url: NEW_TASK_URL,
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
  const { toastMessage } = useLoaderData();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rollbackTask, setRollbackTask] = useState(null);
  const [deleteTask, setDeleteTask] = useState(null);
  const [progressTick, setProgressTick] = useState(Date.now());

  const isOpeningNewTask = navigation.location?.pathname === NEW_TASK_URL;

  const requestedTab =
    searchParams.get("status") || searchParams.get("view") || "all";
  const activeTab = TASK_TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "all";
  const queryValue = searchParams.get("q") || "";
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
    updateSearchParams({
      q: value,
      page: "",
    });
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
        formatTaskChange(task),
        formatTaskType(task),
        formatApplyTo(task),
        getStatusLabel(task.status),
        task.id,
        JSON.stringify(task),
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [tasks, activeTab, queryValue]);

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
    if (!hasActiveTask) return undefined;

    const interval = window.setInterval(() => {
      setProgressTick(Date.now());

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
      page: currentPage > 2 ? currentPage - 1 : "",
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
    const taskStatus = getTaskListStatus(task, progressTick);
    const changeItems = getTaskChangeItems(task);
    const visibleChanges = changeItems.length ? changeItems : [formatTaskChange(task)];
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
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {formatTaskType(task)}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {formatApplyTo(task)}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" tone="subdued">
            {formatDate(task.createdAt || task.updatedAt)}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Badge tone={taskStatus.tone}>{taskStatus.label}</Badge>
            {taskStatus.showProgress ? (
              <InlineStack gap="100" blockAlign="center" wrap={false}>
                <Spinner
                  accessibilityLabel={`${taskStatus.label} task`}
                  size="small"
                />
                <Text as="span" variant="bodySm" tone="subdued">
                  {taskStatus.progress}%
                </Text>
              </InlineStack>
            ) : null}
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

  const paginationLabel =
    filteredTasks.length > 0
      ? `${startIndex + 1}-${Math.min(endIndex, filteredTasks.length)} of ${
          filteredTasks.length
        }`
      : "0 tasks";

  return (
    <Page
      title="Tasks"
      primaryAction={{
        content: "Create task",
        url: NEW_TASK_URL,
        loading: isOpeningNewTask,
        disabled: isOpeningNewTask,
      }}
      fullWidth
    >
      <TitleBar title="Tasks" />

      <Card padding="0">
            <Tabs
              tabs={tabsWithCounts}
              selected={selectedTabIndex}
              onSelect={handleTabChange}
            />

            <Box padding="400" borderBlockStartWidth="025" borderColor="border">
              <TextField
                label="Search tasks"
                labelHidden
                value={queryValue}
                onChange={handleQueryChange}
                placeholder="Search tasks by selected products, collections, or tags"
                autoComplete="off"
                clearButton
                onClearButtonClick={() =>
                  updateSearchParams({
                    q: "",
                    page: "",
                  })
                }
              />
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
                  title: "Created",
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
                <InlineStack align="center">
                  <Pagination
                    label={paginationLabel}
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
