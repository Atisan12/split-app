"use client";

/**
 * Centralized fetch wrapper for mutating API calls. Injects the
 * `X-CSRF-Token` header (see src/lib/csrf.ts / src/lib/middleware/csrfMiddleware.ts)
 * on POST/PUT/PATCH/DELETE requests, refreshing the cached token before it
 * expires and transparently retrying once if a request is rejected with 403
 * because the token expired mid-flight.
 *
 * Non-OK responses are surfaced as `AppError` instances (see src/lib/errors.ts)
 * so callers get a stable error code, a user-friendly message and recovery
 * suggestions. Transient failures (network errors, 5xx, 429) are retried with
 * exponential backoff + jitter via `retryWithBackoff` (see src/lib/retry.ts),
 * and retry attempts are announced through `onRetry` so the UI can toast.
 */

import { AppError, ErrorCode, type ErrorCodeValue } from "@/lib/errors";
import { retryWithBackoff, type RetryEvent } from "@/lib/retry";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Options controlling retry behaviour and notifications for `apiFetch`. */
export interface ApiFetchOptions extends RequestInit {
  /** Maximum number of retry attempts for transient failures. Defaults to 3. */
  maxRetries?: number;
  /** Base delay (ms) for exponential backoff. Defaults to 300ms. */
  baseDelayMs?: number;
  /** Maximum delay (ms) between retries. Defaults to 10_000ms. */
  maxDelayMs?: number;
  /** Invoked before each retry so the UI can notify the user. */
  onRetry?: (event: RetryEvent) => void;
}

/** Maps an HTTP status code to the closest matching `AppError` code. */
export function statusToErrorCode(status: number): ErrorCodeValue {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      if (status >= 500) return ErrorCode.SERVER;
      return ErrorCode.UNKNOWN;
  }
}

/** True for failures worth retrying: network errors, 5xx and 429. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function toAppError(response: Response): Promise<AppError> {
  let detail: string | undefined;
  try {
    const body = await response.clone().json();
    detail = typeof body?.message === "string" ? body.message : undefined;
  } catch {
    // Body was not JSON; fall back to the status text.
    detail = response.statusText || undefined;
  }
  return new AppError(statusToErrorCode(response.status), {
    status: response.status,
    detail,
    cause: response,
  });
}

// Refresh a little early so a request that starts right before expiry
// doesn't race the server-side clock.
const REFRESH_SKEW_MS = 60 * 1000;

let cachedToken: string | null = null;
let cachedExpiresAt = 0;
let inflightFetch: Promise<string> | null = null;

async function fetchFreshToken(): Promise<string> {
  const response = await fetch("/api/csrf");
  if (!response.ok) {
    throw new Error("Failed to fetch CSRF token");
  }
  const data = await response.json();
  cachedToken = data.token;
  cachedExpiresAt = data.expiresAt;
  return data.token;
}

export async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < cachedExpiresAt - REFRESH_SKEW_MS) {
    return cachedToken;
  }
  if (!forceRefresh && inflightFetch) {
    return inflightFetch;
  }

  inflightFetch = fetchFreshToken().finally(() => {
    inflightFetch = null;
  });
  return inflightFetch;
}

export function getCachedCsrfExpiry(): number {
  return cachedExpiresAt;
}

/**
 * fetch() wrapper that attaches a CSRF token to mutating requests and
 * retries once, with a freshly-fetched token, if the server rejects the
 * first attempt with 403.
 *
 * Transient failures (network errors, 5xx, 429) are retried with exponential
 * backoff and jitter. Once retries are exhausted (or for non-retryable
 * failures) a non-OK response is thrown as an `AppError`.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: ApiFetchOptions = {},
): Promise<Response> {
  const { maxRetries, baseDelayMs, maxDelayMs, onRetry, ...requestInit } = init;
  const method = (requestInit.method ?? "GET").toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return fetch(input, requestInit);
  }

  const attempt = async (token: string) => {
    const headers = new Headers(requestInit.headers);
    headers.set("X-CSRF-Token", token);
    return fetch(input, { ...requestInit, headers });
  };

  // Single CSRF retry: refresh the token and try again on a 403.
  const attemptWithCsrfRetry = async (): Promise<Response> => {
    const token = await getCsrfToken();
    const response = await attempt(token);
    if (response.status !== 403) {
      return response;
    }
    const freshToken = await getCsrfToken(true);
    return attempt(freshToken);
  };

  const response = await retryWithBackoff(
    async () => {
      const res = await attemptWithCsrfRetry();
      if (!res.ok && isRetryableStatus(res.status)) {
        // Throw so the retry handler treats it as a transient failure.
        throw await toAppError(res);
      }
      return res;
    },
    {
      maxRetries,
      baseDelayMs,
      maxDelayMs,
      onRetry,
      isRetryable: (error) =>
        error instanceof AppError
          ? error.status !== undefined && isRetryableStatus(error.status)
          : true, // network errors are retryable
    },
  );

  if (!response.ok) {
    throw await toAppError(response);
  }
  return response;
}
