/**
 * GET /api/auth/magic — Handle opaque magic link token
 *
 * Looks up token in KV, extracts email+OTP, verifies server-side via
 * internal fetch to Better Auth, then redirects to /chat on success.
 * Token is single-use (deleted after lookup).
 * OTP never appears in browser URL or redirect.
 */

import type { RequestHandler } from './$types';
import { redirect, error } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, platform, fetch }) => {
	const token = url.searchParams.get('token');
	if (!token) {
		error(400, 'Missing token');
	}

	const kv = platform?.env?.CACHE;
	if (!kv) {
		// Dev fallback: redirect to login page
		redirect(302, '/login');
	}

	const stored = await kv.get(`magic:${token}`);
	if (!stored) {
		// Token expired or already used
		redirect(302, '/login?error=expired');
	}

	// Delete token immediately (single-use)
	await kv.delete(`magic:${token}`);

	let email: string;
	let otp: string;
	try {
		const data = JSON.parse(stored);
		// Validate extracted fields
		if (typeof data.email !== 'string' || !data.email.includes('@')) {
			error(400, 'Invalid token data');
		}
		if (typeof data.otp !== 'string' || data.otp.length !== 6) {
			error(400, 'Invalid token data');
		}
		email = data.email;
		otp = data.otp;
	} catch {
		error(400, 'Invalid token data');
	}

	// Server-side verification: POST to Better Auth's sign-in endpoint internally.
	// This keeps OTP out of browser URLs entirely.
	try {
		const response = await fetch('/api/auth/sign-in/email-otp', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, otp })
		});

		if (!response.ok) {
			redirect(302, '/login?error=invalid');
		}

		// Better Auth sets session cookies via Set-Cookie headers on the internal response.
		// SvelteKit's fetch() automatically propagates these to the client.
		redirect(302, '/chat');
	} catch (e) {
		// Re-throw redirects (SvelteKit throws for redirect())
		if (e && typeof e === 'object' && 'status' in e) throw e;
		redirect(302, '/login?error=failed');
	}
};
