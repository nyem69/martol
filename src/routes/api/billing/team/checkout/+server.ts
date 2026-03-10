/**
 * POST /api/billing/team/checkout — Create Stripe Checkout for Team subscription
 *
 * Auth: any authenticated user can create a team.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStripe } from '$lib/server/stripe';
import { teams } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals, platform, url }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const env = platform?.env;
	if (!env?.STRIPE_SECRET_KEY || !env?.STRIPE_PRO_PRICE_ID) {
		error(503, 'Billing not configured');
	}

	const body = (await request.json()) as Record<string, unknown>;
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const seats = Math.max(1, Math.min(100, parseInt(String(body.seats ?? '5')) || 5));

	if (!name || name.length < 1 || name.length > 100) {
		error(400, 'Team name is required (1-100 characters)');
	}

	// Check if user already owns a team
	const [existingTeam] = await locals.db
		.select({ id: teams.id, status: teams.status })
		.from(teams)
		.where(eq(teams.ownerId, locals.user.id))
		.limit(1);

	if (existingTeam?.status === 'active') {
		error(400, 'You already have an active team. Manage it from settings.');
	}

	const stripe = createStripe(env.STRIPE_SECRET_KEY);
	const origin = url.origin;

	// Create Stripe customer for team billing
	const customer = await stripe.customers.create({
		email: locals.user.email,
		metadata: { type: 'team', owner_id: locals.user.id }
	});

	// Create team record (incomplete until checkout succeeds)
	const teamId = crypto.randomUUID();

	if (existingTeam) {
		// Reuse existing canceled/incomplete team record
		await locals.db
			.update(teams)
			.set({
				name,
				seats,
				stripeCustomerId: customer.id,
				status: 'incomplete' as const,
				updatedAt: new Date()
			})
			.where(eq(teams.id, existingTeam.id));
	} else {
		await locals.db.insert(teams).values({
			id: teamId,
			ownerId: locals.user.id,
			name,
			stripeCustomerId: customer.id,
			seats,
			status: 'incomplete' as const
		});
	}

	const resolvedTeamId = existingTeam?.id ?? teamId;

	// Select price — team uses same Pro price, annual if requested
	const interval = body.interval === 'annual' ? ('annual' as const) : ('monthly' as const);
	const priceId = interval === 'annual' && env.STRIPE_PRO_ANNUAL_PRICE_ID
		? env.STRIPE_PRO_ANNUAL_PRICE_ID
		: env.STRIPE_PRO_PRICE_ID;

	const session = await stripe.checkout.sessions.create({
		customer: customer.id,
		mode: 'subscription',
		allow_promotion_codes: true,
		line_items: [
			{
				price: priceId,
				quantity: seats
			}
		],
		success_url: `${origin}/settings?team=success&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${origin}/settings?team=cancel`,
		subscription_data: {
			metadata: { type: 'team', team_id: resolvedTeamId, owner_id: locals.user.id }
		},
		metadata: { type: 'team', team_id: resolvedTeamId, owner_id: locals.user.id }
	});

	return json({ url: session.url });
};
