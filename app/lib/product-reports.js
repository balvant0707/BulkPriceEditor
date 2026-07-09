export const REPORT_TYPES = {
  margin: "margin",
  discount: "discount",
};

export const DEFAULT_REPORT_SETTINGS = {
  includeDraftProducts: "true",
  reapplyMinute: "20",
};

export const SETTINGS_KEY = "price_editor";

export function normalizeShop(shop) {
  return String(shop || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim()
    .toLowerCase();
}

export function getReportPath(type, id) {
  if (!id) return "";
  if (type === REPORT_TYPES.margin) return `/app/tools/margin-reports/${id}`;
  if (type === REPORT_TYPES.discount) return `/app/tools/discount-reports/${id}`;
  return "";
}
