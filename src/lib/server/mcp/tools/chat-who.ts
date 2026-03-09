import { eq, and } from 'drizzle-orm';
import { member, user, organization } from '$lib/server/db/auth-schema';
import { projectBrief } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatWhoResult, ChatWhoMember, McpResponse } from '$lib/types/mcp';

export async function chatWho(
	agent: AgentContext,
	db: any
): Promise<McpResponse<ChatWhoResult>> {
	const [org] = await db
		.select({ name: organization.name, metadata: organization.metadata })
		.from(organization)
		.where(eq(organization.id, agent.orgId))
		.limit(1);

	// Try project_brief table first (active row)
	let brief: string | null = null;
	const [activeBrief] = await db
		.select({ content: projectBrief.content })
		.from(projectBrief)
		.where(and(eq(projectBrief.orgId, agent.orgId), eq(projectBrief.status, 'active')))
		.limit(1);

	if (activeBrief) {
		brief = activeBrief.content;
	} else if (org?.metadata) {
		// Fallback: organization.metadata
		try {
			const meta = typeof org.metadata === 'string' ? JSON.parse(org.metadata) : org.metadata;
			brief = meta?.brief ?? null;
		} catch { /* ignore invalid JSON */ }
	}

	const members = await db
		.select({
			userId: member.userId,
			role: member.role,
			name: user.name,
			aiOptOut: member.aiOptOut
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, agent.orgId));

	const result: ChatWhoMember[] = members.map((m: any) => ({
		user_id: m.userId,
		name: m.name,
		role: m.role,
		is_agent: m.role === 'agent',
		ai_opt_out: m.aiOptOut ?? false
	}));

	return {
		ok: true,
		data: {
			room_id: agent.orgId,
			room_name: org?.name ?? 'Unknown',
			self_user_id: agent.agentUserId,
			members: result,
			brief
		}
	};
}
