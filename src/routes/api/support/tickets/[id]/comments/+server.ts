/**
 * GET  /api/support/tickets/[id]/comments — List comments
 * POST /api/support/tickets/[id]/comments — Add comment
 *
 * Auth: ticket owner or admin.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { supportTickets, ticketComments } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq, asc } from 'drizzle-orm';

/** Check that the caller owns the ticket or is admin */
async function verifyTicketAccess(
	db: NonNullable<App.Locals['db']>,
	ticketId: string,
	userId: string,
	isAdmin: boolean
) {
	const [ticket] = await db
		.select({ userId: supportTickets.userId })
		.from(supportTickets)
		.where(eq(supportTickets.id, ticketId))
		.limit(1);

	if (!ticket) error(404, 'Ticket not found');
	if (ticket.userId !== userId && !isAdmin) error(403, 'Access denied');
	return ticket;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	await verifyTicketAccess(locals.db, params.id, locals.user.id, locals.isAdmin);

	const comments = await locals.db
		.select({
			id: ticketComments.id,
			ticketId: ticketComments.ticketId,
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

	return json({
		ok: true,
		data: comments.map((c: (typeof comments)[number]) => ({
			...c,
			createdAt: c.createdAt?.toISOString() ?? null
		}))
	});
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	await verifyTicketAccess(locals.db, params.id, locals.user.id, locals.isAdmin);

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const content = typeof body.content === 'string' ? body.content.trim() : '';
	const parentId = typeof body.parentId === 'string' ? body.parentId : null;

	if (!content || content.length < 1 || content.length > 5000) {
		error(400, 'Comment must be 1-5000 characters');
	}

	const id = crypto.randomUUID().replace(/-/g, '').slice(0, 21);

	await locals.db.insert(ticketComments).values({
		id,
		ticketId: params.id,
		userId: locals.user.id,
		content,
		parentId
	});

	return json({ ok: true, data: { id, content } }, { status: 201 });
};
