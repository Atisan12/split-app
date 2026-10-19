/**
 * Invoice Aging Analytics Library
 *
 * Pure, unit-testable functions for computing invoice aging buckets,
 * overdue rates, collection efficiency, trend series, and threshold-based alerts.
 */

export type InvoiceStatus = 'paid' | 'unpaid' | 'partial' | 'cancelled' | 'draft';

export interface Invoice {
  id: string;
  /** ISO date string of the invoice issue date */
  issueDate: string;
  /** ISO date string of the payment deadline / due date */
  dueDate: string;
  /** Total amount due on the invoice */
  amount: number;
  /** Amount already paid (defaults to 0 if omitted) */
  amountPaid?: number;
  status: InvoiceStatus;
  /** ISO date string of when the invoice was fully paid, if applicable */
  paidDate?: string;
}

export type AgingBucketKey =
  | 'current'
  | 'days1to30'
  | 'days31to60'
  | 'days61to90'
  | 'days90plus';

export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  /** Inclusive lower bound in days overdue (0 for current) */
  minDays: number;
  /** Inclusive upper bound in days overdue (Infinity for 90+) */
  maxDays: number;
  /** Total outstanding amount in this bucket */
  amount: number;
  /** Number of invoices in this bucket */
  count: number;
  /** Invoice ids in this bucket */
  invoiceIds: string[];
}

export interface AgingReport {
  /** Reference date used for the calculation (ISO string) */
  asOf: string;
  buckets: AgingBucket[];
  /** Total outstanding amount across all buckets */
  totalOutstanding: number;
  /** Total number of outstanding invoices */
  totalInvoices: number;
  /** Overdue amount (everything past the current bucket) */
  overdueAmount: number;
  /** Overdue rate: overdueAmount / totalOutstanding (0 when no outstanding) */
  overdueRate: number;
  /** Collection efficiency: paid amount / total invoiced amount (0..1) */
  collectionEfficiency: number;
  /** Total amount invoiced (paid + outstanding) */
  totalInvoiced: number;
  /** Total amount collected */
  totalCollected: number;
}

export interface TrendPoint {
  /** ISO date string for the point */
  date: string;
  totalOutstanding: number;
  overdueAmount: number;
  overdueRate: number;
  collectionEfficiency: number;
}

export interface AgingAlertThresholds {
  /** Days overdue at which an invoice is considered aging (default 30) */
  warningDays?: number;
  /** Days overdue at which an invoice is considered critical (default 60) */
  criticalDays?: number;
  /** Overdue rate (0..1) that triggers a portfolio-level alert (default 0.25) */
  overdueRateThreshold?: number;
}

export interface AgingAlert {
  type: 'invoice' | 'portfolio';
  severity: 'warning' | 'critical';
  invoiceId?: string;
  daysOverdue?: number;
  amount?: number;
  overdueRate?: number;
  message: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const AGING_BUCKETS: ReadonlyArray<{
  key: AgingBucketKey;
  label: string;
  minDays: number;
  maxDays: number;
}> = [
  { key: 'current', label: 'Current', minDays: 0, maxDays: 0 },
  { key: 'days1to30', label: '1-30 days', minDays: 1, maxDays: 30 },
  { key: 'days31to60', label: '31-60 days', minDays: 31, maxDays: 60 },
  { key: 'days61to90', label: '61-90 days', minDays: 61, maxDays: 90 },
  { key: 'days90plus', label: '90+ days', minDays: 91, maxDays: Infinity },
];

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function startOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Number of whole days an invoice is overdue relative to `asOf`.
 * Returns 0 when not yet due. Negative values are clamped to 0.
 */
export function daysOverdue(invoice: Invoice, asOf: string | Date): number {
  const due = startOfDay(toDate(invoice.dueDate));
  const ref = startOfDay(toDate(asOf));
  const diff = Math.floor((ref.getTime() - due.getTime()) / MS_PER_DAY);
  return diff > 0 ? diff : 0;
}

/**
 * Outstanding amount on an invoice (amount minus amount paid), never negative.
 */
export function outstandingAmount(invoice: Invoice): number {
  const paid = invoice.amountPaid ?? 0;
  const outstanding = invoice.amount - paid;
  return outstanding > 0 ? outstanding : 0;
}

/**
 * Whether an invoice should be considered in aging calculations.
 * Paid, cancelled, and draft invoices are excluded.
 */
export function isAgingEligible(invoice: Invoice): boolean {
  if (invoice.status === 'paid' || invoice.status === 'cancelled' || invoice.status === 'draft') {
    return false;
  }
  return outstandingAmount(invoice) > 0;
}

/**
 * Determine the aging bucket key for a given number of days overdue.
 */
export function bucketKeyForDays(days: number): AgingBucketKey {
  if (days <= 0) return 'current';
  if (days <= 30) return 'days1to30';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  return 'days90plus';
}

/**
 * Compute aging buckets for a set of invoices as of a reference date.
 */
export function computeAgingBuckets(
  invoices: Invoice[],
  asOf: string | Date,
): AgingBucket[] {
  const buckets: AgingBucket[] = AGING_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    minDays: b.minDays,
    maxDays: b.maxDays,
    amount: 0,
    count: 0,
    invoiceIds: [],
  }));

  const byKey = new Map<AgingBucketKey, AgingBucket>();
  for (const bucket of buckets) byKey.set(bucket.key, bucket);

  for (const invoice of invoices) {
    if (!isAgingEligible(invoice)) continue;
    const days = daysOverdue(invoice, asOf);
    const key = bucketKeyForDays(days);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.amount += outstandingAmount(invoice);
    bucket.count += 1;
    bucket.invoiceIds.push(invoice.id);
  }

  return buckets;
}

/**
 * Compute the full aging report for a set of invoices.
 */
export function generateAgingReport(
  invoices: Invoice[],
  asOf: string | Date,
): AgingReport {
  const asOfDate = toDate(asOf);
  const buckets = computeAgingBuckets(invoices, asOfDate);

  let totalOutstanding = 0;
  let overdueAmount = 0;
  let totalInvoices = 0;
  for (const bucket of buckets) {
    totalOutstanding += bucket.amount;
    totalInvoices += bucket.count;
    if (bucket.key !== 'current') {
      overdueAmount += bucket.amount;
    }
  }

  let totalInvoiced = 0;
  let totalCollected = 0;
  for (const invoice of invoices) {
    if (invoice.status === 'cancelled' || invoice.status === 'draft') continue;
    totalInvoiced += invoice.amount;
    totalCollected += Math.min(invoice.amountPaid ?? 0, invoice.amount);
  }

  const overdueRate = totalOutstanding > 0 ? overdueAmount / totalOutstanding : 0;
  const collectionEfficiency = totalInvoiced > 0 ? totalCollected / totalInvoiced : 0;

  return {
    asOf: asOfDate.toISOString(),
    buckets,
    totalOutstanding,
    totalInvoices,
    overdueAmount,
    overdueRate,
    collectionEfficiency,
    totalInvoiced,
    totalCollected,
  };
}

/**
 * Produce a trend series of aging metrics over time.
 *
 * @param invoices invoices to analyze
 * @param startDate ISO date for the first point
 * @param endDate ISO date for the last point
 * @param intervalDays number of days between points (default 7)
 */
export function computeAgingTrend(
  invoices: Invoice[],
  startDate: string | Date,
  endDate: string | Date,
  intervalDays = 7,
): TrendPoint[] {
  const start = startOfDay(toDate(startDate));
  const end = startOfDay(toDate(endDate));
  const step = Math.max(1, Math.floor(intervalDays));
  const points: TrendPoint[] = [];

  if (start.getTime() > end.getTime()) return points;

  for (let t = start.getTime(); t <= end.getTime(); t += step * MS_PER_DAY) {
    const date = new Date(t);
    const report = generateAgingReport(invoices, date);
    points.push({
      date: date.toISOString(),
      totalOutstanding: report.totalOutstanding,
      overdueAmount: report.overdueAmount,
      overdueRate: report.overdueRate,
      collectionEfficiency: report.collectionEfficiency,
    });
  }

  return points;
}

/**
 * Evaluate threshold-based aging alerts.
 *
 * Returns per-invoice alerts for invoices that crossed the warning or critical
 * aging thresholds, plus a portfolio-level alert when the overdue rate exceeds
 * the configured threshold.
 */
export function evaluateAgingAlerts(
  invoices: Invoice[],
  asOf: string | Date,
  thresholds: AgingAlertThresholds = {},
): AgingAlert[] {
  const warningDays = thresholds.warningDays ?? 30;
  const criticalDays = thresholds.criticalDays ?? 60;
  const overdueRateThreshold = thresholds.overdueRateThreshold ?? 0.25;

  const alerts: AgingAlert[] = [];

  for (const invoice of invoices) {
    if (!isAgingEligible(invoice)) continue;
    const days = daysOverdue(invoice, asOf);
    if (days >= criticalDays) {
      alerts.push({
        type: 'invoice',
        severity: 'critical',
        invoiceId: invoice.id,
        daysOverdue: days,
        amount: outstandingAmount(invoice),
        message: `Invoice ${invoice.id} is ${days} days overdue (critical threshold ${criticalDays}).`,
      });
    } else if (days >= warningDays) {
      alerts.push({
        type: 'invoice',
        severity: 'warning',
        invoiceId: invoice.id,
        daysOverdue: days,
        amount: outstandingAmount(invoice),
        message: `Invoice ${invoice.id} is ${days} days overdue (warning threshold ${warningDays}).`,
      });
    }
  }

  const report = generateAgingReport(invoices, asOf);
  if (report.overdueRate > overdueRateThreshold) {
    alerts.push({
      type: 'portfolio',
      severity: report.overdueRate >= overdueRateThreshold * 2 ? 'critical' : 'warning',
      overdueRate: report.overdueRate,
      amount: report.overdueAmount,
      message: `Portfolio overdue rate ${(report.overdueRate * 100).toFixed(1)}% exceeds threshold ${(overdueRateThreshold * 100).toFixed(1)}%.`,
    });
  }

  return alerts;
}

/**
 * Serialize an aging report to CSV for export.
 */
export function agingReportToCsv(report: AgingReport): string {
  const lines: string[] = [];
  lines.push('Bucket,Min Days,Max Days,Amount,Count,Invoice IDs');
  for (const bucket of report.buckets) {
    const max = bucket.maxDays === Infinity ? '' : String(bucket.maxDays);
    const ids = bucket.invoiceIds.join('|');
    lines.push(
      [
        escapeCsv(bucket.label),
        String(bucket.minDays),
        max,
        bucket.amount.toFixed(2),
        String(bucket.count),
        escapeCsv(ids),
      ].join(','),
    );
  }
  lines.push('');
  lines.push('Metric,Value');
  lines.push(`As Of,${escapeCsv(report.asOf)}`);
  lines.push(`Total Outstanding,${report.totalOutstanding.toFixed(2)}`);
  lines.push(`Total Invoices,${report.totalInvoices}`);
  lines.push(`Overdue Amount,${report.overdueAmount.toFixed(2)}`);
  lines.push(`Overdue Rate,${(report.overdueRate * 100).toFixed(2)}%`);
  lines.push(`Collection Efficiency,${(report.collectionEfficiency * 100).toFixed(2)}%`);
  lines.push(`Total Invoiced,${report.totalInvoiced.toFixed(2)}`);
  lines.push(`Total Collected,${report.totalCollected.toFixed(2)}`);
  return lines.join('\n');
}

/**
 * Serialize a trend series to CSV for export.
 */
export function agingTrendToCsv(points: TrendPoint[]): string {
  const lines: string[] = [];
  lines.push('Date,Total Outstanding,Overdue Amount,Overdue Rate,Collection Efficiency');
  for (const p of points) {
    lines.push(
      [
        escapeCsv(p.date),
        p.totalOutstanding.toFixed(2),
        p.overdueAmount.toFixed(2),
        (p.overdueRate * 100).toFixed(2),
        (p.collectionEfficiency * 100).toFixed(2),
      ].join(','),
    );
  }
  return lines.join('\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}