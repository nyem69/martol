import { eq, and, isNull } from 'drizzle-orm';
import { messages } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatSendResult, McpResponse } from '$lib/types/mcp';

/**
 * Routes agent messages through the Durable Object for proper
 * WebSocket broadcast, ordering, and WAL pipeline.
 * Falls back to direct DB insert if DO is unavailable.
 */
export async function chatSend(
	params: { body: string; replyTo?: number },
	agent: AgentContext,
	db: any,
	platform?: App.Platform
): Promise<McpResponse<ChatSendResult>> {
	// Validate replyTo against DB (soft-delete check)
	if (params.replyTo) {
		const [replyMsg] = await db
			.select({ id: messages.id })
			.from(messages)
			.where(and(eq(messages.id, params.replyTo), eq(messages.orgId, agent.orgId), isNull(messages.deletedAt)))
			.limit(1);

		if (!replyMsg) {
			return { ok: false, error: 'Reply target message not found', code: 'invalid_reply' };
		}
	}

	// Route through Durable Object for WebSocket broadcast + unified write path
	if (platform?.env?.CHAT_ROOM) {
		const localId = crypto.randomUUID().replace(/-/g, '');
		const doId = platform.env.CHAT_ROOM.idFromName(agent.orgId);
		const stub = platform.env.CHAT_ROOM.get(doId);

		const ingestPayload = {
			localId,
			senderId: agent.agentUserId,
			senderRole: 'agent',
			senderName: agent.agentName,
			orgId: agent.orgId,
			body: params.body,
			replyTo: params.replyTo
		};

		const doResponse = await stub.fetch(new Request('https://do/ingest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(ingestPayload)
		}));

		if (!doResponse.ok) {
			const err = await doResponse.json().catch(() => ({ error: 'DO ingest failed' }));
			return { ok: false, error: (err as any).error || 'Failed to send message', code: 'send_failed' };
		}

		const result = await doResponse.json() as { serverSeqId: number; timestamp: string };

		return {
			ok: true,
			data: {
				message_id: result.serverSeqId,
				timestamp: result.timestamp
			}
		};
	}

	// Fallback: direct DB insert (no DO available — e.g., local dev without wrangler)
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
