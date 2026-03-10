/**
 * POST /api/billing/team/portal — Create Stripe Customer Portal for Team
 *
 * Redirects team owner to Stripe's self-service portal for the team subscription.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStripe } from '$lib/server/stripe';
import { teams } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY) error(503, 'Billing not configured');

	const [team] = await locals.db
		.select({
			id: teams.id,
			stripeCustomerId: teams.stripeCustomerId,
			ownerId: teams.ownerId
		})
		.from(teams)
		.where(eq(teams.ownerId, locals.user.id))
		.limit(1);

	if (!team) error(404, 'No team found');
	if (!team.stripeCustomerId) error(400, 'No billing account found for this team.');

	const stripe = createStripe(env.STRIPE_SECRET_KEY);
	const portalSession = await stripe.billingPortal.sessions.create({
		customer: team.stripeCustomerId,
		return_url: `${url.origin}/settings/team`
	});

	return json({ url: portalSession.url });
};
