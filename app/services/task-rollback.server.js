import { rollbackMarketPrices } from "./market-pricing.server";

const ROLLBACK_UPDATE_CONCURRENCY = 24;
const ROLLBACK_VARIANT_BATCH_SIZE = 200;

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
        field
        message
      }
    }
  }
`;

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload.errors) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

export async function rollbackTask(
  admin,
  task,
  onProgress = async () => {},
  startedAt = new Date().toISOString(),
) {
  const originalVariants = task.executionSummary?.originalVariants || [];
  const originalMarketPrices = task.executionSummary?.originalMarketPrices || [];
  const originalInventoryItems =
    task.executionSummary?.originalInventoryItems || [];
  const errors = [];
  let updatedVariants = 0;
  let updatedInventoryItems = 0;

  if (!originalVariants.length && !originalMarketPrices.length && !originalInventoryItems.length) {
    return {
      ok: false,
      status: "Cancelled",
      progress: 100,
      error: "Rollback data is not available for this task.",
      updatedVariants,
      updatedInventoryItems,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  if (task.applyChangesTo === "markets" || originalMarketPrices.length) {
    const marketRollback = await rollbackMarketPrices(admin, originalMarketPrices);
    const variantsByProduct = new Map();

    for (const original of originalVariants) {
      if (!original.productId || !original.id) continue;

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

      collectVariantRollbackResults(results, errors, (count) => {
        updatedVariants += count;
      });
    }

    updatedInventoryItems += await rollbackInventoryItems(
      admin,
      originalInventoryItems,
      errors,
    );

    return {
      ok: marketRollback.ok && errors.length === 0,
      status: "Cancelled",
      progress: 100,
      updatedVariants: marketRollback.updatedCount + updatedVariants,
      updatedInventoryItems,
      errors: [...marketRollback.errors, ...errors],
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
    status: "Cancelled",
    progress: 100,
    updatedVariants,
    updatedInventoryItems,
    errors,
    startedAt,
    completedAt,
    rolledBackAt: errors.length === 0 ? completedAt : null,
  };
}

function collectVariantRollbackResults(results, errors, addUpdatedVariants) {
  for (const item of results) {
    if (!item.ok) {
      errors.push(item.error);
      continue;
    }

    const result = item.result;
    const userErrors = result?.userErrors || [];
    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
    } else {
      addUpdatedVariants(result?.productVariants?.length || 0);
    }
  }
}

async function rollbackInventoryItems(admin, originalInventoryItems, errors) {
  let updatedInventoryItems = 0;
  const inventoryUpdates = originalInventoryItems.filter((original) => original?.id);

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
        continue;
      }

      const result = item.result;
      const userErrors = result?.userErrors || [];
      if (userErrors.length) {
        errors.push(...userErrors.map((error) => error.message));
      } else {
        updatedInventoryItems += 1;
      }
    }
  }

  return updatedInventoryItems;
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
