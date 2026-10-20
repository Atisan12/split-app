"use client";

import { useState, useCallback } from "react";
import { simulateTransaction, SimulationResult } from "@/lib/simulateTx";
import { retryWithBackoff } from "@/lib/retryWithBackoff";
import { toAppError } from "@/lib/appError";
import { useToast } from "@/context/ToastContext";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";

interface PaymentSubmissionState {
  showSimulationPreview: boolean;
  isSimulating: boolean;
  simulationResult: SimulationResult | null;
  simulationError: string | null;
}

interface UsePaymentSubmissionReturn {
  state: PaymentSubmissionState;
  initiateDemoPayment: (
    transactionXdr: string,
    onConfirm: () => Promise<any>,
    onCancel: () => void
  ) => Promise<void>;
  resetState: () => void;
}

export function usePaymentSubmission(): UsePaymentSubmissionReturn {
  const [state, setState] = useState<PaymentSubmissionState>({
    showSimulationPreview: false,
    isSimulating: false,
    simulationResult: null,
    simulationError: null,
  });

  const { notify } = useToast();
  const { enqueue } = useOfflineQueue();

  const initiateDemoPayment = useCallback(
    async (
      transactionXdr: string,
      onConfirm: () => Promise<any>,
      onCancel: () => void
    ) => {
      setState((prev) => ({
        ...prev,
        showSimulationPreview: true,
        isSimulating: true,
        simulationError: null,
      }));

      try {
        const result = await retryWithBackoff(
          () => simulateTransaction(transactionXdr),
          {
            onRetry: (attempt, error) => {
              notify({
                type: "info",
                message: `Simulation failed (${toAppError(error).message}). Retrying attempt ${attempt}...`,
              });
            },
          }
        );
        setState((prev) => ({
          ...prev,
          isSimulating: false,
          simulationResult: result,
        }));
      } catch (error) {
        const appError = toAppError(error);
        setState((prev) => ({
          ...prev,
          isSimulating: false,
          simulationError: appError.message,
        }));
      }
    },
    [notify]
  );

  const handleProceed = useCallback(
    async (onConfirm: () => Promise<any>) => {
      try {
        await retryWithBackoff(() => onConfirm(), {
          onRetry: (attempt, error) => {
            notify({
              type: "info",
              message: `Payment failed (${toAppError(error).message}). Retrying attempt ${attempt}...`,
            });
          },
        });
        resetState();
      } catch (error) {
        const appError = toAppError(error);
        if (appError.isNetworkError) {
          enqueue({ type: "payment", execute: onConfirm });
          notify({
            type: "warning",
            message: "Connection lost. Payment queued and will retry when you're back online.",
          });
        } else {
          setState((prev) => ({
            ...prev,
            simulationError: appError.message,
          }));
        }
      }
    },
    [notify, enqueue]
  );

  const handleCancel = useCallback((onCancel: () => void) => {
    onCancel();
    resetState();
  }, []);

  const handleSkip = useCallback(
    async (onConfirm: () => Promise<any>) => {
      try {
        await retryWithBackoff(() => onConfirm(), {
          onRetry: (attempt, error) => {
            notify({
              type: "info",
              message: `Payment failed (${toAppError(error).message}). Retrying attempt ${attempt}...`,
            });
          },
        });
        resetState();
      } catch (error) {
        const appError = toAppError(error);
        if (appError.isNetworkError) {
          enqueue({ type: "payment", execute: onConfirm });
          notify({
            type: "warning",
            message: "Connection lost. Payment queued and will retry when you're back online.",
          });
        } else {
          setState((prev) => ({
            ...prev,
            simulationError: appError.message,
          }));
        }
      }
    },
    [notify, enqueue]
  );

  const resetState = useCallback(() => {
    setState({
      showSimulationPreview: false,
      isSimulating: false,
      simulationResult: null,
      simulationError: null,
    });
  }, []);

  return {
    state,
    initiateDemoPayment,
    resetState,
  };
}
