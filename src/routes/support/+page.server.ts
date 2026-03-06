/**
 * Support Page — create ticket + list own tickets
 */

import { redirect, error } from '@sveltejs/kit';
import { supportTickets } from '$lib/server/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const [tickets, [{ count }]] = await Promise.all([
		db
			.select({
				id: supportTickets.id,
				title: supportTickets.title,
				category: supportTickets.category,
				status: supportTickets.status,
				createdAt: supportTickets.createdAt,
				updatedAt: supportTickets.updatedAt
			})
			.from(supportTickets)
			.where(eq(supportTickets.userId, locals.user.id))
			.orderBy(desc(supportTickets.createdAt))
			.limit(50),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(supportTickets)
			.where(eq(supportTickets.userId, locals.user.id))
	]);

	return {
		tickets: tickets.map((t: (typeof tickets)[number]) => ({
			...t,
			createdAt: t.createdAt?.toISOString() ?? null,
			updatedAt: t.updatedAt?.toISOString() ?? null
		})),
		total: count ?? 0,
		isAdmin: locals.isAdmin
	};
};
