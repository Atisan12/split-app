/**
 * App-level Stellar / Soroban configuration.
 * Mirrors env vars used by `src/lib/stellar.ts` so settings pages can import a single module.
 */

export const STELLAR_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (STELLAR_NETWORK === "mainnet"
    ? "https://soroban.stellar.org"
    : "https://soroban-testnet.stellar.org");

/** StellarSplit contract ID used for on-chain calls and event filtering. */
export const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";

/**
 * Parse a positive integer env var, falling back to a default when unset or invalid.
 */
function positiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Parse a non-negative number env var (e.g. jitter factor), falling back when invalid.
 */
function nonNegativeFloatEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Parse a boolean env var ("true"/"1" => true, "false"/"0" => false).
 */
function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

/** Retry / exponential backoff configuration. */
export interface RetryConfig {
  /** Maximum number of retry attempts after the initial failure. */
  maxRetries: number;
  /** Base delay (ms) used for the first backoff interval. */
  baseDelayMs: number;
  /** Upper bound (ms) for any single backoff interval. */
  maxDelayMs: number;
  /** Random jitter factor (0..1) applied to each delay to avoid thundering herd. */
  jitterFactor: number;
  /** Whether automatic retries are enabled. */
  enabled: boolean;
  /** Whether to surface retry notifications to the user. */
  notify: boolean;
}

/** Offline queue configuration for failed transactions. */
export interface OfflineQueueConfig {
  /** Maximum number of operations held in the queue. */
  maxSize: number;
  /** Storage key used to persist the queue across restarts. */
  storageKey: string;
  /** Whether the offline queue is enabled. */
  enabled: boolean;
  /** Whether to automatically flush the queue when connectivity is restored. */
  autoRetryOnReconnect: boolean;
  /** Whether to notify the user of queue status changes. */
  notify: boolean;
  /** Maximum age (ms) of a queued item before it is considered stale. */
  maxItemAgeMs: number;
}

/** Feature flags for retry and offline queue behavior. */
export interface RetryFeatureFlags {
  retry: boolean;
  offlineQueue: boolean;
  retryMetrics: boolean;
}

export const RETRY_CONFIG: RetryConfig = {
  maxRetries: positiveIntEnv(process.env.NEXT_PUBLIC_MAX_RETRIES, 5),
  baseDelayMs: positiveIntEnv(process.env.NEXT_PUBLIC_RETRY_BASE_DELAY_MS, 500),
  maxDelayMs: positiveIntEnv(process.env.NEXT_PUBLIC_RETRY_MAX_DELAY_MS, 30_000),
  jitterFactor: Math.min(
    1,
    nonNegativeFloatEnv(process.env.NEXT_PUBLIC_RETRY_JITTER_FACTOR, 0.2),
  ),
  enabled: boolEnv(process.env.NEXT_PUBLIC_RETRY_ENABLED, true),
  notify: boolEnv(process.env.NEXT_PUBLIC_RETRY_NOTIFY, true),
} as const;

export const OFFLINE_QUEUE_CONFIG: OfflineQueueConfig = {
  maxSize: positiveIntEnv(process.env.NEXT_PUBLIC_OFFLINE_QUEUE_MAX_SIZE, 50),
  storageKey:
    process.env.NEXT_PUBLIC_OFFLINE_QUEUE_STORAGE_KEY ?? "stellarsplit:offline-queue",
  enabled: boolEnv(process.env.NEXT_PUBLIC_OFFLINE_QUEUE_ENABLED, true),
  autoRetryOnReconnect: boolEnv(
    process.env.NEXT_PUBLIC_OFFLINE_QUEUE_AUTO_RETRY,
    true,
  ),
  notify: boolEnv(process.env.NEXT_PUBLIC_OFFLINE_QUEUE_NOTIFY, true),
  maxItemAgeMs: positiveIntEnv(
    process.env.NEXT_PUBLIC_OFFLINE_QUEUE_MAX_ITEM_AGE_MS,
    24 * 60 * 60 * 1000,
  ),
} as const;

export const RETRY_FEATURE_FLAGS: RetryFeatureFlags = {
  retry: RETRY_CONFIG.enabled,
  offlineQueue: OFFLINE_QUEUE_CONFIG.enabled,
  retryMetrics: boolEnv(process.env.NEXT_PUBLIC_RETRY_METRICS_ENABLED, true),
} as const;

export const config = {
  network: STELLAR_NETWORK,
  rpcUrl: RPC_URL,
  contractId,
  retry: RETRY_CONFIG,
  offlineQueue: OFFLINE_QUEUE_CONFIG,
  features: RETRY_FEATURE_FLAGS,
} as const;

export default config;