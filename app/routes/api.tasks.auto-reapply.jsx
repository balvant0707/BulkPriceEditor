import { json } from "@remix-run/node";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getAutoReapplyLastRun,
  getDisabledAutoReapplyConfiguration,
} from "../lib/task-auto-reapply";
import { executeAutoReapplyTask } from "../services/task-reapply.server";

const AUTO_REAPPLY_BATCH_SIZE = 20;
const MAX_AUTO_REAPPLY_PRICE_CHANGES = 10000;
const AUTO_REAPPLY_INTERVAL_MS = 60 * 60 * 1000;
const runningTaskIds = new Set();

export async function loader({ request }) {
  return runAutoReapplyScheduler(request);
}

export async function action({ request }) {
  return runAutoReapplyScheduler(request);
}

async function runAutoReapplyScheduler(request) {
  const authResponse = authorizeCronRequest(request);
  if (authResponse) return authResponse;

  // Server cron should call this endpoint once per hour, for example:
  // https://your-app-domain.com/cron/auto-reapply?secret=YOUR_SECRET
  const candidateTasks = await db.task.findMany({
    where: {
      status: { in: ["Completed", "Complete"] },
      shop: { not: "" },
      OR: [{ autoReapply: true }, { autoReapplyChanges: true }],
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: AUTO_REAPPLY_BATCH_SIZE * 3,
  });
  const tasks = candidateTasks
    .filter((task) => shouldRunAutoReapplyTask(task))
    .slice(0, AUTO_REAPPLY_BATCH_SIZE);

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
  const configuredSecret = process.env.CRON_SECRET || "";
  const authHeader = request.headers.get("authorization") || "";

  if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function shouldRunAutoReapplyTask(task) {
  if (!task.shop) return false;
  if (runningTaskIds.has(task.id)) return false;

  const lastRun = getAutoReapplyLastRun(task);
  if (!lastRun) return true;

  const lastRunAt = new Date(lastRun).getTime();
  if (Number.isNaN(lastRunAt)) return true;

  return Date.now() - lastRunAt >= AUTO_REAPPLY_INTERVAL_MS;
}

async function reapplyTask(task) {
  if (!task.shop) {
    return {
      ok: false,
      taskId: task.id,
      shop: "",
      error: "Auto re-apply skipped because the task shop is missing.",
    };
  }

  if (runningTaskIds.has(task.id)) {
    return {
      ok: true,
      taskId: task.id,
      shop: task.shop,
      skipped: true,
      reason: "Auto re-apply is already running for this task.",
    };
  }

  runningTaskIds.add(task.id);

  try {
    const { admin } = await unauthenticated.admin(task.shop);
    const execution = await executeAutoReapplyTask(admin, task);
    const totalPriceChanges = Number(execution.totalPriceChanges || 0);
    const canContinue = totalPriceChanges <= MAX_AUTO_REAPPLY_PRICE_CHANGES;
    const now = new Date().toISOString();

    await db.task.updateMany({
      where: { id: task.id, shop: task.shop },
      data: {
        autoReapply: canContinue,
        autoReapplyChanges: canContinue,
        configuration: canContinue
          ? {
              ...(task.configuration || {}),
              auto_reapply_changes: true,
              auto_reapply_changes_enabled: true,
              auto_reapply_last_run_at: now,
            }
          : getDisabledAutoReapplyConfiguration(task.configuration),
        executionSummary: {
          ...(task.executionSummary || {}),
          autoReapplyLastRunAt: now,
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
    const now = new Date().toISOString();

    await db.task.updateMany({
      where: { id: task.id, shop: task.shop },
      data: {
        configuration: {
          ...(task.configuration || {}),
          auto_reapply_last_run_at: now,
        },
        executionSummary: {
          ...(task.executionSummary || {}),
          autoReapplyLastRunAt: now,
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
  } finally {
    runningTaskIds.delete(task.id);
  }
}
