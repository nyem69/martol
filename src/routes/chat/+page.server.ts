import { redirect, error } from '@sveltejs/kit';
import { member, organization } from '$lib/server/db/auth-schema';
import { messages as messagesTable } from '$lib/server/db/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
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

		if (!firstMembership) error(404, 'No organization found');
		roomId = firstMembership.orgId;
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

	// Reverse to chronological order and map to serializable format
	const initialMessages = recentMessages.reverse().map((msg) => ({
		dbId: msg.id,
		senderId: msg.senderId,
		senderRole: msg.senderRole,
		body: msg.body,
		createdAt: msg.createdAt.toISOString()
	}));

	return {
		roomId,
		userId: locals.user.id,
		userName: locals.user.name || locals.user.email || 'Unknown',
		userRole,
		roomName: org?.name || 'Chat',
		initialMessages
	};
};
