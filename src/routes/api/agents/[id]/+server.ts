/**
 * DELETE /api/agents/[id] — Revoke an agent key and remove the agent
 *
 * Auth: session-based, owner/lead only.
 * [id] = agentUserId (text)
 * Deletes: apikey row, member row.
 * Optionally sets KV revoked flag for real-time revocation.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member, apikey, account } from '$lib/server/db/auth-schema';
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

	// [id] = agentUserId — verify the agent belongs to this room
	const agentUserId = params.id;
	if (!agentUserId) {
		error(400, 'Invalid agent ID');
	}

	const [agentMember] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, agentUserId), eq(member.role, 'agent')))
		.limit(1);

	if (!agentMember) {
		error(404, 'Agent not found in this room');
	}

	// Set KV revoked flags for real-time revocation (before DB deletion)
	const keys = await locals.db
		.select({ id: apikey.id })
		.from(apikey)
		.where(eq(apikey.referenceId, agentUserId));

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

	// Revoke: delete API key + membership + bindings.
	// Keep user row — messages/actions have ON DELETE RESTRICT foreign keys.
	await locals.db.transaction(async (tx: typeof locals.db) => {
		await tx.delete(apikey).where(eq(apikey.referenceId, agentUserId));
		await tx.delete(member).where(
			and(eq(member.userId, agentUserId), eq(member.organizationId, orgId))
		);
		await tx.delete(account).where(eq(account.userId, agentUserId));
		await tx.delete(agentRoomBindings).where(eq(agentRoomBindings.agentUserId, agentUserId));
	});

	return json({ ok: true });
};
