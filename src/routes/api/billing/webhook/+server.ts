/**
 * POST /api/billing/webhook — Stripe Webhook Handler
 *
 * Handles Stripe lifecycle events. Called by Stripe, NOT the browser.
 * Auth: Stripe signature verification only (no locals.user).
 *
 * NOTE: Webhooks may be unreliable in sandbox/test mode. The billing-sync
 * utilities provide a safety net by syncing from Stripe on page load.
 * This handler is still important for production and real-time updates.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStripe } from '$lib/server/stripe';
import { subscriptions, teams } from '$lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';

/** Extract current_period_end from subscription items (moved from sub root in newer API) */
function getPeriodEnd(sub: Stripe.Subscription): Date | null {
	const periodEnd = sub.items.data[0]?.current_period_end;
	return periodEnd ? new Date(periodEnd * 1000) : null;
}

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

/**
 * Extract subscription ID from an invoice object.
 * Handles both newer (parent.subscription_details) and older (subscription) API shapes.
 */
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
	// Newer API: parent.subscription_details.subscription
	const parentSub = invoice.parent?.subscription_details?.subscription;
	if (parentSub) {
		return typeof parentSub === 'string' ? parentSub : parentSub.id;
	}
	// Older API: direct subscription field
	if ('subscription' in invoice && invoice.subscription) {
		const sub = invoice.subscription;
		return typeof sub === 'string' ? sub : (sub as { id: string }).id;
	}
	return null;
}

/**
 * Find and update subscription status by stripeSubscriptionId.
 * Tries subscriptions table first, then teams table.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateStatusBySubId(db: any, subId: string, status: 'active' | 'past_due' | 'canceled' | 'incomplete') {
	const [existingSub] = await db
		.select({ id: subscriptions.id })
		.from(subscriptions)
		.where(eq(subscriptions.stripeSubscriptionId, subId))
		.limit(1);

	if (existingSub) {
		await db
			.update(subscriptions)
			.set({ status, updatedAt: new Date() })
			.where(eq(subscriptions.stripeSubscriptionId, subId));
		return true;
	}

	// Fall back to teams table
	const result = await db
		.update(teams)
		.set({ status, updatedAt: new Date() })
		.where(eq(teams.stripeSubscriptionId, subId));

	return (result?.rowCount ?? 0) > 0;
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
			if (!session.subscription || !session.customer) break;

			const stripeSubscriptionId =
				typeof session.subscription === 'string'
					? session.subscription
					: session.subscription.id;
			const stripeCustomerId =
				typeof session.customer === 'string' ? session.customer : session.customer.id;

			// Fetch subscription details for period end
			const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
			const periodEnd = getPeriodEnd(sub);

			if (session.metadata?.type === 'team') {
				const teamId = session.metadata?.team_id;
				if (!teamId) {
					console.error('[Stripe] checkout.session.completed: missing team_id metadata', event.id);
					break;
				}

				await db
					.update(teams)
					.set({
						stripeCustomerId,
						stripeSubscriptionId,
						status: 'active',
						seats: sub.items.data[0]?.quantity ?? 5,
						currentPeriodEnd: periodEnd,
						cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
						updatedAt: new Date()
					})
					.where(eq(teams.id, teamId));
			} else {
				const orgId = session.metadata?.org_id;
				if (!orgId) {
					console.error('[Stripe] checkout.session.completed: missing org_id metadata', event.id);
					break;
				}

				// Check founding member eligibility (< 100 pro subscriptions)
				const [{ count: proCount }] = await db
					.select({ count: sql<number>`count(*)::int` })
					.from(subscriptions)
					.where(eq(subscriptions.plan, 'pro'));
				const isFoundingMember = (proCount ?? 0) < 100;

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
							cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
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
						cancelAtPeriodEnd: sub.cancel_at_period_end ?? false
					});
				}
			}
			break;
		}

		case 'customer.subscription.updated': {
			const sub = event.data.object as Stripe.Subscription;

			if (sub.metadata?.type === 'team') {
				const teamId = sub.metadata?.team_id;
				if (!teamId) {
					console.warn('[Stripe] subscription.updated: missing team_id metadata, falling back to stripeSubscriptionId', event.id);
					// Fallback: find by subscription ID
					await db
						.update(teams)
						.set({
							status: mapStripeStatus(sub.status),
							seats: sub.items.data[0]?.quantity ?? 5,
							currentPeriodEnd: getPeriodEnd(sub),
							cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
							updatedAt: new Date()
						})
						.where(eq(teams.stripeSubscriptionId, sub.id));
					break;
				}

				await db
					.update(teams)
					.set({
						status: mapStripeStatus(sub.status),
						seats: sub.items.data[0]?.quantity ?? 5,
						currentPeriodEnd: getPeriodEnd(sub),
						cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
						updatedAt: new Date()
					})
					.where(eq(teams.id, teamId));
			} else {
				const orgId = sub.metadata?.org_id;
				if (!orgId) {
					console.warn('[Stripe] subscription.updated: missing org_id metadata, falling back to stripeSubscriptionId', event.id);
					// Fallback: find by subscription ID
					await db
						.update(subscriptions)
						.set({
							status: mapStripeStatus(sub.status),
							quantity: sub.items.data[0]?.quantity ?? 1,
							currentPeriodEnd: getPeriodEnd(sub),
							cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
							updatedAt: new Date()
						})
						.where(eq(subscriptions.stripeSubscriptionId, sub.id));
					break;
				}

				await db
					.update(subscriptions)
					.set({
						status: mapStripeStatus(sub.status),
						quantity: sub.items.data[0]?.quantity ?? 1,
						currentPeriodEnd: getPeriodEnd(sub),
						cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
						updatedAt: new Date()
					})
					.where(eq(subscriptions.orgId, orgId));
			}
			break;
		}

		case 'customer.subscription.deleted': {
			const sub = event.data.object as Stripe.Subscription;

			if (sub.metadata?.type === 'team') {
				const teamId = sub.metadata?.team_id;
				if (teamId) {
					await db
						.update(teams)
						.set({ status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() })
						.where(eq(teams.id, teamId));
				} else {
					// Fallback: find by subscription ID
					await db
						.update(teams)
						.set({ status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() })
						.where(eq(teams.stripeSubscriptionId, sub.id));
				}
			} else {
				const orgId = sub.metadata?.org_id;
				if (orgId) {
					await db
						.update(subscriptions)
						.set({ status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() })
						.where(eq(subscriptions.orgId, orgId));
				} else {
					// Fallback: find by subscription ID
					await db
						.update(subscriptions)
						.set({ status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() })
						.where(eq(subscriptions.stripeSubscriptionId, sub.id));
				}
			}
			break;
		}

		case 'invoice.payment_succeeded': {
			// Recover from past_due → active when payment succeeds
			const invoice = event.data.object as Stripe.Invoice;
			const subId = getInvoiceSubscriptionId(invoice);
			if (!subId) {
				console.warn('[Stripe] invoice.payment_succeeded: no subscription ID found', event.id);
				break;
			}
			await updateStatusBySubId(db, subId, 'active');
			break;
		}

		case 'invoice.payment_failed': {
			const invoice = event.data.object as Stripe.Invoice;
			const subId = getInvoiceSubscriptionId(invoice);
			if (!subId) {
				console.error('[Stripe] invoice.payment_failed: no subscription ID found', event.id);
				break;
			}
			const found = await updateStatusBySubId(db, subId, 'past_due');
			if (!found) {
				console.error('[Stripe] invoice.payment_failed: subscription not found in DB', subId, event.id);
			}
			break;
		}
	}

	return json({ received: true });
};
