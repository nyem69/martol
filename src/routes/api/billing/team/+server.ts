/**
 * GET /api/billing/team — Get team info and members
 *
 * Syncs team status from Stripe on each load (webhooks may be unreliable).
 * Auth: team owner only.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { teams, teamMembers } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq } from 'drizzle-orm';
import { syncTeamSubscription } from '$lib/server/billing-sync';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const db = locals.db;

	let [team] = await db
		.select()
		.from(teams)
		.where(eq(teams.ownerId, locals.user.id))
		.limit(1);

	if (!team) {
		return json({ team: null, members: [] });
	}

	// Sync from Stripe if we have a customer ID
	const stripeKey = platform?.env?.STRIPE_SECRET_KEY;
	if (stripeKey && team.stripeCustomerId) {
		await syncTeamSubscription(db, team.id, team.stripeCustomerId, stripeKey);
		// Re-read after sync
		[team] = await db
			.select()
			.from(teams)
			.where(eq(teams.id, team.id))
			.limit(1);
	}

	const members = await db
		.select({
			id: teamMembers.id,
			userId: teamMembers.userId,
			assignedAt: teamMembers.assignedAt,
			username: user.username,
			displayName: user.displayName,
			email: user.email
		})
		.from(teamMembers)
		.innerJoin(user, eq(user.id, teamMembers.userId))
		.where(eq(teamMembers.teamId, team.id));

	return json({
		team: {
			id: team.id,
			name: team.name,
			seats: team.seats,
			status: team.status,
			currentPeriodEnd: team.currentPeriodEnd?.toISOString() ?? null,
			cancelAtPeriodEnd: team.cancelAtPeriodEnd,
			memberCount: members.length
		},
		members: members.map((m: typeof members[number]) => ({
			id: m.id,
			userId: m.userId,
			username: m.username,
			displayName: m.displayName,
			email: m.email,
			assignedAt: m.assignedAt.toISOString()
		}))
	});
};
