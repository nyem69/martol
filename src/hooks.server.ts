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
import { termsVersions, termsAcceptances } from '$lib/server/db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { checkOrgLimits } from '$lib/server/feature-gates';

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
			env.CACHE,
			env.ENVIRONMENT
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
			},
			undefined,
			process.env.ENVIRONMENT as string
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

	// ── Terms Re-acceptance Check ────────────────────────────────────────
	// For authenticated page routes, check if user has accepted the latest terms.
	// Skip for: API routes, /login, /legal/*, /accept-terms
	const pathname = event.url.pathname;
	const isPageRoute =
		!pathname.startsWith('/api/') &&
		!pathname.startsWith('/login') &&
		!pathname.startsWith('/legal/') &&
		!pathname.startsWith('/accept-terms') &&
		!pathname.startsWith('/accept-invitation');

	if (event.locals.user && event.locals.db && isPageRoute) {
		try {
			const db = event.locals.db;
			const userId = event.locals.user.id;

			// Batch query: get latest version of each required type using DISTINCT ON
			const latestVersions = await db
				.select({ id: termsVersions.id, type: termsVersions.type })
				.from(termsVersions)
				.where(inArray(termsVersions.type, ['tos', 'privacy', 'aup']))
				.orderBy(termsVersions.type, desc(termsVersions.effectiveAt));

			// Deduplicate to latest per type (first row per type due to ORDER BY)
			const latestByType = new Map<string, number>();
			for (const v of latestVersions) {
				if (!latestByType.has(v.type)) {
					latestByType.set(v.type, v.id);
				}
			}

			// Only check if at least one terms version exists
			if (latestByType.size > 0) {
				const requiredIds = [...latestByType.values()];

				// Single query: count user's acceptances for these version IDs
				const [{ count: acceptedCount }] = await db
					.select({ count: sql<number>`count(*)::int` })
					.from(termsAcceptances)
					.where(
						and(
							eq(termsAcceptances.userId, userId),
							inArray(termsAcceptances.termsVersionId, requiredIds)
						)
					);

				// If any required type is missing acceptance, redirect
				if ((acceptedCount ?? 0) < latestByType.size) {
					return new Response(null, {
						status: 302,
						headers: { Location: '/accept-terms' }
					});
				}
			}
		} catch (err) {
			console.error('[Terms] Version check failed:', err);
			// Fail open — don't block the user if the check fails
		}
	}

	// ── 2FA advisory for room owners ─────────────────────────────────────
	// NOTE: Hard redirect removed — 2FA setup UI not yet implemented.
	// When 2FA UI exists on /settings, re-enable enforcement for /chat only.
	// For now, the server just logs a warning for owners without 2FA.

	// ── OTP Rate Limiting ──────────────────────────────────────────────────
	// Intercept OTP endpoints BEFORE they reach Better Auth.
	// All blocked requests return consistent responses to prevent enumeration.
	const isOtpSend =
		event.url.pathname === '/api/auth/email-otp/send-verification-otp' &&
		event.request.method === 'POST';
	const isOtpVerify =
		event.url.pathname === '/api/auth/sign-in/email-otp' &&
		event.request.method === 'POST';
	const isInvite =
		event.url.pathname === '/api/auth/organization/invite-member' &&
		event.request.method === 'POST';
	const isActionApproval =
		/^\/api\/actions\/\d+\/(approve|reject)$/.test(event.url.pathname) &&
		event.request.method === 'POST';
	const isUpload =
		event.url.pathname === '/api/upload' && event.request.method === 'POST';

	// ── Turnstile CAPTCHA verification (OTP send only) ──
	// Turnstile tokens are single-use. Enforce only on send, not verify.
	// Verify is already protected by OTP secret + 5-attempt lockout.
	if (isOtpSend) {
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
				console.warn('[Turnstile] Verification request failed, proceeding with rate limiting only:', err);
				// Fall through — rate limiting still protects
			}
		}
	}

	if (isOtpSend || isOtpVerify) {
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

				// Verification rate limit: 5 attempts / 15 min per email (fail-closed)
				const verifyLimit = await checkRateLimit(kv, {
					key: `otp-verify:${email}`,
					maxRequests: 5,
					windowSeconds: 900
				}, true);
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

	// ── Invitation rate limit: 20 per user per hour ──
	if (isInvite && event.locals.user) {
		const kv: KVNamespace | undefined = event.platform?.env?.CACHE;
		if (kv) {
			const userId = event.locals.user.id;
			const inviteLimit = await checkRateLimit(kv, {
				key: `invite-user:${userId}`,
				maxRequests: 20,
				windowSeconds: 3600
			});
			if (!inviteLimit.allowed) {
				return new Response(
					JSON.stringify({ error: { message: 'Too many invitations. Try again later.' } }),
					{ status: 429, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}

		// ── Feature gate: check member limit before inviting ──
		if (event.locals.db && event.locals.session?.activeOrganizationId) {
			const orgLimits = await checkOrgLimits(
				event.locals.db,
				event.locals.session.activeOrganizationId
			);
			if (orgLimits.usage.users >= orgLimits.limits.maxUsers) {
				return new Response(
					JSON.stringify({
						error: {
							message: `Free plan allows ${orgLimits.limits.maxUsers} users. Upgrade to add more.`
						}
					}),
					{ status: 403, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}
	}

	// ── Upload rate limit: 20 per user per minute ──
	// Fail CLOSED: uploads blocked when KV is missing (unlike OTP which fails open)
	if (isUpload && event.locals.user) {
		const kv: KVNamespace | undefined = event.platform?.env?.CACHE;
		if (!kv && hasHyperdrive) {
			console.error('[Upload] CACHE KV binding missing — uploads blocked');
			return new Response(
				JSON.stringify({ error: { message: 'Upload service temporarily unavailable.' } }),
				{ status: 503, headers: { 'Content-Type': 'application/json' } }
			);
		}
		if (kv) {
			const userId = event.locals.user.id;
			const uploadLimit = await checkRateLimit(kv, {
				key: `upload:${userId}`,
				maxRequests: 20,
				windowSeconds: 60
			});
			if (!uploadLimit.allowed) {
				return new Response(
					JSON.stringify({ error: { message: 'Too many uploads. Try again later.' } }),
					{ status: 429, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}
	}

	// ── MCP endpoint rate limiting: 60 req/min per API key (CR-07) ──
	if (pathname === '/mcp/v1' && event.request.method === 'POST') {
		const apiKey = event.request.headers.get('x-api-key');
		const kv: KVNamespace | undefined = platform?.env?.CACHE;
		if (apiKey) {
			if (!kv && hasHyperdrive) {
				console.warn('[MCP] CACHE KV binding missing — rate limiting disabled');
			}
			if (kv) {
				const mcpLimit = await checkRateLimit(kv, {
					key: `mcp:${apiKey.slice(-8)}`,
					maxRequests: 60,
					windowSeconds: 60
				});
				if (!mcpLimit.allowed) {
					return new Response(JSON.stringify({ ok: false, error: 'Rate limited' }), {
						status: 429,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			}
		}
	}

	// ── Action approval rate limit: 60 per user per minute ──
	if (isActionApproval && event.locals.user) {
		const kv: KVNamespace | undefined = event.platform?.env?.CACHE;
		if (kv) {
			const userId = event.locals.user.id;
			const actionLimit = await checkRateLimit(kv, {
				key: `action-approval:${userId}`,
				maxRequests: 60,
				windowSeconds: 60
			});
			if (!actionLimit.allowed) {
				return new Response(
					JSON.stringify({ error: { message: 'Too many approval requests. Try again later.' } }),
					{ status: 429, headers: { 'Content-Type': 'application/json' } }
				);
			}
		}
	}

	// Process the request — ensure Hyperdrive client is closed after
	try {
		const response = await resolve(event);

		// ── Audit logging for OTP verify ──
		if (isOtpVerify && event.locals.user && event.locals.db) {
			const auditAction = response.ok ? 'login_success' : 'login_failed';
			try {
				const { accountAudit } = await import('$lib/server/db/schema');
				await event.locals.db.insert(accountAudit).values({
					userId: event.locals.user.id,
					action: auditAction,
					oldValue: null,
					newValue: null,
					ipAddress: event.getClientAddress(),
					userAgent: event.request.headers.get('user-agent') || null
				});
			} catch {
				// Non-critical — don't block the response
			}
		}

		// CORS headers on response
		if (origin && ALLOWED_ORIGINS.has(origin)) {
			response.headers.set('Access-Control-Allow-Origin', origin);
			response.headers.set('Access-Control-Allow-Credentials', 'true');
		}
		response.headers.append('Vary', 'Origin');

		// Security headers
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		response.headers.set(
			'Permissions-Policy',
			'camera=(), microphone=(), geolocation=()'
		);
		response.headers.set(
			'Strict-Transport-Security',
			'max-age=63072000; includeSubDomains; preload'
		);

		// CSP is now handled by SvelteKit's built-in csp config in svelte.config.js
		// which auto-generates nonces for inline scripts during SSR.

		return response;
	} finally {
		if (hyperdriveClient) {
			try { await hyperdriveClient.end(); } catch { /* already closed */ }
		}
	}
};
