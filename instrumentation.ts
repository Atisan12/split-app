import * as Sentry from "@sentry/nextjs";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const WALLET_REGEX = /\b0x[a-fA-F0-9]{40}\b/g;
const COOKIE_REGEX = /(cookie|set-cookie|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi;

function scrubString(value: string): string {
  return value
    .replace(EMAIL_REGEX, "[Filtered Email]")
    .replace(WALLET_REGEX, "[Filtered Wallet]")
    .replace(COOKIE_REGEX, "$1: [Filtered]");
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[Truncated]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("cookie") ||
        lowerKey.includes("authorization") ||
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token")
      ) {
        result[key] = "[Filtered]";
      } else {
        result[key] = scrubValue(val, depth + 1);
      }
    }
    return result;
  }
  return value;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.request) {
    if (event.request.headers) {
      event.request.headers = scrubValue(event.request.headers) as Record<string, string>;
    }
    if (event.request.cookies) {
      event.request.cookies = "[Filtered]";
    }
    if (event.request.data) {
      event.request.data = scrubValue(event.request.data);
    }
    if (event.request.query_string) {
      event.request.query_string = scrubString(String(event.request.query_string));
    }
  }

  if (event.user) {
    event.user = {
      id: event.user.id,
    };
  }

  if (event.message) {
    event.message = scrubString(event.message);
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((exception) => ({
      ...exception,
      value: exception.value ? scrubString(exception.value) : exception.value,
    }));
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      message: breadcrumb.message ? scrubString(breadcrumb.message) : breadcrumb.message,
      data: breadcrumb.data ? (scrubValue(breadcrumb.data) as Record<string, unknown>) : breadcrumb.data,
    }));
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as Record<string, Record<string, unknown>>;
  }

  return event;
}

function initSentry(dsn: string) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.SENTRY_RELEASE,
    tracesSampleRate: 0.1,
    debug: false,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === "console") {
        return null;
      }
      if (breadcrumb.message) {
        breadcrumb.message = scrubString(breadcrumb.message);
      }
      if (breadcrumb.data) {
        breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
      }
      return breadcrumb;
    },
    initialScope: {
      tags: {
        service: "web",
        org: process.env.NEXT_PUBLIC_SENTRY_ORG ?? "unknown",
        project: process.env.NEXT_PUBLIC_SENTRY_PROJECT ?? "unknown",
      },
    },
    integrations: (integrations) =>
      integrations.filter((integration) => integration.name !== "Breadcrumbs" || true),
    normalizeDepth: 10,
    maxBreadcrumbs: 50,
    attachStacktrace: true,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
    ],
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^moz-extension:\/\//i,
    ],
  });
}

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    initSentry(dsn);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    initSentry(dsn);
  }
}