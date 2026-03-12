import { eq, and } from 'drizzle-orm';
import { user, member } from '$lib/server/db/auth-schema';

export interface AgentContext {
	agentUserId: string;
	agentName: string;
	orgId: string;
	orgRole: string;
	isAdmin: boolean;
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
	kv?: KVNamespace,
	orgIdHint?: string | null
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

	const agentUserId = keyData.key?.referenceId;
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

	// Resolve agent context — prefer orgIdHint if the agent is a member of that org
	const baseConditions = [eq(member.userId, agentUserId), eq(member.role, 'agent')];
	if (orgIdHint) {
		baseConditions.push(eq(member.organizationId, orgIdHint));
	}

	console.log(`[MCP:auth] userId=${agentUserId}, orgIdHint=${orgIdHint ?? 'none'}, conditions=${baseConditions.length}`);

	const [result] = await db
		.select({
			orgId: member.organizationId,
			role: member.role,
			name: user.name,
			userRole: user.role
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(and(...baseConditions))
		.orderBy(member.createdAt)
		.limit(1);

	if (!result) {
		console.log(`[MCP:auth] No membership found for userId=${agentUserId} with orgIdHint=${orgIdHint ?? 'none'}`);
		return {
			ok: false,
			status: 403,
			error: { ok: false, error: 'Agent not a member of any room', code: 'agent_unbound' }
		};
	}

	console.log(`[MCP:auth] Resolved orgId=${result.orgId} (hint was ${orgIdHint ?? 'none'})`);

	return {
		ok: true,
		agent: {
			agentUserId,
			agentName: result.name ?? `Agent-${agentUserId.slice(0, 6)}`,
			orgId: result.orgId,
			orgRole: result.role,
			isAdmin: result.userRole === 'admin'
		}
	};
}
