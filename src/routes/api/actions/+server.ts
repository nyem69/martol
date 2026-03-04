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
import { eq, and, desc, gte, ne } from 'drizzle-orm';

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
	// [I11] All members can view actions (read-only); approve/reject restricted to owner/lead

	// Optional status filter (default: pending)
	const statusFilter = url.searchParams.get('status') ?? 'pending';
	const validStatuses = ['pending', 'approved', 'rejected', 'expired', 'executed', 'recent'];
	if (!validStatuses.includes(statusFilter)) {
		error(400, 'Invalid status filter');
	}

	const selectFields = {
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
		createdAt: pendingActions.createdAt,
		simulationType: pendingActions.simulationType,
		simulationPayload: pendingActions.simulationPayload,
		riskFactors: pendingActions.riskFactors,
		estimatedImpact: pendingActions.estimatedImpact
	};

	let actions;
	if (statusFilter === 'recent') {
		// [I2] Two indexed queries instead of OR — each arm uses (org_id, status, created_at)
		// [I4] Safety cap at 200 — 200+ pending actions indicates a system problem
		const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

		const [allPending, recentResolved] = await Promise.all([
			locals.db
				.select(selectFields)
				.from(pendingActions)
				.where(and(
					eq(pendingActions.orgId, orgId),
					eq(pendingActions.status, 'pending')
				))
				.orderBy(desc(pendingActions.createdAt))
				.limit(200),
			locals.db
				.select(selectFields)
				.from(pendingActions)
				.where(and(
					eq(pendingActions.orgId, orgId),
					ne(pendingActions.status, 'pending'),
					gte(pendingActions.createdAt, cutoff)
				))
				.orderBy(desc(pendingActions.createdAt))
				.limit(50)
		]);

		// Merge and deduplicate (pending items older than 24h may overlap)
		const seen = new Set<number>();
		actions = [];
		for (const a of [...allPending, ...recentResolved]) {
			if (!seen.has(a.id)) {
				seen.add(a.id);
				actions.push(a);
			}
		}
		actions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	} else {
		actions = await locals.db
			.select(selectFields)
			.from(pendingActions)
			.where(
				and(
					eq(pendingActions.orgId, orgId),
					eq(pendingActions.status, statusFilter as 'pending' | 'approved' | 'rejected' | 'expired' | 'executed')
				)
			)
			.orderBy(desc(pendingActions.createdAt))
			.limit(50);
	}

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
			created_at: a.createdAt.toISOString(),
			simulation_type: a.simulationType ?? null,
			simulation_payload: a.simulationPayload ?? null,
			risk_factors: a.riskFactors ?? null,
			estimated_impact: a.estimatedImpact ?? null
		}))
	});
};
