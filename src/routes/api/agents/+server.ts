/**
 * POST /api/agents — Create synthetic agent user + API key
 * GET  /api/agents — List agents for the user's active room
 *
 * Auth: session-based, owner/lead only.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member, user, apikey } from '$lib/server/db/auth-schema';
import { agentRoomBindings } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

const LABEL_RE = /^[a-zA-Z0-9_:-]{2,32}$/;

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

	const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
	if (typeof body.label !== 'string' || typeof body.model !== 'string') {
		error(400, 'Missing label or model');
	}

	const label = (body.label as string).trim();
	const model = (body.model as string).trim();

	if (!LABEL_RE.test(label)) {
		error(400, 'Label must be 2-32 chars: letters, digits, _ : -');
	}
	if (model.length < 2 || model.length > 128) {
		error(400, 'Model must be 2-128 characters');
	}

	// Check label uniqueness within org
	const [existing] = await locals.db
		.select({ id: agentRoomBindings.id })
		.from(agentRoomBindings)
		.where(and(eq(agentRoomBindings.orgId, orgId), eq(agentRoomBindings.label, label)))
		.limit(1);

	if (existing) {
		error(409, 'An agent with this label already exists in this room');
	}

	// 1. Create synthetic agent user via Better Auth
	const randomId = crypto.randomUUID().slice(0, 12);
	const agentEmail = `agent-${randomId}@martol.local`;
	const agentPassword = crypto.randomUUID();

	let signUpResult: any;
	try {
		signUpResult = await locals.auth.api.signUpEmail({
			body: {
				name: label,
				email: agentEmail,
				password: agentPassword
			}
		});
	} catch (e: any) {
		console.error('[Agents] signUpEmail failed:', e);
		error(500, 'Failed to create agent user');
	}

	const agentUserId = signUpResult?.user?.id ?? signUpResult?.id;
	if (!agentUserId) {
		console.error('[Agents] signUpEmail returned no user ID:', signUpResult);
		error(500, 'Failed to create agent user');
	}

	// 2. Add as org member with role 'agent'
	const memberId = crypto.randomUUID();
	try {
		await locals.db.insert(member).values({
			id: memberId,
			organizationId: orgId,
			userId: agentUserId,
			role: 'agent',
			createdAt: new Date()
		});
	} catch (e: any) {
		console.error('[Agents] member insert failed:', e);
		error(500, 'Failed to add agent as member');
	}

	// 3. Create agent_room_binding
	let bindingId: number;
	try {
		const [binding] = await locals.db
			.insert(agentRoomBindings)
			.values({
				orgId,
				agentUserId,
				label,
				model
			})
			.returning({ id: agentRoomBindings.id });
		bindingId = binding.id;
	} catch (e: any) {
		console.error('[Agents] binding insert failed:', e);
		error(500, 'Failed to create agent binding');
	}

	// 4. Create API key via Better Auth
	let keyResult: any;
	try {
		keyResult = await locals.auth.api.createApiKey({
			body: {
				name: `${label} agent key`,
				prefix: 'mtl',
				userId: agentUserId
			}
		});
	} catch (e: any) {
		console.error('[Agents] createApiKey failed:', e);
		error(500, 'Failed to create API key');
	}

	const fullKey = keyResult?.key;
	const keyStart = keyResult?.start ?? (typeof fullKey === 'string' ? fullKey.slice(0, 8) + '...' : null);

	return json({
		ok: true,
		data: {
			id: bindingId!,
			label,
			model,
			key: fullKey,
			keyStart
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
		if (!firstMembership) error(400, 'No active organization');
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

	// Query agent bindings joined with apikey for key prefix
	const agents = await locals.db
		.select({
			id: agentRoomBindings.id,
			label: agentRoomBindings.label,
			model: agentRoomBindings.model,
			agentUserId: agentRoomBindings.agentUserId,
			createdAt: agentRoomBindings.createdAt,
			keyStart: apikey.start
		})
		.from(agentRoomBindings)
		.leftJoin(apikey, eq(apikey.userId, agentRoomBindings.agentUserId))
		.where(eq(agentRoomBindings.orgId, orgId))
		.orderBy(agentRoomBindings.createdAt);

	return json({
		ok: true,
		data: agents.map((a: typeof agents[number]) => ({
			id: a.id,
			label: a.label,
			model: a.model,
			agentUserId: a.agentUserId,
			keyStart: a.keyStart ?? null,
			createdAt: a.createdAt?.toISOString() ?? null
		}))
	});
};
