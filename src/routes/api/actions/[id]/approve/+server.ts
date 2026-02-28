/**
 * POST /api/actions/[id]/approve — Approve a pending action
 *
 * Auth: session-based.
 * Owner can approve all pending actions.
 * Lead can approve medium-risk actions only (not high-risk).
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member } from '$lib/server/db/auth-schema';
import { pendingActions } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const actionId = parseInt(params.id, 10);
	if (isNaN(actionId) || actionId <= 0) {
		error(400, 'Invalid action ID');
	}

	let orgId = locals.session.activeOrganizationId;
	if (!orgId) {
		const [firstMembership] = await locals.db
			.select({ orgId: member.organizationId })
			.from(member)
			.where(eq(member.userId, locals.user.id))
			.limit(1);
		if (!firstMembership) error(400, 'No active organization');
		orgId = firstMembership.orgId;
	}

	// Verify membership and role
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}

	// Fetch the action
	const [action] = await locals.db
		.select()
		.from(pendingActions)
		.where(and(eq(pendingActions.id, actionId), eq(pendingActions.orgId, orgId)))
		.limit(1);

	if (!action) {
		error(404, 'Action not found');
	}
	if (action.status !== 'pending') {
		error(409, `Action already ${action.status}`);
	}

	// Authorization: owner can approve anything, lead can approve medium-risk only
	if (memberRecord.role === 'owner') {
		// Owner can approve all
	} else if (memberRecord.role === 'lead') {
		if (action.riskLevel === 'high') {
			error(403, 'Only owner can approve high-risk actions');
		}
	} else {
		error(403, 'Only owner or lead can approve actions');
	}

	// Update the action
	const [updated] = await locals.db
		.update(pendingActions)
		.set({
			status: 'approved',
			approvedBy: locals.user.id,
			approvedAt: new Date()
		})
		.where(eq(pendingActions.id, actionId))
		.returning({ id: pendingActions.id, status: pendingActions.status });

	return json({ ok: true, data: { id: updated.id, status: updated.status } });
};
