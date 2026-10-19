import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * Keys that may contain personally identifiable information.
 * These are scrubbed from event payloads before they are sent to Sentry.
 */
const PII_KEYS = [
  "email",
  "phone",
  "name",
  "firstName",
  "lastName",
  "address",
  "ip",
  "ipAddress",
  "wallet",
  "walletAddress",
  "publicKey",
  "privateKey",
  "secret",
  "password",
  "token",
  "authorization",
  "cookie",
];

const REDACTED = "[REDACTED]";

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8 || value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.some((piiKey) => key.toLowerCase() === piiKey.toLowerCase())) {
        result[key] = REDACTED;
      } else {
        result[key] = scrubValue(val, depth + 1);
      }
    }
    return result;
  }

  return value;
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  if (event.user) {
    // Only keep the hashed wallet identifier; drop everything else.
    event.user = event.user.id ? { id: event.user.id } : {};
  }

  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      data: breadcrumb.data
        ? (scrubValue(breadcrumb.data) as Record<string, unknown>)
        : breadcrumb.data,
    }));
  }

  return event;
}

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    debug: false,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeSendTransaction(event) {
      return scrubEvent(event);
    },
  });
}

/**
 * Associates the current Sentry scope with a hashed wallet identifier.
 * The raw wallet address must never be passed here; callers are expected
 * to provide a one-way hash so no PII leaves the client.
 */
export function setUser(hashedWalletId: string | null): void {
  if (!dsn) {
    return;
  }

  if (hashedWalletId) {
    Sentry.setUser({ id: hashedWalletId });
  } else {
    Sentry.setUser(null);
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;