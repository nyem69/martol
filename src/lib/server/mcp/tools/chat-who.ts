import { eq } from 'drizzle-orm';
import { member, user, organization } from '$lib/server/db/auth-schema';
import { getActiveBrief } from '$lib/server/db/brief';
import type { AgentContext } from '../auth';
import type { ChatWhoResult, ChatWhoMember, McpResponse } from '$lib/types/mcp';

export async function chatWho(
	agent: AgentContext,
	db: any
): Promise<McpResponse<ChatWhoResult>> {
	const [orgResult, briefResult, membersResult] = await Promise.all([
		db
			.select({ name: organization.name })
			.from(organization)
			.where(eq(organization.id, agent.orgId))
			.limit(1),
		getActiveBrief(db, agent.orgId),
		db
			.select({
				userId: member.userId,
				role: member.role,
				name: user.name,
				aiOptOut: member.aiOptOut
			})
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, agent.orgId))
	]);

	const org = orgResult[0];

	const result: ChatWhoMember[] = membersResult.map((m: any) => ({
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
			brief: briefResult.content,
			brief_version: briefResult.version
		}
	};
}
