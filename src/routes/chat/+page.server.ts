import { redirect, error } from '@sveltejs/kit';
import { generateId } from 'better-auth';
import { user, member, organization, invitation, session as sessionTable } from '$lib/server/db/auth-schema';
import { messages as messagesTable, readCursors } from '$lib/server/db/schema';
import { eq, and, desc, isNull, inArray, sql, gt } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals, platform } = event;
	if (!locals.user || !locals.session) redirect(302, '/login');

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	// Resolve room from active org or first membership
	const activeOrgId = locals.session.activeOrganizationId;
	let roomId = '';
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
				// Use Better Auth API to accept — ensures hooks and validation run
				try {
					await locals.auth!.api.acceptInvitation({
						body: { invitationId: pendingInvite.id },
						headers: event.request.headers
					});
				} catch (e) {
					console.error('[Chat] Auto-accept invitation failed:', e);
				}

				roomId = pendingInvite.organizationId;
				userRole = pendingInvite.role || 'member';
			} else {
				// Organic user: auto-create a default room (organization)
				// Advisory lock prevents duplicate creation from concurrent requests
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await db.transaction(async (tx: any) => {
					await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${locals.user.id}))`);

					// Re-check membership after acquiring lock
					const [recheck] = await tx
						.select({ orgId: member.organizationId })
						.from(member)
						.where(eq(member.userId, locals.user.id))
						.limit(1);

					if (recheck) {
						roomId = recheck.orgId;
					} else {
						const orgId = generateId();
						const memberId = generateId();
						const now = new Date();
						const userName = locals.user.username || locals.user.name || `User-${locals.user.id.slice(0, 6)}`;
						const slug = `${userName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-room`;

						await tx.insert(organization).values({
							id: orgId,
							name: `${userName}'s Room`,
							slug,
							createdAt: now
						});
						await tx.insert(member).values({
							id: memberId,
							organizationId: orgId,
							userId: locals.user.id,
							role: 'owner',
							createdAt: now
						});

						roomId = orgId;
						userRole = 'owner';
					}
				});
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
			replyTo: messagesTable.replyTo,
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
			.select({ id: user.id, name: user.name, username: user.username })
			.from(user)
			.where(inArray(user.id, senderIds));
		for (const u of users) {
			senderNameMap.set(u.id, u.username || u.name || `User-${u.id.slice(0, 6)}`);
		}
	}

	// Reverse to chronological order and map to serializable format
	const initialMessages = recentMessages.reverse().map((msg: typeof recentMessages[number]) => ({
		dbId: msg.id,
		senderId: msg.senderId,
		senderName: senderNameMap.get(msg.senderId) ?? 'Unknown',
		senderRole: msg.senderRole,
		body: msg.body,
		replyTo: msg.replyTo ?? undefined,
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

	// Load invitations for this room (for invite list in MemberPanel)
	const roomInvitations = await db
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			createdAt: invitation.createdAt,
			inviterId: invitation.inviterId,
			// Left join to check if invited email has an account
			userId: user.id,
			username: user.username,
			userName: user.name
		})
		.from(invitation)
		.leftJoin(user, sql`LOWER(${user.email}) = LOWER(${invitation.email})`)
		.where(eq(invitation.organizationId, roomId))
		.orderBy(desc(invitation.createdAt));

	// Check if this room has any registered agents
	const [agentMember] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, roomId), eq(member.role, 'agent')))
		.limit(1);
	const hasAgents = !!agentMember;

	// Deduplicate per email — keep only the latest invitation (already sorted desc)
	const seenEmails = new Set<string>();
	const filteredInvitations = roomInvitations
		.filter((inv: typeof roomInvitations[number]) => {
			if (userRole !== 'owner' && inv.inviterId !== locals.user.id) return false;
			const key = inv.email.toLowerCase();
			if (seenEmails.has(key)) return false;
			seenEmails.add(key);
			return true;
		})
		.map((inv: typeof roomInvitations[number]) => ({
			id: inv.id,
			email: inv.email,
			role: inv.role || 'member',
			status: inv.status,
			createdAt: inv.createdAt.toISOString(),
			hasAccount: !!inv.userId,
			username: inv.username || inv.userName || null
		}));

	// Expose HMAC secret for owner/lead (needed by external clients like martol-client)
	let hmacSecret: string | null = null;
	if ((userRole === 'owner' || userRole === 'lead') && platform?.env) {
		hmacSecret = platform.env.HMAC_SIGNING_SECRET ?? null;
	}

	return {
		roomId,
		userId: locals.user.id,
		userName: locals.user.username || locals.user.name || `User-${locals.user.id.slice(0, 6)}`,
		userRole,
		roomName: org?.name || 'Chat',
		userRooms,
		roomInvitations: filteredInvitations,
		initialMessages,
		hasAgents,
		hmacSecret,
		enableUploads: platform?.env?.ENABLE_UPLOADS === 'true'
	};
};
