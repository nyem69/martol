import { eq, and } from 'drizzle-orm';
import { agentRoomBindings } from '$lib/server/db/schema';
import { user, member } from '$lib/server/db/auth-schema';
import type { McpError } from '$lib/types/mcp';
import type { HyperdriveDb } from '$lib/server/db/hyperdrive';

export interface AgentContext {
	agentUserId: string;
	agentName: string;
	orgId: string;
	orgRole: string;
	label: string;
	model: string;
}

type AuthResult =
	| { ok: true; agent: AgentContext }
	| { ok: false; status: number; error: McpError };

export async function authenticateAgent(
	apiKeyHeader: string | null,
	auth: any,
	db: any,
	kv?: KVNamespace
): Promise<AuthResult> {
	if (!apiKeyHeader) {
		return {
			ok: false,
			status: 401,
			error: { ok: false, error: 'Missing x-api-key header', code: 'auth_missing' }
		};
	}

	let keyData: any;
	try {
		keyData = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } });
	} catch {
		return {
			ok: false,
			status: 401,
			error: { ok: false, error: 'Invalid API key', code: 'auth_invalid' }
		};
	}

	if (!keyData?.valid) {
		return {
			ok: false,
			status: 401,
			error: { ok: false, error: 'Invalid API key', code: 'auth_invalid' }
		};
	}

	const agentUserId = keyData.key?.userId;
	if (!agentUserId) {
		return {
			ok: false,
			status: 401,
			error: { ok: false, error: 'API key has no associated user', code: 'auth_invalid' }
		};
	}

	if (kv && keyData.key?.id) {
		const revoked = await kv.get(`revoked:${keyData.key.id}`);
		if (revoked) {
			return {
				ok: false,
				status: 401,
				error: { ok: false, error: 'API key has been revoked', code: 'auth_revoked' }
			};
		}
	}

	// Single joined query instead of 3 sequential DB round-trips
	const [result] = await db
		.select({
			orgId: agentRoomBindings.orgId,
			label: agentRoomBindings.label,
			model: agentRoomBindings.model,
			role: member.role,
			name: user.name
		})
		.from(agentRoomBindings)
		.innerJoin(
			member,
			and(
				eq(member.organizationId, agentRoomBindings.orgId),
				eq(member.userId, agentRoomBindings.agentUserId)
			)
		)
		.innerJoin(user, eq(user.id, agentRoomBindings.agentUserId))
		.where(eq(agentRoomBindings.agentUserId, agentUserId))
		.limit(1);

	if (!result) {
		return {
			ok: false,
			status: 403,
			error: { ok: false, error: 'Agent not bound to any room or not a member', code: 'agent_unbound' }
		};
	}

	return {
		ok: true,
		agent: {
			agentUserId,
			agentName: result.name ?? result.label,
			orgId: result.orgId,
			orgRole: result.role,
			label: result.label,
			model: result.model
		}
	};
}
