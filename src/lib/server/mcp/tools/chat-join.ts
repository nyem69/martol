import { messages } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { AgentContext } from '../auth';
import type { McpResponse } from '$lib/types/mcp';

const REJOIN_COOLDOWN_MS = 60_000; // 1 minute — prevent duplicate join spam on reconnect

export async function chatJoin(
	agent: AgentContext,
	db: any
): Promise<McpResponse<{ joined: true; room_id: string }>> {
	// Idempotency: skip if this agent already joined recently
	const [lastJoin] = await db
		.select({ createdAt: messages.createdAt })
		.from(messages)
		.where(
			and(
				eq(messages.orgId, agent.orgId),
				eq(messages.senderId, agent.agentUserId),
				eq(messages.type, 'join')
			)
		)
		.orderBy(desc(messages.createdAt))
		.limit(1);

	const now = Date.now();
	if (lastJoin && now - new Date(lastJoin.createdAt).getTime() < REJOIN_COOLDOWN_MS) {
		return {
			ok: true,
			data: { joined: true, room_id: agent.orgId }
		};
	}

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
