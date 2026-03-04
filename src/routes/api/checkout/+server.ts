import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { subscriptions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateId } from 'better-auth';

export const POST: RequestHandler = async ({ locals, platform, url }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY || !env?.STRIPE_PRICE_ID) error(503, 'Payment service unavailable');

	const stripe = new Stripe(env.STRIPE_SECRET_KEY);
	const userId = locals.user.id;

	// Check if already subscribed
	const [existing] = await locals.db
		.select({
			plan: subscriptions.plan,
			status: subscriptions.status,
			stripeCustomerId: subscriptions.stripeCustomerId
		})
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.limit(1);

	if (existing?.plan === 'image_upload' && existing.status === 'active') {
		error(400, 'Already subscribed');
	}

	// Reuse existing Stripe customer or create new (persist immediately to avoid orphans)
	let customerId = existing?.stripeCustomerId;
	if (!customerId) {
		const customer = await stripe.customers.create({
			email: locals.user.email,
			metadata: { martolUserId: userId }
		});
		customerId = customer.id;
		await locals.db.insert(subscriptions).values({
			id: generateId(),
			userId,
			stripeCustomerId: customerId,
			plan: 'free',
			status: 'active'
		}).onConflictDoNothing();
	}

	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		mode: 'subscription',
		line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
		success_url: `${url.origin}/chat?upgrade=success`,
		cancel_url: `${url.origin}/chat?upgrade=canceled`,
		metadata: { martolUserId: userId }
	});

	if (!session.url) error(503, 'Failed to create checkout session');
	return json({ url: session.url });
};
