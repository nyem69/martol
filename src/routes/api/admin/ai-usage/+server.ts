/**
 * GET /api/admin/ai-usage — Aggregated Workers AI neuron usage monitoring
 *
 * Auth: admin only.
 * Returns daily/monthly usage across all orgs with estimated neuron counts.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { aiUsage } from '$lib/server/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');
	if (!locals.isAdmin) error(403, 'Admin access required');

	const today = new Date().toISOString().slice(0, 10);
	const monthStart = today.slice(0, 8) + '01';

	// Today's usage (all orgs combined)
	const dailyUsage = await locals.db
		.select({
			operation: aiUsage.operation,
			total: sql<number>`sum(${aiUsage.count})`.as('total'),
		})
		.from(aiUsage)
		.where(eq(aiUsage.periodStart, today))
		.groupBy(aiUsage.operation);

	// Monthly usage (all orgs combined)
	const monthlyUsage = await locals.db
		.select({
			operation: aiUsage.operation,
			total: sql<number>`sum(${aiUsage.count})`.as('total'),
		})
		.from(aiUsage)
		.where(gte(aiUsage.periodStart, monthStart))
		.groupBy(aiUsage.operation);

	// Top orgs by LLM generation today
	const topOrgs = await locals.db
		.select({
			orgId: aiUsage.orgId,
			count: aiUsage.count,
		})
		.from(aiUsage)
		.where(and(
			eq(aiUsage.operation, 'llm_generation'),
			eq(aiUsage.periodStart, today)
		))
		.orderBy(sql`${aiUsage.count} DESC`)
		.limit(10);

	// Estimated neuron cost
	// Llama 3.1 8B: ~3000 neurons per call
	// BGE embedding: ~50 neurons per call
	type UsageRow = { operation: string; total: number };
	const llmToday = (dailyUsage as UsageRow[]).find((u) => u.operation === 'llm_generation')?.total ?? 0;
	const embedToday = (dailyUsage as UsageRow[]).find((u) => u.operation === 'vector_query')?.total ?? 0;
	const estimatedNeuronsToday = (llmToday * 3000) + (embedToday * 50);

	return json({
		today: {
			usage: Object.fromEntries((dailyUsage as UsageRow[]).map((u) => [u.operation, u.total])),
			estimatedNeurons: estimatedNeuronsToday,
			neuronLimit: 10000,
			neuronPct: Math.round((estimatedNeuronsToday / 10000) * 100),
		},
		month: {
			usage: Object.fromEntries((monthlyUsage as UsageRow[]).map((u) => [u.operation, u.total])),
		},
		topOrgs,
		timestamp: new Date().toISOString(),
	});
};
