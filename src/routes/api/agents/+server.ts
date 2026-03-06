/**
 * POST /api/agents — Create synthetic agent user + API key
 * GET  /api/agents — List agents for the user's active room
 *
 * Auth: session-based, owner/lead only.
 *
 * Simplified: server creates user + membership + key.
 * Label and model are client-side config (set via --label and --model flags).
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member, user, account, apikey } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';
import { checkOrgLimits } from '$lib/server/feature-gates';

/** Resolve orgId + verify owner/lead role */
async function resolveOrgAndRole(locals: App.Locals) {
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

	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owner or lead can manage agents');
	}

	return orgId;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const orgId = await resolveOrgAndRole(locals);

	// Feature gate: check agent limit
	const orgLimits = await checkOrgLimits(locals.db, orgId);
	if (orgLimits.usage.agents >= orgLimits.limits.maxAgents) {
		error(403, `Free plan allows ${orgLimits.limits.maxAgents} agents. Upgrade to add more.`);
	}

	const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
	const name = typeof body.name === 'string' ? body.name.trim() : '';

	if (!name || name.length < 2 || name.length > 64) {
		error(400, 'Name must be 2-64 characters');
	}

	// Create agent atomically — user + account + membership in a single transaction.
	const agentUserId = crypto.randomUUID();
	const agentEmail = `agent-${crypto.randomUUID().slice(0, 12)}@agent.invalid`;
	const memberId = crypto.randomUUID();

	try {
		await locals.db.transaction(async (tx: typeof locals.db) => {
			// 1. Create synthetic agent user
			await tx.insert(user).values({
				id: agentUserId,
				name,
				email: agentEmail,
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date()
			});

			// 2. Create account record for Better Auth consistency
			await tx.insert(account).values({
				id: crypto.randomUUID(),
				accountId: agentUserId,
				providerId: 'agent',
				userId: agentUserId,
				createdAt: new Date(),
				updatedAt: new Date()
			});

			// 3. Add as org member with role 'agent'
			await tx.insert(member).values({
				id: memberId,
				organizationId: orgId,
				userId: agentUserId,
				role: 'agent',
				createdAt: new Date()
			});
		});
	} catch (e: any) {
		console.error('[Agents] transaction failed (rolled back):', e);
		error(500, 'Failed to create agent');
	}

	// 4. Create API key via Better Auth (outside transaction — uses Better Auth's own DB connection)
	let keyResult: any;
	try {
		keyResult = await locals.auth.api.createApiKey({
			body: {
				name: `${name} agent key`,
				prefix: 'mtl',
				userId: agentUserId
			}
		});
	} catch (e: any) {
		// Compensating cleanup — remove the agent user created in the transaction above
		try {
			await locals.db.transaction(async (tx: typeof locals.db) => {
				await tx.delete(member).where(
					and(eq(member.userId, agentUserId), eq(member.organizationId, orgId))
				);
				await tx.delete(account).where(eq(account.userId, agentUserId));
				await tx.delete(user).where(eq(user.id, agentUserId));
			});
		} catch (cleanupErr) {
			console.error('[Agents] Cleanup after API key failure also failed:', cleanupErr);
		}
		console.error('[Agents] API key creation failed, cleaned up agent user:', e);
		error(500, 'Failed to create API key');
	}

	const fullKey = keyResult?.key;

	return json({
		ok: true,
		data: {
			agentUserId,
			name,
			key: fullKey
		}
	});
};

export const GET: RequestHandler = async ({ locals }) => {
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
		if (!firstMembership) return json({ ok: true, data: [] });
		orgId = firstMembership.orgId;
	}

	// Verify membership (any role can view agents)
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}

	// Query agent members that have an active API key (revoked agents have no key)
	const agents = await locals.db
		.select({
			agentUserId: member.userId,
			name: user.name,
			createdAt: member.createdAt,
			keyStart: apikey.start
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.innerJoin(apikey, eq(apikey.referenceId, member.userId))
		.where(and(eq(member.organizationId, orgId), eq(member.role, 'agent')))
		.orderBy(member.createdAt);

	return json({
		ok: true,
		data: agents.map((a: typeof agents[number]) => ({
			agentUserId: a.agentUserId,
			name: a.name,
			keyStart: a.keyStart ?? null,
			createdAt: a.createdAt?.toISOString() ?? null
		}))
	});
};
