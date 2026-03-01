import { eq, and } from 'drizzle-orm';
import { user, member } from '$lib/server/db/auth-schema';

export interface AgentContext {
	agentUserId: string;
	agentName: string;
	orgId: string;
	orgRole: string;
}

interface McpError {
	ok: false;
	error: string;
	code: string;
}

type AuthResult =
	| { ok: true; agent: AgentContext }
	| { ok: false; status: number; error: McpError };

// db typed as any: App.Locals.db is any (Drizzle instance varies by env — Hyperdrive vs direct pool)
export async function authenticateAgent(
	apiKeyHeader: string | null,
	auth: { api: { verifyApiKey: (opts: { body: { key: string } }) => Promise<any> } },
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

	// Single joined query: member + user to resolve agent context
	const [result] = await db
		.select({
			orgId: member.organizationId,
			role: member.role,
			name: user.name
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(and(eq(member.userId, agentUserId), eq(member.role, 'agent')))
		.limit(1);

	if (!result) {
		return {
			ok: false,
			status: 403,
			error: { ok: false, error: 'Agent not a member of any room', code: 'agent_unbound' }
		};
	}

	return {
		ok: true,
		agent: {
			agentUserId,
			agentName: result.name ?? `Agent-${agentUserId.slice(0, 6)}`,
			orgId: result.orgId,
			orgRole: result.role
		}
	};
}
