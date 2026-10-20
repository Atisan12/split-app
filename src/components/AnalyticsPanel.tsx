"use client";

import { useEffect, useMemo, useState } from "react";
import { formatAmount } from "@stellar-split/sdk";
import { useI18n } from "@/components/I18nProvider";
import type { Invoice } from "@stellar-split/sdk";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/Skeleton";
import { getAnalyticsSummary, type AnalyticsSummary } from "@/lib/analytics";
import { calculateAgingBuckets, type AgingBucket } from "@/lib/invoiceAging";

interface Props {
  invoices: Invoice[];
}

interface AppMetrics {
  eventTotals: { name: string; count: number }[];
  funnel: { step: string; count: number; conversion: number }[];
  activeUsers: number;
}

const FUNNEL_STEPS = ["invoice_created", "invoice_funded", "invoice_released"] as const;

function buildAppMetrics(summary: AnalyticsSummary): AppMetrics {
  const totals = new Map<string, number>();
  for (const event of summary.events) {
    totals.set(event.name, (totals.get(event.name) ?? 0) + 1);
  }
  const eventTotals = Array.from(totals.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const funnelTop = totals.get(FUNNEL_STEPS[0]) ?? 0;
  const funnel = FUNNEL_STEPS.map((step) => {
    const count = totals.get(step) ?? 0;
    return {
      step,
      count,
      conversion: funnelTop > 0 ? Math.round((count / funnelTop) * 100) : 0,
    };
  });

  return { eventTotals, funnel, activeUsers: summary.activeUsers };
}

function trendIndicator(current: number, previous: number): { label: string; className: string } {
  if (previous === 0) {
    return current > 0
      ? { label: "▲ new", className: "text-red-400" }
      : { label: "—", className: "text-gray-500" };
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) return { label: "— 0%", className: "text-gray-400" };
  return change > 0
    ? { label: `▲ ${change.toFixed(0)}%`, className: "text-red-400" }
    : { label: `▼ ${Math.abs(change).toFixed(0)}%`, className: "text-green-400" };
}

type RangePreset = "7d" | "30d" | "3m" | "custom";

interface RangeOption {
  key: RangePreset;
  label: string;
  days: number | null;
}

const RANGE_OPTIONS: RangeOption[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "3m", label: "Last 3 months", days: 90 },
  { key: "custom", label: "Custom", days: null },
];

export default function AnalyticsPanel({ invoices }: Props) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [range, setRange] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isRefetching, setIsRefetching] = useState(false);

  const now = Date.now() / 1000;

  // Determine the [from, to] window (in unix seconds) for the active range.
  const { from, to } = useMemo(() => {
    if (range === "custom") {
      const fromTs = customFrom ? new Date(customFrom).getTime() / 1000 : 0;
      const toTs = customTo ? new Date(customTo).getTime() / 1000 : now;
      return { from: fromTs, to: toTs };
    }
    const option = RANGE_OPTIONS.find((o) => o.key === range);
    const days = option?.days ?? 30;
    return { from: now - days * 24 * 60 * 60, to: now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, customFrom, customTo]);

  // Simulate a metrics refetch whenever the selected range changes.
  useEffect(() => {
    setIsRefetching(true);
    const id = setTimeout(() => setIsRefetching(false), 400);
    return () => clearTimeout(id);
  }, [range, customFrom, customTo]);

  const scopedInvoices = useMemo(
    () => invoices.filter((inv) => inv.deadline >= from && inv.deadline <= to),
    [invoices, from, to]
  );

  // Calculate summary stats
  const stats = {
    totalSent: 0n,
    totalReceived: 0n,
    pending: 0,
    released: 0,
    refunded: 0,
  };

  scopedInvoices.forEach((inv) => {
    if (inv.status === "Pending") stats.pending++;
    else if (inv.status === "Released") stats.released++;
    else if (inv.status === "Refunded") stats.refunded++;

    // Count as "sent" if user is creator (funded amount), "received" if recipient
    stats.totalSent += inv.funded;
    stats.totalReceived += inv.funded;
  });

  // Group scoped invoices by week
  const weekData: Record<string, number> = {};

  scopedInvoices.forEach((inv) => {
    const date = new Date(inv.deadline * 1000);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().slice(0, 10);

    weekData[weekKey] = (weekData[weekKey] || 0) + 1;
  });

  const chartData = Object.entries(weekData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, invoices: count }));

  // Application metrics (event tracking + funnel + active users) for the range.
  const appMetrics = useMemo(() => {
    const summary = getAnalyticsSummary({ from, to });
    return buildAppMetrics(summary);
  }, [from, to]);

  // Invoice aging buckets for the current scoped invoices, with a trend
  // indicator comparing the current window against the preceding window.
  const aging = useMemo(() => {
    const current = calculateAgingBuckets(scopedInvoices, to);
    const windowSeconds = Math.max(to - from, 0);
    const prevFrom = from - windowSeconds;
    const prevInvoices = invoices.filter(
      (inv) => inv.deadline >= prevFrom && inv.deadline < from
    );
    const previous = calculateAgingBuckets(prevInvoices, from);
    return { current, previous };
  }, [scopedInvoices, invoices, from, to]);

  const overdueTrend = trendIndicator(
    aging.current.overdueTotal,
    aging.previous.overdueTotal
  );

  return (
    <div className="bg-gray-900 rounded-xl p-4 sm:p-5 mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-left font-semibold text-lg hover:text-white transition-colors"
        aria-expanded={isOpen}
        aria-label="Toggle analytics panel"
      >
        <span>{t("dashboard.analytics")}</span>
        <span className="text-sm text-gray-400">
          {isOpen ? "▼" : "▶"}
        </span>
      </button>

      {isOpen && (
        <div className="mt-5 space-y-5">
          {/* Date-range selector */}
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                aria-pressed={range === option.key}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  range === option.key
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
            {range === "custom" && (
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  aria-label="Custom range start date"
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-gray-500 text-xs">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  aria-label="Custom range end date"
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>

          {isRefetching ? (
            <div
              role="status"
              aria-busy="true"
              aria-label="Loading analytics"
              className="space-y-5"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-[250px] rounded-lg" />
            </div>
          ) : (
            <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">{t("dashboard.totalSent")}</p>
              <p className="text-lg font-semibold">{formatAmount(stats.totalSent)}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">{t("dashboard.totalReceived")}</p>
              <p className="text-lg font-semibold">{formatAmount(stats.totalReceived)}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">{t("dashboard.totalInvoices")}</p>
              <p className="text-lg font-semibold">{scopedInvoices.length}</p>
            </div>
          </div>

          {/* Status Breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
              <p className="text-xs text-yellow-300 mb-1">{t("dashboard.pending")}</p>
              <p className="text-lg font-semibold text-yellow-300">{stats.pending}</p>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <p className="text-xs text-green-300 mb-1">{t("dashboard.released")}</p>
              <p className="text-lg font-semibold text-green-300">{stats.released}</p>
            </div>
            <div className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">{t("dashboard.refunded")}</p>
              <p className="text-lg font-semibold text-gray-400">{stats.refunded}</p>
            </div>
          </div>

          {/* Invoice Aging Summary */}
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">{t("dashboard.agingSummary")}</p>
              <span
                className={`text-xs font-medium ${overdueTrend.className}`}
                aria-label="Overdue trend versus previous period"
              >
                {overdueTrend.label}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {aging.current.buckets.map((bucket: AgingBucket) => (
                <div key={bucket.key} className="bg-gray-900/60 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">{bucket.label}</p>
                  <p className="text-sm font-semibold text-gray-200">
                    {formatAmount(bucket.amount)}
                  </p>
                  <p className="text-xs text-gray-500">{bucket.count} invoices</p>
                </div>
              ))}
            </div>
          </div>

          {/* Application Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">{t("dashboard.activeUsers")}</p>
              <p className="text-lg font-semibold">{appMetrics.activeUsers}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 sm:col-span-2">
              <p className="text-xs text-gray-400 mb-2">{t("dashboard.conversionFunnel")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {appMetrics.funnel.map((step) => (
                  <div
                    key={step.step}
                    className="flex-1 min-w-[90px] bg-gray-900/60 rounded-lg px-3 py-2"
                  >
                    <p className="text-xs text-gray-400 truncate">{step.step}</p>
                    <p className="text-sm font-semibold text-gray-200">{step.count}</p>
                    <p className="text-xs text-indigo-300">{step.conversion}%</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Event Totals */}
          {appMetrics.eventTotals.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-3">{t("dashboard.eventTotals")}</p>
              <ul className="space-y-1">
                {appMetrics.eventTotals.slice(0, 8).map((event) => (
                  <li
                    key={event.name}
                    className="flex items-center justify-between text-xs text-gray-300"
                  >
                    <span className="truncate">{event.name}</span>
                    <span className="font-semibold text-gray-200">{event.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Weekly Chart */}
          {chartData.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
              <p className="text-sm text-gray-400 mb-3">{t("dashboard.invoicesByWeek")}</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={chartData}
                  margin={{ top: 20, right: 30, left: 0, bottom: 50 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1f2937",
                      border: "1px solid #374151",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="invoices" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
