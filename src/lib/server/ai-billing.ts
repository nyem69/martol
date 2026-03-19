/**
 * AI usage tracking and Stripe metered billing.
 *
 * Free allowances (per org per month):
 * - doc_process: 50
 * - vector_query: 500
 * - llm_generation: 150
 *
 * Overage rates:
 * - doc_process: $0.05/doc
 * - vector_query: $0.005/query
 * - llm_generation: $0.03/call
 */

import { aiUsage, subscriptions } from '$lib/server/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { createStripe } from '$lib/server/stripe';

const FREE_ALLOWANCES = {
	doc_process: 50,
	vector_query: 500,
	llm_generation: 500, // Increased from 150 for testing — adjust after validating neuron costs
} as const;

export async function getAiUsageForOrg(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	orgId: string
): Promise<{ doc_process: number; vector_query: number; llm_generation: number }> {
	const periodStart = new Date().toISOString().slice(0, 8) + '01'; // First of current month

	const rows = await db
		.select({ operation: aiUsage.operation, count: aiUsage.count })
		.from(aiUsage)
		.where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.periodStart, periodStart)));

	const usage = { doc_process: 0, vector_query: 0, llm_generation: 0 };
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
	const llmOverage = Math.max(0, usage.llm_generation - FREE_ALLOWANCES.llm_generation) * 3; // 3 cents each
	const totalCents = docOverage + queryOverage + llmOverage;

	return totalCents >= cap;
}

/** Overage rates in cents */
const OVERAGE_RATES = {
	doc_process: 5,     // 5 cents per doc
	vector_query: 0.5,  // 0.5 cents per query
	llm_generation: 3,  // 3 cents per call
} as const;

/**
 * Report AI overage usage to Stripe Billing Meter for all active Pro orgs.
 * Called by the daily cron job. Uses Stripe's Billing Meter Events API.
 *
 * Only reports when STRIPE_AI_METER_ID env var is set (metered price configured in Stripe).
 * Returns the number of orgs with overage reported.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reportAiUsageToStripe(db: any, stripeKey: string, meterId: string): Promise<number> {
	const periodStart = new Date().toISOString().slice(0, 8) + '01';

	// Get all orgs with active Pro subscriptions and their AI usage this month
	const orgsWithUsage = await db
		.select({
			orgId: subscriptions.orgId,
			stripeCustomerId: subscriptions.stripeCustomerId,
		})
		.from(subscriptions)
		.where(and(eq(subscriptions.plan, 'pro'), eq(subscriptions.status, 'active')));

	if (orgsWithUsage.length === 0) return 0;

	const stripe = createStripe(stripeKey);
	let reported = 0;

	for (const org of orgsWithUsage) {
		if (!org.stripeCustomerId) continue;

		try {
			// Get this org's AI usage for the current month
			const rows = await db
				.select({ operation: aiUsage.operation, count: sql<number>`sum(${aiUsage.count})::int` })
				.from(aiUsage)
				.where(and(eq(aiUsage.orgId, org.orgId), gte(aiUsage.periodStart, periodStart)))
				.groupBy(aiUsage.operation);

			const usage: Record<string, number> = {};
			for (const row of rows) {
				usage[row.operation] = row.count ?? 0;
			}

			// Calculate overage in cents
			const docOverage = Math.max(0, (usage['doc_process'] ?? 0) - FREE_ALLOWANCES.doc_process);
			const queryOverage = Math.max(0, (usage['vector_query'] ?? 0) - FREE_ALLOWANCES.vector_query);
			const llmOverage = Math.max(0, (usage['llm_generation'] ?? 0) - FREE_ALLOWANCES.llm_generation);
			const totalCents = Math.round(docOverage * OVERAGE_RATES.doc_process + queryOverage * OVERAGE_RATES.vector_query + llmOverage * OVERAGE_RATES.llm_generation);

			if (totalCents <= 0) continue;

			// Report to Stripe Billing Meter
			await stripe.billing.meterEvents.create({
				event_name: meterId,
				payload: {
					stripe_customer_id: org.stripeCustomerId,
					value: String(totalCents),
				},
			});
			reported++;
		} catch (err) {
			console.error('[AiBilling] Failed to report usage for org=%s:', org.orgId, err);
		}
	}

	return reported;
}
