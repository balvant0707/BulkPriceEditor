// app/routes/app.tasks.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
import { authenticate } from "../shopify.server";

const TASK_HELP_URL = "https://help.platmart.io/article/28-how-to-use-tasks";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // Later replace this with real DB task count
  const taskCount = 0;

  return json({ taskCount });
};

function EmptyTasksPage() {
  return (
    <Page
      title="Tasks"
      primaryAction={{
        content: "Create task",
        url: "/app/tasks/new",
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
                  url: "/app/tasks/new",
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

function TasksListPage() {
  return (
    <Page
      heading="Tasks"
      primaryAction={{
        content: "Create Task",
        url: "/app/tasks/new",
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

                <Text as="p" variant="bodyMd" tone="subdued">
                  Task list will show here when tasks are available.
                </Text>

                <InlineStack>
                  <Button variant="primary" url="/app/tasks/new">
                    Create task
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default function TaskPage() {
  const { taskCount } = useLoaderData();

  if (!taskCount || taskCount <= 0) {
    return <EmptyTasksPage />;
  }

  return <TasksListPage />;
}
