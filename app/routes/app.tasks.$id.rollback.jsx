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
  const task = await loadTask(params.id, session.shop);
  const rollbackStartedAt = new Date().toISOString();

  if (!canRollbackTask(task)) {
    return redirect(
      `/app/tasks?message=${encodeURIComponent(
        "Task can be rolled back only after it is complete.",
      )}`,
    );
  }

  await db.task.update({
    where: { id: task.id },
    data: {
      status: "Rolling back",
      executionSummary: {
        ...(task.executionSummary || {}),
        rollback: {
          status: "processing",
          progress: 0,
          startedAt: rollbackStartedAt,
        },
      },
    },
  });

  scheduleRollbackExecution(admin, task, rollbackStartedAt);

  return redirect(
    `/app/tasks?message=${encodeURIComponent("Rollback started")}`,
  );
};

function scheduleRollbackExecution(admin, task, rollbackStartedAt) {
  setTimeout(() => {
    void runRollbackExecution(admin, task, rollbackStartedAt);
  }, 100);
}

async function runRollbackExecution(admin, task, rollbackStartedAt) {
  const updateRollbackProgress = async (progress, summary = {}) => {
    await db.task.update({
      where: { id: task.id },
      data: {
        executionSummary: {
          ...(task.executionSummary || {}),
          rollback: {
            status: "processing",
            startedAt: rollbackStartedAt,
            ...summary,
            progress,
          },
        },
      },
    });
  };

  try {
    const rollback = await rollbackTask(
      admin,
      task,
      updateRollbackProgress,
      rollbackStartedAt,
    );

    await db.task.update({
      where: { id: task.id },
      data: {
        status: rollback.ok ? "Canceled" : "Rollback failed",
        executionSummary: {
          ...(task.executionSummary || {}),
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
          ...(task.executionSummary || {}),
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

function canRollbackTask(task) {
  const status = normalizeStatus(task.status);

  if (
    status.includes("cancel") ||
    status.includes("rolling back") ||
    status.includes("rollback") ||
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
      error: "Rollback data is not available for this task.",
      updatedVariants,
      updatedInventoryItems,
    };
  }

  const variantsByProduct = new Map();

  for (const original of originalVariants) {
    if (!original.productId || !original.id) {
      errors.push(
        `Rollback skipped a variant because its product or variant ID was not recorded.`,
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

  const totalUpdateSteps = variantsByProduct.size + originalInventoryItems.length;
  let completedUpdateSteps = 0;
  await onProgress(25, {
    variantUpdateSteps: variantsByProduct.size,
    inventoryUpdateSteps: originalInventoryItems.length,
    updatedVariants,
    updatedInventoryItems,
  });

  const reportUpdateProgress = async () => {
    completedUpdateSteps += 1;
    const progress =
      totalUpdateSteps > 0
        ? 25 + Math.round((completedUpdateSteps / totalUpdateSteps) * 70)
        : 95;

    await onProgress(Math.min(progress, 95), {
      updateSteps: totalUpdateSteps,
      completedUpdateSteps,
      updatedVariants,
      updatedInventoryItems,
    });
  };

  if (totalUpdateSteps === 0) {
    await onProgress(95, {
      updateSteps: 0,
      completedUpdateSteps: 0,
      updatedVariants,
      updatedInventoryItems,
    });
  }

  for (const [productId, variants] of variantsByProduct) {
    const data = await shopifyGraphql(admin, TASK_PRODUCT_VARIANTS_BULK_UPDATE, {
      productId,
      variants,
    });
    const result = data.productVariantsBulkUpdate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
    } else {
      updatedVariants += result?.productVariants?.length || 0;
    }

    await reportUpdateProgress();
  }

  for (const original of originalInventoryItems) {
    const data = await shopifyGraphql(admin, TASK_INVENTORY_ITEM_UPDATE, {
      id: original.id,
      input: { cost: original.cost },
    });
    const result = data.inventoryItemUpdate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
    } else {
      updatedInventoryItems += 1;
    }

    await reportUpdateProgress();
  }

  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? "complete" : "failed",
    progress: 100,
    updatedVariants,
    updatedInventoryItems,
    errors,
    startedAt,
    completedAt: new Date().toISOString(),
    rolledBackAt: new Date().toISOString(),
  };
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
              {!canRollback ? (
                <Banner tone="warning">
                  Task can be rolled back only after it is complete.
                </Banner>
              ) : null}

              <Text as="p">
                Rollback will restore the product prices, compare-at prices, and
                inventory costs recorded before this task ran.
              </Text>

              <InlineStack gap="200">
                <Button url={`/app/tasks/${task.id}`}>Cancel</Button>
                <Form method="post">
                  <Button submit variant="primary" disabled={!canRollback}>
                    Rollback
                  </Button>
                </Form>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
