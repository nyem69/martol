import { redirect, error } from '@sveltejs/kit';
import { generateId } from 'better-auth';
import { user, member, organization, invitation, session as sessionTable } from '$lib/server/db/auth-schema';
import { messages as messagesTable, readCursors } from '$lib/server/db/schema';
import { eq, and, desc, isNull, inArray, sql, gt } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
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
			// Check for pending invitations before auto-creating a room
			const [pendingInvite] = await db
				.select({
					id: invitation.id,
					organizationId: invitation.organizationId,
					role: invitation.role
				})
				.from(invitation)
				.where(
					and(
						sql`LOWER(${invitation.email}) = LOWER(${locals.user.email!})`,
						eq(invitation.status, 'pending'),
						gt(invitation.expiresAt, new Date())
					)
				)
				.limit(1);

			if (pendingInvite) {
				// Accept the invitation: add user as member and mark invitation as accepted
				const memberId = generateId();
				const now = new Date();
				await db.insert(member).values({
					id: memberId,
					organizationId: pendingInvite.organizationId,
					userId: locals.user.id,
					role: pendingInvite.role || 'member',
					createdAt: now
				});
				await db
					.update(invitation)
					.set({ status: 'accepted' })
					.where(eq(invitation.id, pendingInvite.id));

				roomId = pendingInvite.organizationId;
				userRole = pendingInvite.role || 'member';
			} else {
				// Organic user: auto-create a default room (organization)
				const orgId = generateId();
				const memberId = generateId();
				const now = new Date();
				const userName = locals.user.name || (locals.user as any).username || `User-${locals.user.id.slice(0, 6)}`;
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

	// Ensure activeOrganizationId is set on the session (fixes actions/WS after org auto-creation)
	if (locals.session.activeOrganizationId !== roomId) {
		await db
			.update(sessionTable)
			.set({ activeOrganizationId: roomId })
			.where(eq(sessionTable.id, locals.session.id));
		locals.session.activeOrganizationId = roomId;
	}

	// Get org name for header
	const [org] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, roomId))
		.limit(1);

	// Load all rooms the user belongs to (for room switcher)
	const userRooms = await db
		.select({ id: organization.id, name: organization.name })
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, locals.user.id));

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

	// Update read cursor to latest loaded message
	if (initialMessages.length > 0) {
		const latestId = initialMessages[initialMessages.length - 1].dbId;
		await db
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
	}

	// Check if this room has any registered agents
	const [agentMember] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, roomId), eq(member.role, 'agent')))
		.limit(1);
	const hasAgents = !!agentMember;

	return {
		roomId,
		userId: locals.user.id,
		userName: locals.user.name || (locals.user as any).username || `User-${locals.user.id.slice(0, 6)}`,
		userRole,
		roomName: org?.name || 'Chat',
		userRooms,
		initialMessages,
		hasAgents
	};
};
