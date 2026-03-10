/**
 * POST /api/billing/team/members — Assign user to team seat
 * DELETE /api/billing/team/members — Remove user from team
 *
 * Auth: team owner only.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { teams, teamMembers } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';

/** Verify caller is team owner, return team */
async function getOwnedTeam(locals: App.Locals) {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const [team] = await locals.db
		.select()
		.from(teams)
		.where(eq(teams.ownerId, locals.user.id))
		.limit(1);

	if (!team) error(404, 'No team found');
	if (team.status !== 'active') error(400, 'Team subscription is not active');

	return team;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const team = await getOwnedTeam(locals);
	const db = locals.db!;

	const body = await request.json() as { email?: string };
	const targetEmail = body.email?.trim()?.toLowerCase();
	if (!targetEmail) error(400, 'Email is required');

	// Find user by email
	const [targetUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, targetEmail))
		.limit(1);

	if (!targetUser) error(404, 'User not found with that email');

	// Check seat availability
	const [{ count: memberCount }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(teamMembers)
		.where(eq(teamMembers.teamId, team.id));

	if ((memberCount ?? 0) >= team.seats) {
		error(400, `All ${team.seats} seats are filled. Increase seats via billing portal.`);
	}

	// Check if already assigned
	const [existing] = await db
		.select({ id: teamMembers.id })
		.from(teamMembers)
		.where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, targetUser.id)))
		.limit(1);

	if (existing) error(400, 'User is already assigned to this team');

	// Assign seat
	await db.insert(teamMembers).values({
		id: crypto.randomUUID(),
		teamId: team.id,
		userId: targetUser.id
	});

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const team = await getOwnedTeam(locals);
	const db = locals.db!;

	const body = await request.json() as { userId?: string };
	const userId = body.userId;
	if (!userId) error(400, 'userId is required');

	await db
		.delete(teamMembers)
		.where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));

	return json({ success: true });
};
