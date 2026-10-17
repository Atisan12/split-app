export type ErrorKind =
  | "wallet_not_connected"
  | "invoice_not_found"
  | "rpc_timeout"
  | "ledger_not_connected"
  | "ledger_locked"
  | "ledger_app_not_open"
  | "ledger_denied"
  | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
}

const PATTERNS: { kind: ErrorKind; match: RegExp; message: string }[] = [
  {
    kind: "wallet_not_connected",
    match: /wallet not connected|connect your freighter|freighter.*not connected/i,
    message: "Connect your Freighter wallet to continue.",
  },
  {
    kind: "invoice_not_found",
    match: /invoice not found|not found on-chain/i,
    message: "This invoice could not be found on-chain.",
  },
  {
    kind: "rpc_timeout",
    match: /rpc timeout|timed out|timeout/i,
    message: "The Stellar RPC request timed out. Please try again.",
  },
  {
    kind: "ledger_not_connected",
    match: /ledger.*not connected|no ledger device|ledger device not found|device not found|disconnected/i,
    message: "Connect your Ledger device and try again.",
  },
  {
    kind: "ledger_locked",
    match: /ledger.*locked|device.*locked|unlock your ledger/i,
    message: "Unlock your Ledger device to continue.",
  },
  {
    kind: "ledger_app_not_open",
    match: /ledger.*app.*not open|open the stellar app|stellar app.*not open|app is not open/i,
    message: "Open the Stellar app on your Ledger device to continue.",
  },
  {
    kind: "ledger_denied",
    match: /ledger.*denied|user denied|rejected on device|transaction rejected|denied on device/i,
    message: "The transaction was rejected on your Ledger device.",
  },
];

export function classifyError(error: unknown): ClassifiedError {
  const text = error instanceof Error ? error.message : String(error);

  for (const { kind, match, message } of PATTERNS) {
    if (match.test(text)) {
      return { kind, message };
    }
  }

  return {
    kind: "unknown",
    message: text || "Something went wrong. Please try again.",
  };
}

/**
 * Separate, additive classifier for Stellar RPC failures (used by
 * StellarErrorBoundary / useStellarQuery). Kept independent from
 * classifyError/ErrorKind above so the app-wide ErrorBoundary's exhaustive
 * kind switch is never at risk of an unhandled case.
 */
export type RpcErrorKind = "network" | "contract" | "unknown";

export interface ClassifiedRpcError {
  kind: RpcErrorKind;
  message: string;
}

const NETWORK_PATTERN = /timed out|timeout|network error|failed to fetch|econnrefused|503|service unavailable|no internet|offline/i;

function getHorizonResultCodes(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response;
  return response?.data?.extras?.result_codes;
}

export function classifyRpcError(error: unknown): ClassifiedRpcError {
  const text = error instanceof Error ? error.message : String(error);
  const resultCodes = getHorizonResultCodes(error);

  if (resultCodes) {
    return {
      kind: "contract",
      message: "The transaction was rejected by the network. Please review the details and try again.",
    };
  }

  if (NETWORK_PATTERN.test(text)) {
    return {
      kind: "network",
      message: "Couldn't reach the Stellar network. This is usually temporary.",
    };
  }

  return {
    kind: "unknown",
    message: text || "Something went wrong talking to Stellar.",
  };
}
