import { formatAmount } from "@stellar-split/sdk";
import type {
  Subscription,
  SubscriptionCancellationReason,
  SubscriptionFrequency,
  SubscriptionInvoice,
  SubscriptionStatus,
} from "@/types/subscription";
import { pushNotification } from "@/lib/notifications/pushNotifications";

const STORAGE_KEY = "stellar_split_subscriptions";

export function loadSubscriptions(): Subscription[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed.map((s) => ({
      ...s,
      recipients: (s.recipients as Array<{ address: string; amount: string }>).map(
        (r) => ({ ...r, amount: BigInt(r.amount) })
      ),
      totalUsdcCollected: BigInt(s.totalUsdcCollected as string),
      invoiceHistory: (s.invoiceHistory as Array<Record<string, unknown>>).map(
        (inv) => ({
          ...inv,
          amount: BigInt(inv.amount as string),
        })
      ),
    })) as Subscription[];
  } catch {
    return [];
  }
}

export function saveSubscriptions(subs: Subscription[]): void {
  if (typeof window === "undefined") return;
  const serializable = subs.map((s) => ({
    ...s,
    recipients: s.recipients.map((r) => ({
      ...r,
      amount: r.amount.toString(),
    })),
    totalUsdcCollected: s.totalUsdcCollected.toString(),
    invoiceHistory: s.invoiceHistory.map((inv) => ({
      ...inv,
      amount: inv.amount.toString(),
    })),
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

export function getSubscriptionById(id: string): Subscription | undefined {
  return loadSubscriptions().find((s) => s.id === id);
}

export function frequencyToIntervalDays(freq: SubscriptionFrequency): number {
  switch (freq) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
  }
}

export function formatFrequency(freq: SubscriptionFrequency): string {
  switch (freq) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Biweekly";
    case "monthly":
      return "Monthly";
  }
}

/**
 * Compute upcoming invoice dates from a subscription's config.
 * Returns the next N dates after `fromDate` (defaults to now).
 */
export function computeUpcomingDates(
  intervalDays: number,
  count: number,
  fromDate: Date = new Date()
): Date[] {
  const dates: Date[] = [];
  let current = new Date(fromDate);
  for (let i = 0; i < count; i++) {
    current = new Date(current.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    dates.push(current);
  }
  return dates;
}

/**
 * Lifecycle state-transition guards.
 */
export function canPause(sub: Subscription): boolean {
  return sub.status === "active";
}

export function canResume(sub: Subscription): boolean {
  return sub.status === "paused";
}

export function canCancel(sub: Subscription): boolean {
  return sub.status === "active" || sub.status === "paused";
}

/**
 * Pause a subscription — sets status to "paused" and records the timestamp.
 */
export function pauseSubscription(sub: Subscription): Subscription {
  if (!canPause(sub)) return sub;
  const pausedAt = Date.now() / 1000;
  pushNotification({
    title: "Subscription paused",
    body: `Your ${formatFrequency(sub.frequency).toLowerCase()} subscription has been paused.`,
    kind: "subscription-paused",
    subscriptionId: sub.id,
  });
  return { ...sub, status: "paused" as const, pausedAt };
}

/**
 * Resume a subscription — sets status to "active" and recomputes nextRunDate.
 */
export function resumeSubscription(sub: Subscription): Subscription {
  if (!canResume(sub)) return sub;
  const now = Date.now() / 1000;
  const nextRunDate = now + sub.intervalDays * 86400;
  return {
    ...sub,
    status: "active" as const,
    nextRunDate,
    pausedAt: undefined,
  };
}

/**
 * Cancel a subscription — sets status to "cancelled" and records the reason.
 */
export function cancelSubscription(
  sub: Subscription,
  reason: SubscriptionCancellationReason,
  note?: string
): Subscription {
  if (!canCancel(sub)) return sub;
  const cancelledAt = Date.now() / 1000;
  pushNotification({
    title: "Subscription cancelled",
    body: `Your ${formatFrequency(sub.frequency).toLowerCase()} subscription has been cancelled.`,
    kind: "subscription-cancelled",
    subscriptionId: sub.id,
  });
  return {
    ...sub,
    status: "cancelled" as const,
    cancelledAt,
    cancellationReason: reason,
    cancellationNote: note,
  };
}

/**
 * Apply modifications immediately and recompute nextRunDate.
 */
export function modifySubscription(
  sub: Subscription,
  changes: Partial<
    Pick<
      Subscription,
      "frequency" | "intervalDays" | "recipients" | "totalUsdcCollected"
    >
  >
): Subscription {
  const updated: Subscription = { ...sub, ...changes };
  const intervalDays =
    changes.intervalDays ??
    (changes.frequency ? frequencyToIntervalDays(changes.frequency) : sub.intervalDays);
  const now = Date.now() / 1000;
  return {
    ...updated,
    intervalDays,
    nextRunDate: now + intervalDays * 86400,
  };
}

/**
 * Emit a billing notification when an invoice is generated.
 */
export function notifyInvoiceGenerated(
  sub: Subscription,
  invoice: SubscriptionInvoice
): void {
  pushNotification({
    title: "Invoice generated",
    body: `An invoice of ${formatAmount(invoice.amount)} was generated for your subscription.`,
    kind: "invoice-generated",
    subscriptionId: sub.id,
    invoiceId: invoice.id,
  });
}

export interface SubscriptionAnalytics {
  countsByStatus: Record<SubscriptionStatus, number>;
  total: number;
  mrr: bigint;
  churnRate: number;
  cancellationReasons: Record<string, number>;
}

/**
 * Aggregate subscription analytics for the dashboard.
 */
export function aggregateSubscriptionAnalytics(
  subs: Subscription[]
): SubscriptionAnalytics {
  const countsByStatus: Record<SubscriptionStatus, number> = {
    active: 0,
    paused: 0,
    cancelled: 0,
  };
  const cancellationReasons: Record<string, number> = {};
  let mrr = BigInt(0);

  for (const sub of subs) {
    countsByStatus[sub.status] = (countsByStatus[sub.status] ?? 0) + 1;

    if (sub.status === "active") {
      const perRun = sub.recipients.reduce((sum, r) => sum + r.amount, BigInt(0));
      const runsPerMonth = 30 / sub.intervalDays;
      mrr += BigInt(Math.round(Number(perRun) * runsPerMonth));
    }

    if (sub.status === "cancelled" && sub.cancellationReason) {
      cancellationReasons[sub.cancellationReason] =
        (cancellationReasons[sub.cancellationReason] ?? 0) + 1;
    }
  }

  const total = subs.length;
  const churnRate = total > 0 ? countsByStatus.cancelled / total : 0;

  return { countsByStatus, total, mrr, churnRate, cancellationReasons };
}

/**
 * Format a subscription for display in the list.
 */
export function formatSubscriptionForDisplay(sub: Subscription) {
  return {
    ...sub,
    totalUsdcFormatted: formatAmount(sub.totalUsdcCollected),
    nextRunDateFormatted: new Date(sub.nextRunDate * 1000).toLocaleDateString(),
    createdAtFormatted: new Date(sub.createdAt * 1000).toLocaleDateString(),
    frequencyLabel: formatFrequency(sub.frequency),
  };
}
