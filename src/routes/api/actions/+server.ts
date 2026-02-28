/**
 * GET /api/actions — List pending actions for the user's active room
 *
 * Auth: session-based, owner/lead only.
 * Returns pending_actions ordered by created_at DESC.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member } from '$lib/server/db/auth-schema';
import { pendingActions } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	let orgId = locals.session.activeOrganizationId;
	if (!orgId) {
		// Fallback: resolve from first membership
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
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owner or lead can view pending actions');
	}

	// Optional status filter (default: pending)
	const statusFilter = url.searchParams.get('status') ?? 'pending';
	const validStatuses = ['pending', 'approved', 'rejected', 'expired', 'executed'];
	if (!validStatuses.includes(statusFilter)) {
		error(400, 'Invalid status filter');
	}

	const actions = await locals.db
		.select({
			id: pendingActions.id,
			actionType: pendingActions.actionType,
			riskLevel: pendingActions.riskLevel,
			description: pendingActions.description,
			requestedBy: pendingActions.requestedBy,
			requestedRole: pendingActions.requestedRole,
			agentUserId: pendingActions.agentUserId,
			status: pendingActions.status,
			approvedBy: pendingActions.approvedBy,
			approvedAt: pendingActions.approvedAt,
			createdAt: pendingActions.createdAt
		})
		.from(pendingActions)
		.where(
			and(
				eq(pendingActions.orgId, orgId),
				eq(pendingActions.status, statusFilter as 'pending' | 'approved' | 'rejected' | 'expired' | 'executed')
			)
		)
		.orderBy(desc(pendingActions.createdAt))
		.limit(50);

	return json({
		ok: true,
		data: actions.map((a: typeof actions[number]) => ({
			id: a.id,
			action_type: a.actionType,
			risk_level: a.riskLevel,
			description: a.description,
			requested_by: a.requestedBy,
			requested_role: a.requestedRole,
			agent_user_id: a.agentUserId,
			status: a.status,
			approved_by: a.approvedBy,
			approved_at: a.approvedAt?.toISOString() ?? null,
			created_at: a.createdAt.toISOString()
		}))
	});
};
