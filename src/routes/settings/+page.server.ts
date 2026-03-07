/**
 * Settings Page — Server Load
 *
 * Loads user profile data and username history for cooldown checks.
 * Redirects to /login if no session.
 */

import { redirect, error } from '@sveltejs/kit';
import { user, member } from '$lib/server/db/auth-schema';
import { usernameHistory, accountAudit } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkOrgLimits } from '$lib/server/feature-gates';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	// Get full user record
	const [userData] = await db
		.select({
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			email: user.email,
			createdAt: user.createdAt
		})
		.from(user)
		.where(eq(user.id, locals.user.id))
		.limit(1);

	if (!userData) error(404, 'User not found');

	// Get last username change for cooldown check
	const [lastChange] = await db
		.select({
			changedAt: usernameHistory.changedAt
		})
		.from(usernameHistory)
		.where(eq(usernameHistory.userId, locals.user.id))
		.orderBy(desc(usernameHistory.changedAt))
		.limit(1);

	// Get last email change for cooldown check
	const [lastEmailChange] = await db
		.select({
			changedAt: accountAudit.createdAt
		})
		.from(accountAudit)
		.where(and(eq(accountAudit.userId, locals.user.id), eq(accountAudit.action, 'email_change')))
		.orderBy(desc(accountAudit.createdAt))
		.limit(1);

	// Mask email: show first 2 chars + domain
	const emailParts = userData.email.split('@');
	const maskedEmail =
		emailParts[0].length > 2
			? emailParts[0].slice(0, 2) + '***@' + emailParts[1]
			: emailParts[0][0] + '***@' + emailParts[1];

	// Load billing data for active org
	let activeOrgId = locals.session.activeOrganizationId;
	if (!activeOrgId) {
		const [first] = await db
			.select({ orgId: member.organizationId })
			.from(member)
			.where(eq(member.userId, locals.user.id))
			.limit(1);
		activeOrgId = first?.orgId ?? null;
	}

	// Check org role for billing management
	let isOwnerOrLead = false;
	if (activeOrgId) {
		const [memberRecord] = await db
			.select({ role: member.role })
			.from(member)
			.where(
				and(eq(member.organizationId, activeOrgId), eq(member.userId, locals.user.id))
			)
			.limit(1);
		isOwnerOrLead =
			memberRecord?.role === 'owner' || memberRecord?.role === 'lead';
	}

	const billing = activeOrgId
		? await checkOrgLimits(db, activeOrgId)
		: null;

	return {
		profile: {
			id: userData.id,
			username: userData.username ?? '',
			displayName: userData.displayName ?? '',
			email: maskedEmail,
			createdAt: userData.createdAt.toISOString()
		},
		lastUsernameChange: lastChange?.changedAt?.toISOString() ?? null,
		lastEmailChange: lastEmailChange?.changedAt?.toISOString() ?? null,
		billing,
		isOwnerOrLead
	};
};
