/**
 * GET /api/messages — Cursor-based message history for the user's active room
 *
 * Auth: session-based, any member.
 * Query params:
 *   before: message ID to paginate before (exclusive)
 *   limit: max messages to return (default 50, max 100)
 *
 * Returns messages in chronological order (oldest first).
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member } from '$lib/server/db/auth-schema';
import { user } from '$lib/server/db/auth-schema';
import { messages as messagesTable } from '$lib/server/db/schema';
import { eq, and, lt, desc, isNull, inArray } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const orgId = locals.session.activeOrganizationId;
	if (!orgId) {
		return json({ ok: true, data: [] });
	}

	// Verify membership
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}

	const beforeId = parseInt(url.searchParams.get('before') ?? '', 10);
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 100);

	const conditions = [eq(messagesTable.orgId, orgId), isNull(messagesTable.deletedAt)];
	if (!isNaN(beforeId) && beforeId > 0) {
		conditions.push(lt(messagesTable.id, beforeId));
	}

	const rows = await locals.db
		.select({
			id: messagesTable.id,
			senderId: messagesTable.senderId,
			senderRole: messagesTable.senderRole,
			body: messagesTable.body,
			createdAt: messagesTable.createdAt
		})
		.from(messagesTable)
		.where(and(...conditions))
		.orderBy(desc(messagesTable.id))
		.limit(limit);

	// Resolve sender names
	const senderIds: string[] = [...new Set<string>(rows.map((r: typeof rows[number]) => r.senderId))];
	const senderNameMap = new Map<string, string>();
	if (senderIds.length > 0) {
		const users = await locals.db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(inArray(user.id, senderIds));
		for (const u of users) {
			senderNameMap.set(u.id, u.name);
		}
	}

	// Return in chronological order (oldest first)
	const messages = rows.reverse().map((msg: typeof rows[number]) => ({
		id: msg.id,
		sender_id: msg.senderId,
		sender_name: senderNameMap.get(msg.senderId) ?? 'Unknown',
		sender_role: msg.senderRole,
		body: msg.body,
		created_at: msg.createdAt.toISOString()
	}));

	return json({
		ok: true,
		data: messages,
		has_more: rows.length === limit
	});
};
