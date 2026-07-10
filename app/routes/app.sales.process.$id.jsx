import { json } from "@remix-run/node";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { executeSaleRecord } from "../lib/sales.server";
import {
  createSaleExecutionSummary,
  normalizeSaleStatus,
  SALE_STATUS,
} from "../lib/sale-status";

export const loader = async ({ request, params }) => processSale(request, params);
export const action = async ({ request, params }) => processSale(request, params);

async function processSale(request, params) {
  const { admin, session } = await authenticate.admin(request);
  const saleId = Number(params.id);

  if (!Number.isInteger(saleId) || saleId <= 0) {
    return json({ ok: false, error: "Sale not found." }, { status: 404 });
  }

  const sale = await db.sale.findFirst({
    where: { id: saleId, shop: session.shop },
  });

  if (!sale) {
    return json({ ok: false, error: "Sale not found." }, { status: 404 });
  }

  const status = normalizeSaleStatus(sale.status);
  if (status === SALE_STATUS.COMPLETED || status === SALE_STATUS.FAILED) {
    return json({ ok: true, skipped: true, status });
  }

  if (status !== SALE_STATUS.PENDING) {
    return json({
      ok: true,
      skipped: true,
      status,
      message: "Sale is already processing or is not eligible to process.",
    });
  }

  const claimed = await db.sale.updateMany({
    where: {
      id: sale.id,
      shop: session.shop,
      status: sale.status,
    },
    data: {
      status: SALE_STATUS.APPLYING,
      executionSummary: {
        ...(sale.executionSummary || {}),
        ...createSaleExecutionSummary(SALE_STATUS.APPLYING, {
          progress: 0,
          processingStartedAt: new Date().toISOString(),
        }),
      },
      startedAt: new Date(),
    },
  });

  if (!claimed.count) {
    return json({
      ok: true,
      skipped: true,
      message: "Sale was already claimed by another request.",
    });
  }

  try {
    const execution = await executeSaleRecord(admin, {
      ...sale,
      status: SALE_STATUS.APPLYING,
    });
    const completedStatus = execution.ok ? SALE_STATUS.COMPLETED : SALE_STATUS.FAILED;

    await db.sale.updateMany({
      where: {
        id: sale.id,
        shop: session.shop,
        status: SALE_STATUS.APPLYING,
      },
      data: {
        status: completedStatus,
        executionSummary: {
          ...(sale.executionSummary || {}),
          ...execution,
          ok: execution.ok,
          status: execution.ok ? "Completed" : "Failed",
          progress: 100,
          processedItems:
            execution.updatedVariants ||
            execution.variantUpdates ||
            execution.analyzedVariants ||
            0,
          totalItems: execution.analyzedVariants || 0,
          errors: execution.errors || [],
          processingCompletedAt: new Date().toISOString(),
        },
        completedAt: new Date(),
      },
    });

    return json({
      ok: execution.ok,
      status: completedStatus,
      updatedVariants: execution.updatedVariants || 0,
      errors: execution.errors || [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process sale.";

    await db.sale.updateMany({
      where: { id: sale.id, shop: session.shop },
      data: {
        status: SALE_STATUS.FAILED,
        executionSummary: {
          ...(sale.executionSummary || {}),
          ok: false,
          status: "Failed",
          progress: 100,
          errors: [...(sale.executionSummary?.errors || []), message],
          error: message,
          processingCompletedAt: new Date().toISOString(),
        },
        completedAt: new Date(),
      },
    });

    return json({ ok: false, error: message }, { status: 500 });
  }
}
