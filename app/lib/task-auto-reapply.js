export const AUTO_REAPPLY_TEXT =
  "Automatically re-apply price changes (up to 10,000 changes)";
export const AUTO_REAPPLY_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_REAPPLY_MINUTE = 20;
const DEFAULT_REAPPLY_INTERVAL_UNIT = "hours";
const DEFAULT_REAPPLY_INTERVAL_VALUE = 1;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const AUTO_REAPPLY_INTERVAL_MAX_VALUES = {
  minutes: 43200,
  hours: 720,
  days: 30,
};

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

  return new Date(getNextAutoReapplyRunMs(task, baseMs)).toISOString();
}

export function getConfiguredReapplyMinute(task) {
  const configuration = getObjectValue(task?.configuration);
  const minute = Number(
    configuration.reapplyMinute ??
      configuration.reapply_minute ??
      DEFAULT_REAPPLY_MINUTE,
  );

  if (!Number.isFinite(minute)) return DEFAULT_REAPPLY_MINUTE;
  return Math.max(0, Math.min(59, Math.trunc(minute)));
}

export function getNextHourlyRunMs(baseMs, minute) {
  const base = new Date(baseMs);
  const next = new Date(baseMs + AUTO_REAPPLY_INTERVAL_MS);
  next.setUTCMinutes(minute, 0, 0);

  if (next.getTime() <= base.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }

  return next.getTime();
}

export function getAutoReapplyIntervalConfig(record) {
  const configuration = getObjectValue(record?.configuration);
  const form = getObjectValue(configuration.form);
  const rawUnit =
    record?.autoReapplyIntervalUnit ||
    form.autoReapplyIntervalUnit ||
    form.auto_reapply_interval_unit ||
    configuration.autoReapplyIntervalUnit ||
    configuration.auto_reapply_interval_unit ||
    DEFAULT_REAPPLY_INTERVAL_UNIT;
  const unit = ["minutes", "hours", "days"].includes(rawUnit)
    ? rawUnit
    : DEFAULT_REAPPLY_INTERVAL_UNIT;
  const rawValue =
    record?.autoReapplyIntervalValue ||
    form.autoReapplyIntervalValue ||
    form.auto_reapply_interval_value ||
    configuration.autoReapplyIntervalValue ||
    configuration.auto_reapply_interval_value ||
    DEFAULT_REAPPLY_INTERVAL_VALUE;
  const value = Number(rawValue);
  const max =
    AUTO_REAPPLY_INTERVAL_MAX_VALUES[unit] ||
    AUTO_REAPPLY_INTERVAL_MAX_VALUES[DEFAULT_REAPPLY_INTERVAL_UNIT];

  return {
    unit,
    value: Number.isFinite(value)
      ? Math.max(1, Math.min(max, Math.trunc(value)))
      : DEFAULT_REAPPLY_INTERVAL_VALUE,
  };
}

export function getAutoReapplyIntervalMs(record) {
  const { unit, value } = getAutoReapplyIntervalConfig(record);
  if (unit === "minutes") return value * MINUTE_MS;
  return value * (unit === "days" ? DAY_MS : HOUR_MS);
}

export function getNextAutoReapplyRunMs(record, baseMs) {
  const intervalMs = getAutoReapplyIntervalMs(record);
  return baseMs + intervalMs;
}

export function formatAutoReapplyInterval(record) {
  const { unit, value } = getAutoReapplyIntervalConfig(record);
  const label =
    unit === "minutes"
      ? value === 1
        ? "minute"
        : "minutes"
      : unit === "days"
        ? value === 1
          ? "day"
          : "days"
        : value === 1
          ? "hour"
          : "hours";

  return `Every ${value} ${label}`;
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
