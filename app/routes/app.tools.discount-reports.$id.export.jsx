import {
  buildExcelResponse,
  loadReportExportRows,
} from "../lib/product-reports.server";
import { normalizeShop, REPORT_TYPES } from "../lib/product-reports";
import { authenticate } from "../shopify.server";

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

  return buildExcelResponse({
    filename: `products-discount-report-${reportId}.xls`,
    type: REPORT_TYPES.discount,
    rows,
  });
}
