/**
 * Admin Dashboard — system stats
 */

import { error } from '@sveltejs/kit';
import { user, member, organization } from '$lib/server/db/auth-schema';
import { messages, supportTickets, agentRoomBindings } from '$lib/server/db/schema';
import { sql, eq, gte, and } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const [
		[{ totalUsers }],
		[{ totalRooms }],
		[{ messagesToday }],
		[{ activeAgents }],
		[{ openTickets }]
	] = await Promise.all([
		db.select({ totalUsers: sql<number>`count(*)::int` }).from(user),
		db.select({ totalRooms: sql<number>`count(*)::int` }).from(organization),
		db
			.select({ messagesToday: sql<number>`count(*)::int` })
			.from(messages)
			.where(gte(messages.createdAt, today)),
		db.select({ activeAgents: sql<number>`count(*)::int` }).from(agentRoomBindings),
		db
			.select({ openTickets: sql<number>`count(*)::int` })
			.from(supportTickets)
			.where(eq(supportTickets.status, 'open'))
	]);

	return {
		stats: {
			totalUsers: totalUsers ?? 0,
			totalRooms: totalRooms ?? 0,
			messagesToday: messagesToday ?? 0,
			activeAgents: activeAgents ?? 0,
			openTickets: openTickets ?? 0
		}
	};
};
