import { eq, and, gt, desc, isNull, inArray, sql } from 'drizzle-orm';
import { messages, agentCursors } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import type { AgentContext } from '../auth';
import type { ChatReadResult, ChatMessage, McpResponse } from '$lib/types/mcp';

type MessageRow = {
	id: number;
	senderId: string;
	senderRole: string;
	body: string;
	replyTo: number | null;
	createdAt: Date;
};

async function formatMessages(rows: MessageRow[], db: any): Promise<ChatMessage[]> {
	if (rows.length === 0) return [];

	const senderIds = [...new Set(rows.map((r) => r.senderId))];
	const users = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(inArray(user.id, senderIds));

	const nameMap = new Map<string, string>(
		users.map((u: { id: string; name: string }) => [u.id, u.name])
	);

	return rows.map((r) => ({
		id: r.id,
		sender_id: r.senderId,
		sender_name: nameMap.get(r.senderId) ?? 'Unknown',
		sender_role: r.senderRole,
		body: r.body,
		reply_to: r.replyTo,
		timestamp: r.createdAt.toISOString()
	}));
}

async function upsertCursor(db: any, orgId: string, agentUserId: string, lastReadId: number) {
	await db
		.insert(agentCursors)
		.values({
			orgId,
			agentUserId,
			lastReadId,
			updatedAt: new Date()
		})
		.onConflictDoUpdate({
			target: [agentCursors.orgId, agentCursors.agentUserId],
			set: {
				// Only advance cursor forward — prevents race condition on concurrent reads
				lastReadId: sql`GREATEST(${agentCursors.lastReadId}, ${lastReadId})`,
				updatedAt: new Date()
			}
		});
}

export async function chatRead(
	params: { limit: number },
	agent: AgentContext,
	db: any
): Promise<McpResponse<ChatReadResult>> {
	const [cursor] = await db
		.select({ lastReadId: agentCursors.lastReadId })
		.from(agentCursors)
		.where(
			and(eq(agentCursors.orgId, agent.orgId), eq(agentCursors.agentUserId, agent.agentUserId))
		)
		.limit(1);

	const lastReadId = cursor?.lastReadId ?? 0;

	const rows: MessageRow[] = await db
		.select({
			id: messages.id,
			senderId: messages.senderId,
			senderRole: messages.senderRole,
			body: messages.body,
			replyTo: messages.replyTo,
			createdAt: messages.createdAt
		})
		.from(messages)
		.where(
			and(eq(messages.orgId, agent.orgId), gt(messages.id, lastReadId), isNull(messages.deletedAt))
		)
		.orderBy(messages.id)
		.limit(params.limit + 1);

	const hasMore = rows.length > params.limit;
	const resultRows = hasMore ? rows.slice(0, params.limit) : rows;
	const formatted = await formatMessages(resultRows, db);

	const newCursor = resultRows.length > 0 ? resultRows[resultRows.length - 1].id : lastReadId;

	if (resultRows.length > 0) {
		await upsertCursor(db, agent.orgId, agent.agentUserId, newCursor);
	}

	return {
		ok: true,
		data: {
			messages: formatted,
			cursor: newCursor,
			has_more: hasMore
		}
	};
}

export async function chatResync(
	params: { limit: number },
	agent: AgentContext,
	db: any
): Promise<McpResponse<ChatReadResult>> {
	const rows: MessageRow[] = await db
		.select({
			id: messages.id,
			senderId: messages.senderId,
			senderRole: messages.senderRole,
			body: messages.body,
			replyTo: messages.replyTo,
			createdAt: messages.createdAt
		})
		.from(messages)
		.where(and(eq(messages.orgId, agent.orgId), isNull(messages.deletedAt)))
		.orderBy(desc(messages.id))
		.limit(params.limit);

	rows.reverse();
	const formatted = await formatMessages(rows, db);

	const newCursor = rows.length > 0 ? rows[rows.length - 1].id : 0;
	await upsertCursor(db, agent.orgId, agent.agentUserId, newCursor);

	return {
		ok: true,
		data: {
			messages: formatted,
			cursor: newCursor,
			has_more: false
		}
	};
}
