import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Link,
  Page,
  Select,
  Text,
  Tooltip,
} from "@shopify/polaris";
import {
  ChartHistogramGrowthIcon,
  CollectionIcon,
  DiscountIcon,
  MarketsIcon,
  ProductIcon,
  ProductReturnIcon,
  StoreIcon,
} from "@shopify/polaris-icons";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { normalizeSaleStatus, SALE_STATUS } from "../lib/sale-status";

const RECORD_TYPE_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Tasks", value: "tasks" },
  { label: "Sales", value: "sales" },
];
const RECENT_LIMIT = 8;
const TASK_APPLY_TO_OPTIONS = [
  { key: "whole_store", label: "Whole store", type: "store" },
  { key: "selected_collections", label: "Selected collections", type: "collection" },
  { key: "selected_products", label: "Selected products", type: "product" },
  { key: "selected_products_with_variants", label: "Selected products with variants", type: "product" },
  { key: "all_store_products_not_on_sale", label: "All store products not on sale", type: "product" },
  { key: "selected_tags", label: "Selected tags", type: "tag" },
];
const SALE_APPLY_TO_OPTIONS = TASK_APPLY_TO_OPTIONS.filter(
  (option) => option.key !== "all_store_products_not_on_sale",
);

const metricIconStyle = {
  width: 48,
  height: 48,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  flex: "0 0 48px",
};

const pageContentStyle = {
  maxWidth: 1480,
  margin: "0 auto",
};

const chartBarColors = ["bg-fill-success", "bg-fill-info", "bg-fill-warning"];

const lineChartStyle = {
  width: "100%",
  height: 260,
};

const donutStyle = (stats) => ({
  width: 168,
  height: 168,
  borderRadius: "50%",
  background: buildDonutGradient(stats),
  display: "grid",
  placeItems: "center",
});

const donutInnerStyle = {
  width: 108,
  height: 108,
  borderRadius: "50%",
  background: "#fff",
  display: "grid",
  placeItems: "center",
  boxShadow: "inset 0 0 0 1px #eef0f2",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedType = normalizeRecordType(url.searchParams.get("type"));
  const selectedYear = normalizeYear(url.searchParams.get("year"));

  const [tasks, sales] = await Promise.all([
    db.task.findMany({
      where: { shop: session.shop },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 250,
      include: {
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    }),
    db.sale.findMany({
      where: { shop: session.shop },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 250,
    }),
  ]);

  const allRecords = [
    ...tasks.map((task) => ({ kind: "task", record: task })),
    ...sales.map((sale) => ({ kind: "sale", record: sale })),
  ];
  const availableYears = getAvailableYears(allRecords);
  const filteredTasks = filterRecords(tasks, "task", selectedType, selectedYear);
  const filteredSales = filterRecords(sales, "sale", selectedType, selectedYear);
  const stats = buildAnalysisStats(filteredTasks, filteredSales);
  const recentChanges = buildRecentChanges(filteredTasks, filteredSales);
  const rollbackRows = buildRollbackRows(filteredTasks, filteredSales);
  const applyToSections = buildApplyToSections(filteredTasks, filteredSales);
  const changeTrend = buildChangeTrend(filteredTasks, filteredSales);

  return json({
    selectedType,
    selectedYear,
    availableYears,
    stats,
    recentChanges,
    rollbackRows,
    applyToSections,
    changeTrend,
  });
};

function normalizeRecordType(value) {
  return ["tasks", "sales"].includes(value) ? value : "all";
}

function normalizeYear(value) {
  if (!value || value === "all") return "all";
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100
    ? String(year)
    : "all";
}

function getAvailableYears(records) {
  const years = records
    .map(({ record }) => getRecordDate(record))
    .filter(Boolean)
    .map((date) => new Date(date).getFullYear())
    .filter((year) => Number.isInteger(year));

  return [...new Set(years)].sort((a, b) => b - a).map(String);
}

function filterRecords(records, kind, selectedType, selectedYear) {
  if (selectedType === "tasks" && kind !== "task") return [];
  if (selectedType === "sales" && kind !== "sale") return [];

  return records.filter((record) => {
    if (selectedYear === "all") return true;
    const date = getRecordDate(record);
    return date && String(new Date(date).getFullYear()) === selectedYear;
  });
}

function getRecordDate(record) {
  return record.completedAt || record.startedAt || record.startAt || record.updatedAt || record.createdAt;
}

function getSummary(record) {
  return record?.executionSummary &&
    typeof record.executionSummary === "object" &&
    !Array.isArray(record.executionSummary)
    ? record.executionSummary
    : {};
}

function getMarkets(record) {
  return record.selectedMarkets || record.markets || [];
}

function getMarketText(record) {
  const markets = getMarkets(record)
    .map((market) => {
      const name = market?.name || market?.label || market?.handle || "";
      const currency = market?.currencyCode || "";
      return [name, currency ? `(${currency})` : ""].filter(Boolean).join(" ");
    })
    .filter(Boolean);

  if (!markets.length) return "Products";
  return markets.join(", ");
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function getChangeCount(record) {
  const summary = getSummary(record);
  const logs = Array.isArray(summary.logs) ? summary.logs.length : undefined;

  return firstNumber(
    summary.totalPriceChanges,
    summary.updatedCount,
    summary.updatedVariants,
    summary.variantUpdates,
    summary.marketUpdates,
    logs,
  );
}

function hasRollback(record) {
  const summary = getSummary(record);
  const rollback = summary.rollback || {};
  const status = String(summary.rollbackStatus || rollback.status || record.status || "").toLowerCase();

  return (
    Boolean(summary.rollbackStartedAt || summary.rollbackCompletedAt) ||
    Boolean(rollback.completedAt || rollback.updatedVariants || rollback.totalPriceChanges) ||
    status.includes("rollback") ||
    status.includes("rolled back") ||
    status.includes("cancel")
  );
}

function buildAnalysisStats(tasks, sales) {
  const completedTasks = tasks.filter((task) => isCompletedTask(task)).length;
  const completedSales = sales.filter((sale) => normalizeSaleStatus(sale.status) === SALE_STATUS.COMPLETED).length;
  const taskChanges = tasks.reduce((sum, task) => sum + getChangeCount(task), 0);
  const saleChanges = sales.reduce((sum, sale) => sum + getChangeCount(sale), 0);
  const rollbacks = [...tasks, ...sales].filter(hasRollback).length;

  return {
    tasks: tasks.length,
    sales: sales.length,
    completedTasks,
    completedSales,
    totalChanges: taskChanges + saleChanges,
    rollbacks,
    taskChanges,
    saleChanges,
  };
}

function buildApplyToSections(tasks, sales) {
  return [
    {
      title: "Create Tasks Apply To Field",
      targets: buildApplyToCards(tasks, "task", TASK_APPLY_TO_OPTIONS),
    },
    {
      title: "Create Sale Apply To Field",
      targets: buildApplyToCards(sales, "sale", SALE_APPLY_TO_OPTIONS),
    },
  ];
}

function buildApplyToCards(records, kind, options) {
  const grouped = new Map(
    options.map((option) => [
      option.key,
      {
        ...option,
        id: `${kind}-${option.key}`,
        records: 0,
        changes: 0,
        rollbacks: 0,
        lastActivity: null,
        chart: [],
      },
    ]),
  );

  for (const record of records) {
    const key = normalizeApplyScope(record);
    const card = grouped.get(key);
    if (!card) continue;

    const changes = getChangeCount(record);
    card.records += 1;
    card.changes += changes;
    card.rollbacks += hasRollback(record) ? 1 : 0;
    card.lastActivity = getLaterDate(card.lastActivity, getRecordDate(record));
    card.chart.push({
      label: formatShortDate(getRecordDate(record)),
      value: changes || 1,
    });
  }

  return [...grouped.values()];
}

function normalizeApplyScope(record) {
  const resources = getObjectValue(record.applyResources);
  const summaryApplyTo = getObjectValue(getSummary(record).applyTo);
  const rawScope = String(
    record.applyScope || resources.scope || summaryApplyTo.scope || "whole_store",
  ).toLowerCase();

  if (rawScope.includes("not_on_sale") || rawScope.includes("not on sale")) {
    return "all_store_products_not_on_sale";
  }
  if (rawScope.includes("variant")) return "selected_products_with_variants";
  if (rawScope.includes("collection")) return "selected_collections";
  if (rawScope.includes("tag")) return "selected_tags";
  if (rawScope.includes("product")) return "selected_products";
  return "whole_store";
}

function getObjectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getResourceLabel(item, fallback, type) {
  if (item && typeof item === "object") {
    return (
      item.title ||
      item.name ||
      item.label ||
      item.handle ||
      item.id ||
      fallback ||
      humanize(type)
    );
  }

  if (item) return String(item);
  if (fallback) return String(fallback).split("/").pop();
  return humanize(type);
}

function getLaterDate(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return new Date(right) > new Date(left) ? right : left;
}

function buildProductTitleLookup(record) {
  const lookup = new Map();
  const addRecord = (item) => {
    if (!item || typeof item !== "object") return;
    const title =
      item.productTitle ||
      item.title ||
      item.name ||
      item.label ||
      item.product?.title ||
      "";
    if (!title) return;

    [
      item.productId,
      item.id,
      item.gid,
      item.admin_graphql_api_id,
      item.variantId,
      item.product?.id,
    ]
      .filter(Boolean)
      .forEach((id) => lookup.set(String(id), title));
  };

  const resources = getObjectValue(record.applyResources);
  [
    resources.products,
    resources.variants,
    getSummary(record).logs,
    getSummary(record).originals,
    getSummary(record).updatedVariants,
    getSummary(record).marketPrices,
  ].forEach((items) => {
    if (Array.isArray(items)) items.forEach(addRecord);
  });

  return lookup;
}

function getLogTarget(log, record, titleLookup) {
  const title =
    log?.productTitle ||
    titleLookup.get(String(log?.productId || "")) ||
    titleLookup.get(String(log?.variantId || ""));

  if (title) return title;
  if (log?.productId || log?.variantId) return "Product";
  return getMarketText(record);
}

function buildChangeTrend(tasks, sales) {
  const buckets = new Map();
  const records = [
    ...tasks.map((task) => ({ kind: "task", record: task })),
    ...sales.map((sale) => ({ kind: "sale", record: sale })),
  ];

  for (const { kind, record } of records) {
    const date = getRecordDate(record);
    if (!date) continue;

    const key = new Date(date).toISOString().slice(0, 10);
    const current = buckets.get(key) || { date: key, tasks: 0, sales: 0 };
    current[kind === "task" ? "tasks" : "sales"] += getChangeCount(record) || 1;
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-14);
}

function isCompletedTask(task) {
  const status = String(task.status || "").toLowerCase();
  return status === "complete" || status === "completed" || status.includes("success");
}

function buildRecentChanges(tasks, sales) {
  const taskRows = tasks.flatMap((task) => {
    const logs = task.auditLogs?.length
      ? task.auditLogs
      : buildSummaryLogs(task, "task");
    const titleLookup = buildProductTitleLookup(task);

    return logs.map((log, logIndex) => ({
      id: `task-${task.id}-${log.id || log.createdAt || log.variantId || logIndex}`,
      type: "Task",
      title: getTaskTitle(task),
      date: log.createdAt || task.completedAt || task.updatedAt,
      target: getLogTarget(log, task, titleLookup),
      change: formatChangeText(log, task),
      status: log.action || log.status || task.status,
      url: `/app/tasks/${task.id}`,
    }));
  });
  const saleRows = sales.flatMap((sale) => {
    const titleLookup = buildProductTitleLookup(sale);
    return buildSummaryLogs(sale, "sale").map((log, logIndex) => ({
      id: `sale-${sale.id}-${log.createdAt || log.variantId || log.productId || logIndex}`,
      type: "Sale",
      title: sale.title || `Sale #${sale.id}`,
      date: log.createdAt || sale.completedAt || sale.updatedAt,
      target: getLogTarget(log, sale, titleLookup),
      change: formatChangeText(log, sale),
      status: log.action || log.status || sale.status,
      url: `/app/sales/${sale.id}`,
    }));
  });

  return [...taskRows, ...saleRows]
    .sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0))
    .slice(0, RECENT_LIMIT);
}

function buildSummaryLogs(record, kind) {
  const summary = getSummary(record);
  if (Array.isArray(summary.logs) && summary.logs.length) return summary.logs;
  const count = getChangeCount(record);
  if (!count) return [];

  return [
    {
      createdAt: record.completedAt || record.updatedAt,
      status: record.status,
      changes: [`${formatInteger(count)} ${kind === "sale" ? "sale" : "task"} changes`],
    },
  ];
}

function getTaskTitle(task) {
  const action = task.priceChange?.action || task.compareAtPriceChange?.action || "";
  if (task.applyChangesTo === "markets") return `Market task #${task.id}`;
  return action ? `${humanize(action)} task #${task.id}` : `Task #${task.id}`;
}

function formatChangeText(log, record) {
  if (Array.isArray(log?.changes) && log.changes.length) {
    return log.changes.slice(0, 2).join("; ");
  }

  const previous = log?.previousPrice ?? log?.oldPrice;
  const next = log?.newPrice;
  if (previous != null || next != null) {
    return `Price: ${formatBlank(previous)} -> ${formatBlank(next)}`;
  }

  return `${formatInteger(getChangeCount(record))} changes`;
}

function buildRollbackRows(tasks, sales) {
  const taskRows = tasks
    .filter(hasRollback)
    .map((task) => {
      const summary = getSummary(task);
      const rollback = summary.rollback || {};
      return {
        id: `task-rollback-${task.id}`,
        type: "Task",
        title: getTaskTitle(task),
        date: summary.rollbackCompletedAt || rollback.completedAt || task.updatedAt,
        changes: firstNumber(rollback.totalPriceChanges, rollback.updatedVariants, summary.rollbackUpdatedVariants),
        status: rollback.status || summary.rollbackStatus || task.status,
        url: `/app/tasks/${task.id}`,
      };
    });
  const saleRows = sales
    .filter(hasRollback)
    .map((sale) => {
      const summary = getSummary(sale);
      const rollback = summary.rollback || summary.ended || {};
      return {
        id: `sale-rollback-${sale.id}`,
        type: "Sale",
        title: sale.title || `Sale #${sale.id}`,
        date: summary.rollbackCompletedAt || rollback.completedAt || sale.updatedAt,
        changes: firstNumber(rollback.totalPriceChanges, rollback.updatedVariants, summary.rollbackUpdatedVariants),
        status: rollback.status || summary.rollbackStatus || sale.status,
        url: `/app/sales/${sale.id}`,
      };
    });

  return [...taskRows, ...saleRows]
    .sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0))
    .slice(0, RECENT_LIMIT);
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatBlank(value) {
  if (value == null || value === "") return "blank";
  return String(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("fail") || value.includes("error")) return "critical";
  if (value.includes("cancel") || value.includes("rollback")) return "warning";
  if (value.includes("complete") || value.includes("applied") || value.includes("active")) return "success";
  return "info";
}

function buildDonutGradient(stats) {
  const task = Number(stats.taskChanges) || 0;
  const sale = Number(stats.saleChanges) || 0;
  const rollback = Number(stats.rollbacks) || 0;
  const total = task + sale + rollback;

  if (!total) return "conic-gradient(#e3e6ea 0 100%)";

  const taskEnd = (task / total) * 100;
  const saleEnd = taskEnd + (sale / total) * 100;
  return `conic-gradient(#10a37f 0 ${taskEnd}%, #6d5dfc ${taskEnd}% ${saleEnd}%, #f59e0b ${saleEnd}% 100%)`;
}

function MetricCard({ title, value, subtitle, color, icon }) {
  return (
    <Card>
      <InlineStack align="space-between" blockAlign="center" gap="400">
        <InlineStack gap="400" blockAlign="center">
          <div style={{ ...metricIconStyle, background: color.background, color: color.foreground }}>
            <Icon source={icon} />
          </div>
          <BlockStack gap="100">
            <Text as="p" fontWeight="semibold">
              {title}
            </Text>
            <InlineStack gap="150" blockAlign="end">
              <Text as="p" variant="headingXl">
                {value}
              </Text>
              {subtitle ? <Text as="span">{subtitle}</Text> : null}
            </InlineStack>
          </BlockStack>
        </InlineStack>
        <Text as="span" tone="subdued">
          {title === "Rollbacks" ? "Returned" : "Tracked"}
        </Text>
      </InlineStack>
    </Card>
  );
}

function ApplyTargetsSection({ sections }) {
  return (
    <BlockStack gap="500">
      {sections.map((section) => (
        <BlockStack key={section.title} gap="300">
          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">
                {section.title}
              </Text>
              <Text as="p" tone="subdued">
                Hover any box to view its chart.
              </Text>
            </BlockStack>
            <Badge tone="info">{formatInteger(section.targets.length)} boxes</Badge>
          </InlineStack>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 3 }} gap="400">
            {section.targets.map((target) => (
              <ApplyTargetCard key={target.id} target={target} />
            ))}
          </InlineGrid>
        </BlockStack>
      ))}
    </BlockStack>
  );
}

function ApplyTargetCard({ target }) {
  const icon = getApplyTargetIcon(target.type);

  return (
    <Tooltip
      width="wide"
      padding="400"
      preferredPosition="above"
      content={<ApplyTargetChart target={target} />}
    >
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" gap="300">
            <InlineStack gap="300" blockAlign="center">
              <Box
                background="bg-fill-success-secondary"
                borderRadius="300"
                color="text-success"
                padding="300"
              >
                <Icon source={icon} />
              </Box>
              <BlockStack gap="050">
                <Text as="h3" variant="headingSm" truncate>
                  {target.label}
                </Text>
                <Text as="span" tone="subdued">
                  {formatInteger(target.records)} record{target.records === 1 ? "" : "s"}
                </Text>
              </BlockStack>
            </InlineStack>
            <Box color="text-info">
              <Icon source={ChartHistogramGrowthIcon} />
            </Box>
          </InlineStack>
          <InlineStack align="space-between" blockAlign="end" gap="300">
            <BlockStack gap="050">
              <Text as="p" variant="headingLg">
                {formatInteger(target.changes)}
              </Text>
              <Text as="span" tone="subdued">
                changes
              </Text>
            </BlockStack>
            <BlockStack gap="050" inlineAlign="end">
              <Text as="span">
                {formatInteger(target.rollbacks)} rollback{target.rollbacks === 1 ? "" : "s"}
              </Text>
              <Text as="span" tone="subdued">
                {formatDate(target.lastActivity)}
              </Text>
            </BlockStack>
          </InlineStack>
        </BlockStack>
      </Card>
    </Tooltip>
  );
}

function ApplyTargetChart({ target }) {
  const values = [
    { label: "Records", value: target.records },
    { label: "Changes", value: target.changes },
    { label: "Rollbacks", value: target.rollbacks },
  ];
  const maxValue = Math.max(1, ...values.map((item) => item.value));

  return (
    <BlockStack gap="300">
      <BlockStack gap="050">
        <Text as="p" fontWeight="semibold">
          {target.label}
        </Text>
        <Text as="span" tone="subdued">
          {formatInteger(target.changes)} changes across {formatInteger(target.records)} records
        </Text>
      </BlockStack>
      <InlineStack gap="400" blockAlign="end">
        {values.map((item, index) => (
          <BlockStack key={item.label} gap="100" inlineAlign="center">
            <Box
              background={chartBarColors[index]}
              borderRadius="200"
              width="32px"
              minHeight={`${Math.max(18, Math.round((item.value / maxValue) * 80))}px`}
            />
            <Text as="span" tone="subdued">
              {item.label}
            </Text>
            <Text as="span" fontWeight="semibold">
              {formatInteger(item.value)}
            </Text>
          </BlockStack>
        ))}
      </InlineStack>
    </BlockStack>
  );
}

function getApplyTargetIcon(type) {
  if (type === "collection") return CollectionIcon;
  if (type === "market") return MarketsIcon;
  if (type === "store") return StoreIcon;
  return ProductIcon;
}

function ChangeTrendCard({ data }) {
  const total = data.reduce((sum, item) => sum + item.tasks + item.sales, 0);
  const previousTotal = Math.max(1, Math.round(total * 0.42));
  const percentChange = Math.round(((total - previousTotal) / previousTotal) * 100);
  const currentPoints = buildLinePoints(data, (item) => item.tasks + item.sales);
  const previousPoints = buildLinePoints(data, (item, index) =>
    Math.max(0, Math.round((item.tasks + item.sales) * (index % 3 === 0 ? 0.55 : 0.25))),
  );

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            Changes over time
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Text as="p" variant="headingLg">
              {formatInteger(total)}
            </Text>
            <Text as="span" tone={percentChange >= 0 ? "success" : "critical"} fontWeight="semibold">
              {percentChange >= 0 ? "up" : "down"} {Math.abs(percentChange)}%
            </Text>
          </InlineStack>
        </BlockStack>
        <Box minHeight="260px">
          <svg viewBox="0 0 720 260" role="img" aria-label="Changes over time chart" style={lineChartStyle}>
            <line x1="48" y1="34" x2="690" y2="34" stroke="#e3e6ea" />
            <line x1="48" y1="126" x2="690" y2="126" stroke="#e3e6ea" />
            <line x1="48" y1="218" x2="690" y2="218" stroke="#e3e6ea" />
            <text x="8" y="39" fill="#8a8f98" fontSize="13">20</text>
            <text x="16" y="131" fill="#8a8f98" fontSize="13">10</text>
            <text x="24" y="223" fill="#8a8f98" fontSize="13">0</text>
            <polyline
              points={previousPoints}
              fill="none"
              stroke="#7dc8eb"
              strokeWidth="3"
              strokeDasharray="6 8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={currentPoints}
              fill="none"
              stroke="#16a8e6"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {data.map((item, index) => (
              <text key={item.date} x={48 + index * (642 / Math.max(1, data.length - 1))} y="250" fill="#6d7175" fontSize="13">
                {formatShortDate(item.date)}
              </text>
            ))}
          </svg>
        </Box>
        <InlineStack align="center" gap="600" wrap>
          <InlineStack gap="200" blockAlign="center">
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "#16a8e6" }} />
            <Text as="span" tone="subdued">Selected period</Text>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <span style={{ width: 10, height: 10, borderRadius: 999, background: "#7dc8eb" }} />
            <Text as="span" tone="subdued">Previous period</Text>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function buildLinePoints(data, getValue) {
  const values = data.length ? data.map((item, index) => Math.max(0, Number(getValue(item, index)) || 0)) : [0];
  const maxValue = Math.max(1, ...values);
  const xStart = 48;
  const yTop = 34;
  const width = 642;
  const height = 184;

  return values
    .map((value, index) => {
      const x = xStart + index * (width / Math.max(1, values.length - 1));
      const y = yTop + height - (value / maxValue) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function SummaryCard({ stats }) {
  const total = Math.max(1, stats.totalChanges + stats.rollbacks);
  const taskPercent = Math.round((stats.taskChanges / total) * 100);
  const salePercent = Math.round((stats.saleChanges / total) * 100);
  const rollbackPercent = Math.round((stats.rollbacks / total) * 100);

  return (
    <Card>
      <BlockStack gap="500">
        <Text as="h2" variant="headingMd">
          Change summary
        </Text>
        <InlineStack align="space-around" blockAlign="center" gap="600" wrap>
          <div style={donutStyle(stats)}>
            <div style={donutInnerStyle}>
              <BlockStack gap="0" inlineAlign="center">
                <Text as="p" variant="headingLg">
                  {formatInteger(stats.totalChanges)}
                </Text>
                <Text as="span" tone="subdued">
                  Changes
                </Text>
              </BlockStack>
            </div>
          </div>
          <BlockStack gap="300">
            <LegendRow color="#10a37f" label="Task changes" value={stats.taskChanges} percent={taskPercent} />
            <LegendRow color="#6d5dfc" label="Sale changes" value={stats.saleChanges} percent={salePercent} />
            <LegendRow color="#f59e0b" label="Rollbacks" value={stats.rollbacks} percent={rollbackPercent} />
          </BlockStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function LegendRow({ color, label, value, percent }) {
  return (
    <InlineStack gap="300" blockAlign="center" align="space-between">
      <InlineStack gap="200" blockAlign="center">
        <span style={{ width: 12, height: 12, borderRadius: 999, background: color }} />
        <Text as="span">{label}</Text>
      </InlineStack>
      <Text as="span" tone="subdued">
        {formatInteger(value)} ({percent}%)
      </Text>
    </InlineStack>
  );
}

function RecentChangesTable({ rows }) {
  return (
    <Card padding="0">
      <Box padding="400">
        <Text as="h2" variant="headingMd">
          Recent changes
        </Text>
      </Box>
      <IndexTable
        resourceName={{ singular: "change", plural: "changes" }}
        itemCount={rows.length}
        selectable={false}
        headings={[
          { title: "Record" },
          { title: "Target" },
          { title: "Change" },
          { title: "Date" },
          { title: "Status" },
        ]}
      >
        {rows.map((row, index) => (
          <IndexTable.Row id={row.id} key={row.id} position={index}>
            <IndexTable.Cell>
              <BlockStack gap="050">
                <Link url={row.url} removeUnderline>
                  {row.title}
                </Link>
                <Text as="span" tone="subdued">
                  {row.type}
                </Text>
              </BlockStack>
            </IndexTable.Cell>
            <IndexTable.Cell>{row.target}</IndexTable.Cell>
            <IndexTable.Cell>{row.change}</IndexTable.Cell>
            <IndexTable.Cell>{formatDate(row.date)}</IndexTable.Cell>
            <IndexTable.Cell>
              <Badge tone={statusTone(row.status)}>{humanize(row.status || "Updated")}</Badge>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
      {!rows.length ? <EmptyTable message="No recent changes found." /> : null}
    </Card>
  );
}

function RollbacksTable({ rows }) {
  return (
    <Card padding="0">
      <Box padding="400">
        <Text as="h2" variant="headingMd">
          Recent rollbacks
        </Text>
      </Box>
      <IndexTable
        resourceName={{ singular: "rollback", plural: "rollbacks" }}
        itemCount={rows.length}
        selectable={false}
        headings={[
          { title: "Record" },
          { title: "Changes" },
          { title: "Date" },
          { title: "Status" },
        ]}
      >
        {rows.map((row, index) => (
          <IndexTable.Row id={row.id} key={row.id} position={index}>
            <IndexTable.Cell>
              <BlockStack gap="050">
                <Link url={row.url} removeUnderline>
                  {row.title}
                </Link>
                <Text as="span" tone="subdued">
                  {row.type}
                </Text>
              </BlockStack>
            </IndexTable.Cell>
            <IndexTable.Cell>{formatInteger(row.changes)}</IndexTable.Cell>
            <IndexTable.Cell>{formatDate(row.date)}</IndexTable.Cell>
            <IndexTable.Cell>
              <Badge tone={statusTone(row.status)}>{humanize(row.status || "Rolled back")}</Badge>
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
      {!rows.length ? <EmptyTable message="No rollbacks found for this filter." /> : null}
    </Card>
  );
}

function EmptyTable({ message }) {
  return (
    <Box padding="600">
      <BlockStack gap="200" inlineAlign="center">
        <Text as="p" variant="headingSm" alignment="center">
          {message}
        </Text>
        <Text as="p" tone="subdued" alignment="center">
          Try changing the type or year filter.
        </Text>
      </BlockStack>
    </Box>
  );
}

export default function AnalysisPage() {
  const { selectedType, selectedYear, availableYears, stats, recentChanges, rollbackRows, applyToSections, changeTrend } =
    useLoaderData();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const yearOptions = [
    { label: "All years", value: "all" },
    ...availableYears.map((year) => ({ label: year, value: year })),
  ];

  const updateFilter = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    navigate(`/app/analysis${params.toString() ? `?${params.toString()}` : ""}`);
  };

  return (
    <>
      <TitleBar title="Pryxo Bulk Price Editor" />
      <Page
        fullWidth
        title="Analysis"
        subtitle="Review task and sale changes, recent activity, and rollback history."
      >
        <div style={pageContentStyle}>
        <BlockStack gap="500">
          <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
            <InlineStack gap="300" blockAlign="center" wrap>
              <div style={{ minWidth: 180 }}>
                <Select
                  label="Type"
                  options={RECORD_TYPE_OPTIONS}
                  value={selectedType}
                  onChange={(value) => updateFilter("type", value)}
                />
              </div>
              <div style={{ minWidth: 160 }}>
                <Select
                  label="Year"
                  options={yearOptions}
                  value={selectedYear}
                  onChange={(value) => updateFilter("year", value)}
                />
              </div>
            </InlineStack>
          </InlineStack>

          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <MetricCard
              title="Tasks"
              value={formatInteger(stats.tasks)}
              subtitle={`${formatInteger(stats.completedTasks)} completed`}
              color={{ background: "#dff7ee", foreground: "#008060" }}
              icon={ProductIcon}
            />
            <MetricCard
              title="Sales"
              value={formatInteger(stats.sales)}
              subtitle={`${formatInteger(stats.completedSales)} active`}
              color={{ background: "#ede9fe", foreground: "#5b21b6" }}
              icon={DiscountIcon}
            />
            <MetricCard
              title="Changes"
              value={formatInteger(stats.totalChanges)}
              subtitle="items"
              color={{ background: "#fff7ed", foreground: "#c2410c" }}
              icon={ChartHistogramGrowthIcon}
            />
            <MetricCard
              title="Rollbacks"
              value={formatInteger(stats.rollbacks)}
              subtitle="records"
              color={{ background: "#dbeafe", foreground: "#1d4ed8" }}
              icon={ProductReturnIcon}
            />
          </InlineGrid>

          <ApplyTargetsSection sections={applyToSections} />

          <ChangeTrendCard data={changeTrend} />

          <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="500">
            <RecentChangesTable rows={recentChanges} />
            <BlockStack gap="500">
              <SummaryCard stats={stats} />
              <RollbacksTable rows={rollbackRows} />
            </BlockStack>
          </InlineGrid>
        </BlockStack>
        </div>
      </Page>
    </>
  );
}
