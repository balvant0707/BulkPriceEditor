import db from "../db.server";
import {
  DEFAULT_REPORT_SETTINGS,
  getReportPath,
  normalizeShop,
  REPORT_TYPES,
  SETTINGS_KEY,
} from "./product-reports";

const PRODUCT_VARIANTS_QUERY = `#graphql
  query ProductReportVariants($first: Int!, $after: String) {
    shop {
      currencyCode
    }
    productVariants(first: $first, after: $after) {
      nodes {
        id
        title
        sku
        price
        compareAtPrice
        inventoryItem {
          unitCost {
            amount
          }
        }
        product {
          id
          title
          handle
          status
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const VARIANT_PAGE_SIZE = 250;
const MAX_REPORT_ROWS = 10000;

export async function loadSettings(shop) {
  if (!shop) return {};

  const row = await db.priceEditorSetting.findUnique({
    where: {
      shop_key: {
        shop,
        key: SETTINGS_KEY,
      },
    },
  });

  const data = safeObject(row?.value);

  return {
    includeDraftProducts:
      data.includeDraftProducts ??
      data.include_draft_products ??
      DEFAULT_REPORT_SETTINGS.includeDraftProducts,
    reapplyMinute:
      data.reapplyMinute ??
      data.reapply_minute ??
      DEFAULT_REPORT_SETTINGS.reapplyMinute,
  };
}

export async function saveSettings(shop, settings) {
  if (!shop) return false;

  const payload = {
    includeDraftProducts: settings.includeDraftProducts,
    include_draft_products: settings.includeDraftProducts,
    reapplyMinute: settings.reapplyMinute,
    reapply_minute: settings.reapplyMinute,
  };

  await db.priceEditorSetting.upsert({
    where: {
      shop_key: {
        shop,
        key: SETTINGS_KEY,
      },
    },
    update: {
      value: payload,
    },
    create: {
      shop,
      key: SETTINGS_KEY,
      value: payload,
    },
  });

  return true;
}

export async function getLatestReportUrl(shop, type) {
  if (!shop) return "";

  const report = await db.productReport.findFirst({
    where: {
      shop,
      type,
      status: "Completed",
    },
    orderBy: [{ generatedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });

  return report?.id ? getReportPath(type, report.id) : "";
}

export async function generateProductReport(admin, shop, type) {
  const settings = await loadSettings(shop);
  const includeDraftProducts =
    String(settings.includeDraftProducts ?? "true") !== "false";
  const report = await db.productReport.create({
    data: {
      shop,
      type,
      status: "Generating",
      generatedAt: new Date(),
    },
  });

  try {
    const { rows, currencyCode } = await collectReportRows(admin, {
      shop,
      type,
      includeDraftProducts,
      reportId: report.id,
    });

    if (rows.length) {
      await db.productReportRow.createMany({
        data: rows.map((row) => ({
          ...row,
          currencyCode: row.currencyCode || currencyCode,
        })),
      });
    }

    await db.productReport.update({
      where: { id: report.id },
      data: {
        status: "Completed",
        totalRows: rows.length,
        generatedAt: new Date(),
      },
    });

    return {
      id: report.id,
      totalRows: rows.length,
      url: getReportPath(type, report.id),
    };
  } catch (error) {
    await db.productReport.update({
      where: { id: report.id },
      data: {
        status: "Failed",
      },
    });

    throw error;
  }
}

export async function loadReportPage({
  shop,
  type,
  reportId,
  query = "",
  filter = "all",
  page = 1,
  pageSize = 25,
}) {
  const report = await db.productReport.findFirst({
    where: {
      id: reportId,
      shop,
      type,
    },
  });

  if (!report) {
    throw new Response("Report not found", { status: 404 });
  }

  const where = buildRowsWhere({ reportId, shop, type, query, filter });
  const totalRows = await db.productReportRow.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const rows = await db.productReportRow.findMany({
    where,
    orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }, { id: "asc" }],
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
  });

  return {
    report: serializeReport(report),
    rows: rows.map(serializeReportRow),
    totalRows,
    totalPages,
    currentPage,
  };
}

export async function loadReportExportRows({ shop, type, reportId, query, filter }) {
  const report = await db.productReport.findFirst({
    where: {
      id: reportId,
      shop,
      type,
    },
    select: { id: true },
  });

  if (!report) {
    throw new Response("Report not found", { status: 404 });
  }

  const rows = await db.productReportRow.findMany({
    where: buildRowsWhere({ reportId, shop, type, query, filter }),
    orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }, { id: "asc" }],
  });

  return rows.map(serializeReportRow);
}

export function buildCsvResponse({ filename, type, rows }) {
  const headers =
    type === REPORT_TYPES.margin
      ? ["Product", "Variant", "SKU", "Price", "Cost", "Margin"]
      : ["Product", "Variant", "SKU", "Price", "Compare at price", "Discount"];
  const csvRows = [
    headers,
    ...rows.map((row) =>
      type === REPORT_TYPES.margin
        ? [
            row.productTitle,
            row.variantTitle,
            row.sku,
            row.price,
            row.cost,
            row.marginPercent == null ? "" : `${row.marginPercent}%`,
          ]
        : [
            row.productTitle,
            row.variantTitle,
            row.sku,
            row.price,
            row.compareAtPrice,
            row.discountPercent == null ? "" : `${row.discountPercent}% off`,
          ],
    ),
  ];
  const csv = csvRows.map((row) => row.map(escapeCsvValue).join(",")).join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function collectReportRows(admin, { shop, type, includeDraftProducts, reportId }) {
  const rows = [];
  let after = null;
  let currencyCode = "";

  do {
    const data = await shopifyGraphql(admin, PRODUCT_VARIANTS_QUERY, {
      first: VARIANT_PAGE_SIZE,
      after,
    });
    currencyCode = data.shop?.currencyCode || currencyCode;
    const connection = data.productVariants;

    for (const variant of connection?.nodes || []) {
      if (rows.length >= MAX_REPORT_ROWS) break;
      if (!includeDraftProducts && variant.product?.status !== "ACTIVE") continue;

      const row = buildReportRow({
        reportId,
        shop,
        type,
        variant,
        currencyCode,
      });

      if (row) rows.push(row);
    }

    after =
      rows.length < MAX_REPORT_ROWS && connection?.pageInfo?.hasNextPage
        ? connection.pageInfo.endCursor
        : null;
  } while (after);

  return { rows, currencyCode };
}

function buildReportRow({ reportId, shop, type, variant, currencyCode }) {
  const price = toNumber(variant.price);
  const cost = toNumber(variant.inventoryItem?.unitCost?.amount);
  const compareAtPrice = toNumber(variant.compareAtPrice);
  const common = {
    reportId,
    shop,
    type,
    productId: variant.product?.id || "",
    productTitle: variant.product?.title || "",
    productHandle: variant.product?.handle || null,
    variantId: variant.id || "",
    variantTitle: variant.title || "",
    sku: variant.sku || null,
    price: toDecimalString(price),
    cost: toDecimalString(cost),
    compareAtPrice: toDecimalString(compareAtPrice),
    currencyCode,
  };

  if (!common.productId || !common.variantId) return null;

  if (type === REPORT_TYPES.margin) {
    return {
      ...common,
      marginPercent:
        price != null && price !== 0 && cost != null
          ? toDecimalString(((price - cost) / price) * 100)
          : null,
      discountPercent: null,
    };
  }

  if (type === REPORT_TYPES.discount) {
    if (compareAtPrice == null || compareAtPrice <= 0 || price == null) return null;

    return {
      ...common,
      marginPercent: null,
      discountPercent:
        compareAtPrice > price
          ? toDecimalString(((compareAtPrice - price) / compareAtPrice) * 100)
          : "0.00",
    };
  }

  return null;
}

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload.errors) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

function buildRowsWhere({ reportId, shop, type, query, filter }) {
  const trimmedQuery = String(query || "").trim();
  const where = {
    reportId,
    shop,
    type,
  };

  if (trimmedQuery) {
    where.OR = [
      { productTitle: { contains: trimmedQuery } },
      { variantTitle: { contains: trimmedQuery } },
      { sku: { contains: trimmedQuery } },
    ];
  }

  if (type === REPORT_TYPES.margin) {
    if (filter === "with_margin") {
      where.marginPercent = { not: null };
    } else if (filter === "without_margin") {
      where.marginPercent = null;
    }
  }

  return where;
}

function serializeReport(report) {
  return {
    ...report,
    generatedAt: report.generatedAt?.toISOString() || "",
    createdAt: report.createdAt?.toISOString() || "",
    updatedAt: report.updatedAt?.toISOString() || "",
  };
}

function serializeReportRow(row) {
  return {
    id: row.id,
    reportId: row.reportId,
    productId: row.productId,
    productTitle: row.productTitle,
    productHandle: row.productHandle || "",
    variantId: row.variantId,
    variantTitle: row.variantTitle || "",
    sku: row.sku || "",
    price: decimalToString(row.price),
    cost: decimalToString(row.cost),
    compareAtPrice: decimalToString(row.compareAtPrice),
    marginPercent: decimalToNumber(row.marginPercent),
    discountPercent: decimalToNumber(row.discountPercent),
    currencyCode: row.currencyCode || "",
  };
}

function safeObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toDecimalString(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

function decimalToString(value) {
  if (value == null) return "";
  return Number(value).toFixed(2);
}

function decimalToNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
