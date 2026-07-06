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

const ROLLBACK_UPDATE_CONCURRENCY = 12;
const ROLLBACK_VARIANT_BATCH_SIZE = 200;
const ROLLBACK_PROGRESS_WRITE_INTERVAL_MS = 800;

const TASK_PRODUCT_VARIANTS_BULK_UPDATE = `#graphql
  mutation TaskRollbackProductVariantsBulkUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      product {
        id
      }
      productVariants {
        id
        price
        compareAtPrice
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const TASK_INVENTORY_ITEM_UPDATE = `#graphql
  mutation TaskRollbackInventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        unitCost {
          amount
        }
      }
      userErrors {
        message
      }
    }
  }
`;

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const task = await loadTask(params.id, session.shop);

  return json({ task });
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const task = await loadTask(params.id, session.shop);
  const rollbackStartedAt = new Date().toISOString();
  const redirectTo = getSafeRedirectTo(
    request,
    formData.get("redirectTo"),
    `/app/tasks/${task.id}`,
  );

  if (isRollbackProcessing(task)) {
    return redirect(withMessage(redirectTo, "Rollback is already running."));
  }

  if (isRollbackCompleted(task)) {
    return redirect(withMessage(redirectTo, "Rollback is already complete."));
  }

  if (!canRollbackTask(task)) {
    return redirect(
      withMessage(
        redirectTo,
        "Task can be rolled back only after it is complete.",
      ),
    );
  }

  await db.task.update({
    where: { id: task.id },
    data: {
      status: "Rolling Back",
      executionSummary: {
        ...(task.executionSummary || {}),
        rollback: {
          ok: null,
          status: "processing",
          progress: 1,
          startedAt: rollbackStartedAt,
        },
      },
    },
  });

  scheduleRollbackExecution(admin, task, rollbackStartedAt);

  return redirect(withMessage(redirectTo, "Rollback started"));
};

function scheduleRollbackExecution(admin, task, rollbackStartedAt) {
  setTimeout(() => {
    void runRollbackExecution(admin, task, rollbackStartedAt);
  }, 10);
}

async function runRollbackExecution(admin, task, rollbackStartedAt) {
  const executionSummary = task.executionSummary || {};
  const updateRollbackProgress = createRollbackProgressReporter(
    task.id,
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

    await db.task.update({
      where: { id: task.id },
      data: {
        status: rollback.ok ? "Rolled back" : "Rollback failed",
        executionSummary: {
          ...executionSummary,
          rollback,
        },
      },
    });
  } catch (error) {
    await db.task.update({
      where: { id: task.id },
      data: {
        status: "Rollback failed",
        executionSummary: {
          ...executionSummary,
          rollback: {
            ok: false,
            status: "failed",
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

function createRollbackProgressReporter(taskId, baseExecutionSummary, startedAt) {
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

    await db.task.update({
      where: { id: taskId },
      data: {
        status: "Rolling Back",
        executionSummary: {
          ...baseExecutionSummary,
          rollback: {
            ok: null,
            status: "processing",
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

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Response("Task not found", { status: 404 });
  }

  const task = await db.task.findFirst({
    where: {
      id: taskId,
      shop,
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
    rollbackStatus === "processing" ||
    rollbackStatus === "started" ||
    rollbackStatus === "running" ||
    rollbackStatus === "in_progress" ||
    rollbackStatus === "rollback_processing" ||
    rollbackStatus === "rollback_started" ||
    rollbackStatus === "rollback_running" ||
    rollbackStatus === "rollback_in_progress" ||
    taskStatus === "rolling_back" ||
    taskStatus === "rollback_processing" ||
    (Boolean(rollback.startedAt) && !rollback.completedAt && rollback.progress < 100)
  );
}

function isRollbackCompleted(task) {
  const taskStatus = normalizeStatusKey(task?.status);
  const rollbackStatus = getRollbackStatus(task);
  const rollback = getRollbackSummary(task);

  return (
    rollbackStatus === "complete" ||
    rollbackStatus === "completed" ||
    rollbackStatus === "rolled_back" ||
    rollbackStatus === "rollback_complete" ||
    rollbackStatus === "rollback_completed" ||
    taskStatus === "rolled_back" ||
    taskStatus === "rollback_complete" ||
    taskStatus === "rollback_completed" ||
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
    status.includes("rolled_back") ||
    status.includes("failed") ||
    status.includes("error")
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

function withMessage(path, message) {
  const url = new URL(path, "https://app.local");
  url.searchParams.set("message", message);
  return `${url.pathname}${url.search}`;
}

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload.errors) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

async function rollbackTask(
  admin,
  task,
  onProgress = async () => {},
  startedAt = new Date().toISOString(),
) {
  const originalVariants = task.executionSummary?.originalVariants || [];
  const originalInventoryItems =
    task.executionSummary?.originalInventoryItems || [];
  const errors = [];
  let updatedVariants = 0;
  let updatedInventoryItems = 0;

  if (!originalVariants.length && !originalInventoryItems.length) {
    return {
      ok: false,
      status: "failed",
      progress: 100,
      error: "Rollback data is not available for this task.",
      updatedVariants,
      updatedInventoryItems,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const variantsByProduct = new Map();

  for (const original of originalVariants) {
    if (!original.productId || !original.id) {
      errors.push(
        "Rollback skipped a variant because its product or variant ID was not recorded.",
      );
      continue;
    }

    const originalPrice = normalizeMoneyInput(original.price);
    if (originalPrice == null) {
      errors.push(
        `Rollback skipped ${original.title || original.id} because its original price was not recorded.`,
      );
      continue;
    }

    const rollbackVariant = {
      id: original.id,
      price: originalPrice,
    };

    if (Object.hasOwn(original, "compareAtPrice")) {
      rollbackVariant.compareAtPrice = normalizeNullableMoneyInput(
        original.compareAtPrice,
      );
    }

    if (!variantsByProduct.has(original.productId)) {
      variantsByProduct.set(original.productId, []);
    }
    variantsByProduct.get(original.productId).push(rollbackVariant);
  }

  const productUpdates = createProductRollbackBatches(variantsByProduct);
  const inventoryUpdates = originalInventoryItems.filter((original) => original?.id);

  const totalUpdateSteps = productUpdates.length + inventoryUpdates.length;
  let completedUpdateSteps = 0;

  await onProgress(
    20,
    {
      variantUpdateSteps: productUpdates.length,
      inventoryUpdateSteps: inventoryUpdates.length,
      updatedVariants,
      updatedInventoryItems,
    },
    { force: true },
  );

  const reportUpdateProgress = async () => {
    completedUpdateSteps += 1;
    const progress =
      totalUpdateSteps > 0
        ? 20 + Math.round((completedUpdateSteps / totalUpdateSteps) * 75)
        : 95;

    await onProgress(Math.min(progress, 95), {
      updateSteps: totalUpdateSteps,
      completedUpdateSteps,
      updatedVariants,
      updatedInventoryItems,
    });
  };

  if (totalUpdateSteps === 0) {
    await onProgress(
      95,
      {
        updateSteps: 0,
        completedUpdateSteps: 0,
        updatedVariants,
        updatedInventoryItems,
      },
      { force: true },
    );
  }

  for (const batch of chunkArray(productUpdates, ROLLBACK_UPDATE_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(async ({ productId, variants }) => {
        try {
          const data = await shopifyGraphql(admin, TASK_PRODUCT_VARIANTS_BULK_UPDATE, {
            productId,
            variants,
          });
          return { ok: true, result: data.productVariantsBulkUpdate };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Variant rollback failed.",
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        errors.push(item.error);
        await reportUpdateProgress();
        continue;
      }

      const result = item.result;
      const userErrors = result?.userErrors || [];

      if (userErrors.length) {
        errors.push(...userErrors.map((error) => error.message));
      } else {
        updatedVariants += result?.productVariants?.length || 0;
      }

      await reportUpdateProgress();
    }
  }

  for (const batch of chunkArray(inventoryUpdates, ROLLBACK_UPDATE_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map(async (original) => {
        try {
          const data = await shopifyGraphql(admin, TASK_INVENTORY_ITEM_UPDATE, {
            id: original.id,
            input: { cost: normalizeNullableMoneyInput(original.cost) },
          });
          return { ok: true, result: data.inventoryItemUpdate };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Inventory rollback failed.",
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        errors.push(item.error);
        await reportUpdateProgress();
        continue;
      }

      const result = item.result;
      const userErrors = result?.userErrors || [];

      if (userErrors.length) {
        errors.push(...userErrors.map((error) => error.message));
      } else {
        updatedInventoryItems += 1;
      }

      await reportUpdateProgress();
    }
  }

  const completedAt = new Date().toISOString();

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "complete" : "failed",
    progress: 100,
    updatedVariants,
    updatedInventoryItems,
    errors,
    startedAt,
    completedAt,
    rolledBackAt: errors.length === 0 ? completedAt : null,
  };
}

function createProductRollbackBatches(variantsByProduct) {
  const batches = [];

  for (const [productId, variants] of variantsByProduct) {
    for (const variantBatch of chunkArray(variants, ROLLBACK_VARIANT_BATCH_SIZE)) {
      batches.push({ productId, variants: variantBatch });
    }
  }

  return batches;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeMoneyInput(value) {
  if (value == null || value === "") return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  return number.toFixed(2);
}

function normalizeNullableMoneyInput(value) {
  if (value == null || value === "") return null;
  return normalizeMoneyInput(value);
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
      <TitleBar title="Rollback task" />

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
