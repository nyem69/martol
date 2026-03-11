/**
 * Seed script for test accounts.
 *
 * Creates test users, personal orgs, Stripe customers (test mode),
 * DB subscription records, a team, and password hashes.
 *
 * Usage: pnpm db:seed-test
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' });

import pg from 'pg';
import Stripe from 'stripe';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TEST_ACCOUNTS, hashTestPassword } from '../src/lib/server/auth/test-accounts';
import { user, organization, member } from '../src/lib/server/db/auth-schema';
import { subscriptions, teams, teamMembers, testAccountCredentials } from '../src/lib/server/db/schema';

// ── DB connection ───────────────────────────────────────────────────

const connectionString =
	process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ||
	`postgres://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}?sslmode=require`;

const pool = new pg.Pool({
	connectionString,
	ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool);

// ── Stripe client ───────────────────────────────────────────────────

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
	console.error('STRIPE_SECRET_KEY not found in .dev.vars');
	process.exit(1);
}
const stripe = new Stripe(stripeKey);

// ── Helpers ─────────────────────────────────────────────────────────

const now = new Date();
const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

const NEEDS_STRIPE: Set<string> = new Set(['pro', 'pro_founding', 'team_owner', 'canceled', 'past_due']);
const NEEDS_SUBSCRIPTION: Set<string> = new Set(['pro', 'pro_founding', 'canceled', 'past_due']);

const TEAM_ID = 'test-team-0000-0000-000000000001';

// ── Main ────────────────────────────────────────────────────────────

async function main() {
	console.log('Seeding test accounts...\n');

	// Track Stripe customer IDs for subscription records
	const stripeCustomerIds = new Map<string, string>();

	// ── Step 1: Create users ────────────────────────────────────────
	console.log('1. Creating users...');
	for (const acct of TEST_ACCOUNTS) {
		await db
			.insert(user)
			.values({
				id: acct.id,
				name: acct.displayName,
				email: acct.email,
				username: acct.username,
				displayName: acct.displayName,
				emailVerified: true,
				role: 'user',
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: user.id,
				set: {
					name: acct.displayName,
					email: acct.email,
					username: acct.username,
					displayName: acct.displayName,
					emailVerified: true,
					role: 'user',
					updatedAt: now,
				},
			});
		console.log(`   ${acct.username} (${acct.id})`);
	}

	// ── Step 2: Create personal orgs ────────────────────────────────
	console.log('\n2. Creating personal organizations...');
	for (const acct of TEST_ACCOUNTS) {
		const orgId = `org-${acct.id}`;
		const memberId = `member-${acct.id}`;

		await db
			.insert(organization)
			.values({
				id: orgId,
				name: `${acct.displayName}'s Workspace`,
				slug: `org-${acct.username}`,
				createdAt: now,
			})
			.onConflictDoNothing();

		await db
			.insert(member)
			.values({
				id: memberId,
				organizationId: orgId,
				userId: acct.id,
				role: 'owner',
				createdAt: now,
			})
			.onConflictDoNothing();

		console.log(`   ${orgId}`);
	}

	// ── Step 3: Create Stripe customers ─────────────────────────────
	console.log('\n3. Creating Stripe customers...');
	for (const acct of TEST_ACCOUNTS) {
		if (!NEEDS_STRIPE.has(acct.planState)) {
			console.log(`   ${acct.username} — skipped (${acct.planState})`);
			continue;
		}

		// Check if customer already exists
		const existing = await stripe.customers.list({ email: acct.email, limit: 1 });
		let customer: Stripe.Customer;

		if (existing.data.length > 0) {
			customer = existing.data[0];
			console.log(`   ${acct.username} — exists (${customer.id})`);
		} else {
			customer = await stripe.customers.create({
				email: acct.email,
				name: acct.displayName,
				metadata: { test_account: 'true', user_id: acct.id },
			});
			console.log(`   ${acct.username} — created (${customer.id})`);
		}

		// Attach a test payment method
		const pm = await stripe.paymentMethods.create({
			type: 'card',
			card: { token: 'tok_visa' },
		});
		await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
		await stripe.customers.update(customer.id, {
			invoice_settings: { default_payment_method: pm.id },
		});

		stripeCustomerIds.set(acct.id, customer.id);
	}

	// ── Step 4: Create subscription records in DB ───────────────────
	console.log('\n4. Creating subscription records...');
	for (const acct of TEST_ACCOUNTS) {
		if (!NEEDS_SUBSCRIPTION.has(acct.planState)) {
			console.log(`   ${acct.username} — skipped (${acct.planState})`);
			continue;
		}

		const customerId = stripeCustomerIds.get(acct.id);
		if (!customerId) {
			console.error(`   ${acct.username} — ERROR: no Stripe customer ID`);
			continue;
		}

		const orgId = `org-${acct.id}`;
		const subId = `sub-${acct.id}`;

		const values: typeof subscriptions.$inferInsert = {
			id: subId,
			orgId,
			stripeCustomerId: customerId,
			plan: 'pro',
			status: acct.planState === 'past_due' ? 'past_due' : 'active',
			quantity: 1,
			foundingMember: acct.planState === 'pro_founding',
			currentPeriodEnd: thirtyDaysFromNow,
			cancelAtPeriodEnd: acct.planState === 'canceled',
		};

		await db
			.insert(subscriptions)
			.values(values)
			.onConflictDoUpdate({
				target: subscriptions.id,
				set: {
					stripeCustomerId: values.stripeCustomerId,
					plan: values.plan,
					status: values.status,
					quantity: values.quantity,
					foundingMember: values.foundingMember,
					currentPeriodEnd: values.currentPeriodEnd,
					cancelAtPeriodEnd: values.cancelAtPeriodEnd,
					updatedAt: now,
				},
			});
		console.log(`   ${acct.username} — ${acct.planState}`);
	}

	// ── Step 5: Create team ─────────────────────────────────────────
	console.log('\n5. Creating team...');
	const teamOwner = TEST_ACCOUNTS.find((a) => a.planState === 'team_owner')!;
	const teamMember = TEST_ACCOUNTS.find((a) => a.planState === 'team_member')!;
	const teamCustomerId = stripeCustomerIds.get(teamOwner.id);

	await db
		.insert(teams)
		.values({
			id: TEAM_ID,
			ownerId: teamOwner.id,
			name: 'Test Team',
			stripeCustomerId: teamCustomerId ?? null,
			seats: 5,
			status: 'active',
			currentPeriodEnd: thirtyDaysFromNow,
		})
		.onConflictDoUpdate({
			target: teams.id,
			set: {
				ownerId: teamOwner.id,
				name: 'Test Team',
				stripeCustomerId: teamCustomerId ?? null,
				seats: 5,
				status: 'active',
				currentPeriodEnd: thirtyDaysFromNow,
				updatedAt: now,
			},
		});
	console.log(`   Team: ${TEAM_ID}`);

	// Add team member
	const tmId = `tm-${teamMember.id}`;
	await db
		.insert(teamMembers)
		.values({
			id: tmId,
			teamId: TEAM_ID,
			userId: teamMember.id,
		})
		.onConflictDoNothing();
	console.log(`   Member: ${teamMember.username}`);

	// ── Step 6: Store password hashes ───────────────────────────────
	console.log('\n6. Storing password hashes...');
	for (const acct of TEST_ACCOUNTS) {
		const hash = await hashTestPassword(acct.password);
		await db
			.insert(testAccountCredentials)
			.values({
				userId: acct.id,
				passwordHash: hash,
			})
			.onConflictDoUpdate({
				target: testAccountCredentials.userId,
				set: { passwordHash: hash },
			});
		console.log(`   ${acct.username}`);
	}

	console.log('\nDone! All test accounts seeded.');
	await pool.end();
}

main().catch((err) => {
	console.error('Seed failed:', err);
	pool.end().then(() => process.exit(1));
});
