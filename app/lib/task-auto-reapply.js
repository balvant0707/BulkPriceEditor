export const AUTO_REAPPLY_TEXT =
  "Automatically re-apply price changes (every hour, up to 10,000 changes)";
export const AUTO_REAPPLY_INTERVAL_MS = 60 * 60 * 1000;

export function isEnabledValue(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;

  return ["1", "true", "yes", "on", "enabled"].includes(
    String(value).toLowerCase(),
  );
}

export function isAutoReapplyEnabled(task) {
  const configuration = task?.configuration || {};

  return (
    Boolean(task?.autoReapply || task?.autoReapplyChanges) ||
    isEnabledValue(configuration.auto_reapply_changes) ||
    isEnabledValue(configuration.auto_reapply_changes_enabled)
  );
}

export function getAutoReapplyLastRun(task) {
  return (
    task?.autoReapplyLastRunAt ||
    task?.executionSummary?.autoReapplyLastRunAt ||
    task?.executionSummary?.lastAutoReapplyRunAt ||
    task?.configuration?.auto_reapply_last_run_at ||
    ""
  );
}

export function getAutoReapplyBaseRunTime(task) {
  return (
    getAutoReapplyLastRun(task) ||
    task?.completedAt ||
    task?.appliedAt ||
    task?.updatedAt ||
    task?.createdAt ||
    ""
  );
}

export function getAutoReapplyNextRunAt(task) {
  const baseRunTime = getAutoReapplyBaseRunTime(task);
  if (!baseRunTime) return "";

  const baseDate = new Date(baseRunTime);
  const baseMs = baseDate.getTime();
  if (Number.isNaN(baseMs)) return "";

  return new Date(baseMs + AUTO_REAPPLY_INTERVAL_MS).toISOString();
}

export function getObjectValue(value) {
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

export function getDisabledAutoReapplyConfiguration(configuration) {
  const nextConfiguration = getObjectValue(configuration);

  nextConfiguration.auto_reapply_changes = false;
  nextConfiguration.auto_reapply_changes_enabled = false;
  delete nextConfiguration.auto_reapply_last_run_at;

  return nextConfiguration;
}
