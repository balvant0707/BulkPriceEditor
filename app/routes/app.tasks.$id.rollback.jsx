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

  if (task.status !== "Complete") {
    return redirect(
      `/app/tasks?message=${encodeURIComponent(
        "Task can be rolled back only after status is Complete.",
      )}`,
    );
  }

  const rollback = await rollbackTask(admin, task);

  await db.task.update({
    where: { id: task.id },
    data: {
      status: rollback.ok ? "Rolled back" : "Rollback failed",
      executionSummary: {
        ...(task.executionSummary || {}),
        rollback,
      },
    },
  });

  return redirect(
    `/app/tasks?message=${encodeURIComponent(
      rollback.ok
        ? "Task changes were rolled back."
        : "Rollback failed. Check task details.",
    )}`,
  );
};

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

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload.errors) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

async function rollbackTask(admin, task) {
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
    if (!original.productId) continue;
    if (!variantsByProduct.has(original.productId)) {
      variantsByProduct.set(original.productId, []);
    }
    variantsByProduct.get(original.productId).push({
      id: original.id,
      price: original.price,
      compareAtPrice: original.compareAtPrice,
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
  }

  return {
    ok: errors.length === 0,
    updatedVariants,
    updatedInventoryItems,
    errors,
    rolledBackAt: new Date().toISOString(),
  };
}

export default function RollbackTaskPage() {
  const { task } = useLoaderData();
  const canRollback = task.status === "Complete";

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
                  Task can be rolled back only after status is Complete.
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
