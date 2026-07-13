export const SALE_STATUS = {
  PENDING: "pending",
  APPLYING: "applying",
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  CANCELING: "canceling",
  CANCELED: "canceled",
  FAILED: "failed",
  CHECKING_CHANGES: "checking_changes",
};

const LEGACY_STATUS_MAP = {
  draft: SALE_STATUS.PENDING,
  activating: SALE_STATUS.APPLYING,
  active: SALE_STATUS.COMPLETED,
  ending: SALE_STATUS.CANCELING,
  ended: SALE_STATUS.CANCELED,
  complete: SALE_STATUS.COMPLETED,
  finished: SALE_STATUS.COMPLETED,
  cancelled: SALE_STATUS.CANCELED,
};

const STATUS_LABELS = {
  [SALE_STATUS.PENDING]: "Pending",
  [SALE_STATUS.APPLYING]: "Applying",
  [SALE_STATUS.SCHEDULED]: "Scheduled",
  [SALE_STATUS.COMPLETED]: "Active",
  [SALE_STATUS.CANCELING]: "Canceling",
  [SALE_STATUS.CANCELED]: "Canceled",
  [SALE_STATUS.FAILED]: "Failed",
  [SALE_STATUS.CHECKING_CHANGES]: "Checking changes",
};

const STATUS_TONES = {
  [SALE_STATUS.PENDING]: "attention",
  [SALE_STATUS.APPLYING]: "attention",
  [SALE_STATUS.SCHEDULED]: "info",
  [SALE_STATUS.COMPLETED]: "success",
  [SALE_STATUS.CANCELING]: "attention",
  [SALE_STATUS.CANCELED]: "subdued",
  [SALE_STATUS.FAILED]: "critical",
  [SALE_STATUS.CHECKING_CHANGES]: "attention",
};

const PROGRESS_STATUSES = new Set([
  SALE_STATUS.PENDING,
  SALE_STATUS.APPLYING,
  SALE_STATUS.CANCELING,
  SALE_STATUS.CHECKING_CHANGES,
]);

export function normalizeSaleStatus(status) {
  const key = String(status || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return LEGACY_STATUS_MAP[key] || key || SALE_STATUS.PENDING;
}

export function getSaleStatusLabel(status) {
  return STATUS_LABELS[normalizeSaleStatus(status)] || humanizeStatus(status || "pending");
}

export function getSaleStatusTone(status) {
  return STATUS_TONES[normalizeSaleStatus(status)] || "subdued";
}

export function shouldShowSaleProgress(status) {
  return PROGRESS_STATUSES.has(normalizeSaleStatus(status));
}

export function clampSaleProgress(value) {
  const progress = Number(value);
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function getSaleProgressValue(sale) {
  const summary = sale?.executionSummary || {};
  const progress = [summary.progress, summary.percent, summary.percentage]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));

  if (Number.isFinite(progress)) return clampSaleProgress(progress);
  if (normalizeSaleStatus(sale?.status) === SALE_STATUS.COMPLETED) return 100;
  if (normalizeSaleStatus(sale?.status) === SALE_STATUS.CANCELED) return 100;
  return 0;
}

export function getSaleStatusDisplay(sale) {
  const status = normalizeSaleStatus(sale?.status);
  return {
    status,
    label: getSaleStatusLabel(status),
    tone: getSaleStatusTone(status),
    progress: getSaleProgressValue(sale),
    showProgress: shouldShowSaleProgress(status),
  };
}

export function createSaleExecutionSummary(status, extra = {}) {
  const normalizedStatus = normalizeSaleStatus(status);
  return {
    status: getSaleStatusLabel(normalizedStatus),
    progress: normalizedStatus === SALE_STATUS.COMPLETED ? 100 : 0,
    processedItems: 0,
    totalItems: 0,
    errors: [],
    logs: [],
    ...extra,
  };
}

export function canProcessSale(sale) {
  const status = normalizeSaleStatus(sale?.status);
  return (
    status === SALE_STATUS.PENDING ||
    (status === SALE_STATUS.SCHEDULED && isSaleStartDue(sale))
  );
}

export function isSaleStartDue(sale, now = new Date()) {
  if (!sale?.startAt) return true;

  const startAt = new Date(sale.startAt);
  if (Number.isNaN(startAt.getTime())) return true;

  return startAt <= now;
}

export function canRollbackSale(sale) {
  const summary = sale?.executionSummary || {};
  return (
    normalizeSaleStatus(sale?.status) === SALE_STATUS.COMPLETED &&
    (Array.isArray(summary.originalVariants) ||
      Array.isArray(summary.originalMarketPrices))
  );
}

export function canDeleteSale(sale) {
  return [SALE_STATUS.CANCELED, SALE_STATUS.FAILED].includes(
    normalizeSaleStatus(sale?.status),
  );
}

export function isSaleBusy(sale) {
  return [
    SALE_STATUS.PENDING,
    SALE_STATUS.APPLYING,
    SALE_STATUS.CANCELING,
    SALE_STATUS.CHECKING_CHANGES,
  ].includes(normalizeSaleStatus(sale?.status));
}

function humanizeStatus(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
