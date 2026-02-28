import { redirect, error } from '@sveltejs/kit';
import { user, member, organization } from '$lib/server/db/auth-schema';
import { messages as messagesTable, readCursors } from '$lib/server/db/schema';
import { eq, and, desc, isNull, inArray, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	// Resolve room from active org or first membership
	const activeOrgId = locals.session.activeOrganizationId;
	let roomId: string;
	let userRole = 'member';

	if (activeOrgId) {
		roomId = activeOrgId;
	} else {
		const [firstMembership] = await db
			.select({ orgId: member.organizationId })
			.from(member)
			.where(eq(member.userId, locals.user.id))
			.limit(1);

		if (firstMembership) {
			roomId = firstMembership.orgId;
		} else {
			// First-time user: auto-create a default room (organization)
			const orgId = crypto.randomUUID();
			const memberId = crypto.randomUUID();
			const now = new Date();
			const userName = locals.user.name || locals.user.email?.split('@')[0] || 'User';
			const slug = `${userName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-room`;

			await db.insert(organization).values({
				id: orgId,
				name: `${userName}'s Room`,
				slug,
				createdAt: now
			});
			await db.insert(member).values({
				id: memberId,
				organizationId: orgId,
				userId: locals.user.id,
				role: 'owner',
				createdAt: now
			});

			roomId = orgId;
			userRole = 'owner';
		}
	}

	// Get user's role in this org
	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, roomId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (memberRecord) {
		userRole = memberRecord.role;
	}

	// Get org name for header
	const [org] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, roomId))
		.limit(1);

	// Load recent messages from PostgreSQL as fallback history
	const recentMessages = await db
		.select({
			id: messagesTable.id,
			senderId: messagesTable.senderId,
			senderRole: messagesTable.senderRole,
			body: messagesTable.body,
			createdAt: messagesTable.createdAt
		})
		.from(messagesTable)
		.where(and(eq(messagesTable.orgId, roomId), isNull(messagesTable.deletedAt)))
		.orderBy(desc(messagesTable.id))
		.limit(50);

	// Resolve sender names via batched user lookup
	const senderIds = [...new Set<string>(recentMessages.map((row: typeof recentMessages[number]) => row.senderId))];
	const senderNameMap = new Map<string, string>();
	if (senderIds.length > 0) {
		const users = await db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(inArray(user.id, senderIds));
		for (const u of users) {
			senderNameMap.set(u.id, u.name);
		}
	}

	// Reverse to chronological order and map to serializable format
	const initialMessages = recentMessages.reverse().map((msg: typeof recentMessages[number]) => ({
		dbId: msg.id,
		senderId: msg.senderId,
		senderName: senderNameMap.get(msg.senderId) ?? 'Unknown',
		senderRole: msg.senderRole,
		body: msg.body,
		createdAt: msg.createdAt.toISOString()
	}));

	// Update read cursor to latest loaded message (non-blocking)
	// [I4] Use waitUntil to keep worker alive until cursor update completes
	if (initialMessages.length > 0) {
		const latestId = initialMessages[initialMessages.length - 1].dbId;
		const cursorPromise = db
			.insert(readCursors)
			.values({
				orgId: roomId,
				userId: locals.user.id,
				lastReadMessageId: latestId,
				updatedAt: new Date()
			})
			.onConflictDoUpdate({
				target: [readCursors.orgId, readCursors.userId],
				set: {
					lastReadMessageId: sql`GREATEST(${readCursors.lastReadMessageId}, ${latestId})`,
					updatedAt: new Date()
				}
			})
			.catch((err: unknown) => console.error('[Chat] Read cursor update failed:', err));

		platform?.context?.waitUntil(cursorPromise);
	}

	return {
		roomId,
		userId: locals.user.id,
		userName: locals.user.name || locals.user.email || 'Unknown',
		userRole,
		roomName: org?.name || 'Chat',
		initialMessages
	};
};
