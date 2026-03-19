import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { aiUsage } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import { eq, and, gte, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.session) return json({ count: 0, limit: 150 });
	if (!locals.db) return json({ count: 0, limit: 150 });

	const orgId = params.roomId;

	// Verify caller is a member of this room
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!memberRecord) return json({ count: 0, limit: 150 });
	// Get current month's first day
	const periodStart = new Date().toISOString().slice(0, 8) + '01';

	const [usage] = await locals.db
		.select({ total: sql<number>`coalesce(sum(${aiUsage.count}), 0)` })
		.from(aiUsage)
		.where(and(
			eq(aiUsage.orgId, orgId),
			eq(aiUsage.operation, 'llm_generation'),
			gte(aiUsage.periodStart, periodStart)
		))
		.limit(1);

	// Hardcoded limit — will be derived from the room creator's subscription plan
	// once billing tier gates are implemented (see billing model in CLAUDE.md).
	return json({ count: Number(usage?.total ?? 0), limit: 150 });
};
