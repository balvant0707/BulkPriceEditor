import { json } from "@remix-run/node";
import {
  buildCsvResponse,
  buildExcelResponse,
  loadReportExportRows,
  loadReportPage,
} from "../lib/product-reports.server";
import { normalizeShop, REPORT_TYPES } from "../lib/product-reports";
import { authenticate } from "../shopify.server";
import ProductReportPage from "../components/ProductReportPage";

const PAGE_SIZE = 25;

export async function loader({ request, params }) {
  const { session } = await authenticate.admin(request);
  const shop = normalizeShop(session.shop);
  const url = new URL(request.url);
  const reportId = Number(params.id);
  const query = url.searchParams.get("q") || "";
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";
  const timezoneOffsetMinutes = url.searchParams.get("timezoneOffsetMinutes") || "";

  if (!Number.isInteger(reportId) || reportId <= 0) {
    throw new Response("Report not found", { status: 404 });
  }

  const exportType = url.searchParams.get("export");

  if (exportType === "csv" || exportType === "excel" || exportType === "xls") {
    const rows = await loadReportExportRows({
      shop,
      type: REPORT_TYPES.discount,
      reportId,
      query,
      filter: "all",
      dateFrom,
      dateTo,
      timezoneOffsetMinutes,
    });

    if (exportType === "excel" || exportType === "xls") {
      return buildExcelResponse({
        filename: `products-discount-report-${reportId}.xlsx`,
        type: REPORT_TYPES.discount,
        rows,
      });
    }

    return buildCsvResponse({
      filename: `products-discount-report-${reportId}.csv`,
      type: REPORT_TYPES.discount,
      rows,
    });
  }

  const page = Number(url.searchParams.get("page") || 1);
  const data = await loadReportPage({
    shop,
    type: REPORT_TYPES.discount,
    reportId,
    query,
    filter: "all",
    dateFrom,
    dateTo,
    timezoneOffsetMinutes,
    page,
    pageSize: PAGE_SIZE,
  });

  return json({
    ...data,
    query,
    filter: "all",
    dateFrom,
    dateTo,
    shopifyStoreHandle: getShopifyStoreHandle(shop),
  });
}

export default function DiscountReportPage() {
  return <ProductReportPage type={REPORT_TYPES.discount} />;
}

function getShopifyStoreHandle(shop) {
  return String(shop || "").replace(".myshopify.com", "");
}
