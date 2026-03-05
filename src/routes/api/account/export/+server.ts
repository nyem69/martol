/**
 * GET /api/account/export — Export all user data as JSON
 *
 * GDPR Art. 20 — Data portability. Returns a JSON file with all personal data
 * associated with the authenticated user.
 *
 * Auth: session-based.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { user, session as sessionTable, account, member } from '$lib/server/db/auth-schema';
import {
	messages,
	usernameHistory,
	termsAcceptances,
	accountAudit,
	contentReports
} from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const db = locals.db;
	const userId = locals.user.id;

	// Fetch all user data in parallel
	const [
		userData,
		sessionsData,
		accountsData,
		membershipsData,
		messagesData,
		usernameHistoryData,
		termsData,
		auditData,
		reportsData
	] = await Promise.all([
		db.select().from(user).where(eq(user.id, userId)).limit(1),
		db
			.select({
				id: sessionTable.id,
				createdAt: sessionTable.createdAt,
				expiresAt: sessionTable.expiresAt,
				ipAddress: sessionTable.ipAddress,
				userAgent: sessionTable.userAgent
			})
			.from(sessionTable)
			.where(eq(sessionTable.userId, userId)),
		db
			.select({
				id: account.id,
				providerId: account.providerId,
				createdAt: account.createdAt
			})
			.from(account)
			.where(eq(account.userId, userId)),
		db
			.select({
				id: member.id,
				organizationId: member.organizationId,
				role: member.role,
				createdAt: member.createdAt
			})
			.from(member)
			.where(eq(member.userId, userId)),
		db
			.select({
				id: messages.id,
				orgId: messages.orgId,
				body: messages.body,
				type: messages.type,
				createdAt: messages.createdAt,
				deletedAt: messages.deletedAt
			})
			.from(messages)
			.where(eq(messages.senderId, userId))
			.orderBy(desc(messages.createdAt))
			.limit(10000),
		db.select().from(usernameHistory).where(eq(usernameHistory.userId, userId)),
		db.select().from(termsAcceptances).where(eq(termsAcceptances.userId, userId)),
		db.select().from(accountAudit).where(eq(accountAudit.userId, userId)),
		db
			.select({
				id: contentReports.id,
				reason: contentReports.reason,
				details: contentReports.details,
				createdAt: contentReports.createdAt
			})
			.from(contentReports)
			.where(eq(contentReports.reporterId, userId))
	]);

	const profile = userData[0];
	if (!profile) {
		error(404, 'User not found');
	}

	const exportData = {
		exportedAt: new Date().toISOString(),
		profile: {
			id: profile.id,
			name: profile.name,
			email: profile.email,
			username: profile.username,
			displayName: profile.displayName,
			emailVerified: profile.emailVerified,
			createdAt: profile.createdAt.toISOString(),
			updatedAt: profile.updatedAt.toISOString()
		},
		sessions: sessionsData,
		accounts: accountsData,
		memberships: membershipsData,
		messages: messagesData,
		usernameHistory: usernameHistoryData,
		termsAcceptances: termsData,
		auditLog: auditData,
		reports: reportsData
	};

	return new Response(JSON.stringify(exportData, null, 2), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="martol-data-export-${new Date().toISOString().slice(0, 10)}.json"`
		}
	});
};
