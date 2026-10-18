import * as Sentry from "@sentry/nextjs";
import { initPerformanceMonitoring, onPerformanceMetric, isRegression } from "./src/lib/performanceMonitoring";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    debug: false,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
  });
}

// Core Web Vitals collection + budget-regression reporting (see
// src/lib/performanceMonitoring.ts and docs/PERFORMANCE.md).
onPerformanceMetric((metric) => {
  if (dsn) {
    Sentry.setMeasurement(metric.name, metric.value, metric.name === "CLS" ? "" : "millisecond");
  }
  if (isRegression(metric.name, metric.value)) {
    if (dsn) {
      Sentry.captureMessage(`Performance budget regression: ${metric.name}=${metric.value} on ${metric.path}`, "warning");
    } else if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[perf] budget regression: ${metric.name}=${metric.value} on ${metric.path}`);
    }
  }
});
initPerformanceMonitoring();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
