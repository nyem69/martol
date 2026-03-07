/**
 * Support Ticket Detail — view own ticket with comments
 */

import { redirect, error } from '@sveltejs/kit';
import { supportTickets, ticketComments } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq, asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const [ticket] = await db
		.select({
			id: supportTickets.id,
			userId: supportTickets.userId,
			title: supportTickets.title,
			description: supportTickets.description,
			category: supportTickets.category,
			status: supportTickets.status,
			createdAt: supportTickets.createdAt,
			updatedAt: supportTickets.updatedAt
		})
		.from(supportTickets)
		.where(eq(supportTickets.id, params.id))
		.limit(1);

	if (!ticket) error(404, 'Ticket not found');

	// Only ticket owner or admin can view
	if (ticket.userId !== locals.user.id && !locals.isAdmin) {
		error(403, 'Access denied');
	}

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
			createdAt: ticket.createdAt?.toISOString() ?? null,
			updatedAt: ticket.updatedAt?.toISOString() ?? null
		},
		comments: comments.map((c: (typeof comments)[number]) => ({
			...c,
			createdAt: c.createdAt?.toISOString() ?? null
		})),
		isAdmin: locals.isAdmin
	};
};
