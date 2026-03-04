/**
 * POST /api/billing/portal — Create Stripe Customer Portal Session
 *
 * Redirects org owner/lead to Stripe's self-service portal.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStripe } from '$lib/server/stripe';
import { subscriptions } from '$lib/server/db/schema';
import { member } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY) error(503, 'Billing not configured');

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

	// Get subscription with Stripe customer ID
	const [sub] = await locals.db
		.select({ stripeCustomerId: subscriptions.stripeCustomerId })
		.from(subscriptions)
		.where(eq(subscriptions.orgId, orgId))
		.limit(1);

	if (!sub?.stripeCustomerId) {
		error(400, 'No billing account found. Upgrade first.');
	}

	const stripe = createStripe(env.STRIPE_SECRET_KEY);
	const portalSession = await stripe.billingPortal.sessions.create({
		customer: sub.stripeCustomerId,
		return_url: `${url.origin}/settings`
	});

	return json({ url: portalSession.url });
};
