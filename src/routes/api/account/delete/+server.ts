/**
 * POST /api/account/delete — Delete user account
 *
 * GDPR Art. 17 — Right to erasure. Soft-deletes the user:
 * - Anonymizes messages (body → '[deleted]', senderId kept for FK to anonymized user row)
 * - Removes all sessions, API keys, 2FA secrets, invitations
 * - Removes org memberships, accounts, terms acceptances, username history
 * - Records audit entry
 * - Anonymizes user row (email/name/username cleared, row kept for FK integrity)
 *
 * Auth: session-based. Requires confirmation phrase in body.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { user, session as sessionTable, account, member, apikey, twoFactor, invitation } from '$lib/server/db/auth-schema';
import { messages, accountAudit, termsAcceptances, usernameHistory } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	let body: { confirm: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	// Require explicit confirmation
	if (body.confirm !== 'DELETE MY ACCOUNT') {
		return json(
			{ ok: false, error: 'Confirmation required. Send { "confirm": "DELETE MY ACCOUNT" }' },
			{ status: 400 }
		);
	}

	const db = locals.db;
	const userId = locals.user.id;
	const now = new Date();

	try {
		await db.transaction(async (tx: typeof db) => {
			// 1. Soft-delete messages: clear body, keep senderId pointing at anonymized user row
			await tx
				.update(messages)
				.set({
					body: '[deleted]',
					deletedAt: now
				})
				.where(eq(messages.senderId, userId));

			// 2. Delete all sessions
			await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));

			// 3. Delete API keys (prevents continued agent auth after deletion)
			await tx.delete(apikey).where(eq(apikey.userId, userId));

			// 4. Delete 2FA secrets and backup codes
			await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));

			// 5. Delete pending invitations sent by user
			await tx.delete(invitation).where(eq(invitation.inviterId, userId));

			// 6. Delete org memberships
			await tx.delete(member).where(eq(member.userId, userId));

			// 7. Delete accounts
			await tx.delete(account).where(eq(account.userId, userId));

			// 8. Delete terms acceptances
			await tx.delete(termsAcceptances).where(eq(termsAcceptances.userId, userId));

			// 9. Delete username history
			await tx.delete(usernameHistory).where(eq(usernameHistory.userId, userId));

			// 10. Audit log (before user anonymization)
			await tx.insert(accountAudit).values({
				userId,
				action: 'account_delete',
				ipAddress: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for'),
				userAgent: request.headers.get('user-agent')
			});

			// 11. Anonymize user record (keep row for FK integrity, clear PII)
			await tx
				.update(user)
				.set({
					name: 'Deleted User',
					email: `deleted-${userId}@deleted.invalid`,
					emailVerified: false,
					username: null,
					displayName: null,
					image: null,
					updatedAt: now
				})
				.where(eq(user.id, userId));
		});
	} catch (e) {
		console.error('[Account] Delete transaction failed:', e);
		error(500, 'Account deletion failed. Please try again.');
	}

	return json({ ok: true });
};
