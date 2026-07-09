import { json } from "@remix-run/node";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { endSaleRecord, executeSaleRecord } from "../lib/sales.server";

const SALES_CRON_BATCH_SIZE = 20;

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
  const [scheduledSales, endingSales] = await Promise.all([
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
        status: "active",
        shop: { not: "" },
        endAt: { lte: now },
      },
      orderBy: [{ endAt: "asc" }, { id: "asc" }],
      take: SALES_CRON_BATCH_SIZE,
    }),
  ]);
  const results = [];

  for (const sale of scheduledSales) {
    results.push(await activateSale(sale));
  }

  for (const sale of endingSales) {
    results.push(await endSale(sale));
  }

  return json({
    ok: results.every((result) => result.ok),
    processed: results.length,
    results,
  });
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
    const { admin } = await unauthenticated.admin(sale.shop);
    const executionSummary = await executeSaleRecord(admin, sale);

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: "scheduled",
      },
      data: {
        status: executionSummary.ok ? "active" : "failed",
        executionSummary,
        startedAt: new Date(),
        completedAt: executionSummary.ok ? null : new Date(),
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
        status: "failed",
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
    const { admin } = await unauthenticated.admin(sale.shop);
    const ended = await endSaleRecord(admin, sale);

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: sale.shop,
        status: "active",
      },
      data: {
        status: ended.ok ? "completed" : "failed",
        executionSummary: {
          ...(sale.executionSummary || {}),
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
        status: "failed",
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
