import { inngest } from "../client";
import { runAutoReapplyTasks } from "../../cron/auto-reapply.server";

const AUTO_REAPPLY_BATCH_SIZE = 20;

export const autoReapply = inngest.createFunction(
  {
    id: "auto-reapply",
    name: "Auto Reapply Tasks",
    triggers: [{ cron: "* * * * *" }],
  },
  async ({ logger }) => {
    const log = logger || console;
    const startedAt = Date.now();

    log.info("[inngest:auto-reapply] Function started");

    try {
      const result = await runAutoReapplyTasks({
        take: AUTO_REAPPLY_BATCH_SIZE,
      });
      const results = result.results || [];
      const errors = results.filter((item) => item.ok === false);

      log.info("[inngest:auto-reapply] Task count", {
        checked: result.checked,
        due: result.due,
        processed: results.length,
      });

      if (errors.length) {
        log.error("[inngest:auto-reapply] Errors", { errors });
      }

      log.info("[inngest:auto-reapply] Completed", {
        durationMs: Date.now() - startedAt,
        errors: errors.length,
      });

      return {
        ok: errors.length === 0,
        checked: result.checked,
        due: result.due,
        processed: results.length,
        durationMs: Date.now() - startedAt,
        results,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Auto reapply function failed.";

      log.error("[inngest:auto-reapply] Failed", {
        error: message,
        durationMs: Date.now() - startedAt,
      });

      return {
        ok: false,
        error: message,
        durationMs: Date.now() - startedAt,
      };
    }
  },
);
