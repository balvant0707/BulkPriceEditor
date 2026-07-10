import { json } from "@remix-run/node";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  endSaleRecord,
  executeSaleConditionChangeRecord,
  executeSaleRecord,
} from "../lib/sales.server";
import { SALE_STATUS } from "../lib/sale-status";

const SALES_CRON_BATCH_SIZE = 20;
const SALE_TRACK_CONDITION_INTERVAL_MS = 60 * 60 * 1000;
const runningConditionSaleIds = new Set();

export async function loader({ request }) {
  return runSalesScheduler(request);
}

export async function action({ request }) {
  return runSalesScheduler(request);
}

async function runSalesScheduler(request) {
  const authResponse = authorizeCronRequest(request);
  if (authResponse) return authResponse;

  const now = new Date();
  const [scheduledSales, endingSales, trackConditionSales] = await Promise.all([
    db.sale.findMany({
      where: {
        status: "scheduled",
        shop: { not: "" },
        startAt: { lte: now },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: SALES_CRON_BATCH_SIZE,
    }),
    db.sale.findMany({
      where: {
        status: { in: [SALE_STATUS.COMPLETED, "active"] },
        shop: { not: "" },
        endAt: { lte: now },
      },
      orderBy: [{ endAt: "asc" }, { id: "asc" }],
      take: SALES_CRON_BATCH_SIZE,
    }),
    db.sale.findMany({
      where: {
        status: { in: [SALE_STATUS.COMPLETED, "active"] },
        shop: { not: "" },
        trackConditionChanges: true,
        OR: [{ endAt: null }, { endAt: { gt: now } }],
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: SALES_CRON_BATCH_SIZE * 3,
    }),
  ]);
  const results = [];

  for (const sale of scheduledSales) {
    results.push(await activateSale(sale));
  }

  for (const sale of endingSales) {
    results.push(await endSale(sale));
  }

  const dueTrackConditionSales = trackConditionSales
    .filter((sale) => shouldTrackSaleCondition(sale))
    .slice(0, SALES_CRON_BATCH_SIZE);

  for (const sale of dueTrackConditionSales) {
    results.push(await trackSaleCondition(sale));
  }

  return json({
    ok: results.every((result) => result.ok),
    processed: results.length,
    results,
  });
}

function getObjectValue(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ...parsed }
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function getSaleConditionLastRun(sale) {
  const configuration = getObjectValue(sale.configuration);
  const executionSummary = getObjectValue(sale.executionSummary);

  return (
    executionSummary.trackConditionLastRunAt ||
    executionSummary.saleConditionLastRunAt ||
    configuration.track_condition_changes_last_run_at ||
    ""
  );
}

function shouldTrackSaleCondition(sale) {
  if (!sale.shop || runningConditionSaleIds.has(sale.id)) return false;

  const lastRun = getSaleConditionLastRun(sale);
  if (!lastRun) return true;

  const lastRunAt = new Date(lastRun).getTime();
  if (Number.isNaN(lastRunAt)) return true;

  return Date.now() - lastRunAt >= SALE_TRACK_CONDITION_INTERVAL_MS;
}

function authorizeCronRequest(request) {
  const configuredSecret = process.env.SALES_CRON_SECRET || process.env.CRON_SECRET || "";
  const url = new URL(request.url);
  const providedSecret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("secret") ||
    "";

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

async function activateSale(sale) {
  try {
    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: "scheduled",
      },
      data: {
        status: SALE_STATUS.APPLYING,
        executionSummary: {
          ...(sale.executionSummary || {}),
          status: "Applying",
          progress: 5,
        },
      },
    });

    const { admin } = await unauthenticated.admin(sale.shop);
    const executionSummary = await executeSaleRecord(admin, sale);

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: SALE_STATUS.APPLYING,
      },
      data: {
        status: executionSummary.ok ? SALE_STATUS.COMPLETED : SALE_STATUS.FAILED,
        executionSummary: {
          ...executionSummary,
          progress: 100,
          status: executionSummary.ok ? "Completed" : "Failed",
        },
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    return {
      ok: executionSummary.ok,
      saleId: sale.id,
      action: "activate",
      updatedVariants: executionSummary.updatedVariants || 0,
    };
  } catch (error) {
    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
      },
      data: {
        status: SALE_STATUS.FAILED,
        executionSummary: {
          ...(sale.executionSummary || {}),
          ok: false,
          error: error instanceof Error ? error.message : "Unable to activate sale.",
        },
        completedAt: new Date(),
      },
    });

    return {
      ok: false,
      saleId: sale.id,
      action: "activate",
      error: error instanceof Error ? error.message : "Unable to activate sale.",
    };
  }
}

async function endSale(sale) {
  try {
    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: sale.status,
      },
      data: {
        status: SALE_STATUS.CANCELING,
        executionSummary: {
          ...(sale.executionSummary || {}),
          status: "Canceling",
          progress: 5,
        },
      },
    });

    const { admin } = await unauthenticated.admin(sale.shop);
    const ended = await endSaleRecord(admin, sale);

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: SALE_STATUS.CANCELING,
      },
      data: {
        status: ended.ok ? SALE_STATUS.CANCELED : SALE_STATUS.FAILED,
        executionSummary: {
          ...(sale.executionSummary || {}),
          status: ended.ok ? "Canceled" : "Failed",
          progress: 100,
          ended,
        },
        completedAt: new Date(),
      },
    });

    return {
      ok: ended.ok,
      saleId: sale.id,
      action: "end",
      restoredVariants: ended.restoredVariants || 0,
    };
  } catch (error) {
    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
      },
      data: {
        status: SALE_STATUS.FAILED,
        executionSummary: {
          ...(sale.executionSummary || {}),
          endError: error instanceof Error ? error.message : "Unable to end sale.",
        },
        completedAt: new Date(),
      },
    });

    return {
      ok: false,
      saleId: sale.id,
      action: "end",
      error: error instanceof Error ? error.message : "Unable to end sale.",
    };
  }
}

async function trackSaleCondition(sale) {
  if (runningConditionSaleIds.has(sale.id)) {
    return {
      ok: true,
      saleId: sale.id,
      action: "track_condition",
      skipped: true,
      reason: "Condition tracking is already running for this sale.",
    };
  }

  runningConditionSaleIds.add(sale.id);

  try {
    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: sale.status,
      },
      data: {
        status: SALE_STATUS.CHECKING_CHANGES,
        executionSummary: {
          ...(sale.executionSummary || {}),
          status: "Checking changes",
          progress: 0,
        },
      },
    });

    const { admin } = await unauthenticated.admin(sale.shop);
    const tracked = await executeSaleConditionChangeRecord(admin, sale);
    const now = new Date().toISOString();

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: SALE_STATUS.CHECKING_CHANGES,
      },
      data: {
        status: SALE_STATUS.COMPLETED,
        configuration: {
          ...(sale.configuration || {}),
          track_condition_changes_last_run_at: now,
        },
        executionSummary: {
          ...(sale.executionSummary || {}),
          originalVariants: tracked.originalVariants,
          originalMarketPrices:
            tracked.originalMarketPrices ||
            sale.executionSummary?.originalMarketPrices ||
            [],
          progress: 100,
          trackConditionLastRunAt: now,
          trackConditionLastResult: {
            ok: tracked.ok,
            analyzedVariants: tracked.analyzedVariants,
            addedVariants: tracked.addedVariants,
            removedVariants: tracked.removedVariants,
            taggedProducts: tracked.taggedProducts,
            errors: tracked.errors,
          },
          logs: [
            ...((sale.executionSummary || {}).logs || []),
            ...(tracked.logs || []),
          ],
        },
      },
    });

    return {
      ok: tracked.ok,
      saleId: sale.id,
      action: "track_condition",
      addedVariants: tracked.addedVariants,
      removedVariants: tracked.removedVariants,
    };
  } catch (error) {
    const now = new Date().toISOString();

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
      },
      data: {
        status: SALE_STATUS.COMPLETED,
        configuration: {
          ...(sale.configuration || {}),
          track_condition_changes_last_run_at: now,
        },
        executionSummary: {
          ...(sale.executionSummary || {}),
          progress: 100,
          trackConditionLastRunAt: now,
          trackConditionLastResult: {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Unable to track sale condition changes.",
          },
        },
      },
    });

    return {
      ok: false,
      saleId: sale.id,
      action: "track_condition",
      error:
        error instanceof Error
          ? error.message
          : "Unable to track sale condition changes.",
    };
  } finally {
    runningConditionSaleIds.delete(sale.id);
  }
}
