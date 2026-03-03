/**
 * /api/auth/magic — Handle opaque magic link token
 *
 * GET: Reads token from KV (without consuming), redirects to login page
 *      with magic param. This prevents email client link prefetching from
 *      consuming the OTP — the actual verification requires a POST.
 *
 * POST: Consumes the token, verifies OTP via Better Auth, sets session.
 */

import type { RequestHandler } from './$types';
import { redirect, error, json } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, platform }) => {
	const token = url.searchParams.get('token');
	if (!token) error(400, 'Missing token');

	const kv = platform?.env?.CACHE;
	if (!kv) redirect(302, '/login');

	// Verify token exists in KV (don't consume — prefetch safe)
	const stored = await kv.get(`magic:${token}`);
	if (!stored) redirect(302, '/login?error=expired');

	// Redirect WITHOUT email — email stays server-side only
	redirect(302, `/login?magic=${encodeURIComponent(token)}`);
};

export const POST: RequestHandler = async ({ request, platform, fetch, getClientAddress }) => {
	const kv = platform?.env?.CACHE;
	if (!kv) return json({ error: 'Service unavailable' }, { status: 503 });

	// Rate limit magic token consumption by IP — prevents token brute-force
	const ip = getClientAddress();
	const ipKey = `rl:magic-ip:${ip}`;
	const existing = await kv.get(ipKey);
	const count = existing ? parseInt(existing, 10) : 0;
	if (count >= 10) {
		return json({ error: 'Too many attempts' }, { status: 429 });
	}
	await kv.put(ipKey, String(count + 1), { expirationTtl: 900 });

	const body = await request.json().catch(() => ({})) as Record<string, unknown>;
	const token = typeof body.token === 'string' ? body.token : '';
	if (!token) return json({ error: 'Missing token' }, { status: 400 });

	const stored = await kv.get(`magic:${token}`);
	if (!stored) return json({ error: 'Token expired or already used' }, { status: 410 });

	// Delete token immediately (single-use)
	await kv.delete(`magic:${token}`);

	let email: string;
	let otp: string;
	try {
		const data = JSON.parse(stored);
		if (typeof data.email !== 'string' || !data.email.includes('@')) {
			return json({ error: 'Invalid token data' }, { status: 400 });
		}
		if (typeof data.otp !== 'string' || data.otp.length !== 6) {
			return json({ error: 'Invalid token data' }, { status: 400 });
		}
		email = data.email;
		otp = data.otp;
	} catch {
		return json({ error: 'Invalid token data' }, { status: 400 });
	}

	// Verify OTP via Better Auth's sign-in endpoint (internal fetch)
	const response = await fetch('/api/auth/sign-in/email-otp', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, otp })
	});

	if (!response.ok) {
		return json({ error: 'Verification failed' }, { status: 401 });
	}

	// Forward Set-Cookie headers from Better Auth response
	const setCookie = response.headers.get('Set-Cookie') || '';
	return json({ ok: true }, {
		status: 200,
		headers: setCookie ? { 'Set-Cookie': setCookie } : {}
	});
};
