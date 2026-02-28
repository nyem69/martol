import { eq } from 'drizzle-orm';
import { member, user, organization } from '$lib/server/db/auth-schema';
import { agentRoomBindings } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatWhoResult, ChatWhoMember, McpResponse } from '$lib/types/mcp';

export async function chatWho(
	agent: AgentContext,
	db: any
): Promise<McpResponse<ChatWhoResult>> {
	const [org] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, agent.orgId))
		.limit(1);

	const members = await db
		.select({
			userId: member.userId,
			role: member.role,
			name: user.name
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, agent.orgId));

	const agentBindings = await db
		.select({ agentUserId: agentRoomBindings.agentUserId })
		.from(agentRoomBindings)
		.where(eq(agentRoomBindings.orgId, agent.orgId));

	const agentUserIds = new Set(agentBindings.map((b: any) => b.agentUserId));

	const result: ChatWhoMember[] = members.map((m: any) => ({
		user_id: m.userId,
		name: m.name,
		role: m.role,
		is_agent: agentUserIds.has(m.userId)
	}));

	return {
		ok: true,
		data: {
			room_id: agent.orgId,
			room_name: org?.name ?? 'Unknown',
			members: result
		}
	};
}
