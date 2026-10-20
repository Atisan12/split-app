export type ErrorKind =
  | "wallet_not_connected"
  | "invoice_not_found"
  | "rpc_timeout"
  | "not_a_cosigner"
  | "cosigner_approval_failed"
  | "unknown";

/**
 * Unified application error taxonomy.
 *
 * `AppErrorCode` is the canonical, stable set of error codes used across the
 * app. Existing `ErrorKind` / `RpcErrorKind` classifiers are kept for backward
 * compatibility and are mapped onto these codes.
 */
export type AppErrorCode =
  | "network"
  | "validation"
  | "auth"
  | "wallet"
  | "contract"
  | "rate_limit"
  | "unknown";

export type AppErrorSeverity = "info" | "warning" | "error" | "fatal";

export interface AppErrorOptions {
  code?: AppErrorCode;
  severity?: AppErrorSeverity;
  retryable?: boolean;
  /** User-safe message. Never include secrets or raw stack traces here. */
  userMessage?: string;
  /** Original error, kept for logging/debugging only. */
  cause?: unknown;
  /** Arbitrary structured context for logs (no secrets). */
  context?: Record<string, unknown>;
}

const DEFAULT_SEVERITY: Record<AppErrorCode, AppErrorSeverity> = {
  network: "warning",
  validation: "info",
  auth: "warning",
  wallet: "warning",
  contract: "error",
  rate_limit: "warning",
  unknown: "error",
};

const DEFAULT_RETRYABLE: Record<AppErrorCode, boolean> = {
  network: true,
  validation: false,
  auth: false,
  wallet: false,
  contract: false,
  rate_limit: true,
  unknown: false,
};

/**
 * Structured application error. Carries a stable code, severity, retryability
 * and a user-safe message, while retaining the original cause for logging.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly severity: AppErrorSeverity;
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = "AppError";
    this.code = options.code ?? "unknown";
    this.severity = options.severity ?? DEFAULT_SEVERITY[this.code];
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE[this.code];
    this.userMessage = options.userMessage ?? getErrorMessageTemplate(this.code);
    this.context = options.context;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      severity: this.severity,
      retryable: this.retryable,
      message: this.message,
      userMessage: this.userMessage,
      context: this.context,
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Map legacy `ErrorKind` values onto the unified taxonomy. */
export function errorKindToCode(kind: ErrorKind): AppErrorCode {
  switch (kind) {
    case "wallet_not_connected":
      return "wallet";
    case "invoice_not_found":
      return "validation";
    case "rpc_timeout":
      return "network";
    case "unknown":
    default:
      return "unknown";
  }
}

/** Map legacy `RpcErrorKind` values onto the unified taxonomy. */
export function rpcErrorKindToCode(kind: RpcErrorKind): AppErrorCode {
  switch (kind) {
    case "network":
      return "network";
    case "contract":
      return "contract";
    case "unknown":
    default:
      return "unknown";
  }
}

const ERROR_MESSAGE_TEMPLATES: Record<AppErrorCode, string> = {
  network: "We couldn't reach the network. Check your connection and try again.",
  validation: "Some of the information provided isn't valid. Please review and try again.",
  auth: "You need to sign in to continue.",
  wallet: "Connect your Freighter wallet to continue.",
  contract: "The transaction was rejected by the network. Please review the details and try again.",
  rate_limit: "Too many requests right now. Please wait a moment and try again.",
  unknown: "Something went wrong. Please try again.",
};

/** Return the user-safe message template for a given error code. */
export function getErrorMessageTemplate(code: AppErrorCode): string {
  return ERROR_MESSAGE_TEMPLATES[code] ?? ERROR_MESSAGE_TEMPLATES.unknown;
}

const RECOVERY_SUGGESTIONS: Record<AppErrorCode, string[]> = {
  network: [
    "Check your internet connection.",
    "Wait a few seconds and retry.",
  ],
  validation: [
    "Review the highlighted fields for mistakes.",
    "Correct the values and submit again.",
  ],
  auth: [
    "Sign in with your account.",
    "If your session expired, sign in again.",
  ],
  wallet: [
    "Install or unlock the Freighter wallet extension.",
    "Connect your wallet and retry.",
  ],
  contract: [
    "Review the transaction details before retrying.",
    "Ensure your account has sufficient balance and trustlines.",
  ],
  rate_limit: [
    "Wait a moment before trying again.",
    "Avoid repeated rapid submissions.",
  ],
  unknown: [
    "Try again in a moment.",
    "If the problem persists, contact support with the error details.",
  ],
};

/** Return ordered recovery suggestions for a given error code. */
export function getRecoverySuggestions(code: AppErrorCode): string[] {
  return [...(RECOVERY_SUGGESTIONS[code] ?? RECOVERY_SUGGESTIONS.unknown)];
}

/** Normalize any thrown value into an `AppError`. */
export function toAppError(error: unknown, options: AppErrorOptions = {}): AppError {
  if (isAppError(error)) return error;

  const text = error instanceof Error ? error.message : String(error);
  const classified = classifyError(error);
  const code = options.code ?? errorKindToCode(classified.kind);

  return new AppError(text || getErrorMessageTemplate(code), {
    ...options,
    code,
    cause: options.cause ?? error,
  });
}

export interface ErrorLogEntry {
  timestamp: string;
  code: AppErrorCode;
  severity: AppErrorSeverity;
  retryable: boolean;
  message: string;
  userMessage: string;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export interface ErrorLogger {
  log(entry: ErrorLogEntry): void;
}

const consoleErrorLogger: ErrorLogger = {
  log(entry) {
    // eslint-disable-next-line no-console
    console.error("[AppError]", entry);
  },
};

let activeLogger: ErrorLogger = consoleErrorLogger;

/** Replace the active logger (useful for tests / telemetry backends). */
export function setErrorLogger(logger: ErrorLogger | null): void {
  activeLogger = logger ?? consoleErrorLogger;
}

/** Structured logger helper. Never throws. */
export function logError(error: unknown, context?: Record<string, unknown>): ErrorLogEntry {
  const appError = toAppError(error, { context });
  const entry: ErrorLogEntry = {
    timestamp: new Date().toISOString(),
    code: appError.code,
    severity: appError.severity,
    retryable: appError.retryable,
    message: appError.message,
    userMessage: appError.userMessage,
    context: appError.context,
    cause: (appError as { cause?: unknown }).cause,
  };

  try {
    activeLogger.log(entry);
  } catch {
    // Logging must never break the app.
  }

  return entry;
}

export interface RetryMetrics {
  attempts: number;
  successes: number;
  failures: number;
  retries: number;
  totalLatencyMs: number;
}

const retryMetrics: RetryMetrics = {
  attempts: 0,
  successes: 0,
  failures: 0,
  retries: 0,
  totalLatencyMs: 0,
};

/** Snapshot of in-memory retry metrics for debugging. */
export function getRetryMetrics(): RetryMetrics {
  return { ...retryMetrics };
}

/** Reset in-memory retry metrics (useful for tests). */
export function resetRetryMetrics(): void {
  retryMetrics.attempts = 0;
  retryMetrics.successes = 0;
  retryMetrics.failures = 0;
  retryMetrics.retries = 0;
  retryMetrics.totalLatencyMs = 0;
}

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default 300. */
  baseDelayMs?: number;
  /** Maximum delay in ms between attempts. Default 5000. */
  maxDelayMs?: number;
  /** Jitter factor (0..1) applied to each delay. Default 0.2. */
  jitter?: number;
  /** Predicate deciding whether an error is retryable. Default: AppError.retryable. */
  isRetryable?: (error: unknown) => boolean;
  /** Optional abort signal to cancel retries. */
  signal?: AbortSignal;
  /** Called before each retry with the upcoming attempt number and delay. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Injectable sleep for tests. Default: setTimeout-based. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function defaultIsRetryable(error: unknown): boolean {
  if (isAppError(error)) return error.retryable;
  const classified = classifyError(error);
  return errorKindToCode(classified.kind) === "network";
}

/** Compute the backoff delay for a given attempt (1-based). */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitterAmount = exponential * Math.min(1, Math.max(0, jitter));
  return Math.round(exponential - jitterAmount + random() * jitterAmount * 2);
}

/**
 * Retry an async operation with exponential backoff and jitter.
 * Records metrics and notifies via `onRetry`. Never retries more than
 * `maxAttempts` times and respects cancellation via `signal`.
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 5000,
    jitter = 0.2,
    isRetryable = defaultIsRetryable,
    signal,
    onRetry,
    sleep = defaultSleep,
  } = options;

  const attemptsLimit = Math.max(1, Math.floor(maxAttempts));
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted");
    }

    retryMetrics.attempts += 1;

    try {
      const result = await operation(attempt);
      retryMetrics.successes += 1;
      retryMetrics.totalLatencyMs += Date.now() - startedAt;
      return result;
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attemptsLimit && isRetryable(error);

      if (!canRetry) {
        retryMetrics.failures += 1;
        retryMetrics.totalLatencyMs += Date.now() - startedAt;
        throw error;
      }

      retryMetrics.retries += 1;
      const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs, signal);
    }
  }

  retryMetrics.failures += 1;
  retryMetrics.totalLatencyMs += Date.now() - startedAt;
  throw lastError;
}

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
    kind: "not_a_cosigner",
    match: /not a cosigner|not a co-signer|not a designated cosigner|not a designated co-signer|cosigner not found|co-signer not found/i,
    message: "This wallet is not a designated co-signer for this invoice.",
  },
  {
    kind: "cosigner_approval_failed",
    match: /cosigner approval failed|co-signer approval failed|approval failed|failed to approve/i,
    message: "Co-signer approval could not be submitted. Please try again.",
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
