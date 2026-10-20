export type AuditCategory = "invoice" | "payment" | "auth" | "settings" | "admin";

export interface AuditEntry {
  id: string;
  timestamp: number;
  actor: string;
  action: string;
  category: AuditCategory;
  target?: string;
  details?: string;
}

export interface AuditFilter {
  query?: string;
  category?: AuditCategory | "all";
  from?: number;
  to?: number;
}

export function filterAuditEntries(entries: AuditEntry[], filter: AuditFilter = {}): AuditEntry[] {
  const q = filter.query?.trim().toLowerCase() ?? "";
  return entries
    .filter((e) => !filter.category || filter.category === "all" || e.category === filter.category)
    .filter((e) => filter.from === undefined || e.timestamp >= filter.from)
    .filter((e) => filter.to === undefined || e.timestamp <= filter.to)
    .filter(
      (e) =>
        !q ||
        [e.actor, e.action, e.target, e.details].some((f) => f?.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.timestamp - a.timestamp);
}

export interface InvoiceAmendmentAuditInput {
  id: string;
  timestamp?: number;
  actor: string;
  invoiceId: string;
  reason: string;
  changedFields: string[];
  comment?: string;
  version?: number;
}

export function createInvoiceAmendmentAuditEntry(input: InvoiceAmendmentAuditInput): AuditEntry {
  const parts: string[] = [`Reason: ${input.reason}`];
  if (input.changedFields.length > 0) {
    parts.push(`Changed fields: ${input.changedFields.join(", ")}`);
  }
  if (input.version !== undefined) {
    parts.push(`Version: ${input.version}`);
  }
  if (input.comment) {
    parts.push(`Comment: ${input.comment}`);
  }
  return {
    id: input.id,
    timestamp: input.timestamp ?? Date.now(),
    actor: input.actor,
    action: "invoice_amended",
    category: "invoice",
    target: input.invoiceId,
    details: parts.join(" | "),
  };
}

export function appendInvoiceAmendmentAuditEntry(
  entries: AuditEntry[],
  input: InvoiceAmendmentAuditInput,
): AuditEntry[] {
  return [...entries, createInvoiceAmendmentAuditEntry(input)];
}

export function filterAuditEntriesByInvoice(
  entries: AuditEntry[],
  invoiceId: string,
): AuditEntry[] {
  return entries
    .filter((e) => e.category === "invoice" && e.target === invoiceId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function auditEntriesToCsv(entries: AuditEntry[]): string {
  const header = "timestamp,actor,category,action,target,details";
  const rows = entries.map((e) =>
    [new Date(e.timestamp).toISOString(), e.actor, e.category, e.action, e.target ?? "", e.details ?? ""]
      .map(csvCell)
      .join(","),
  );
  return [header, ...rows].join("\n");
}