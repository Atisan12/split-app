/**
 * Lightweight analytics helper.
 *
 * Provides a typed `trackEvent` function that safely no-ops when no analytics
 * provider is available (e.g. during SSR, tests, or when analytics is disabled).
 * Also exposes specific helpers for help content and feature flag exposure.
 */

export type AnalyticsProps = Record<string, unknown>;

export interface AnalyticsProvider {
  track: (name: string, props?: AnalyticsProps) => void;
}

let provider: AnalyticsProvider | null = null;

/**
 * Register (or clear) the analytics provider. Passing `null` disables tracking.
 */
export function setAnalyticsProvider(next: AnalyticsProvider | null): void {
  provider = next;
}

/**
 * Returns true when an analytics provider is currently registered.
 */
export function isAnalyticsAvailable(): boolean {
  return provider !== null;
}

/**
 * Track a generic event. No-ops when analytics is unavailable.
 */
export function trackEvent(name: string, props?: AnalyticsProps): void {
  if (!provider) {
    return;
  }
  try {
    provider.track(name, props);
  } catch {
    // Analytics must never break the app.
  }
}

/**
 * Track that a contextual help entry was opened.
 */
export function trackHelpOpened(helpKey: string): void {
  trackEvent('help_opened', { helpKey });
}

/**
 * Track that a user was exposed to a feature flag variant.
 */
export function trackFeatureFlagExposure(flagKey: string, variant: string): void {
  trackEvent('feature_flag_exposure', { flagKey, variant });
}