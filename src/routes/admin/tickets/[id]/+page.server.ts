/**
 * Admin Ticket Detail — view ticket with comments
 */

import { error } from '@sveltejs/kit';
import { supportTickets, ticketComments } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq, asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const [ticket] = await db
		.select({
			id: supportTickets.id,
			userId: supportTickets.userId,
			userName: user.name,
			title: supportTickets.title,
			description: supportTickets.description,
			category: supportTickets.category,
			status: supportTickets.status,
			assignedTo: supportTickets.assignedTo,
			resolvedAt: supportTickets.resolvedAt,
			resolvedBy: supportTickets.resolvedBy,
			closedAt: supportTickets.closedAt,
			closedBy: supportTickets.closedBy,
			createdAt: supportTickets.createdAt,
			updatedAt: supportTickets.updatedAt
		})
		.from(supportTickets)
		.leftJoin(user, eq(user.id, supportTickets.userId))
		.where(eq(supportTickets.id, params.id))
		.limit(1);

	if (!ticket) error(404, 'Ticket not found');

	const comments = await db
		.select({
			id: ticketComments.id,
			userId: ticketComments.userId,
			agentUserId: ticketComments.agentUserId,
			userName: user.name,
			content: ticketComments.content,
			parentId: ticketComments.parentId,
			createdAt: ticketComments.createdAt
		})
		.from(ticketComments)
		.leftJoin(user, eq(user.id, ticketComments.userId))
		.where(eq(ticketComments.ticketId, params.id))
		.orderBy(asc(ticketComments.createdAt));

	return {
		ticket: {
			...ticket,
			resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
			closedAt: ticket.closedAt?.toISOString() ?? null,
			createdAt: ticket.createdAt?.toISOString() ?? null,
			updatedAt: ticket.updatedAt?.toISOString() ?? null
		},
		comments: comments.map((c: (typeof comments)[number]) => ({
			...c,
			createdAt: c.createdAt?.toISOString() ?? null
		}))
	};
};
