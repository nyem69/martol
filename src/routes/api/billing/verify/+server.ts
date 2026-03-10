/**
 * POST /api/billing/verify — Verify Checkout Session & Activate Subscription
 *
 * Called after Stripe checkout redirect. Retrieves the checkout session
 * from Stripe, verifies payment, and upserts the subscription in our DB.
 * This ensures the subscription activates even if the webhook is delayed.
 *
 * Auth: logged-in user who owns/leads the org.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStripe } from '$lib/server/stripe';
import { subscriptions } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY) error(503, 'Billing not configured');

	const body = (await request.json()) as { session_id?: string };
	if (!body.session_id) error(400, 'Missing session_id');

	const stripe = createStripe(env.STRIPE_SECRET_KEY);
	const db = locals.db;

	// Retrieve checkout session from Stripe
	const session = await stripe.checkout.sessions.retrieve(body.session_id, {
		expand: ['subscription']
	});

	if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
		error(402, 'Payment not completed');
	}

	// Only handle pro subscriptions (not team)
	if (session.metadata?.type !== 'pro') {
		error(400, 'Not a pro checkout session');
	}

	const orgId = session.metadata?.org_id;
	if (!orgId) error(400, 'Missing org_id in session metadata');

	// Verify user is owner/lead of this org
	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this room');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owner or lead can verify billing');
	}

	// Extract subscription details
	const sub = typeof session.subscription === 'object' ? session.subscription : null;
	if (!sub || !('id' in sub)) error(400, 'No subscription found on session');

	const stripeSubscriptionId = sub.id;
	const stripeCustomerId =
		typeof session.customer === 'string' ? session.customer : session.customer?.id ?? '';
	const periodEnd = sub.items.data[0]?.current_period_end;
	const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;

	// Check founding member eligibility (< 100 pro subscriptions)
	const [{ count: proCount }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(subscriptions)
		.where(eq(subscriptions.plan, 'pro'));
	const isFoundingMember = (proCount ?? 0) < 100;

	// Upsert subscription (idempotent — safe if webhook also fires)
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
				currentPeriodEnd,
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
			currentPeriodEnd,
			cancelAtPeriodEnd: sub.cancel_at_period_end ?? false
		});
	}

	return json({ ok: true, plan: 'pro' });
};
