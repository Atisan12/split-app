"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  classifyError,
  getErrorTemplate,
  getRecoverySuggestions,
} from "@/lib/errors";
import { logger } from "@/lib/logger";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  const errorType = classifyError(error);
  const template = getErrorTemplate(errorType);
  const suggestions = getRecoverySuggestions(errorType);

  useEffect(() => {
    logger.error("[GlobalError]", {
      type: errorType,
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error, errorType]);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full flex flex-col items-center text-center gap-6">
        <span className="text-5xl font-bold tracking-tight text-indigo-400">
          StellarSplit
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{template.title}</h1>
          <p className="text-gray-400 text-sm">{template.message}</p>
        </div>

        {suggestions.length > 0 && (
          <ul className="w-full text-left text-sm text-gray-400 list-disc list-inside flex flex-col gap-1">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="min-h-11 px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {template.retryLabel}
          </button>
          <Link
            href="/"
            className="min-h-11 inline-flex items-center px-6 py-2 rounded-lg border border-gray-600 hover:border-gray-400 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Go Home
          </Link>
        </div>

        {process.env.NODE_ENV === "development" && (
          <details className="w-full text-left">
            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-400">
              Error details (dev only)
            </summary>
            <pre className="mt-2 p-3 bg-gray-900 rounded text-xs text-red-400 overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {error.stack ?? error.message}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}
