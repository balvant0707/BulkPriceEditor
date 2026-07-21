const PRICE_LIST_PRICES_QUERY = `#graphql
  query MarketPriceListPrices($id: ID!, $first: Int!, $after: String) {
    priceList(id: $id) {
      id
      prices(first: $first, after: $after) {
        nodes {
          originType
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
          variant {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const PRICE_LIST_FIXED_PRICES_ADD = `#graphql
  mutation MarketPriceListFixedPricesAdd(
    $priceListId: ID!
    $prices: [PriceListPriceInput!]!
  ) {
    priceListFixedPricesAdd(priceListId: $priceListId, prices: $prices) {
      prices {
        price {
          amount
          currencyCode
        }
        compareAtPrice {
          amount
          currencyCode
        }
        variant {
          id
        }
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const PRICE_LIST_FIXED_PRICES_UPDATE = `#graphql
  mutation MarketPriceListFixedPricesUpdate(
    $priceListId: ID!
    $pricesToAdd: [PriceListPriceInput!]!
    $variantIdsToDelete: [ID!]!
  ) {
    priceListFixedPricesUpdate(
      priceListId: $priceListId
      pricesToAdd: $pricesToAdd
      variantIdsToDelete: $variantIdsToDelete
    ) {
      pricesAdded {
        price {
          amount
          currencyCode
        }
        compareAtPrice {
          amount
          currencyCode
        }
        variant {
          id
        }
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

const MARKET_PRODUCT_VARIANTS_BULK_UPDATE = `#graphql
  mutation MarketProductVariantsBulkUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
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

const PRICE_LIST_PAGE_SIZE = 250;
const PRICE_LIST_UPDATE_BATCH_SIZE = 100;
const PRODUCT_UPDATE_BATCH_SIZE = 4;
const GRAPHQL_MAX_RETRIES = 4;
const GRAPHQL_RETRY_BASE_MS = 500;

export async function getFixedPrices(admin, priceListId, variantIds = []) {
  const wantedIds = new Set(variantIds.filter(Boolean));
  const byVariantId = new Map();
  let after = null;

  if (!priceListId || !wantedIds.size) return byVariantId;

  do {
    const data = await marketGraphql(admin, PRICE_LIST_PRICES_QUERY, {
      id: priceListId,
      first: PRICE_LIST_PAGE_SIZE,
      after,
    });
    const connection = data.priceList?.prices;

    for (const node of connection?.nodes || []) {
      const variantId = node.variant?.id;
      if (!wantedIds.has(variantId)) continue;

      byVariantId.set(variantId, {
        variantId,
        originType: node.originType,
        price: node.price?.amount ?? null,
        compareAtPrice: node.compareAtPrice?.amount ?? null,
        currencyCode:
          node.price?.currencyCode || node.compareAtPrice?.currencyCode || "",
      });
    }

    if (byVariantId.size >= wantedIds.size) break;
    after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);

  return byVariantId;
}

export async function updateMarketPrices({
  admin,
  ownerType,
  ownerId,
  shop,
  markets,
  variants,
  priceChange,
  compareAtPriceChange,
  applyToFixedPrices = false,
}) {
  const selectedMarkets = normalizeMarkets(markets);
  const variantIds = variants.map((variant) => variant.id).filter(Boolean);
  const errors = [];
  const logs = [];
  const originalMarketPrices = [];
  const originalVariants = [];
  let updatedCount = 0;
  let skippedCount = 0;
  let updatedBaseProductPrices = false;

  for (const market of selectedMarkets) {
    if (!market.priceListIds.length) {
      if (updatedBaseProductPrices) {
        continue;
      }

      const baseResult = await updateBaseProductPrices({
        admin,
        ownerType,
        ownerId,
        shop,
        market,
        variants,
        priceChange,
        compareAtPriceChange,
      });

      updatedBaseProductPrices = true;
      updatedCount += baseResult.updatedCount;
      skippedCount += baseResult.skippedCount;
      logs.push(...baseResult.logs);
      originalVariants.push(...baseResult.originalVariants);
      errors.push(...baseResult.errors);
      continue;
    }

    for (const priceListId of market.priceListIds) {
      try {
        const fixedPrices = await getFixedPrices(admin, priceListId, variantIds);
        const updates = [];

        for (const variant of variants) {
          const fixedPrice = fixedPrices.get(variant.id);
          if (applyToFixedPrices && !fixedPrice) {
            skippedCount += 1;
            logs.push(
              buildMarketLog({
                ownerType,
                ownerId,
                shop,
                market,
                priceListId,
                variant,
                status: "Skipped",
                errors: ["Variant has no fixed price in selected market."],
              }),
            );
            continue;
          }

          const basePrice = fixedPrice?.price ?? variant.price;
          const baseCompareAtPrice = fixedPrice?.compareAtPrice ?? variant.compareAtPrice;
          const nextPrice = calculateMarketPrice(basePrice, variant, priceChange, {
            fallbackBase: variant.price,
          });
          const nextCompareAtPrice = calculateMarketPrice(
            baseCompareAtPrice,
            { ...variant, price: basePrice },
            compareAtPriceChange,
            { resetValue: null, fallbackBase: basePrice },
          );

          if (
            (nextPrice === undefined || moneyValuesEqual(nextPrice, basePrice)) &&
            (nextCompareAtPrice === undefined ||
              moneyValuesEqual(nextCompareAtPrice, baseCompareAtPrice))
          ) {
            skippedCount += 1;
            continue;
          }

          const priceInput = {
            variantId: variant.id,
            price: {
              amount: nextPrice ?? formatPrice(basePrice),
              currencyCode: market.currencyCode || fixedPrice?.currencyCode,
            },
          };

          if (nextCompareAtPrice !== undefined) {
            priceInput.compareAtPrice =
              nextCompareAtPrice == null
                ? null
                : {
                    amount: nextCompareAtPrice,
                    currencyCode: market.currencyCode || fixedPrice?.currencyCode,
                  };
          } else if (baseCompareAtPrice != null) {
            priceInput.compareAtPrice = {
              amount: formatPrice(baseCompareAtPrice),
              currencyCode: market.currencyCode || fixedPrice?.currencyCode,
            };
          }

          if (!priceInput.price.currencyCode) {
            skippedCount += 1;
            errors.push(
              `Skipped ${variant.id} in ${market.name}: missing market currency code.`,
            );
            continue;
          }

          updates.push(priceInput);
          originalMarketPrices.push({
            marketId: market.id,
            marketName: market.name,
            priceListId,
            variantId: variant.id,
            productId: variant.product?.id,
            productTitle: variant.product?.title,
            variantTitle: variant.title,
            price: fixedPrice?.price ?? null,
            compareAtPrice: fixedPrice?.compareAtPrice ?? null,
            nextPrice: priceInput.price.amount,
            nextCompareAtPrice:
              priceInput.compareAtPrice === undefined
                ? baseCompareAtPrice
                : priceInput.compareAtPrice?.amount ?? null,
            currencyCode: market.currencyCode || fixedPrice?.currencyCode || "",
            hadFixedPrice: Boolean(fixedPrice),
          });
          logs.push(
            buildMarketLog({
              ownerType,
              ownerId,
              shop,
              market,
              priceListId,
              variant,
              oldPrice: basePrice,
              newPrice: priceInput.price.amount,
              oldCompareAtPrice: baseCompareAtPrice,
              newCompareAtPrice:
                priceInput.compareAtPrice === undefined
                  ? baseCompareAtPrice
                  : priceInput.compareAtPrice?.amount ?? null,
              status: "Applied",
            }),
          );
        }

        const result = await updateFixedPrices(admin, priceListId, updates, []);
        updatedCount += result.updatedCount;
        errors.push(...result.errors);
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `${market.name || priceListId}: ${error.message}`
            : `${market.name || priceListId}: Market price update failed.`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    updatedCount,
    skippedCount,
    totalPriceChanges: updatedCount,
    originalMarketPrices,
    originalVariants,
    logs,
    errors,
  };
}

async function updateBaseProductPrices({
  admin,
  ownerType,
  ownerId,
  shop,
  market,
  variants,
  priceChange,
  compareAtPriceChange,
}) {
  const updates = [];
  const logs = [];
  const originalVariants = [];
  let skippedCount = 0;

  for (const variant of variants) {
    const basePrice = variant.price;
    const baseCompareAtPrice = variant.compareAtPrice;
    const nextPrice = calculateMarketPrice(basePrice, variant, priceChange, {
      fallbackBase: variant.price,
    });
    const nextCompareAtPrice = calculateMarketPrice(
      baseCompareAtPrice,
      { ...variant, price: basePrice },
      compareAtPriceChange,
      { resetValue: null, fallbackBase: basePrice },
    );

    if (
      (nextPrice === undefined || moneyValuesEqual(nextPrice, basePrice)) &&
      (nextCompareAtPrice === undefined ||
        moneyValuesEqual(nextCompareAtPrice, baseCompareAtPrice))
    ) {
      skippedCount += 1;
      continue;
    }

    const update = {
      productId: variant.product?.id,
      variant: { id: variant.id },
    };

    if (nextPrice !== undefined && !moneyValuesEqual(nextPrice, basePrice)) {
      update.variant.price = nextPrice;
    }

    if (
      nextCompareAtPrice !== undefined &&
      !moneyValuesEqual(nextCompareAtPrice, baseCompareAtPrice)
    ) {
      update.variant.compareAtPrice = nextCompareAtPrice;
    }

    if (!update.productId || Object.keys(update.variant).length <= 1) {
      skippedCount += 1;
      continue;
    }

    updates.push(update);
    originalVariants.push({
      id: variant.id,
      title: variant.title,
      productId: variant.product?.id,
      productTitle: variant.product?.title,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      nextPrice: update.variant.price ?? variant.price,
      nextCompareAtPrice:
        update.variant.compareAtPrice ?? variant.compareAtPrice,
    });
    logs.push(
      buildMarketLog({
        ownerType,
        ownerId,
        shop,
        market,
        priceListId: null,
        variant,
        oldPrice: basePrice,
        newPrice: update.variant.price ?? basePrice,
        oldCompareAtPrice: baseCompareAtPrice,
        newCompareAtPrice:
          update.variant.compareAtPrice === undefined
            ? baseCompareAtPrice
            : update.variant.compareAtPrice,
        status: "Applied",
      }),
    );
  }

  const result = await applyBaseProductUpdates(admin, updates);

  return {
    updatedCount: result.updatedCount,
    skippedCount,
    originalVariants,
    logs,
    errors: result.errors,
  };
}

async function applyBaseProductUpdates(admin, updates) {
  const errors = [];
  let updatedCount = 0;
  const byProduct = new Map();

  for (const update of updates) {
    if (!byProduct.has(update.productId)) byProduct.set(update.productId, []);
    byProduct.get(update.productId).push(update.variant);
  }

  const productUpdates = Array.from(byProduct, ([productId, variants]) => ({
    productId,
    variants,
  }));

  for (const batch of chunkArray(productUpdates, PRODUCT_UPDATE_BATCH_SIZE)) {
    const results = await Promise.all(
      batch.map(async ({ productId, variants }) => {
        try {
          const data = await marketGraphql(admin, MARKET_PRODUCT_VARIANTS_BULK_UPDATE, {
            productId,
            variants,
          });
          return { ok: true, result: data.productVariantsBulkUpdate };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Product variant update failed.",
          };
        }
      }),
    );

    for (const item of results) {
      if (!item.ok) {
        errors.push(item.error);
        continue;
      }

      const userErrors = item.result?.userErrors || [];
      if (userErrors.length) {
        errors.push(...userErrors.map(formatUserError));
      } else {
        updatedCount += item.result?.productVariants?.length || 0;
      }
    }
  }

  return { errors, updatedCount };
}

export async function rollbackMarketPrices(admin, originalMarketPrices = []) {
  const errors = [];
  let updatedCount = 0;
  const byPriceList = new Map();

  for (const original of originalMarketPrices) {
    if (!original?.priceListId || !original?.variantId) continue;
    if (!byPriceList.has(original.priceListId)) byPriceList.set(original.priceListId, []);
    byPriceList.get(original.priceListId).push(original);
  }

  for (const [priceListId, originals] of byPriceList) {
    const pricesToAdd = [];
    const variantIdsToDelete = [];

    for (const original of originals) {
      if (!original.hadFixedPrice) {
        variantIdsToDelete.push(original.variantId);
        continue;
      }

      if (!original.currencyCode || original.price == null) {
        errors.push(
          `Skipped rollback for ${original.variantId}: original market price is missing.`,
        );
        continue;
      }

      const input = {
        variantId: original.variantId,
        price: {
          amount: formatPrice(original.price),
          currencyCode: original.currencyCode,
        },
      };

      if (Object.hasOwn(original, "compareAtPrice")) {
        input.compareAtPrice =
          original.compareAtPrice == null
            ? null
            : {
                amount: formatPrice(original.compareAtPrice),
                currencyCode: original.currencyCode,
              };
      }

      pricesToAdd.push(input);
    }

    try {
      const result = await updateFixedPrices(admin, priceListId, pricesToAdd, variantIdsToDelete);
      updatedCount += result.updatedCount + variantIdsToDelete.length;
      errors.push(...result.errors);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Market price rollback failed.");
    }
  }

  return {
    ok: errors.length === 0,
    updatedCount,
    errors,
  };
}

export function calculateMarketPrice(currentValue, variant, change, options = {}) {
  const action = change?.action || "";
  const current = toNumber(currentValue);

  if (!action) return undefined;
  if (action === "reset_compare_at_price") return options.resetValue;
  if (action === "set_to_price") return formatPrice(variant.price);
  if (action === "set_to_compare_at_price") {
    return variant.compareAtPrice == null ? undefined : formatPrice(variant.compareAtPrice);
  }

  let nextValue = current ?? toNumber(options.fallbackBase);

  if (action === "set_new_value") {
    nextValue = toNumber(change.amount);
  } else if (action === "set_margin") {
    const cost = toNumber(variant.inventoryItem?.unitCost?.amount);
    const margin = toNumber(change.percent);
    if (cost == null || cost <= 0 || margin == null || margin < 0 || margin >= 100) {
      return undefined;
    }
    nextValue = cost / (1 - margin / 100);
  } else if (action === "increase" || action === "decrease") {
    const relativeBase = getRelativeBaseValue(variant, change.relativeTo);
    if (relativeBase != null) nextValue = relativeBase;
    if (nextValue == null) return undefined;
    const direction = action === "increase" ? 1 : -1;

    if (change.type === "by_amount") {
      const amount = toNumber(change.amount);
      if (amount == null) return undefined;
      nextValue += direction * amount;
    } else {
      const percent = toNumber(change.percent);
      if (percent == null) return undefined;
      nextValue += direction * nextValue * (percent / 100);
    }
  }

  if (nextValue == null) return undefined;

  return formatPrice(Math.max(0, applyRounding(nextValue, change.rounding)));
}

async function addFixedPrices(admin, priceListId, prices) {
  const errors = [];
  let updatedCount = 0;

  for (const batch of chunkArray(prices, PRICE_LIST_UPDATE_BATCH_SIZE)) {
    if (!batch.length) continue;

    const data = await marketGraphql(admin, PRICE_LIST_FIXED_PRICES_ADD, {
      priceListId,
      prices: batch,
    });
    const result = data.priceListFixedPricesAdd;
    const userErrors = result?.userErrors || [];

    if (userErrors.length) {
      errors.push(...userErrors.map(formatUserError));
    } else {
      updatedCount += result?.prices?.length || 0;
    }
  }

  return { errors, updatedCount };
}

async function updateFixedPrices(admin, priceListId, pricesToAdd, variantIdsToDelete) {
  const errors = [];
  let updatedCount = 0;

  const maxBatches = Math.max(
    Math.ceil(pricesToAdd.length / PRICE_LIST_UPDATE_BATCH_SIZE),
    Math.ceil(variantIdsToDelete.length / PRICE_LIST_UPDATE_BATCH_SIZE),
    1,
  );

  for (let index = 0; index < maxBatches; index += 1) {
    const pricesBatch = pricesToAdd.slice(
      index * PRICE_LIST_UPDATE_BATCH_SIZE,
      (index + 1) * PRICE_LIST_UPDATE_BATCH_SIZE,
    );
    const deleteBatch = variantIdsToDelete.slice(
      index * PRICE_LIST_UPDATE_BATCH_SIZE,
      (index + 1) * PRICE_LIST_UPDATE_BATCH_SIZE,
    );

    if (!pricesBatch.length && !deleteBatch.length) continue;

    const data = await marketGraphql(admin, PRICE_LIST_FIXED_PRICES_UPDATE, {
      priceListId,
      pricesToAdd: pricesBatch,
      variantIdsToDelete: deleteBatch,
    });
    const result = data.priceListFixedPricesUpdate;
    const userErrors = result?.userErrors || [];

    if (userErrors.length) {
      errors.push(...userErrors.map(formatUserError));
    } else {
      updatedCount += result?.pricesAdded?.length || 0;
    }
  }

  return { errors, updatedCount };
}

async function marketGraphql(admin, query, variables = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= GRAPHQL_MAX_RETRIES; attempt += 1) {
    try {
      const response = await admin.graphql(query, { variables });
      const payload = await response.json();

      if (payload.errors) {
        if (isThrottleError(payload.errors) && attempt < GRAPHQL_MAX_RETRIES) {
          await sleep(getGraphqlRetryDelay(attempt));
          continue;
        }

        throw new Error(payload.errors.map((error) => error.message).join("; "));
      }

      return payload.data;
    } catch (error) {
      lastError = error;

      if (!isRetryableGraphqlError(error) || attempt >= GRAPHQL_MAX_RETRIES) {
        throw error;
      }

      await sleep(getGraphqlRetryDelay(attempt));
    }
  }

  throw lastError || new Error("Shopify GraphQL request failed.");
}

function normalizeMarkets(markets = []) {
  return (Array.isArray(markets) ? markets : [])
    .map((market) => ({
      ...market,
      priceListIds: [
        ...new Set([
          ...(market.priceListIds || []),
          market.priceListId,
          ...(market.catalogs || []).map((catalog) => catalog.priceList?.id),
        ].flat().filter(Boolean)),
      ],
    }))
    .filter((market) => market.id || market.name || market.priceListIds.length);
}

function buildMarketLog({
  ownerType,
  ownerId,
  shop,
  market,
  priceListId,
  variant,
  oldPrice = null,
  newPrice = null,
  oldCompareAtPrice,
  newCompareAtPrice,
  status,
  errors = [],
}) {
  const changes = [];
  if (oldPrice !== null || newPrice !== null) {
    changes.push(`Market price: ${formatDisplayValue(oldPrice)} -> ${formatDisplayValue(newPrice)}`);
  }
  if (oldCompareAtPrice !== undefined || newCompareAtPrice !== undefined) {
    changes.push(
      `Market compare at price: ${formatDisplayValue(oldCompareAtPrice)} -> ${formatDisplayValue(
        newCompareAtPrice,
      )}`,
    );
  }

  return {
    ownerType,
    saleId: ownerType === "sale" ? ownerId : undefined,
    taskId: ownerType === "task" ? ownerId : undefined,
    shop,
    marketId: market.id,
    marketName: market.name || market.label || "",
    priceListId,
    productId: variant.product?.id || "",
    productTitle: variant.product?.title || "",
    variantId: variant.id || "",
    variantTitle: variant.title || "",
    oldPrice,
    newPrice,
    oldCompareAtPrice,
    newCompareAtPrice,
    previousPrice: oldPrice,
    changes,
    action: status,
    status,
    errors,
    shopifyErrors: errors,
    createdAt: new Date().toISOString(),
  };
}

function formatUserError(error) {
  const field = Array.isArray(error.field) ? error.field.join(".") : error.field;
  return [field, error.code, error.message].filter(Boolean).join(": ");
}

function formatDisplayValue(value) {
  if (value === null || value === undefined || value === "") return "blank";
  return formatPrice(value);
}

function getRelativeBaseValue(variant, relativeTo) {
  if (relativeTo === "actual_price") return toNumber(variant.price);
  if (relativeTo === "cost_per_item") {
    return toNumber(variant.inventoryItem?.unitCost?.amount);
  }
  return null;
}

function applyRounding(value, rounding = {}) {
  if (rounding.mode === "round_to_whole") return Math.round(value);

  if (rounding.mode === "override_cents") {
    const cents = clampCents(rounding.centsValue);
    const lower = Math.floor(value) + cents / 100;
    const upper = Math.ceil(value) + cents / 100;
    return rounding.overrideToNearest && Math.abs(upper - value) < Math.abs(lower - value)
      ? upper
      : lower;
  }

  if (rounding.mode === "set_ending") {
    const ending = String(rounding.endingPattern || "").replace("*", "");
    const parsedEnding = Number(`0${ending.startsWith(".") ? ending : `.${ending}`}`);
    if (Number.isFinite(parsedEnding)) return Math.floor(value) + parsedEnding;
  }

  return value;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function clampCents(value) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return 0;
  return Math.max(0, Math.min(99, Math.trunc(cents)));
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPrice(value) {
  const number = toNumber(value);
  return number == null ? null : number.toFixed(2);
}

function moneyValuesEqual(left, right) {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);

  if (leftNumber == null || rightNumber == null) {
    return leftNumber == null && rightNumber == null;
  }

  return leftNumber.toFixed(2) === rightNumber.toFixed(2);
}

function isThrottleError(errors = []) {
  return errors.some((error) => {
    const code = String(error?.extensions?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();

    return code === "THROTTLED" || message.includes("throttled");
  });
}

function isRetryableGraphqlError(error) {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("throttled") ||
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("socket") ||
    message.includes("econnreset")
  );
}

function getGraphqlRetryDelay(attempt) {
  return GRAPHQL_RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
