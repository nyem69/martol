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
		// Must use async variant — Cloudflare Workers only support SubtleCrypto (async)
		event = await stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET);
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

		case 'invoice.paid': {
			const invoice = event.data.object as Stripe.Invoice;
			// Stripe SDK v20: subscription ref moved to parent.subscription_details
			const subRef = invoice.parent?.subscription_details?.subscription;
			const subId = typeof subRef === 'string' ? subRef : subRef?.id;
			if (!subId) break;

			// Stripe SDK v20 breaking change: current_period_end moved from Subscription
			// to SubscriptionItem. Must expand items.data and read from items[0].
			// See: https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md (v20.0.0)
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

		case 'customer.subscription.updated': {
			const sub = event.data.object as Stripe.Subscription;
			const statusMap: Record<string, 'active' | 'canceled' | 'past_due'> = {
				active: 'active',
				past_due: 'past_due',
				canceled: 'canceled'
			};
			const newStatus = statusMap[sub.status];
			if (newStatus) {
				await db
					.update(subscriptions)
					.set({ status: newStatus })
					.where(eq(subscriptions.stripeSubscriptionId, sub.id));
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
