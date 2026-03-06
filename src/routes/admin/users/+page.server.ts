/**
 * Admin Users — list all users with role management
 */

import { error } from '@sveltejs/kit';
import { user } from '$lib/server/db/auth-schema';
import { desc, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
	const offset = parseInt(url.searchParams.get('offset') || '0');

	const [users, [{ count }]] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				username: user.username,
				role: user.role,
				createdAt: user.createdAt
			})
			.from(user)
			.orderBy(desc(user.createdAt))
			.limit(limit)
			.offset(offset),
		db.select({ count: sql<number>`count(*)::int` }).from(user)
	]);

	return {
		users: users.map((u: (typeof users)[number]) => ({
			...u,
			createdAt: u.createdAt?.toISOString() ?? null
		})),
		total: count ?? 0,
		limit,
		offset
	};
};
