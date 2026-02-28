/**
 * SvelteKit Server Hooks — Martol
 *
 * Per-request auth, DB connection, session enrichment, CORS, security headers.
 */

import type { Handle } from '@sveltejs/kit';
import type { CloudflareEnv } from './app.d.ts';

// Detect Cloudflare Workers (has caches.default)
const isCloudflareWorkers = typeof caches !== 'undefined' && 'default' in caches;

// Load .dev.vars for local development ONLY
if (!isCloudflareWorkers) {
	try {
		const dotenv = await import('dotenv');
		const result = dotenv.config({ path: '.dev.vars' });
		if (!result.error) {
			console.log('[Startup] dotenv loaded from .dev.vars');
		}
	} catch {
		// Expected if fs is not available
	}
}

import { createAuth } from '$lib/server/auth';

// Capacitor and localhost origins allowed for CORS
const ALLOWED_ORIGINS = new Set([
	'http://localhost:5190',
	'http://127.0.0.1:5190',
	'capacitor://martol.app',
	'https://martol.app',
	'https://martol.plitix.com'
]);

export const handle: Handle = async ({ event, resolve }) => {
	// CORS: Allow Capacitor schemes + localhost
	const origin = event.request.headers.get('origin');
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		if (event.request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': origin,
					'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
					'Access-Control-Allow-Credentials': 'true',
					'Access-Control-Max-Age': '86400'
				}
			});
		}
	}

	const platform = event.platform;
	const hasHyperdrive = platform?.env?.HYPERDRIVE;
	const hasLocalEnv = process.env.PG_HOST && process.env.BETTER_AUTH_SECRET;

	// Initialize locals
	event.locals.user = null;
	event.locals.session = null;
	event.locals.db = null;

	// Track Hyperdrive client for cleanup after request
	let hyperdriveClient: import('pg').Client | null = null;

	if (hasHyperdrive) {
		// Cloudflare Workers with Hyperdrive (production & wrangler dev)
		const env = platform!.env as CloudflareEnv;

		const { createHyperdriveDb } = await import('$lib/server/db/hyperdrive');
		const { db, client, connectPromise } = createHyperdriveDb(env.HYPERDRIVE);
		await connectPromise;
		hyperdriveClient = client;

		event.locals.db = db;

		const auth = createAuth(
			db,
			env.BETTER_AUTH_SECRET,
			event.url.origin || env.APP_BASE_URL || 'http://localhost:5190',
			{
				resendApiKey: env.RESEND_API_KEY,
				emailFrom: env.EMAIL_FROM || 'noreply@martol.app',
				emailName: env.EMAIL_NAME || 'Martol'
			},
			env.CACHE
		);

		event.locals.auth = auth;

		// Get session
		try {
			const session = await auth.api.getSession({ headers: event.request.headers });
			if (session?.session && session?.user) {
				event.locals.session = session.session;
				event.locals.user = session.user;
			}
		} catch (error) {
			console.error('[Auth] Session validation failed:', error);
		}
	} else if (hasLocalEnv) {
		// Local dev: Direct PostgreSQL connection
		const { createDirectDb } = await import('$lib/server/db/direct');
		const db = createDirectDb();

		event.locals.db = db;

		const auth = createAuth(
			db,
			process.env.BETTER_AUTH_SECRET!,
			event.url.origin || process.env.APP_BASE_URL || 'http://localhost:5190',
			{
				resendApiKey: process.env.RESEND_API_KEY,
				emailFrom: process.env.EMAIL_FROM || 'noreply@martol.app',
				emailName: process.env.EMAIL_NAME || 'Martol'
			}
		);

		event.locals.auth = auth;

		// Get session
		try {
			const session = await auth.api.getSession({ headers: event.request.headers });
			if (session?.session && session?.user) {
				event.locals.session = session.session;
				event.locals.user = session.user;
			}
		} catch (error) {
			console.error('[Auth] Session validation failed:', error);
		}
	}

	// Process the request — ensure Hyperdrive client is closed after
	try {
		const response = await resolve(event);

		// CORS headers on response
		if (origin && ALLOWED_ORIGINS.has(origin)) {
			response.headers.set('Access-Control-Allow-Origin', origin);
			response.headers.set('Access-Control-Allow-Credentials', 'true');
		}

		// Security headers
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		response.headers.set(
			'Permissions-Policy',
			'camera=(), microphone=(), geolocation=(), interest-cohort=()'
		);
		response.headers.set(
			'Strict-Transport-Security',
			'max-age=63072000; includeSubDomains; preload'
		);

		const csp = [
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline'", // Required for SvelteKit hydration; TODO: nonce-based CSP
			"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
			"img-src 'self' data: blob: https:",
			"font-src 'self' data: https://cdn.jsdelivr.net",
			"connect-src 'self' https://martol.app wss://martol.app https://martol.plitix.com wss://martol.plitix.com",
			"worker-src 'self' blob:",
			"object-src 'none'",
			"base-uri 'self'",
			"form-action 'self'",
			"frame-ancestors 'none'"
		].join('; ');

		response.headers.set('Content-Security-Policy', csp);

		return response;
	} finally {
		if (hyperdriveClient) {
			try { await hyperdriveClient.end(); } catch { /* already closed */ }
		}
	}
};
