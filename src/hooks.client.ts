/**
 * SvelteKit Client Hooks — Martol
 *
 * Sentry error tracking for the browser client.
 */

import * as Sentry from '@sentry/sveltekit';

Sentry.init({
	dsn: import.meta.env.VITE_SENTRY_DSN,
	tracesSampleRate: 0.1,
	replaysSessionSampleRate: 0,
	replaysOnErrorSampleRate: 0
});

export const handleError = Sentry.handleErrorWithSentry();
