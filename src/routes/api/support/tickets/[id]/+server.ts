/**
 * GET   /api/support/tickets/[id] — Ticket detail (owner or admin)
 * PATCH /api/support/tickets/[id] — Update status/assignment (admin only)
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { supportTickets, ticketComments } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const [ticket] = await locals.db
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

	// Only ticket owner or admin can view
	if (ticket.userId !== locals.user.id && !locals.isAdmin) {
		error(403, 'Access denied');
	}

	const [{ count }] = await locals.db
		.select({ count: sql<number>`count(*)::int` })
		.from(ticketComments)
		.where(eq(ticketComments.ticketId, params.id));

	return json({
		ok: true,
		data: {
			...ticket,
			commentCount: count ?? 0,
			resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
			closedAt: ticket.closedAt?.toISOString() ?? null,
			createdAt: ticket.createdAt?.toISOString() ?? null,
			updatedAt: ticket.updatedAt?.toISOString() ?? null
		}
	});
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');
	if (!locals.isAdmin) error(403, 'Admin access required');

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

	const updates: Record<string, unknown> = { updatedAt: new Date() };

	if (typeof body.status === 'string') {
		const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
		if (!validStatuses.includes(body.status)) error(400, 'Invalid status');

		updates.status = body.status;

		if (body.status === 'resolved') {
			updates.resolvedAt = new Date();
			updates.resolvedBy = locals.user.id;
		} else if (body.status === 'closed') {
			updates.closedAt = new Date();
			updates.closedBy = locals.user.id;
		}
	}

	if (Array.isArray(body.assignedTo)) {
		updates.assignedTo = body.assignedTo;
	}

	const [updated] = await locals.db
		.update(supportTickets)
		.set(updates)
		.where(eq(supportTickets.id, params.id))
		.returning({ id: supportTickets.id, status: supportTickets.status });

	if (!updated) error(404, 'Ticket not found');

	return json({ ok: true, data: updated });
};
