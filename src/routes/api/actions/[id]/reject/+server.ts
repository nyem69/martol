/**
 * POST /api/actions/[id]/reject — Reject a pending action
 *
 * Auth: session-based, owner/lead only.
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

	const orgId = locals.session.activeOrganizationId;
	if (!orgId) {
		error(400, 'No active organization');
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
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owner or lead can reject actions');
	}

	// Fetch the action
	const [action] = await locals.db
		.select({ id: pendingActions.id, status: pendingActions.status })
		.from(pendingActions)
		.where(and(eq(pendingActions.id, actionId), eq(pendingActions.orgId, orgId)))
		.limit(1);

	if (!action) {
		error(404, 'Action not found');
	}
	if (action.status !== 'pending') {
		error(409, `Action already ${action.status}`);
	}

	// Update the action
	const [updated] = await locals.db
		.update(pendingActions)
		.set({ status: 'rejected' })
		.where(eq(pendingActions.id, actionId))
		.returning({ id: pendingActions.id, status: pendingActions.status });

	return json({ ok: true, data: { id: updated.id, status: updated.status } });
};
