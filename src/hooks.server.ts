/**
 * SvelteKit Server Hooks — Martol
 *
 * Per-request auth, DB connection, session enrichment, CORS, security headers.
 */

import type { Handle } from '@sveltejs/kit';
import type { CloudflareEnv } from './app.d.ts';

// Load .dev.vars for local development ONLY (Vite dev server).
// In Cloudflare Workers, env vars come from wrangler secrets/.dev.vars binding.
// NOTE: dotenv is NOT imported here — Vite's built-in env loading or
// --env-file flag handles .dev.vars in local dev. This avoids bundling
// dotenv (which uses node:fs) into the Cloudflare Workers output.

import { createAuth } from '$lib/server/auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { isDisposableEmail } from '$lib/server/disposable-emails';

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

	// ── OTP Rate Limiting ──────────────────────────────────────────────────
	// Intercept OTP endpoints BEFORE they reach Better Auth.
	// All blocked requests return consistent responses to prevent enumeration.
	const isOtpSend =
		event.url.pathname === '/api/auth/email-otp/send-verification-otp' &&
		event.request.method === 'POST';
	const isOtpVerify =
		event.url.pathname === '/api/auth/sign-in/email-otp' &&
		event.request.method === 'POST';

	if (isOtpSend || isOtpVerify) {
		// ── Turnstile CAPTCHA verification ──
		const turnstileSecret =
			event.platform?.env?.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY;
		if (turnstileSecret) {
			const captchaToken = event.request.headers.get('x-captcha-response');
			if (!captchaToken) {
				return new Response(
					JSON.stringify({ error: { message: 'CAPTCHA verification required' } }),
					{ status: 400, headers: { 'Content-Type': 'application/json' } }
				);
			}
			try {
				const verifyRes = await fetch(
					'https://challenges.cloudflare.com/turnstile/v0/siteverify',
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: new URLSearchParams({
							secret: turnstileSecret,
							response: captchaToken,
							remoteip: event.getClientAddress()
						})
					}
				);
				const result = (await verifyRes.json()) as { success: boolean };
				if (!result.success) {
					return new Response(
						JSON.stringify({ error: { message: 'CAPTCHA verification failed' } }),
						{ status: 403, headers: { 'Content-Type': 'application/json' } }
					);
				}
			} catch (err) {
				console.error('[Auth] Turnstile verification error:', err);
				// Fail open in case of network error to Cloudflare — rate limiting still protects
			}
		}

		const kv: KVNamespace | undefined = event.platform?.env?.CACHE;

		if (!kv && hasHyperdrive) {
			// Production without KV — rate limiting is critical, warn loudly
			console.warn('[Auth] CACHE KV binding missing — OTP rate limiting disabled');
		}

		if (kv) {
			// Clone request so the body can still be read by Better Auth downstream
			const body = (await event.request
				.clone()
				.json()
				.catch(() => ({}))) as Record<string, unknown>;
			const email = (typeof body.email === 'string' ? body.email : '')
				.trim()
				.toLowerCase();

			if (isOtpSend) {
				// ── Disposable email blocking ──
				// Silent drop: attacker gets same response as a successful send
				if (email && isDisposableEmail(email)) {
					return new Response(JSON.stringify({ ok: true }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				const ip = event.getClientAddress();

				// ── Per-IP rate limit: 10 requests / hour ──
				const ipLimit = await checkRateLimit(kv, {
					key: `otp-ip:${ip}`,
					maxRequests: 10,
					windowSeconds: 3600
				});
				if (!ipLimit.allowed) {
					// Silent drop — same 200 OK so attacker can't distinguish
					return new Response(JSON.stringify({ ok: true }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				// ── Per-email rate limit: 3 requests / 15 min ──
				if (email) {
					const emailLimit = await checkRateLimit(kv, {
						key: `otp-email:${email}`,
						maxRequests: 3,
						windowSeconds: 900
					});
					if (!emailLimit.allowed) {
						return new Response(JSON.stringify({ ok: true }), {
							status: 200,
							headers: { 'Content-Type': 'application/json' }
						});
					}
				}

				// ── Global rate limit: 100 requests / minute ──
				const globalLimit = await checkRateLimit(kv, {
					key: 'otp-global',
					maxRequests: 100,
					windowSeconds: 60
				});
				if (!globalLimit.allowed) {
					return new Response(JSON.stringify({ ok: true }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			}

			if (isOtpVerify && email) {
				// Check lockout first (avoids incrementing counter for locked-out users)
				const lockout = await kv.get(`lockout:${email}`);
				if (lockout) {
					return new Response(
						JSON.stringify({
							error: { message: 'Too many attempts. Please try again later.' }
						}),
						{ status: 429, headers: { 'Content-Type': 'application/json' } }
					);
				}

				// Verification rate limit: 5 attempts / 15 min per email
				const verifyLimit = await checkRateLimit(kv, {
					key: `otp-verify:${email}`,
					maxRequests: 5,
					windowSeconds: 900
				});
				if (!verifyLimit.allowed) {
					// Lockout: set a flag so subsequent requests also fail fast
					await kv.put(`lockout:${email}`, 'locked', { expirationTtl: 900 });
					return new Response(
						JSON.stringify({
							error: { message: 'Too many attempts. Please try again later.' }
						}),
						{ status: 429, headers: { 'Content-Type': 'application/json' } }
					);
				}
			}
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
			"script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com", // Turnstile + SvelteKit hydration; TODO: nonce-based CSP
			"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
			"img-src 'self' data: blob: https:",
			"font-src 'self' data: https://cdn.jsdelivr.net",
			"connect-src 'self' https://martol.app wss://martol.app https://martol.plitix.com wss://martol.plitix.com https://cloudflareinsights.com https://challenges.cloudflare.com",
			"frame-src https://challenges.cloudflare.com", // Turnstile iframe
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
