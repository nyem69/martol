/**
 * DELETE /api/agents/[id] — Revoke an agent key and remove the agent
 *
 * Auth: session-based, owner/lead only.
 * Deletes: apikey row, agent_room_bindings row, member row.
 * Optionally sets KV revoked flag for real-time revocation.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member, apikey } from '$lib/server/db/auth-schema';
import { agentRoomBindings } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
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

	// Verify owner/lead role
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owner or lead can revoke agent keys');
	}

	// Find the binding and verify it belongs to this org
	const bindingId = Number(params.id);
	if (!Number.isFinite(bindingId)) {
		error(400, 'Invalid agent ID');
	}

	const [binding] = await locals.db
		.select({
			id: agentRoomBindings.id,
			orgId: agentRoomBindings.orgId,
			agentUserId: agentRoomBindings.agentUserId
		})
		.from(agentRoomBindings)
		.where(eq(agentRoomBindings.id, bindingId))
		.limit(1);

	if (!binding) {
		error(404, 'Agent not found');
	}
	if (binding.orgId !== orgId) {
		error(403, 'Agent does not belong to this room');
	}

	const agentUserId = binding.agentUserId;

	// Find and delete API key(s) for this agent user
	const keys = await locals.db
		.select({ id: apikey.id })
		.from(apikey)
		.where(eq(apikey.userId, agentUserId));

	// Set KV revoked flags for real-time revocation
	const kv = platform?.env?.CACHE;
	for (const key of keys) {
		if (kv) {
			try {
				await kv.put(`revoked:${key.id}`, '1', { expirationTtl: 60 * 60 * 24 * 7 });
			} catch {
				// Non-critical: revocation will still work via DB deletion
			}
		}
	}

	// Delete in order: apikey → agent_room_bindings → member
	if (keys.length > 0) {
		await locals.db
			.delete(apikey)
			.where(eq(apikey.userId, agentUserId));
	}

	await locals.db
		.delete(agentRoomBindings)
		.where(eq(agentRoomBindings.id, bindingId));

	await locals.db
		.delete(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, agentUserId)));

	return json({ ok: true });
};
