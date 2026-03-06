/**
 * POST /api/support/tickets — Create a support ticket
 * GET  /api/support/tickets — List tickets (admin: all, user: own)
 *
 * Auth: any authenticated user.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { supportTickets } from '$lib/server/db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { user } from '$lib/server/db/auth-schema';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const title = typeof body.title === 'string' ? body.title.trim() : '';
	const description = typeof body.description === 'string' ? body.description.trim() : '';
	const category = typeof body.category === 'string' ? body.category : 'other';

	if (!title || title.length < 3 || title.length > 200) {
		error(400, 'Title must be 3-200 characters');
	}
	if (!description || description.length < 10 || description.length > 5000) {
		error(400, 'Description must be 10-5000 characters');
	}
	const validCategories = ['bug', 'feature_request', 'question', 'issue', 'other'];
	if (!validCategories.includes(category)) {
		error(400, 'Invalid category');
	}

	const id = crypto.randomUUID().replace(/-/g, '').slice(0, 21);

	await locals.db.insert(supportTickets).values({
		id,
		userId: locals.user.id,
		title,
		description,
		category: category as 'bug' | 'feature_request' | 'question' | 'issue' | 'other'
	});

	return json({ ok: true, data: { id, title, status: 'open' } }, { status: 201 });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const status = url.searchParams.get('status');
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
	const offset = parseInt(url.searchParams.get('offset') || '0');

	const isAdmin = locals.isAdmin;

	const conditions = [];
	if (!isAdmin) {
		conditions.push(eq(supportTickets.userId, locals.user.id));
	}
	if (status) {
		const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
		if (validStatuses.includes(status)) {
			conditions.push(
				eq(
					supportTickets.status,
					status as 'open' | 'in_progress' | 'resolved' | 'closed'
				)
			);
		}
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const [tickets, [{ count }]] = await Promise.all([
		locals.db
			.select({
				id: supportTickets.id,
				title: supportTickets.title,
				category: supportTickets.category,
				status: supportTickets.status,
				userId: supportTickets.userId,
				userName: user.name,
				createdAt: supportTickets.createdAt,
				updatedAt: supportTickets.updatedAt
			})
			.from(supportTickets)
			.leftJoin(user, eq(user.id, supportTickets.userId))
			.where(where)
			.orderBy(desc(supportTickets.createdAt))
			.limit(limit)
			.offset(offset),
		locals.db
			.select({ count: sql<number>`count(*)::int` })
			.from(supportTickets)
			.where(where)
	]);

	return json({
		ok: true,
		data: tickets.map((t: (typeof tickets)[number]) => ({
			...t,
			createdAt: t.createdAt?.toISOString() ?? null,
			updatedAt: t.updatedAt?.toISOString() ?? null
		})),
		total: count ?? 0
	});
};
