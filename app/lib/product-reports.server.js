import db from "../db.server";
import {
  DEFAULT_REPORT_SETTINGS,
  getReportPath,
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
  dateFrom = "",
  dateTo = "",
  timezoneOffsetMinutes = "",
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

  const where = buildRowsWhere({
    reportId,
    shop,
    type,
    query,
    filter,
    dateFrom,
    dateTo,
    timezoneOffsetMinutes,
  });
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

export async function loadReportExportRows({
  shop,
  type,
  reportId,
  query,
  filter,
  dateFrom = "",
  dateTo = "",
  timezoneOffsetMinutes = "",
}) {
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
    where: buildRowsWhere({
      reportId,
      shop,
      type,
      query,
      filter,
      dateFrom,
      dateTo,
      timezoneOffsetMinutes,
    }),
    orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }, { id: "asc" }],
  });

  if (rows.length || (!query && !dateFrom && !dateTo)) {
    return rows.map(serializeReportRow);
  }

  const fallbackRows = await db.productReportRow.findMany({
    where: { reportId, shop, type },
    orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }, { id: "asc" }],
  });

  return fallbackRows.map(serializeReportRow);
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

export function buildExcelResponse({ filename, type, rows }) {
  const headers =
    type === REPORT_TYPES.margin
      ? ["Product", "Variant", "SKU", "Price", "Cost", "Margin"]
      : ["Product", "Variant", "SKU", "Price", "Compare at price", "Discount"];
  const title =
    type === REPORT_TYPES.margin ? "Products Margin Report" : "Products Discount Report";
  const reportRows = rows.map((row) =>
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
  );
  const workbook = buildXlsxWorkbook(title, [headers, ...reportRows]);
  const safeFilename = String(filename || "product-report.xlsx")
    .replace(/\.(xls|csv)$/i, ".xlsx")
    .replace(/\.xlsx$/i, ".xlsx");

  return new Response(workbook, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
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

function buildRowsWhere({
  reportId,
  shop,
  type,
  query,
  filter,
  dateFrom,
  dateTo,
  timezoneOffsetMinutes,
}) {
  const trimmedQuery = String(query || "").trim();
  const where = {
    reportId,
    shop,
    type,
  };
  const createdAt = buildDateRangeFilter(dateFrom, dateTo, timezoneOffsetMinutes);

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

  if (createdAt) {
    where.createdAt = createdAt;
  }

  return where;
}

function buildDateRangeFilter(dateFrom, dateTo, timezoneOffsetMinutes) {
  const from = parseDateOnly(dateFrom, false, timezoneOffsetMinutes);
  const to = parseDateOnly(dateTo, true, timezoneOffsetMinutes);
  const range = {};

  if (from && to && from > to) {
    range.gte = to;
    range.lte = from;
  } else {
    if (from) range.gte = from;
    if (to) range.lte = to;
  }

  return Object.keys(range).length ? range : null;
}

function parseDateOnly(value, endOfDay = false, timezoneOffsetMinutes = "") {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match.map(Number);
  const offset = Number(timezoneOffsetMinutes);
  const utcMs = Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  const date = Number.isFinite(offset)
    ? new Date(utcMs + offset * 60 * 1000)
    : new Date(utcMs);

  return Number.isNaN(date.getTime()) ? null : date;
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

function buildXlsxWorkbook(title, rows) {
  const sheetRows = [[title], ...rows];
  const files = [
    {
      path: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      path: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      path: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Report" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      path: "xl/worksheets/sheet1.xml",
      content: buildWorksheetXml(sheetRows),
    },
  ];

  return buildZip(files);
}

function buildWorksheetXml(rows) {
  const xmlRows = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((value, cellIndex) => {
          const cellRef = `${columnName(cellIndex + 1)}${rowNumber}`;
          return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");

      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${xmlRows}</sheetData>
</worksheet>`;
}

function columnName(number) {
  let name = "";
  let value = number;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeUtf8(file.path);
    const data = encodeUtf8(file.content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(10, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localHeader.set(name, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(12, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(name, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, offset, true);

  return concatUint8Arrays([...localParts, ...centralParts, endRecord]);
}

function encodeUtf8(value) {
  return new TextEncoder().encode(String(value));
}

function concatUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function crc32(data) {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_, index) => {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    return crc >>> 0;
  }),
);

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
