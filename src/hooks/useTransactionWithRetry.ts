import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import {
  retryWithBackoff,
  isRetryableError,
  type RetryMetrics,
} from '@/utils/retryWithBackoff';

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  retryableStatusCodes?: number[];
}

const DEFAULT_OPTIONS = {
  maxRetries: 5,
  initialDelayMs: 1000,
  retryableStatusCodes: [429],
};

export function useTransactionWithRetry(options?: RetryOptions) {
  const toast = useToast();
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const [attemptCount, setAttemptCount] = useState(0);
  const [metrics, setMetrics] = useState<RetryMetrics | null>(null);
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const executeWithRetry = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      operationId: string = `op-${Date.now()}-${Math.random()}`
    ): Promise<T> => {
      let toastId: string | null = null;

      const controller = abortControllers.current.get(operationId);
      const signal = controller?.signal;

      try {
        const result = await retryWithBackoff<T>(fn, {
          maxRetries: opts.maxRetries,
          initialDelayMs: opts.initialDelayMs,
          signal,
          isRetryable: (error) =>
            isRetryableError(error, opts.retryableStatusCodes),
          onAttempt: (attempt) => {
            setAttemptCount(attempt);
          },
          onRetry: ({ attempt, delayMs, error }) => {
            const countdownSeconds = Math.ceil(delayMs / 1000);
            const reason =
              (error as any)?.response?.status === 429 ||
              (error as any)?.status === 429
                ? 'Rate limited'
                : 'Transient error';
            if (toastId) toast.dismiss(toastId);
            toastId = toast.info(
              `${reason}. Retrying in ${countdownSeconds}s... (attempt ${attempt}/${opts.maxRetries})`
            );
          },
          onMetrics: (m) => {
            setMetrics(m);
          },
        });

        if (toastId) toast.dismiss(toastId);
        return result;
      } catch (error) {
        if (toastId) toast.dismiss(toastId);

        const err = error instanceof Error ? error : new Error(String(error));
        const wasRetryable = isRetryableError(err, opts.retryableStatusCodes);

        if (wasRetryable) {
          toast.error(`${err.message}. Please try again later.`);
        } else {
          toast.error(err.message || 'Transaction failed');
        }

        throw err;
      }
    },
    [opts, toast]
  );

  const cancel = useCallback((operationId: string) => {
    const controller = abortControllers.current.get(operationId);
    if (controller) {
      controller.abort();
      abortControllers.current.delete(operationId);
    }
  }, []);

  return { executeWithRetry, cancel, attemptCount, metrics };
}
