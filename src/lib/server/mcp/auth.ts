import { eq, and } from 'drizzle-orm';
import { agentRoomBindings } from '$lib/server/db/schema';
import { user, member } from '$lib/server/db/auth-schema';
import type { McpError } from '$lib/types/mcp';

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

	const [binding] = await db
		.select({
			orgId: agentRoomBindings.orgId,
			label: agentRoomBindings.label,
			model: agentRoomBindings.model
		})
		.from(agentRoomBindings)
		.where(eq(agentRoomBindings.agentUserId, agentUserId))
		.limit(1);

	if (!binding) {
		return {
			ok: false,
			status: 403,
			error: { ok: false, error: 'Agent not bound to any room', code: 'agent_unbound' }
		};
	}

	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, binding.orgId), eq(member.userId, agentUserId)))
		.limit(1);

	if (!memberRecord) {
		return {
			ok: false,
			status: 403,
			error: {
				ok: false,
				error: 'Agent is not a member of the bound room',
				code: 'agent_not_member'
			}
		};
	}

	const [agentUser] = await db
		.select({ name: user.name })
		.from(user)
		.where(eq(user.id, agentUserId))
		.limit(1);

	return {
		ok: true,
		agent: {
			agentUserId,
			agentName: agentUser?.name ?? binding.label,
			orgId: binding.orgId,
			orgRole: memberRecord.role,
			label: binding.label,
			model: binding.model
		}
	};
}
