import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { commitFlashSession, getFlashSession } from "../lib/flash.server";
import { rollbackTask } from "../services/task-rollback.server";

const ROLLBACK_PROGRESS_WRITE_INTERVAL_MS = 350;

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  if (!session.shop) {
    throw new Response("Shop is required.", { status: 401 });
  }

  const task = await loadTask(params.id, session.shop);

  return json({ task });
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  if (!session.shop) {
    throw new Response("Shop is required to roll back a task.", { status: 401 });
  }

  const flashSession = await getFlashSession(request);
  const formData = await request.formData();
  const task = await loadTask(params.id, session.shop);
  const rollbackStartedAt = new Date().toISOString();
  const redirectTo = getSafeRedirectTo(
    request,
    formData.get("redirectTo"),
    `/app/tasks/${task.id}`,
  );

  if (isRollbackProcessing(task)) {
    return redirectWithToast(flashSession, redirectTo, "Rollback is already running.");
  }

  if (isRollbackCompleted(task)) {
    return redirectWithToast(flashSession, redirectTo, "Rollback is already complete.");
  }

  if (!canRollbackTask(task)) {
    return redirectWithToast(
      flashSession,
      redirectTo,
      "Task can be rolled back only after it is complete.",
    );
  }

  await db.task.updateMany({
    where: { id: task.id, shop: task.shop },
    data: {
      status: "Cancelling",
      executionSummary: {
        ...(task.executionSummary || {}),
        rollback: {
          ok: null,
          status: "Cancelling",
          progress: 1,
          startedAt: rollbackStartedAt,
        },
      },
    },
  });

  scheduleRollbackExecution(admin, task, rollbackStartedAt);

  return redirectWithToast(flashSession, redirectTo, "Task rollback started.");
};

async function redirectWithToast(session, path, message) {
  session.flash("toast", message);
  return redirect(path, {
    headers: {
      "Set-Cookie": await commitFlashSession(session),
    },
  });
}

function scheduleRollbackExecution(admin, task, rollbackStartedAt) {
  void runRollbackExecution(admin, task, rollbackStartedAt);
}

async function runRollbackExecution(admin, task, rollbackStartedAt) {
  const executionSummary = task.executionSummary || {};
  const updateRollbackProgress = createRollbackProgressReporter(
    task.id,
    task.shop,
    executionSummary,
    rollbackStartedAt,
  );

  try {
    await updateRollbackProgress(
      10,
      { message: "Preparing rollback." },
      { force: true },
    );

    const rollback = await rollbackTask(
      admin,
      task,
      updateRollbackProgress,
      rollbackStartedAt,
    );

    await db.task.updateMany({
      where: { id: task.id, shop: task.shop },
      data: {
        status: "Cancelled",
        executionSummary: {
          ...executionSummary,
          rollback: {
            ...rollback,
            status: "Cancelled",
          },
        },
      },
    });
  } catch (error) {
    await db.task.updateMany({
      where: { id: task.id, shop: task.shop },
      data: {
        status: "Cancelled",
        executionSummary: {
          ...executionSummary,
          rollback: {
            ok: false,
            status: "Cancelled",
            progress: 100,
            startedAt: rollbackStartedAt,
            completedAt: new Date().toISOString(),
            error:
              error instanceof Error
                ? error.message
                : "Unable to roll back task.",
          },
        },
      },
    });
  }
}

function createRollbackProgressReporter(
  taskId,
  shop,
  baseExecutionSummary,
  startedAt,
) {
  let lastWriteAt = 0;
  let latestSummary = {};

  return async function updateRollbackProgress(
    progress,
    summary = {},
    options = {},
  ) {
    latestSummary = {
      ...latestSummary,
      ...summary,
      progress,
    };

    const now = Date.now();
    const shouldWrite =
      options.force ||
      progress >= 95 ||
      now - lastWriteAt >= ROLLBACK_PROGRESS_WRITE_INTERVAL_MS;

    if (!shouldWrite) return;

    lastWriteAt = now;

    await db.task.updateMany({
      where: { id: taskId, shop },
      data: {
        status: "Cancelling",
        executionSummary: {
          ...baseExecutionSummary,
          rollback: {
            ok: null,
            status: "Cancelling",
            startedAt,
            ...latestSummary,
            progress,
          },
        },
      },
    });
  };
}

async function loadTask(id, shop) {
  const taskId = Number(id);
  const resolvedShop = String(shop || "").trim();

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Response("Task not found", { status: 404 });
  }

  if (!resolvedShop) {
    throw new Response("Shop is required.", { status: 401 });
  }

  const task = await db.task.findFirst({
    where: {
      id: taskId,
      shop: resolvedShop,
    },
  });

  if (!task) {
    throw new Response("Task not found", { status: 404 });
  }

  return task;
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase().trim();
}

function normalizeStatusKey(status) {
  return normalizeStatus(status).replace(/[\s-]+/g, "_");
}

function getRollbackSummary(task) {
  return (
    task?.rollback ||
    task?.rollbackSummary ||
    task?.executionSummary?.rollback ||
    task?.executionSummary?.rollbackSummary ||
    {}
  );
}

function getRollbackStatus(task) {
  return normalizeStatusKey(
    task?.rollbackStatus ||
      task?.rollback?.status ||
      task?.rollbackSummary?.status ||
      task?.executionSummary?.rollbackStatus ||
      task?.executionSummary?.rollback?.status ||
      task?.executionSummary?.rollbackSummary?.status ||
      "",
  );
}

function isRollbackProcessing(task) {
  const taskStatus = normalizeStatusKey(task?.status);
  const rollbackStatus = getRollbackStatus(task);
  const rollback = getRollbackSummary(task);

  return (
    rollbackStatus === "cancelling" ||
    taskStatus === "canceling" ||
    taskStatus === "cancelling" ||
    (Boolean(rollback.startedAt) && !rollback.completedAt && rollback.progress < 100)
  );
}

function isRollbackCompleted(task) {
  const taskStatus = normalizeStatusKey(task?.status);
  const rollbackStatus = getRollbackStatus(task);
  const rollback = getRollbackSummary(task);

  return (
    rollbackStatus === "cancelled" ||
    rollbackStatus === "canceled" ||
    ((taskStatus === "cancelled" || taskStatus === "canceled") &&
      rollback.ok === true) ||
    Boolean(rollback.completedAt) ||
    Boolean(rollback.rolledBackAt) ||
    rollback.progress >= 100 && rollback.ok === true
  );
}

function canRollbackTask(task) {
  const status = normalizeStatusKey(task.status);

  if (
    isRollbackProcessing(task) ||
    isRollbackCompleted(task) ||
    status.includes("cancel") ||
    status.includes("rollback") ||
    status.includes("rolled_back")
  ) {
    return false;
  }

  return (
    status === "complete" ||
    status === "completed" ||
    status === "applied" ||
    status === "done" ||
    status === "success" ||
    status === "successful" ||
    Boolean(task.completedAt) ||
    Boolean(task.executionSummary?.completedAt)
  );
}

function getSafeRedirectTo(request, requestedRedirect, fallback) {
  const url = new URL(request.url);
  const fallbackPath = fallback || "/app/tasks";
  const rawRedirect = String(requestedRedirect || request.headers.get("referer") || "");

  if (!rawRedirect) return fallbackPath;

  try {
    const redirectUrl = rawRedirect.startsWith("/")
      ? new URL(rawRedirect, url.origin)
      : new URL(rawRedirect);

    if (redirectUrl.origin !== url.origin) return fallbackPath;

    return `${redirectUrl.pathname}${redirectUrl.search}`;
  } catch {
    return fallbackPath;
  }
}

export default function RollbackTaskPage() {
  const { task } = useLoaderData();
  const canRollback = canRollbackTask(task);
  const rollbackProcessing = isRollbackProcessing(task);
  const rollbackCompleted = isRollbackCompleted(task);

  return (
    <Page
      title="Rollback task"
      backAction={{ content: "Task details", url: `/app/tasks/${task.id}` }}
    >
      <TitleBar title="Boltr Bulk Price Editor" />

      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {rollbackProcessing ? (
                <Banner tone="info">
                  Rollback is already running. Please wait until it is complete.
                </Banner>
              ) : null}

              {rollbackCompleted ? (
                <Banner tone="success">
                  Rollback is complete. You can delete this task from the task
                  details page or task list.
                </Banner>
              ) : null}

              {!canRollback && !rollbackProcessing && !rollbackCompleted ? (
                <Banner tone="warning">
                  Task can be rolled back only after it is complete.
                </Banner>
              ) : null}

              <Text as="p">
                Rollback will restore the product prices, compare-at prices, and
                inventory costs recorded before this task ran.
              </Text>

              <InlineStack gap="200">
                <Button url={`/app/tasks/${task.id}`}>Back to task</Button>

                {!rollbackCompleted ? (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="redirectTo"
                      value={`/app/tasks/${task.id}`}
                    />
                    <Button
                      submit
                      variant="primary"
                      disabled={!canRollback || rollbackProcessing}
                      loading={rollbackProcessing}
                    >
                      {rollbackProcessing ? "Rolling back..." : "Rollback"}
                    </Button>
                  </Form>
                ) : null}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
