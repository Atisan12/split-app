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
 * Feature flag value.
 * - `boolean`: simple on/off flag.
 * - `number` (0-100): percentage-based gradual rollout.
 * - `object`: advanced flag with optional percentage rollout and explicit allow/deny lists.
 */
export type FeatureFlagValue =
  | boolean
  | number
  | {
      enabled?: boolean;
      /** Percentage (0-100) of users for whom the flag is enabled. */
      percentage?: number;
      /** User ids that always see the flag enabled. */
      allowlist?: string[];
      /** User ids that never see the flag enabled. */
      denylist?: string[];
    };

export type FeatureFlags = Record<string, FeatureFlagValue>;

/** Context used to evaluate a feature flag for a given user/session. */
export interface FlagContext {
  /** Stable identifier for the user (used for percentage rollout bucketing). */
  userId?: string;
  /** Optional arbitrary attributes for future targeting rules. */
  attributes?: Record<string, string | number | boolean>;
}

/** Default flags used when no override is provided via env. */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  /** Example: gradual rollout of a new dashboard. */
  newDashboard: { enabled: true, percentage: 0 },
  /** Example: A/B test for the split creation flow. */
  splitCreationV2: { enabled: true, percentage: 10 },
  /** Example: analytics instrumentation toggle. */
  analytics: true,
};

/**
 * Parse a JSON feature flag map from an env string.
 * Returns `null` when the input is missing or invalid so callers can fall back to defaults.
 */
function parseFeatureFlags(raw: string | undefined): FeatureFlags | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FeatureFlags;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Feature flags resolved from `NEXT_PUBLIC_FEATURE_FLAGS` (JSON), merged over defaults.
 * Env-provided flags override matching default keys.
 */
export const FEATURE_FLAGS: FeatureFlags = {
  ...DEFAULT_FEATURE_FLAGS,
  ...(parseFeatureFlags(process.env.NEXT_PUBLIC_FEATURE_FLAGS) ?? {}),
};

/**
 * Stable, deterministic 32-bit hash of a string (FNV-1a).
 * Used to bucket users for percentage-based rollouts so the same user
 * consistently receives the same flag evaluation.
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit integer.
  return hash >>> 0;
}

/** Map a user id to a bucket in the range [0, 100). */
function bucketFor(userId: string, key: string): number {
  // Include the flag key so different flags bucket users independently.
  return stableHash(`${key}:${userId}`) % 100;
}

/**
 * Evaluate a feature flag.
 *
 * @param key     Flag name.
 * @param context Optional evaluation context (userId enables percentage rollout).
 * @returns `true` when the flag is enabled for the given context.
 */
export function isFlagEnabled(key: string, context?: FlagContext): boolean {
  const flag = FEATURE_FLAGS[key];
  if (flag === undefined) return false;

  // Simple boolean flag.
  if (typeof flag === "boolean") return flag;

  // Percentage-only flag.
  if (typeof flag === "number") {
    return evaluatePercentage(flag, key, context);
  }

  // Advanced object flag.
  const userId = context?.userId;

  if (userId && flag.denylist?.includes(userId)) return false;
  if (userId && flag.allowlist?.includes(userId)) return true;

  if (flag.enabled === false) return false;

  if (typeof flag.percentage === "number") {
    return evaluatePercentage(flag.percentage, key, context);
  }

  return flag.enabled ?? false;
}

function evaluatePercentage(
  percentage: number,
  key: string,
  context?: FlagContext,
): boolean {
  if (percentage <= 0) return false;
  if (percentage >= 100) return true;

  const userId = context?.userId;
  // Without a stable user id we cannot bucket deterministically; default to off.
  if (!userId) return false;

  return bucketFor(userId, key) < percentage;
}

export const config = {
  network: STELLAR_NETWORK,
  rpcUrl: RPC_URL,
  contractId,
  featureFlags: FEATURE_FLAGS,
} as const;

export default config;