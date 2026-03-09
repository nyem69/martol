/**
 * POST /api/billing/checkout — Create Stripe Checkout Session
 *
 * Creates a hosted Checkout session for upgrading an org to Pro.
 * Auth: org owner or lead only.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStripe } from '$lib/server/stripe';
import { subscriptions } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY || !env?.STRIPE_PRO_PRICE_ID) {
		error(503, 'Billing not configured');
	}

	// Resolve org
	let orgId = locals.session.activeOrganizationId;
	if (!orgId) {
		const [first] = await locals.db
			.select({ orgId: member.organizationId })
			.from(member)
			.where(eq(member.userId, locals.user.id))
			.limit(1);
		if (!first) error(400, 'No active organization');
		orgId = first.orgId;
	}

	// Verify owner/lead role
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this room');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'lead') {
		error(403, 'Only owner or lead can manage billing');
	}

	const stripe = createStripe(env.STRIPE_SECRET_KEY);
	const origin = url.origin;

	// Look up existing subscription for this org
	const [existing] = await locals.db
		.select({
			stripeCustomerId: subscriptions.stripeCustomerId,
			plan: subscriptions.plan,
			status: subscriptions.status
		})
		.from(subscriptions)
		.where(eq(subscriptions.orgId, orgId))
		.limit(1);

	// If already pro and active, redirect to portal instead
	if (existing?.plan === 'pro' && existing.status === 'active') {
		error(400, 'Already on Pro plan. Use the billing portal to manage.');
	}

	// Get or create Stripe customer
	let stripeCustomerId = existing?.stripeCustomerId;
	if (!stripeCustomerId) {
		const customer = await stripe.customers.create({
			email: locals.user.email,
			metadata: { org_id: orgId, user_id: locals.user.id }
		});
		stripeCustomerId = customer.id;
	}

	// Count human members only (exclude agents) for seat quantity
	const [{ count: rawMemberCount }] = await locals.db
		.select({ count: sql<number>`count(*)::int` })
		.from(member)
		.where(and(eq(member.organizationId, orgId), sql`${member.role} != 'agent'`));
	const memberCount = Math.max(1, rawMemberCount ?? 0);

	// Create Checkout Session
	const session = await stripe.checkout.sessions.create({
		customer: stripeCustomerId,
		mode: 'subscription',
		allow_promotion_codes: true,
		line_items: [
			{
				price: env.STRIPE_PRO_PRICE_ID,
				quantity: memberCount
			}
		],
		success_url: `${origin}/settings?billing=success`,
		cancel_url: `${origin}/settings?billing=cancel`,
		subscription_data: {
			metadata: { org_id: orgId }
		},
		metadata: { org_id: orgId }
	});

	return json({ url: session.url });
};
