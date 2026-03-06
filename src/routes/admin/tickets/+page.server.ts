/**
 * Admin Tickets — all support tickets with filtering
 */

import { error } from '@sveltejs/kit';
import { supportTickets } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { desc, eq, sql, and } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const status = url.searchParams.get('status');
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
	const offset = parseInt(url.searchParams.get('offset') || '0');

	const conditions = [];
	if (status) {
		const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
		if (validStatuses.includes(status)) {
			conditions.push(
				eq(supportTickets.status, status as 'open' | 'in_progress' | 'resolved' | 'closed')
			);
		}
	}

	const where = conditions.length > 0 ? and(...conditions) : undefined;

	const [tickets, [{ count }]] = await Promise.all([
		db
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
		db.select({ count: sql<number>`count(*)::int` }).from(supportTickets).where(where)
	]);

	return {
		tickets: tickets.map((t: (typeof tickets)[number]) => ({
			...t,
			createdAt: t.createdAt?.toISOString() ?? null,
			updatedAt: t.updatedAt?.toISOString() ?? null
		})),
		total: count ?? 0,
		statusFilter: status,
		limit,
		offset
	};
};
