/**
 * Email Change Endpoint — Martol
 *
 * POST: Initiate email change — stores pending change in KV, sends confirmation + undo emails
 * GET ?action=confirm&token=: Verify token, update user email
 * GET ?action=revert&token=: Verify revert token, restore old email
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { accountAudit } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq, and, or, desc } from 'drizzle-orm';
import { sendEmail, emailChangeConfirmTemplate, emailChangeRevertTemplate } from '$lib/server/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANGE_TTL = 72 * 60 * 60; // 72 hours in seconds

function generateToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const kv: KVNamespace | undefined = platform?.env?.CACHE;
	if (!kv) error(503, 'Cache unavailable');

	const body = await request.json() as { email?: string };
	const newEmail = (body.email ?? '').trim().toLowerCase();

	if (!newEmail || !EMAIL_RE.test(newEmail)) {
		error(400, 'Invalid email address');
	}

	if (newEmail === locals.user.email?.toLowerCase()) {
		error(400, 'New email is the same as current email');
	}

	const userId = locals.user.id;
	const oldEmail = locals.user.email;
	const db = locals.db;

	// Cooldown: 30 days between email changes
	const [lastChange] = await db
		.select({ createdAt: accountAudit.createdAt })
		.from(accountAudit)
		.where(and(eq(accountAudit.userId, userId), eq(accountAudit.action, 'email_change')))
		.orderBy(desc(accountAudit.createdAt))
		.limit(1);

	if (lastChange) {
		const daysSince = (Date.now() - lastChange.createdAt.getTime()) / (1000 * 60 * 60 * 24);
		if (daysSince < 30) {
			const daysLeft = Math.ceil(30 - daysSince);
			error(429, `You can only change your email once every 30 days. Try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`);
		}
	}

	// Prevent reuse of any previous email
	const previousEmails = await db
		.select({ oldValue: accountAudit.oldValue, newValue: accountAudit.newValue })
		.from(accountAudit)
		.where(
			and(
				eq(accountAudit.userId, userId),
				or(eq(accountAudit.action, 'email_change'), eq(accountAudit.action, 'email_revert'))
			)
		);

	const usedEmails = new Set<string>();
	for (const r of previousEmails) {
		if (r.oldValue) usedEmails.add(r.oldValue.toLowerCase());
		if (r.newValue) usedEmails.add(r.newValue.toLowerCase());
	}

	if (usedEmails.has(newEmail)) {
		error(400, 'This email address has been used before and cannot be reused.');
	}

	// Check for existing pending change
	const existing = await kv.get(`email-change:${userId}`);
	if (existing) {
		error(409, 'An email change is already pending. Check your email or wait for it to expire.');
	}

	// Generate tokens
	const confirmToken = generateToken();
	const revertToken = generateToken();

	const baseUrl = platform?.env?.APP_BASE_URL || 'https://martol.plitix.com';
	const confirmUrl = `${baseUrl}/api/account/email?action=confirm&token=${confirmToken}`;
	const revertUrl = `${baseUrl}/api/account/email?action=revert&token=${revertToken}`;

	// Store pending change in KV
	const pendingChange = {
		userId,
		oldEmail,
		newEmail,
		confirmToken,
		revertToken,
		createdAt: Date.now()
	};

	await kv.put(`email-change:${userId}`, JSON.stringify(pendingChange), {
		expirationTtl: CHANGE_TTL
	});
	await kv.put(`email-change-token:${confirmToken}`, JSON.stringify(pendingChange), {
		expirationTtl: CHANGE_TTL
	});
	await kv.put(`email-revert-token:${revertToken}`, JSON.stringify(pendingChange), {
		expirationTtl: CHANGE_TTL
	});

	// Send emails
	const emailConfig = {
		RESEND_API_KEY: platform?.env?.RESEND_API_KEY || process.env.RESEND_API_KEY || '',
		EMAIL_FROM: platform?.env?.EMAIL_FROM || process.env.EMAIL_FROM || 'noreply@martol.app',
		EMAIL_NAME: platform?.env?.EMAIL_NAME || process.env.EMAIL_NAME || 'Martol'
	};

	// Confirmation email to new address
	const confirmEmail = emailChangeConfirmTemplate(confirmUrl);
	await sendEmail({ to: newEmail, ...confirmEmail }, emailConfig);

	// Undo email to old address
	const revertEmail = emailChangeRevertTemplate(revertUrl);
	await sendEmail({ to: oldEmail, ...revertEmail }, emailConfig);

	return json({ ok: true });
};

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const kv: KVNamespace | undefined = platform?.env?.CACHE;
	if (!kv) error(503, 'Cache unavailable');

	const action = url.searchParams.get('action');
	const token = url.searchParams.get('token');

	if (!token || !action) error(400, 'Missing action or token');

	const baseUrl = platform?.env?.APP_BASE_URL || 'https://martol.plitix.com';

	if (action === 'confirm') {
		const raw = await kv.get(`email-change-token:${token}`);
		if (!raw) {
			return new Response(null, {
				status: 302,
				headers: { Location: `${baseUrl}/settings?email_change=expired` }
			});
		}

		const pending = JSON.parse(raw) as {
			userId: string;
			oldEmail: string;
			newEmail: string;
			revertToken: string;
		};

		// Update user email in database
		await db.update(user).set({ email: pending.newEmail }).where(eq(user.id, pending.userId));

		// Log audit
		await db.insert(accountAudit).values({
			userId: pending.userId,
			action: 'email_change',
			oldValue: pending.oldEmail,
			newValue: pending.newEmail
		});

		// Clean up confirm token + pending change (keep revert token for undo)
		await kv.delete(`email-change-token:${token}`);
		await kv.delete(`email-change:${pending.userId}`);

		return new Response(null, {
			status: 302,
			headers: { Location: `${baseUrl}/settings?email_change=confirmed` }
		});
	}

	if (action === 'revert') {
		const raw = await kv.get(`email-revert-token:${token}`);
		if (!raw) {
			return new Response(null, {
				status: 302,
				headers: { Location: `${baseUrl}/settings?email_change=expired` }
			});
		}

		const pending = JSON.parse(raw) as {
			userId: string;
			oldEmail: string;
			newEmail: string;
			confirmToken: string;
		};

		// Restore old email
		await db.update(user).set({ email: pending.oldEmail }).where(eq(user.id, pending.userId));

		// Log audit
		await db.insert(accountAudit).values({
			userId: pending.userId,
			action: 'email_revert',
			oldValue: pending.newEmail,
			newValue: pending.oldEmail
		});

		// Clean up all tokens
		await kv.delete(`email-revert-token:${token}`);
		await kv.delete(`email-change-token:${pending.confirmToken}`);
		await kv.delete(`email-change:${pending.userId}`);

		return new Response(null, {
			status: 302,
			headers: { Location: `${baseUrl}/settings?email_change=reverted` }
		});
	}

	error(400, 'Invalid action');
};
