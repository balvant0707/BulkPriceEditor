// app/routes/app.tasks.jsx
import { json } from "@remix-run/node";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "@remix-run/react";
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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const TASK_HELP_URL = "https://help.platmart.io/article/28-how-to-use-tasks";
const NEW_TASK_URL = "/app/tasks/new";
const TASKS_URL = "/app/tasks";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const tasks = await db.task.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return json({ taskCount: tasks.length, tasks });
};

function EmptyTasksPage() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isOpeningNewTask = navigation.location?.pathname === NEW_TASK_URL;
  const openNewTask = () => navigate(NEW_TASK_URL);

  return (
    <Page
      title="Tasks"
      primaryAction={{
        content: "Create task",
        url: NEW_TASK_URL,
        onAction: openNewTask,
        loading: isOpeningNewTask,
        disabled: isOpeningNewTask,
      }}
    >
      <TitleBar title="Tasks" />
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
                  onAction: openNewTask,
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
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isOpeningNewTask = navigation.location?.pathname === NEW_TASK_URL;
  const openNewTask = () => navigate(NEW_TASK_URL);

  return (
    <Page
      title="Tasks"
      primaryAction={{
        content: "Create task",
        url: NEW_TASK_URL,
        onAction: openNewTask,
        loading: isOpeningNewTask,
        disabled: isOpeningNewTask,
      }}
    >
      <TitleBar title="Tasks" />

      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="500">
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Your tasks
                </Text>

                {tasks.map((task) => (
                  <Box
                    key={task.id}
                    padding="300"
                    borderColor="border"
                    borderWidth="025"
                    borderRadius="200"
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          Task #{task.id}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {task.applyChangesTo} - {task.status}
                        </Text>
                        {task.executionSummary ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Analyzed {task.executionSummary.analyzedVariants || 0},
                            updated {task.executionSummary.updatedVariants || 0}
                          </Text>
                        ) : null}
                      </BlockStack>

                      <Button url={`/app/tasks/${task.id}`}>Edit</Button>
                    </InlineStack>
                  </Box>
                ))}

                <Button
                  variant="primary"
                  url={NEW_TASK_URL}
                  onClick={openNewTask}
                  loading={isOpeningNewTask}
                  disabled={isOpeningNewTask}
                >
                  Create task
                </Button>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
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
