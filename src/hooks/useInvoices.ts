"use client";

import { useCallback, useEffect, useState } from "react";
import type { Invoice } from "@stellar-split/sdk";
import {
  clearInvoiceCache,
  getCachedInvoices,
  putCachedInvoices,
  QuotaExceededCacheError,
} from "@/lib/db/invoiceCache";
import { useToast } from "@/contexts/ToastContext";
import { trackEvent } from "@/lib/analytics";

export interface UseInvoicesResult {
  invoices: Invoice[];
  /** True until either the cache or the network has produced a first result. */
  loading: boolean;
  /** True while the network request is in flight, even after cached data painted. */
  refreshing: boolean;
  error: string | null;
  /** Wipes the IndexedDB cache; the next render still shows in-memory invoices. */
  clearCache: () => Promise<void>;
}

/**
 * useInvoices — cache-then-network invoice list for a wallet address.
 *
 * On mount, cached invoices (if any) render immediately from IndexedDB while
 * the API request is in flight. When the API responds it becomes the
 * rendered list and is written back to the cache for the next cold load.
 */
export function useInvoices(publicKey: string | null | undefined): UseInvoicesResult {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let active = true;

    if (!publicKey) {
      setInvoices([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // Fire-and-forget: never await analytics so the data fetch is not delayed.
    trackEvent("wallet_connected");

    setLoading(true);
    setRefreshing(true);

    getCachedInvoices(publicKey).then((cached) => {
      if (!active) return;
      if (cached.length > 0) {
        setInvoices(cached);
        setLoading(false);
      }
    });

    fetch(`/api/invoices?publicKey=${encodeURIComponent(publicKey)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch invoices (${res.status})`);
        return res.json() as Promise<{ invoices: Invoice[] }>;
      })
      .then(async (data) => {
        if (!active) return;
        setInvoices(data.invoices);
        setError(null);

        // Fire-and-forget analytics with non-identifying custom properties.
        const statusBreakdown: Record<string, number> = {};
        for (const invoice of data.invoices) {
          const status = String(invoice.status ?? "unknown");
          statusBreakdown[status] = (statusBreakdown[status] ?? 0) + 1;
        }
        trackEvent("invoice_list_viewed", {
          count: data.invoices.length,
          statusBreakdown,
        });
        for (const invoice of data.invoices) {
          trackEvent("invoice_created", {
            status: String(invoice.status ?? "unknown"),
          });
        }
        try {
          await putCachedInvoices(publicKey, data.invoices);
        } catch (err) {
          if (err instanceof QuotaExceededCacheError) {
            toast.info("Storage is full — invoice caching is disabled for this session.");
          }
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  const clearCache = useCallback(async () => {
    await clearInvoiceCache();
  }, []);

  return { invoices, loading, refreshing, error, clearCache };
}

export default useInvoices;
