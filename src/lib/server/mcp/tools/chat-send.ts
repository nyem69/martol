import { eq, and } from 'drizzle-orm';
import { messages } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatSendResult, McpResponse } from '$lib/types/mcp';

export async function chatSend(
	params: { body: string; replyTo?: number },
	agent: AgentContext,
	db: any
): Promise<McpResponse<ChatSendResult>> {
	if (params.replyTo) {
		const [replyMsg] = await db
			.select({ id: messages.id })
			.from(messages)
			.where(and(eq(messages.id, params.replyTo), eq(messages.orgId, agent.orgId)))
			.limit(1);

		if (!replyMsg) {
			return { ok: false, error: 'Reply target message not found', code: 'invalid_reply' };
		}
	}

	const [inserted] = await db
		.insert(messages)
		.values({
			orgId: agent.orgId,
			senderId: agent.agentUserId,
			senderRole: 'agent' as const,
			type: 'chat' as const,
			body: params.body,
			replyTo: params.replyTo ?? null
		})
		.returning({ id: messages.id, createdAt: messages.createdAt });

	return {
		ok: true,
		data: {
			message_id: inserted.id,
			timestamp: inserted.createdAt.toISOString()
		}
	};
}
