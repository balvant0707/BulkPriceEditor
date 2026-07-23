import { useState } from "react";
import { BlockStack, Card, InlineStack, Text } from "@shopify/polaris";

const chartStyle = {
  width: "100%",
  height: 240,
  display: "block",
  overflow: "visible",
  background: "#ffffff",
};

const tooltipStyle = {
  position: "absolute",
  pointerEvents: "none",
  minWidth: 150,
  padding: 8,
  borderRadius: 8,
  background: "#ffffff",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
  border: "1px solid #e3e3e3",
  zIndex: 2,
};

const legendDotStyle = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  display: "inline-block",
};

export default function PeriodComparisonChart({
  title,
  value,
  currentPeriodLabel = "",
  previousPeriodLabel = "",
  data = [],
  currentData,
  previousData = [],
  color = "#16a8e6",
  comparisonColor = "#8bd3f7",
  applyToLabel = "",
  applyToOptions = [],
  controls = null,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const chartWidth = 1200;
  const chartHeight = 230;
  const padding = { top: 16, right: 22, bottom: 42, left: 58 };
  const safeData = normalizeChartData(currentData || data);
  const safePreviousData = normalizeChartData(previousData);
  const rawMaxValue = Math.max(
    0,
    ...safeData.map((point) => point.value),
    ...safePreviousData.map((point) => point.value),
  );
  const maxValue = Math.max(15, Math.ceil(rawMaxValue / 5) * 5);
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const points = buildChartPoints(safeData, maxValue, chartWidth, chartHeight, padding);
  const previousPoints = buildChartPoints(safePreviousData, maxValue, chartWidth, chartHeight, padding);
  const activePoint = points[hoveredIndex];
  const activeData = safeData[hoveredIndex];
  const ticks = getChartTicks(maxValue);
  const labelIndexes = getChartLabelIndexes(safeData.length);
  const tooltipLeft = activePoint ? `${Math.min(Math.max((activePoint.x / chartWidth) * 100, 8), 88)}%` : "50%";
  const tooltipTop = activePoint ? Math.max(12, activePoint.y - 74) : 20;
  const breakdownRows = getApplyToBreakdownRows(activeData, applyToOptions);
  const currentLabel = currentPeriodLabel || formatChartPeriod(safeData);
  const previousLabel = previousPeriodLabel || formatChartPeriod(safePreviousData);

  const handlePointerMove = (event) => {
    if (!safeData.length) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    const relativeX = Math.min(Math.max(x - padding.left, 0), plotWidth);
    const index = Math.round((relativeX / plotWidth) * Math.max(1, safeData.length - 1));
    setHoveredIndex(Math.min(Math.max(index, 0), safeData.length - 1));
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" gap="400" wrap>
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              {title}
            </Text>
            {value == null ? null : (
              <Text as="p" variant="headingLg">
                {formatInteger(value)}
              </Text>
            )}
          </BlockStack>
          {controls}
        </InlineStack>


        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label={`${title} chart`}
            style={chartStyle}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoveredIndex(null)}
          >
            {ticks.map((tick) => {
              const y = padding.top + plotHeight - (tick / maxValue) * plotHeight;
              return (
                <g key={`tick-${tick}`}>
                  <line x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} stroke="#eef0f3" strokeWidth="2" />
                  <text x={padding.left - 42} y={y + 5} fill="#000000" fontSize="12" fontWeight="500">
                    {tick}
                  </text>
                </g>
              );
            })}
            {labelIndexes.map((index) => (
              <text key={safeData[index]?.date || index} x={points[index]?.x || padding.left} y={chartHeight - 12} fill="#000000" fontSize="12" fontWeight="500" textAnchor="middle">
                {formatShortDate(safeData[index]?.date)}
              </text>
            ))}
            <path d={buildChartPath(previousPoints)} fill="none" stroke={comparisonColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 13" />
            <path d={buildChartPath(points)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {activePoint ? (
              <g>
                <line x1={activePoint.x} x2={activePoint.x} y1={padding.top} y2={chartHeight - padding.bottom} stroke="#c9cccf" strokeDasharray="4 4" />
                <circle cx={activePoint.x} cy={activePoint.y} r="5" fill="#ffffff" stroke={color} strokeWidth="2" />
              </g>
            ) : null}
            <rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight} fill="transparent" />
          </svg>

          {activePoint && activeData ? (
            <div style={{ ...tooltipStyle, left: tooltipLeft, top: tooltipTop, transform: "translateX(-50%)" }}>
              <BlockStack gap="100">
                <Text as="p" fontWeight="semibold">{formatLongDate(activeData.date)}</Text>
                {breakdownRows.length ? (
                  breakdownRows.map((row) => (
                    <Text as="p" key={row.value}>{`${row.label}: ${formatInteger(row.count)} changes`}</Text>
                  ))
                ) : (
                  <Text as="p">{`${applyToLabel || title}: ${formatInteger(activeData.value)} changes`}</Text>
                )}
              </BlockStack>
            </div>
          ) : null}
        </div>

        <InlineStack align="center" gap="500" wrap>
          <InlineStack gap="150" blockAlign="center">
            <span style={{ ...legendDotStyle, background: color }} />
            <Text as="span" tone="subdued">{currentLabel}</Text>
          </InlineStack>
          <InlineStack gap="150" blockAlign="center">
            <span style={{ ...legendDotStyle, background: comparisonColor }} />
            <Text as="span" tone="subdued">{previousLabel}</Text>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function normalizeChartData(data = []) {
  return Array.isArray(data)
    ? data.map((point, index) => ({
        date: point.date || point.label || `Point ${index + 1}`,
        value: Math.max(0, Number(point.value) || 0),
        applyToBreakdown: getObjectValue(point.applyToBreakdown),
      }))
    : [];
}

function getObjectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getApplyToBreakdownRows(point, options = []) {
  if (!point || !options.length) return [];
  const breakdown = getObjectValue(point.applyToBreakdown);

  return options
    .map((option) => ({
      ...option,
      count: Math.max(0, Number(breakdown[option.value]) || 0),
    }))
    .filter((row) => row.count > 0 || options.length === 1);
}

function buildChartPoints(data, maxValue, chartWidth, chartHeight, padding) {
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  return data.map((point, index) => {
    const x = padding.left + index * (plotWidth / Math.max(1, data.length - 1));
    const y = padding.top + plotHeight - (point.value / maxValue) * plotHeight;

    return { x, y };
  });
}

function buildChartPath(points = []) {
  if (!points.length) return "";

  if (points.length < 3) {
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
  }

  return points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }

    const previous = points[index - 1];
    const next = points[index + 1] || point;
    const beforePrevious = points[index - 2] || previous;
    const controlPointStart = {
      x: previous.x + (point.x - beforePrevious.x) / 6,
      y: previous.y + (point.y - beforePrevious.y) / 6,
    };
    const controlPointEnd = {
      x: point.x - (next.x - previous.x) / 6,
      y: point.y - (next.y - previous.y) / 6,
    };

    return `${path} C ${controlPointStart.x.toFixed(2)} ${controlPointStart.y.toFixed(2)}, ${controlPointEnd.x.toFixed(2)} ${controlPointEnd.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, "");
}

function getChartTicks(maxValue) {
  const step = Math.max(5, Math.ceil(maxValue / 3 / 5) * 5);
  const ticks = [];

  for (let tick = 0; tick <= maxValue; tick += step) {
    ticks.push(tick);
  }

  if (ticks[ticks.length - 1] !== maxValue) {
    ticks.push(maxValue);
  }

  return ticks;
}

function getChartLabelIndexes(length) {
  if (!length) return [];

  return [0, Math.floor((length - 1) / 4), Math.floor((length - 1) / 2), Math.floor(((length - 1) * 3) / 4), length - 1]
    .filter((index, position, indexes) => indexes.indexOf(index) === position);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = parseChartDate(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatLongDate(value) {
  if (!value) return "-";
  const date = parseChartDate(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatChartPeriod(data = []) {
  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;

  if (!first || !last) return "";

  return `${formatShortDate(first)}-${formatLongDate(last)}`;
}

function parseChartDate(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }

  return new Date(value);
}
