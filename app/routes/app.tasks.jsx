// app/routes/app.tasks.jsx
import { json } from "@remix-run/node";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigation,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { useMemo, useState } from "react";
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
  Tabs,
  TextField,
  Pagination,
  Banner,
  Modal,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const TASK_HELP_URL = "#";
const NEW_TASK_URL = "/app/tasks/new";
const TASKS_URL = "/app/tasks";
const PAGE_SIZE = 10;

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
    id: "archived",
    content: "Archived",
  },
  {
    id: "canceled",
    content: "Canceled",
  },
];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const tasks = await db.task.findMany({
    where: {
      shop: session.shop,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 250,
  });

  return json({
    taskCount: tasks.length,
    tasks,
  });
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

  const changes = [
    formatChangePayload(task.priceChange, "price"),
    formatChangePayload(task.compareAtPriceChange, "compare at price"),
    formatChangePayload(task.costPerItemChange, "cost per item"),
  ].filter(Boolean);

  if (changes.length) {
    return changes.join(", ");
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
  return humanize(status || "Pending");
}

function getStatusTone(status) {
  const normalized = String(status || "").toLowerCase();

  if (
    normalized === "complete" ||
    normalized.includes("completed") ||
    normalized.includes("success")
  ) {
    return "success";
  }

  if (normalized.includes("archived")) {
    return "info";
  }

  if (
    normalized.includes("cancel") ||
    normalized.includes("failed") ||
    normalized.includes("error")
  ) {
    return "critical";
  }

  if (
    normalized.includes("running") ||
    normalized.includes("processing") ||
    normalized.includes("pending")
  ) {
    return "attention";
  }

  return "subdued";
}

function taskMatchesTab(task, activeTab) {
  if (activeTab === "all") {
    return true;
  }

  const status = String(task.status || "").toLowerCase();

  if (activeTab === "completed") {
    return (
      status === "complete" ||
      status.includes("completed") ||
      status.includes("success")
    );
  }

  if (activeTab === "archived") {
    return status.includes("archived");
  }

  if (activeTab === "canceled") {
    return (
      status.includes("cancel") ||
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
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rollbackTask, setRollbackTask] = useState(null);
  const [deleteTask, setDeleteTask] = useState(null);

  const isOpeningNewTask = navigation.location?.pathname === NEW_TASK_URL;

  const requestedTab =
    searchParams.get("status") || searchParams.get("view") || "all";
  const activeTab = TASK_TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "all";
  const queryValue = searchParams.get("q") || "";
  const message = searchParams.get("message") || "";
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
    const taskStatus = getStatusLabel(task.status);
    const detailsPath = `/app/tasks/${task.id}`;
    const rollbackPath = `/app/tasks/${task.id}/rollback`;
    const deletePath = `/app/tasks/${task.id}/delete`;
    const normalizedStatus = String(task.status || "").toLowerCase();
    const canRollback = normalizedStatus === "complete";
    const canDelete =
      normalizedStatus === "canceled" ||
      normalizedStatus === "rolled back" ||
      normalizedStatus === "rollback failed";
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
          <Text as="span" variant="bodyMd">
            {formatTaskChange(task)}
          </Text>
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
          <Badge tone={getStatusTone(task.status)}>{taskStatus}</Badge>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200" wrap={false}>
            <Button size="slim" url={detailsPath} loading={isDetailsLoading}>
              Details
            </Button>

            <Button
              size="slim"
              variant={canRollback ? "primary" : undefined}
              loading={isRollbackLoading}
              disabled={!canRollback || normalizedStatus === "rolling back"}
              onClick={() => setRollbackTask(task)}
            >
              Rollback
            </Button>

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
    >
      <TitleBar title="Tasks" />

      <Layout>
        <Layout.Section>
          {message ? (
            <Box paddingBlockEnd="400">
              <Banner tone="info">{message}</Banner>
            </Box>
          ) : null}

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
        </Layout.Section>
      </Layout>

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
              canceled. Are you sure?
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

  return <TasksListPage tasks={tasks} />;
}
