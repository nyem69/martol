import { eq, and, isNull } from 'drizzle-orm';
import { messages } from '$lib/server/db/schema';
import type { AgentContext } from '../auth';
import type { ChatEditResult, McpResponse } from '$lib/types/mcp';

/**
 * Edits an existing message via the Durable Object for proper
 * WebSocket broadcast and WAL consistency.
 * Falls back to direct DB update if DO is unavailable.
 */
export async function chatEdit(
	params: { message_id: number; body: string },
	agent: AgentContext,
	db: any,
	platform?: App.Platform
): Promise<McpResponse<ChatEditResult>> {
	// Route through Durable Object for WebSocket broadcast
	if (platform?.env?.CHAT_ROOM) {
		const doId = platform.env.CHAT_ROOM.idFromName(agent.orgId);
		const stub = platform.env.CHAT_ROOM.get(doId);

		const editPayload = {
			serverSeqId: params.message_id,
			senderId: agent.agentUserId,
			orgId: agent.orgId,
			body: params.body
		};

		const doResponse = await stub.fetch(new Request('https://do/edit', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': platform.env.HMAC_SIGNING_SECRET || platform.env.BETTER_AUTH_SECRET
			},
			body: JSON.stringify(editPayload)
		}));

		if (!doResponse.ok) {
			const err = await doResponse.json().catch(() => ({ error: 'DO edit failed' }));
			return { ok: false, error: (err as any).error || 'Failed to edit message', code: 'edit_failed' };
		}

		const result = await doResponse.json() as { editedAt: string };

		return {
			ok: true,
			data: { edited_at: result.editedAt }
		};
	}

	// Fallback: direct DB update (no DO available)
	const [existing] = await db
		.select({ id: messages.id, senderId: messages.senderId })
		.from(messages)
		.where(and(eq(messages.id, params.message_id), eq(messages.orgId, agent.orgId), isNull(messages.deletedAt)))
		.limit(1);

	if (!existing) {
		return { ok: false, error: 'Message not found', code: 'not_found' };
	}

	if (existing.senderId !== agent.agentUserId) {
		return { ok: false, error: 'Can only edit own messages', code: 'unauthorized' };
	}

	const editedAt = new Date();
	await db
		.update(messages)
		.set({ body: params.body, editedAt })
		.where(and(eq(messages.id, params.message_id), eq(messages.orgId, agent.orgId)));

	return {
		ok: true,
		data: { edited_at: editedAt.toISOString() }
	};
}
