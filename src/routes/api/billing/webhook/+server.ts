/**
 * POST /api/billing/webhook — Stripe Webhook Handler
 *
 * Handles Stripe lifecycle events. Called by Stripe, NOT the browser.
 * Auth: Stripe signature verification only (no locals.user).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStripe } from '$lib/server/stripe';
import { subscriptions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

/** Extract current_period_end from subscription items (moved from sub root in newer API) */
function getPeriodEnd(sub: Stripe.Subscription): Date | null {
	const periodEnd = sub.items.data[0]?.current_period_end;
	return periodEnd ? new Date(periodEnd * 1000) : null;
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY || !env?.STRIPE_WEBHOOK_SECRET) {
		error(503, 'Billing not configured');
	}

	const stripe = createStripe(env.STRIPE_SECRET_KEY);
	const body = await request.text();
	const sig = request.headers.get('stripe-signature');

	if (!sig) error(400, 'Missing stripe-signature header');

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
	} catch (err) {
		console.error('[Stripe] Webhook signature verification failed:', err);
		error(400, 'Invalid signature');
	}

	const db = locals.db;

	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object as Stripe.Checkout.Session;
			const orgId = session.metadata?.org_id;
			if (!orgId || !session.subscription || !session.customer) break;

			const stripeSubscriptionId =
				typeof session.subscription === 'string'
					? session.subscription
					: session.subscription.id;
			const stripeCustomerId =
				typeof session.customer === 'string' ? session.customer : session.customer.id;

			// Fetch subscription details for period end
			const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);

			// Check founding member eligibility (< 100 pro subscriptions)
			const proCount = await db
				.select({ id: subscriptions.id })
				.from(subscriptions)
				.where(eq(subscriptions.plan, 'pro'));
			const isFoundingMember = proCount.length < 100 ? 1 : 0;

			const periodEnd = getPeriodEnd(sub);

			// Upsert subscription (idempotent — handles duplicate webhook deliveries)
			const [existing] = await db
				.select({ id: subscriptions.id })
				.from(subscriptions)
				.where(eq(subscriptions.orgId, orgId))
				.limit(1);

			if (existing) {
				await db
					.update(subscriptions)
					.set({
						stripeCustomerId,
						stripeSubscriptionId,
						plan: 'pro',
						status: 'active',
						quantity: sub.items.data[0]?.quantity ?? 1,
						foundingMember: isFoundingMember,
						currentPeriodEnd: periodEnd,
						cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
						updatedAt: new Date()
					})
					.where(eq(subscriptions.orgId, orgId));
			} else {
				await db.insert(subscriptions).values({
					id: crypto.randomUUID(),
					orgId,
					stripeCustomerId,
					stripeSubscriptionId,
					plan: 'pro',
					status: 'active',
					quantity: sub.items.data[0]?.quantity ?? 1,
					foundingMember: isFoundingMember,
					currentPeriodEnd: periodEnd,
					cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0
				});
			}
			break;
		}

		case 'customer.subscription.updated': {
			const sub = event.data.object as Stripe.Subscription;
			const orgId = sub.metadata?.org_id;
			if (!orgId) break;

			await db
				.update(subscriptions)
				.set({
					status: mapStripeStatus(sub.status),
					quantity: sub.items.data[0]?.quantity ?? 1,
					currentPeriodEnd: getPeriodEnd(sub),
					cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
					updatedAt: new Date()
				})
				.where(eq(subscriptions.orgId, orgId));
			break;
		}

		case 'customer.subscription.deleted': {
			const sub = event.data.object as Stripe.Subscription;
			const orgId = sub.metadata?.org_id;
			if (!orgId) break;

			await db
				.update(subscriptions)
				.set({
					status: 'canceled',
					cancelAtPeriodEnd: 0,
					updatedAt: new Date()
				})
				.where(eq(subscriptions.orgId, orgId));
			break;
		}

		case 'invoice.payment_failed': {
			const invoice = event.data.object as Stripe.Invoice;
			// In newer Stripe API, subscription is under parent.subscription_details
			const parentSub = invoice.parent?.subscription_details?.subscription;
			const subId = typeof parentSub === 'string' ? parentSub : parentSub?.id;
			if (!subId) break;

			await db
				.update(subscriptions)
				.set({
					status: 'past_due',
					updatedAt: new Date()
				})
				.where(eq(subscriptions.stripeSubscriptionId, subId));
			break;
		}
	}

	return json({ received: true });
};

/** Map Stripe subscription status to our simplified status set */
function mapStripeStatus(
	status: Stripe.Subscription.Status
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
