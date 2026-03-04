import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { subscriptions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY) error(503, 'Payment service unavailable');

	const [sub] = await locals.db
		.select({ stripeCustomerId: subscriptions.stripeCustomerId })
		.from(subscriptions)
		.where(eq(subscriptions.userId, locals.user.id))
		.limit(1);

	if (!sub?.stripeCustomerId) error(404, 'No billing record found');

	const stripe = new Stripe(env.STRIPE_SECRET_KEY);
	const session = await stripe.billingPortal.sessions.create({
		customer: sub.stripeCustomerId,
		return_url: `${url.origin}/chat`
	});

	return json({ url: session.url });
};
