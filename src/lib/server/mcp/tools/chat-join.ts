import { messages } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { McpResponse } from '$lib/types/mcp';

export async function chatJoin(
	agent: AgentContext,
	db: any
): Promise<McpResponse<{ joined: true; room_id: string }>> {
	await db.insert(messages).values({
		orgId: agent.orgId,
		senderId: agent.agentUserId,
		senderRole: 'agent' as const,
		type: 'join' as const,
		body: `${agent.label} joined the room`
	});

	return {
		ok: true,
		data: { joined: true, room_id: agent.orgId }
	};
}
