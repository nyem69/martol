/**
 * Billing Sync — sync subscription state from Stripe to DB
 *
 * Webhooks are unreliable (may not reach the server in test/sandbox mode).
 * These functions query Stripe directly and update the DB as needed.
 * Safe to call on every page load — only writes if something changed.
 */

import { subscriptions, teams } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { createStripe } from '$lib/server/stripe';

function mapStripeStatus(
	status: string
): 'active' | 'past_due' | 'canceled' | 'incomplete' {
	switch (status) {
		case 'active':
		case 'trialing':
			return 'active';
		case 'past_due':
			return 'past_due';
		case 'canceled':
		case 'unpaid':
			return 'canceled';
		default:
			return 'incomplete';
	}
}

/**
 * Sync org subscription from Stripe.
 * Looks up the Stripe customer's subscriptions and updates DB if needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncOrgSubscription(db: any, orgId: string, stripeKey: string): Promise<void> {
	const [sub] = await db
		.select({
			id: subscriptions.id,
			stripeCustomerId: subscriptions.stripeCustomerId,
			stripeSubscriptionId: subscriptions.stripeSubscriptionId,
			status: subscriptions.status,
			cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd
		})
		.from(subscriptions)
		.where(eq(subscriptions.orgId, orgId))
		.limit(1);

	if (!sub?.stripeCustomerId) return;

	try {
		const stripe = createStripe(stripeKey);
		const subs = await stripe.subscriptions.list({
			customer: sub.stripeCustomerId,
			limit: 1
		});

		const stripeSub = subs.data[0];
		if (!stripeSub) return;

		const periodEnd = stripeSub.items.data[0]?.current_period_end;
		const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;
		const stripeStatus = mapStripeStatus(stripeSub.status);

		if (
			sub.status !== stripeStatus ||
			sub.stripeSubscriptionId !== stripeSub.id ||
			sub.cancelAtPeriodEnd !== stripeSub.cancel_at_period_end
		) {
			await db
				.update(subscriptions)
				.set({
					stripeSubscriptionId: stripeSub.id,
					status: stripeStatus,
					quantity: stripeSub.items.data[0]?.quantity ?? 1,
					currentPeriodEnd,
					cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
					updatedAt: new Date()
				})
				.where(eq(subscriptions.orgId, orgId));
		}
	} catch (err) {
		console.error('[BillingSync] Org sync failed:', err);
	}
}

/**
 * Sync team subscription from Stripe.
 * Looks up the Stripe customer's subscriptions and updates DB if needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncTeamSubscription(db: any, teamId: string, stripeCustomerId: string, stripeKey: string): Promise<void> {
	try {
		const stripe = createStripe(stripeKey);
		const subs = await stripe.subscriptions.list({
			customer: stripeCustomerId,
			limit: 1
		});

		const stripeSub = subs.data[0];
		if (!stripeSub) return;

		const periodEnd = stripeSub.items.data[0]?.current_period_end;
		const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;
		const stripeStatus = mapStripeStatus(stripeSub.status);

		await db
			.update(teams)
			.set({
				stripeSubscriptionId: stripeSub.id,
				status: stripeStatus,
				seats: stripeSub.items.data[0]?.quantity ?? 5,
				currentPeriodEnd,
				cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? false,
				updatedAt: new Date()
			})
			.where(eq(teams.id, teamId));
	} catch (err) {
		console.error('[BillingSync] Team sync failed:', err);
	}
}
