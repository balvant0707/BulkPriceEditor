import { json } from "@remix-run/node";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { executeAutoReapplyTask } from "../services/task-reapply.server";

const AUTO_REAPPLY_BATCH_SIZE = 20;
const MAX_AUTO_REAPPLY_PRICE_CHANGES = 10000;

export async function loader({ request }) {
  return runAutoReapplyScheduler(request);
}

export async function action({ request }) {
  return runAutoReapplyScheduler(request);
}

async function runAutoReapplyScheduler(request) {
  const authResponse = authorizeCronRequest(request);
  if (authResponse) return authResponse;

  const tasks = await db.task.findMany({
    where: {
      status: "Completed",
      autoReapply: true,
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: AUTO_REAPPLY_BATCH_SIZE,
  });

  const results = [];

  for (const task of tasks) {
    results.push(await reapplyTask(task));
  }

  return json({
    ok: results.every((result) => result.ok),
    processed: results.length,
    results,
  });
}

function authorizeCronRequest(request) {
  const configuredSecret =
    process.env.AUTO_REAPPLY_CRON_SECRET || process.env.CRON_SECRET || "";

  if (!configuredSecret && process.env.NODE_ENV !== "production") {
    return null;
  }

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

async function reapplyTask(task) {
  try {
    const { admin } = await unauthenticated.admin(task.shop);
    const execution = await executeAutoReapplyTask(admin, task);
    const totalPriceChanges = Number(execution.totalPriceChanges || 0);
    const canContinue = totalPriceChanges <= MAX_AUTO_REAPPLY_PRICE_CHANGES;

    await db.task.update({
      where: { id: task.id },
      data: {
        autoReapply: canContinue,
        autoReapplyChanges: canContinue,
        executionSummary: {
          ...(task.executionSummary || {}),
          autoReapplyLastRunAt: new Date().toISOString(),
          autoReapplyLastResult: {
            ok: execution.ok,
            totalPriceChanges,
            updatedVariants: execution.updatedVariants || 0,
            skippedVariants: execution.skippedVariants || 0,
            errors: execution.errors || [],
          },
        },
      },
    });

    return {
      ok: execution.ok && canContinue,
      taskId: task.id,
      shop: task.shop,
      totalPriceChanges,
      updatedVariants: execution.updatedVariants || 0,
      skippedVariants: execution.skippedVariants || 0,
      disabled: !canContinue,
    };
  } catch (error) {
    await db.task.update({
      where: { id: task.id },
      data: {
        executionSummary: {
          ...(task.executionSummary || {}),
          autoReapplyLastRunAt: new Date().toISOString(),
          autoReapplyLastResult: {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Unable to re-apply task.",
          },
        },
      },
    });

    return {
      ok: false,
      taskId: task.id,
      shop: task.shop,
      error:
        error instanceof Error ? error.message : "Unable to re-apply task.",
    };
  }
}
