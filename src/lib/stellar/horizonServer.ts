/**
 * Server-only invoice fetching, shared by the RSC invoice list page and
 * `/api/invoices`. Runs the same scan/filter logic either as a direct
 * function call from a Server Component (no HTTP round trip) or from the
 * route handler (for the client-side infinite-scroll dashboard).
 */
import { splitClient } from "@/lib/stellar";
import { blockchainCache } from "@/lib/blockchainCache";
import type { Invoice } from "@stellar-split/sdk";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface FetchInvoicesOptions {
  cursor?: string | null;
  limit?: number;
  /** Case-insensitive prefix match against title/memo. */
  q?: string;
}

export interface FetchInvoicesResult {
  invoices: Invoice[];
  nextCursor: string | null;
}

/**
 * Scans invoice ids starting after `cursor`, returning up to `limit`
 * invoices owned by (created by or a recipient of) `publicKey`.
 */
export async function fetchInvoicesForAddress(
  publicKey: string,
  { cursor, limit: limitParam, q: qParam }: FetchInvoicesOptions = {}
): Promise<FetchInvoicesResult> {
  const limit = Math.min(Math.max(1, limitParam ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const q = (qParam ?? "").trim().toLowerCase();
  const startId = cursor ? parseInt(cursor, 10) + 1 : 1;

  const results: Invoice[] = [];
  const maxId = startId + limit * 10;
  // Fetch ids in parallel batches instead of one-by-one sequential awaits:
  // each `getInvoice` is an independent RPC/cache call, so awaiting them
  // serially in a for-loop (the previous behavior) multiplies round-trip
  // latency by the number of ids scanned. Batching with Promise.all lets
  // the cache/RPC calls for a batch fly concurrently.
  const BATCH_SIZE = 10;
  let reachedEnd = false;

  for (let batchStart = startId; results.length < limit && batchStart <= maxId && !reachedEnd; batchStart += BATCH_SIZE) {
    const batchIds = Array.from(
      { length: Math.min(BATCH_SIZE, maxId - batchStart + 1) },
      (_, i) => batchStart + i
    );

    const batchResults = await Promise.all(
      batchIds.map(async (id) => {
        try {
          // Cached: the dashboard/infinite-scroll list re-scans the same id
          // range on every page load and poll, so this collapses repeat RPC
          // calls for invoices that haven't changed in the last few seconds.
          const inv = await blockchainCache.getOrFetch("invoice", String(id), () =>
            splitClient.getInvoice(String(id))
          );
          return { id, inv, ended: false };
        } catch {
          // splitClient throws when the invoice id does not exist — end of list.
          return { id, inv: null, ended: true };
        }
      })
    );

    for (const { inv, ended } of batchResults) {
      if (ended) {
        reachedEnd = true;
        break;
      }
      if (!inv) continue;

      const mine =
        inv.creator === publicKey || inv.recipients.some((r) => r.address === publicKey);

      if (mine) {
        if (q) {
          const invExt = inv as { title?: string; memo?: string };
          const matchesQuery =
            (invExt.title || "").toLowerCase().startsWith(q) || (invExt.memo || "").toLowerCase().startsWith(q);
          if (matchesQuery) results.push(inv);
        } else {
          results.push(inv);
        }
      }
      if (results.length >= limit) break;
    }
  }

  const nextCursor = results.length === limit ? String(results[results.length - 1].id) : null;
  return { invoices: results.slice(0, limit), nextCursor };
}
