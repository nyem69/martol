import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Stripe from 'stripe';
import { subscriptions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { generateId } from 'better-auth';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY || !env?.STRIPE_WEBHOOK_SECRET) error(503, 'Unavailable');
	if (!locals.db) error(503, 'Database unavailable');

	const stripe = new Stripe(env.STRIPE_SECRET_KEY);
	const body = await request.text();
	const sig = request.headers.get('stripe-signature');
	if (!sig) error(400, 'Missing stripe-signature');

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
	} catch {
		error(400, 'Invalid signature');
	}

	const db = locals.db;

	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object as Stripe.Checkout.Session;
			const userId = session.metadata?.martolUserId;
			if (!userId || !session.customer || !session.subscription) break;

			const customerId =
				typeof session.customer === 'string' ? session.customer : session.customer.id;
			const subscriptionId =
				typeof session.subscription === 'string'
					? session.subscription
					: session.subscription.id;

			const [existing] = await db
				.select({ id: subscriptions.id })
				.from(subscriptions)
				.where(eq(subscriptions.userId, userId))
				.limit(1);

			if (existing) {
				await db
					.update(subscriptions)
					.set({
						stripeCustomerId: customerId,
						stripeSubscriptionId: subscriptionId,
						plan: 'image_upload',
						status: 'active'
					})
					.where(eq(subscriptions.id, existing.id));
			} else {
				await db.insert(subscriptions).values({
					id: generateId(),
					userId,
					stripeCustomerId: customerId,
					stripeSubscriptionId: subscriptionId,
					plan: 'image_upload',
					status: 'active'
				});
			}
			break;
		}

		case 'invoice.payment_succeeded': {
			const invoice = event.data.object as Stripe.Invoice;
			// Stripe SDK v20: subscription ref moved to parent.subscription_details
			const subRef = invoice.parent?.subscription_details?.subscription;
			const subId = typeof subRef === 'string' ? subRef : subRef?.id;
			if (!subId) break;

			// Get current_period_end from the first subscription item
			const stripeSub = await stripe.subscriptions.retrieve(subId, {
				expand: ['items.data']
			});
			const periodEnd = stripeSub.items?.data?.[0]?.current_period_end;
			if (periodEnd) {
				await db
					.update(subscriptions)
					.set({
						status: 'active',
						currentPeriodEnd: new Date(periodEnd * 1000)
					})
					.where(eq(subscriptions.stripeSubscriptionId, subId));
			}
			break;
		}

		case 'customer.subscription.deleted': {
			const sub = event.data.object as Stripe.Subscription;
			await db
				.update(subscriptions)
				.set({ status: 'canceled' })
				.where(eq(subscriptions.stripeSubscriptionId, sub.id));
			break;
		}
	}

	return json({ received: true });
};
