/**
 * AI usage tracking and Stripe metered billing.
 *
 * Free allowances (per org per month):
 * - doc_process: 50
 * - vector_query: 500
 *
 * Overage rates:
 * - doc_process: $0.05/doc
 * - vector_query: $0.005/query
 */

import { aiUsage, subscriptions } from '$lib/server/db/schema';
import { eq, and, gte } from 'drizzle-orm';

const FREE_ALLOWANCES = {
	doc_process: 50,
	vector_query: 500,
} as const;

export async function getAiUsageForOrg(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	orgId: string
): Promise<{ doc_process: number; vector_query: number }> {
	const periodStart = new Date().toISOString().slice(0, 8) + '01'; // First of current month

	const rows = await db
		.select({ operation: aiUsage.operation, count: aiUsage.count })
		.from(aiUsage)
		.where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.periodStart, periodStart)));

	const usage = { doc_process: 0, vector_query: 0 };
	for (const row of rows) {
		if (row.operation in usage) {
			usage[row.operation as keyof typeof usage] += row.count;
		}
	}
	return usage;
}

export function getFreeAllowances() {
	return FREE_ALLOWANCES;
}

/**
 * Check if an org has exceeded its monthly spending cap.
 */
export async function isAiCapReached(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	orgId: string
): Promise<boolean> {
	const usage = await getAiUsageForOrg(db, orgId);
	const [sub] = await db
		.select({ cap: subscriptions.aiOverageCapCents })
		.from(subscriptions)
		.where(eq(subscriptions.orgId, orgId))
		.limit(1);

	const cap = sub?.cap ?? 5000; // $50 default
	const docOverage = Math.max(0, usage.doc_process - FREE_ALLOWANCES.doc_process) * 5; // 5 cents each
	const queryOverage = Math.max(0, usage.vector_query - FREE_ALLOWANCES.vector_query) * 0.5; // 0.5 cents each
	const totalCents = docOverage + queryOverage;

	return totalCents >= cap;
}
