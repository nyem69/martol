# Stripe Billing Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical billing bugs, add annual plan support, and implement Team subscriptions with manual seat assignment.

**Architecture:** Extend existing Stripe integration (checkout → webhook → DB → feature gates). Delete buggy old webhook handler, extend the working new one. Add `teams` + `teamMembers` tables for Team subscriptions. Feature gates check team membership as highest-priority Pro source.

**Tech Stack:** Stripe SDK v20, Drizzle ORM, SvelteKit API routes, Svelte 5, Cloudflare Workers

**Spec:** `docs/superpowers/specs/2026-03-10-stripe-billing-integration-design.md`

---

## Chunk 1: Bug Fixes & Cleanup

### Task 1: Delete Old Buggy Webhook Handler

The old handler at `/api/webhooks/stripe/` has bugs (`plan: 'image_upload'`, reads `martolOrgId`). The new handler at `/api/billing/webhook/` already has these fixed. Delete the old one.

**Files:**
- Delete: `src/routes/api/webhooks/stripe/+server.ts`

- [ ] **Step 1: Delete the old webhook handler**

```bash
rm src/routes/api/webhooks/stripe/+server.ts
```

If the directory is now empty, remove it too:
```bash
rmdir src/routes/api/webhooks/stripe 2>/dev/null
rmdir src/routes/api/webhooks 2>/dev/null
```

- [ ] **Step 2: Verify the new handler still exists**

```bash
cat src/routes/api/billing/webhook/+server.ts | head -5
```

Expected: File exists with `POST /api/billing/webhook` header.

- [ ] **Step 3: Commit**

```bash
git add -A src/routes/api/webhooks/
git commit -m "fix: delete old buggy Stripe webhook handler

The handler at /api/webhooks/stripe/ had two bugs:
- Set plan to 'image_upload' instead of 'pro'
- Read 'martolOrgId' instead of 'org_id' from metadata

The correct handler lives at /api/billing/webhook/ and is already fixed."
```

---

### Task 2: Add `type` Metadata to Pro Checkout

The checkout endpoint needs to include `type: 'pro'` in metadata so the webhook can distinguish Pro from Team checkouts later. Also add `interval` support.

**Files:**
- Modify: `src/routes/api/billing/checkout/+server.ts`

- [ ] **Step 1: Update checkout to accept interval and add type metadata**

In `src/routes/api/billing/checkout/+server.ts`, update the POST handler:

1. After line 20 (`if (!env?.STRIPE_SECRET_KEY || !env?.STRIPE_PRO_PRICE_ID)`), also check for annual price ID availability (but don't require it — monthly is the default).

2. Before the Checkout Session creation (line 85), parse `interval` from request body:

```typescript
// Parse optional interval from request body
let interval: 'monthly' | 'annual' = 'monthly';
try {
	const body = await request.json();
	if (body.interval === 'annual') interval = 'annual';
} catch {
	// No body or invalid JSON — default to monthly
}

// Select price based on interval
const priceId = interval === 'annual' && env.STRIPE_PRO_ANNUAL_PRICE_ID
	? env.STRIPE_PRO_ANNUAL_PRICE_ID
	: env.STRIPE_PRO_PRICE_ID;
```

3. Update the `stripe.checkout.sessions.create` call:

```typescript
const session = await stripe.checkout.sessions.create({
	customer: stripeCustomerId,
	mode: 'subscription',
	allow_promotion_codes: true,
	line_items: [
		{
			price: priceId,
			quantity: memberCount
		}
	],
	success_url: `${origin}/settings?billing=success`,
	cancel_url: `${origin}/settings?billing=cancel`,
	subscription_data: {
		metadata: { type: 'pro', org_id: orgId }
	},
	metadata: { type: 'pro', org_id: orgId }
});
```

4. Add `request` to the destructured params: `async ({ request, locals, platform, url })`.

- [ ] **Step 2: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/billing/checkout/+server.ts
git commit -m "feat: add interval support and type metadata to Pro checkout

- Accept 'interval' param (monthly/annual) from request body
- Select price ID based on interval
- Add type: 'pro' to both session and subscription metadata
- Prepares for Team checkout distinction in webhook"
```

---

## Chunk 2: Database Schema — Teams

### Task 3: Add `teams` and `teamMembers` Tables

**Files:**
- Modify: `src/lib/server/db/schema.ts` (after `subscriptions` table, ~line 412)

- [ ] **Step 1: Add teams and teamMembers table definitions**

Add after the `subscriptions` table block (after line 412) in `src/lib/server/db/schema.ts`:

```typescript
/**
 * Teams — group billing. Owner pays for N seats, assigns Pro to users.
 * Each assigned user gets Pro across all their rooms.
 */
export const teams = pgTable(
	'teams',
	{
		id: text('id').primaryKey(), // nanoid
		ownerId: text('owner_id').notNull(),
		name: text('name').notNull(),
		stripeCustomerId: text('stripe_customer_id'),
		stripeSubscriptionId: text('stripe_subscription_id').unique(),
		seats: integer('seats').notNull().default(5),
		status: text('status')
			.notNull()
			.default('incomplete')
			.$type<'active' | 'past_due' | 'canceled' | 'incomplete'>(),
		currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
		cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('idx_teams_owner').on(table.ownerId),
		index('idx_teams_stripe_sub').on(table.stripeSubscriptionId),
		foreignKey({ columns: [table.ownerId], foreignColumns: [user.id] }).onDelete('restrict')
	]
);

/**
 * Team Members — users assigned Pro via a team.
 * A user can be in multiple teams (each team pays independently).
 */
export const teamMembers = pgTable(
	'team_members',
	{
		id: text('id').primaryKey(), // nanoid
		teamId: text('team_id').notNull(),
		userId: text('user_id').notNull(),
		assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('idx_team_members_unique').on(table.teamId, table.userId),
		index('idx_team_members_user').on(table.userId),
		foreignKey({ columns: [table.teamId], foreignColumns: [teams.id] }).onDelete('cascade'),
		foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade')
	]
);
```

- [ ] **Step 2: Generate migration**

```bash
pnpm db:generate
```

This will prompt for confirmation. Accept the migration.

- [ ] **Step 3: Run migration**

```bash
pnpm db:migrate
```

Expected: Migration applied successfully.

- [ ] **Step 4: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat: add teams and teamMembers tables for group billing

- teams: owner, seats, Stripe refs, status tracking
- teamMembers: user-to-team assignment with unique constraint
- ON DELETE RESTRICT for team owner, CASCADE for members"
```

---

## Chunk 3: Feature Gates Update

### Task 4: Update Feature Gates to Check Team Membership

**Files:**
- Modify: `src/lib/server/feature-gates.ts`

- [ ] **Step 1: Add team membership check**

Import the new tables at the top of `src/lib/server/feature-gates.ts`:

```typescript
import { subscriptions, messages, attachments, teams, teamMembers } from '$lib/server/db/schema';
```

Add a new function after `checkUserRoomCount`:

```typescript
/**
 * Check if a user has Pro via team membership.
 * Returns true if the user is assigned to any active team.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkUserTeamPro(db: any, userId: string): Promise<boolean> {
	const [result] = await db
		.select({ teamId: teamMembers.teamId })
		.from(teamMembers)
		.innerJoin(teams, eq(teams.id, teamMembers.teamId))
		.where(and(eq(teamMembers.userId, userId), eq(teams.status, 'active')))
		.limit(1);
	return !!result;
}
```

- [ ] **Step 2: Update checkOrgLimits to accept optional userId**

Modify the `checkOrgLimits` function signature and add team check:

```typescript
export async function checkOrgLimits(
	db: any,
	orgId: string,
	userId?: string
): Promise<OrgLimitsResult> {
	// 1. Load subscription (default: free)
	const [sub] = await db
		.select({
			plan: subscriptions.plan,
			status: subscriptions.status,
			foundingMember: subscriptions.foundingMember,
			currentPeriodEnd: subscriptions.currentPeriodEnd,
			cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
			quantity: subscriptions.quantity
		})
		.from(subscriptions)
		.where(eq(subscriptions.orgId, orgId))
		.limit(1);

	// Check org-level subscription first
	let plan: 'free' | 'pro' =
		sub?.plan === 'pro' && sub?.status === 'active' ? 'pro' : 'free';

	// If org is free but user has team Pro, upgrade to pro
	if (plan === 'free' && userId) {
		const hasTeamPro = await checkUserTeamPro(db, userId);
		if (hasTeamPro) plan = 'pro';
	}

	const limits = plan === 'pro' ? PRO_LIMITS : FREE_LIMITS;

	// ... rest of function unchanged
```

- [ ] **Step 3: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 4: Update settings page server load to pass userId**

In `src/routes/settings/+page.server.ts`, update line 89:

```typescript
const billing = activeOrgId
	? await checkOrgLimits(db, activeOrgId, locals.user.id)
	: null;
```

- [ ] **Step 5: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/feature-gates.ts src/routes/settings/+page.server.ts
git commit -m "feat: feature gates check team membership for Pro status

- Add checkUserTeamPro() to query teamMembers + teams
- checkOrgLimits() accepts optional userId param
- Priority: team Pro > room subscription > free default
- Settings page passes userId for team Pro detection"
```

---

## Chunk 4: Team API Routes

### Task 5: Team Checkout Endpoint

**Files:**
- Create: `src/routes/api/billing/team/checkout/+server.ts`

- [ ] **Step 1: Create the team checkout endpoint**

```typescript
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

	const body = await request.json();
	const name = body.name?.trim();
	const seats = Math.max(1, Math.min(100, parseInt(body.seats) || 5));

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
				status: 'incomplete',
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
			status: 'incomplete'
		});
	}

	const resolvedTeamId = existingTeam?.id ?? teamId;

	// Select price — team uses same Pro price, annual if requested
	const interval = body.interval === 'annual' ? 'annual' : 'monthly';
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
		success_url: `${origin}/settings?team=success`,
		cancel_url: `${origin}/settings?team=cancel`,
		subscription_data: {
			metadata: { type: 'team', team_id: resolvedTeamId, owner_id: locals.user.id }
		},
		metadata: { type: 'team', team_id: resolvedTeamId, owner_id: locals.user.id }
	});

	return json({ url: session.url });
};
```

- [ ] **Step 2: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/billing/team/checkout/+server.ts
git commit -m "feat: add team checkout endpoint

- POST /api/billing/team/checkout creates Stripe session for team
- Accepts name, seats, optional interval (monthly/annual)
- Creates team record with 'incomplete' status
- Reuses existing canceled/incomplete team record
- Sets type: 'team' in metadata for webhook routing"
```

---

### Task 6: Team Management Endpoints

**Files:**
- Create: `src/routes/api/billing/team/+server.ts`
- Create: `src/routes/api/billing/team/members/+server.ts`

- [ ] **Step 1: Create GET /api/billing/team endpoint**

Create `src/routes/api/billing/team/+server.ts`:

```typescript
/**
 * GET /api/billing/team — Get team info and members
 *
 * Auth: team owner only.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { teams, teamMembers } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const [team] = await locals.db
		.select()
		.from(teams)
		.where(eq(teams.ownerId, locals.user.id))
		.limit(1);

	if (!team) {
		return json({ team: null, members: [] });
	}

	const members = await locals.db
		.select({
			id: teamMembers.id,
			userId: teamMembers.userId,
			assignedAt: teamMembers.assignedAt,
			username: user.username,
			displayName: user.displayName,
			email: user.email
		})
		.from(teamMembers)
		.innerJoin(user, eq(user.id, teamMembers.userId))
		.where(eq(teamMembers.teamId, team.id));

	return json({
		team: {
			id: team.id,
			name: team.name,
			seats: team.seats,
			status: team.status,
			currentPeriodEnd: team.currentPeriodEnd?.toISOString() ?? null,
			cancelAtPeriodEnd: team.cancelAtPeriodEnd,
			memberCount: members.length
		},
		members: members.map((m) => ({
			id: m.id,
			userId: m.userId,
			username: m.username,
			displayName: m.displayName,
			email: m.email,
			assignedAt: m.assignedAt.toISOString()
		}))
	});
};
```

- [ ] **Step 2: Create POST/DELETE /api/billing/team/members endpoint**

Create `src/routes/api/billing/team/members/+server.ts`:

```typescript
/**
 * POST /api/billing/team/members — Assign user to team seat
 * DELETE /api/billing/team/members — Remove user from team
 *
 * Auth: team owner only.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { teams, teamMembers } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth-schema';
import { eq, and, sql } from 'drizzle-orm';

/** Verify caller is team owner, return team */
async function getOwnedTeam(locals: App.Locals) {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	const [team] = await locals.db
		.select()
		.from(teams)
		.where(eq(teams.ownerId, locals.user.id))
		.limit(1);

	if (!team) error(404, 'No team found');
	if (team.status !== 'active') error(400, 'Team subscription is not active');

	return team;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const team = await getOwnedTeam(locals);
	const db = locals.db!;

	const body = await request.json();
	const targetEmail = body.email?.trim()?.toLowerCase();
	if (!targetEmail) error(400, 'Email is required');

	// Find user by email
	const [targetUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, targetEmail))
		.limit(1);

	if (!targetUser) error(404, 'User not found with that email');

	// Check seat availability
	const [{ count: memberCount }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(teamMembers)
		.where(eq(teamMembers.teamId, team.id));

	if ((memberCount ?? 0) >= team.seats) {
		error(400, `All ${team.seats} seats are filled. Increase seats via billing portal.`);
	}

	// Check if already assigned
	const [existing] = await db
		.select({ id: teamMembers.id })
		.from(teamMembers)
		.where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, targetUser.id)))
		.limit(1);

	if (existing) error(400, 'User is already assigned to this team');

	// Assign seat
	await db.insert(teamMembers).values({
		id: crypto.randomUUID(),
		teamId: team.id,
		userId: targetUser.id
	});

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const team = await getOwnedTeam(locals);
	const db = locals.db!;

	const body = await request.json();
	const userId = body.userId;
	if (!userId) error(400, 'userId is required');

	const result = await db
		.delete(teamMembers)
		.where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));

	return json({ success: true });
};
```

- [ ] **Step 3: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/billing/team/+server.ts src/routes/api/billing/team/members/+server.ts
git commit -m "feat: add team management endpoints

- GET /api/billing/team returns team info + member list
- POST /api/billing/team/members assigns user by email
- DELETE /api/billing/team/members removes user from team
- Validates seat count, duplicate assignment, active status"
```

---

## Chunk 5: Webhook Handler — Team Support

### Task 7: Extend Webhook Handler for Team Events

**Files:**
- Modify: `src/routes/api/billing/webhook/+server.ts`

- [ ] **Step 1: Add team imports**

At the top of `src/routes/api/billing/webhook/+server.ts`, add to imports:

```typescript
import { subscriptions, teams } from '$lib/server/db/schema';
```

(Replace the existing `import { subscriptions }` line.)

- [ ] **Step 2: Update checkout.session.completed handler**

Replace the `checkout.session.completed` case (lines 46-106) with:

```typescript
case 'checkout.session.completed': {
	const session = event.data.object as Stripe.Checkout.Session;
	const metadataType = session.metadata?.type;

	if (metadataType === 'team') {
		// Team checkout
		const teamId = session.metadata?.team_id;
		if (!teamId || !session.subscription || !session.customer) break;

		const stripeSubscriptionId =
			typeof session.subscription === 'string'
				? session.subscription
				: session.subscription.id;
		const stripeCustomerId =
			typeof session.customer === 'string' ? session.customer : session.customer.id;

		const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
		const periodEnd = getPeriodEnd(sub);

		await db
			.update(teams)
			.set({
				stripeSubscriptionId,
				stripeCustomerId,
				status: 'active',
				seats: sub.items.data[0]?.quantity ?? 5,
				currentPeriodEnd: periodEnd,
				cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
				updatedAt: new Date()
			})
			.where(eq(teams.id, teamId));
	} else {
		// Pro checkout (default)
		const orgId = session.metadata?.org_id;
		if (!orgId || !session.subscription || !session.customer) break;

		const stripeSubscriptionId =
			typeof session.subscription === 'string'
				? session.subscription
				: session.subscription.id;
		const stripeCustomerId =
			typeof session.customer === 'string' ? session.customer : session.customer.id;

		const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);

		const [{ count: proCount }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(subscriptions)
			.where(eq(subscriptions.plan, 'pro'));
		const isFoundingMember = (proCount ?? 0) < 100;

		const periodEnd = getPeriodEnd(sub);

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
					currentPeriodEnd: periodEnd,
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
				currentPeriodEnd: periodEnd,
				cancelAtPeriodEnd: sub.cancel_at_period_end ?? false
			});
		}
	}
	break;
}
```

- [ ] **Step 3: Update subscription.updated handler**

Replace the `customer.subscription.updated` case with routing via metadata:

```typescript
case 'customer.subscription.updated': {
	const sub = event.data.object as Stripe.Subscription;
	const metadataType = sub.metadata?.type;

	if (metadataType === 'team') {
		const teamId = sub.metadata?.team_id;
		if (!teamId) break;
		await db
			.update(teams)
			.set({
				status: mapStripeStatus(sub.status),
				seats: sub.items.data[0]?.quantity ?? 5,
				currentPeriodEnd: getPeriodEnd(sub),
				cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
				updatedAt: new Date()
			})
			.where(eq(teams.id, teamId));
	} else {
		const orgId = sub.metadata?.org_id;
		if (!orgId) break;
		await db
			.update(subscriptions)
			.set({
				status: mapStripeStatus(sub.status),
				quantity: sub.items.data[0]?.quantity ?? 1,
				currentPeriodEnd: getPeriodEnd(sub),
				cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
				updatedAt: new Date()
			})
			.where(eq(subscriptions.orgId, orgId));
	}
	break;
}
```

- [ ] **Step 4: Update subscription.deleted handler**

Replace the `customer.subscription.deleted` case:

```typescript
case 'customer.subscription.deleted': {
	const sub = event.data.object as Stripe.Subscription;
	const metadataType = sub.metadata?.type;

	if (metadataType === 'team') {
		const teamId = sub.metadata?.team_id;
		if (!teamId) break;
		await db
			.update(teams)
			.set({
				status: 'canceled',
				cancelAtPeriodEnd: false,
				updatedAt: new Date()
			})
			.where(eq(teams.id, teamId));
	} else {
		const orgId = sub.metadata?.org_id;
		if (!orgId) break;
		await db
			.update(subscriptions)
			.set({
				status: 'canceled',
				cancelAtPeriodEnd: false,
				updatedAt: new Date()
			})
			.where(eq(subscriptions.orgId, orgId));
	}
	break;
}
```

- [ ] **Step 5: Update invoice.payment_failed handler**

This handler doesn't carry custom metadata, so use dual lookup:

```typescript
case 'invoice.payment_failed': {
	const invoice = event.data.object as Stripe.Invoice;
	const parentSub = invoice.parent?.subscription_details?.subscription;
	const subId = typeof parentSub === 'string' ? parentSub : parentSub?.id;
	if (!subId) break;

	// Try subscriptions table first
	const [proSub] = await db
		.select({ id: subscriptions.id })
		.from(subscriptions)
		.where(eq(subscriptions.stripeSubscriptionId, subId))
		.limit(1);

	if (proSub) {
		await db
			.update(subscriptions)
			.set({ status: 'past_due', updatedAt: new Date() })
			.where(eq(subscriptions.stripeSubscriptionId, subId));
	} else {
		// Try teams table
		await db
			.update(teams)
			.set({ status: 'past_due', updatedAt: new Date() })
			.where(eq(teams.stripeSubscriptionId, subId));
	}
	break;
}
```

- [ ] **Step 6: Add sql import if missing**

Ensure the `sql` import is present:

```typescript
import { eq, sql } from 'drizzle-orm';
```

- [ ] **Step 7: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/routes/api/billing/webhook/+server.ts
git commit -m "feat: extend webhook handler for team subscriptions

- Route checkout.session.completed by metadata.type (pro/team)
- Route subscription.updated/deleted by metadata.type
- invoice.payment_failed uses dual lookup (no custom metadata)
- Team events update teams table with status, seats, period end"
```

---

## Chunk 6: Settings UI Updates

### Task 8: Update Settings Page Server Load for Teams

**Files:**
- Modify: `src/routes/settings/+page.server.ts`

- [ ] **Step 1: Add team data loading**

Import team tables at top of `src/routes/settings/+page.server.ts`:

```typescript
import { usernameHistory, accountAudit, teams, teamMembers } from '$lib/server/db/schema';
```

After the `roomCount` line (line 92), add team data loading:

```typescript
const roomCount = await checkUserRoomCount(db, locals.user.id);

// Load team data if user owns a team
const [ownedTeam] = await db
	.select({
		id: teams.id,
		name: teams.name,
		seats: teams.seats,
		status: teams.status,
		currentPeriodEnd: teams.currentPeriodEnd,
		cancelAtPeriodEnd: teams.cancelAtPeriodEnd
	})
	.from(teams)
	.where(eq(teams.ownerId, locals.user.id))
	.limit(1);

// Check if user has Pro via any team membership
const { checkUserTeamPro } = await import('$lib/server/feature-gates');
const hasTeamPro = await checkUserTeamPro(db, locals.user.id);
```

Update the return statement to include team data:

```typescript
return {
	profile: { /* ... unchanged ... */ },
	lastUsernameChange: lastChange?.changedAt?.toISOString() ?? null,
	lastEmailChange: lastEmailChange?.changedAt?.toISOString() ?? null,
	billing,
	roomCount,
	isOwnerOrLead,
	team: ownedTeam
		? {
				id: ownedTeam.id,
				name: ownedTeam.name,
				seats: ownedTeam.seats,
				status: ownedTeam.status,
				currentPeriodEnd: ownedTeam.currentPeriodEnd?.toISOString() ?? null,
				cancelAtPeriodEnd: ownedTeam.cancelAtPeriodEnd
			}
		: null,
	hasTeamPro
};
```

- [ ] **Step 2: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/settings/+page.server.ts
git commit -m "feat: load team data in settings page server

- Load owned team info for team management UI
- Check team Pro status for display
- Pass team data and hasTeamPro to page"
```

---

### Task 9: Add Annual Plan Toggle to Checkout UI

This task modifies the settings page to offer monthly/annual choice when upgrading. The exact UI changes depend on the current settings page structure.

**Files:**
- Modify: `src/routes/settings/+page.svelte`

- [ ] **Step 1: Read current settings page to understand structure**

Read `src/routes/settings/+page.svelte` to understand the current billing section layout before modifying.

- [ ] **Step 2: Update the upgrade section**

In the billing section of the settings page, find the upgrade button and add interval selection. The upgrade flow should:

1. Show a choice between Monthly ($10/mo) and Annual ($96/yr — save 20%) when clicking Upgrade
2. POST to `/api/billing/checkout` with `{ interval: 'monthly' | 'annual' }`
3. Redirect to the Stripe Checkout URL returned

Add state and handler:

```svelte
<script>
	// Add to existing script block
	let upgradeInterval = $state<'monthly' | 'annual'>('monthly');
	let upgradeLoading = $state(false);

	async function handleUpgrade() {
		upgradeLoading = true;
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ interval: upgradeInterval })
			});
			const data = await res.json();
			if (data.url) window.location.href = data.url;
			else alert('Failed to create checkout session');
		} finally {
			upgradeLoading = false;
		}
	}
</script>
```

Replace the existing upgrade button with interval selection:

```svelte
{#if data.billing?.plan === 'free' && data.isOwnerOrLead}
	<div class="flex flex-col gap-3">
		<div class="flex gap-2">
			<button
				class="px-3 py-1.5 rounded text-sm {upgradeInterval === 'monthly' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400'}"
				onclick={() => upgradeInterval = 'monthly'}
			>
				Monthly — $10/mo
			</button>
			<button
				class="px-3 py-1.5 rounded text-sm {upgradeInterval === 'annual' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-400'}"
				onclick={() => upgradeInterval = 'annual'}
			>
				Annual — $96/yr <span class="text-xs opacity-70">save 20%</span>
			</button>
		</div>
		<button
			class="px-4 py-2 bg-amber-600 text-white rounded font-medium disabled:opacity-50"
			onclick={handleUpgrade}
			disabled={upgradeLoading}
		>
			{upgradeLoading ? 'Redirecting…' : 'Upgrade to Pro'}
		</button>
	</div>
{/if}
```

- [ ] **Step 3: Add team section to settings page**

Add a team management section below billing. This shows:
- If user owns a team: team name, seats used, manage button
- If user has team Pro (but doesn't own): show "Pro via Team" badge
- If neither: "Create a Team" CTA

```svelte
<!-- Team Section -->
<section class="mt-8 border-t border-zinc-800 pt-6">
	<h2 class="text-lg font-semibold mb-4">Team</h2>

	{#if data.team}
		<div class="space-y-2 text-sm">
			<p><span class="text-zinc-400">Team:</span> {data.team.name}</p>
			<p><span class="text-zinc-400">Status:</span> {data.team.status}</p>
			<p><span class="text-zinc-400">Seats:</span> {data.team.seats}</p>
			{#if data.team.currentPeriodEnd}
				<p><span class="text-zinc-400">Renews:</span> {new Date(data.team.currentPeriodEnd).toLocaleDateString()}</p>
			{/if}
			<a
				href="/settings/team"
				class="inline-block mt-2 px-4 py-2 bg-zinc-800 rounded text-sm hover:bg-zinc-700"
			>
				Manage Team Members
			</a>
		</div>
	{:else if data.hasTeamPro}
		<p class="text-sm text-zinc-400">
			You have <span class="text-amber-400 font-medium">Pro</span> via a team subscription.
		</p>
	{:else}
		<p class="text-sm text-zinc-400 mb-3">
			Create a team to give Pro access to multiple users under one bill.
		</p>
		<a
			href="/settings/team"
			class="inline-block px-4 py-2 bg-zinc-800 rounded text-sm hover:bg-zinc-700"
		>
			Create a Team
		</a>
	{/if}
</section>
```

- [ ] **Step 4: Run type check and dev server**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/settings/+page.svelte
git commit -m "feat: add annual plan toggle and team section to settings

- Upgrade shows monthly/annual choice with pricing
- Posts interval to checkout endpoint
- Team section: shows owned team, team Pro badge, or create CTA
- Links to /settings/team for member management"
```

---

### Task 10: Create Team Management Page

**Files:**
- Create: `src/routes/settings/team/+page.svelte`
- Create: `src/routes/settings/team/+page.server.ts`

- [ ] **Step 1: Create team page server load**

Create `src/routes/settings/team/+page.server.ts`:

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');
	return { userId: locals.user.id };
};
```

- [ ] **Step 2: Create team management page**

Create `src/routes/settings/team/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';

	let { data } = $props();

	interface TeamData {
		id: string;
		name: string;
		seats: number;
		status: string;
		currentPeriodEnd: string | null;
		cancelAtPeriodEnd: boolean;
		memberCount: number;
	}

	interface TeamMember {
		id: string;
		userId: string;
		username: string;
		displayName: string;
		email: string;
		assignedAt: string;
	}

	let team = $state<TeamData | null>(null);
	let members = $state<TeamMember[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Create team form
	let teamName = $state('');
	let teamSeats = $state(5);
	let createLoading = $state(false);

	// Add member form
	let addEmail = $state('');
	let addLoading = $state(false);

	async function loadTeam() {
		loading = true;
		try {
			const res = await fetch('/api/billing/team');
			const data = await res.json();
			team = data.team;
			members = data.members;
		} catch {
			error = 'Failed to load team data';
		} finally {
			loading = false;
		}
	}

	async function createTeam() {
		if (!teamName.trim()) return;
		createLoading = true;
		error = '';
		try {
			const res = await fetch('/api/billing/team/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: teamName, seats: teamSeats })
			});
			const data = await res.json();
			if (data.url) window.location.href = data.url;
			else error = data.message || 'Failed to create checkout';
		} catch {
			error = 'Failed to create team';
		} finally {
			createLoading = false;
		}
	}

	async function addMember() {
		if (!addEmail.trim()) return;
		addLoading = true;
		error = '';
		try {
			const res = await fetch('/api/billing/team/members', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: addEmail })
			});
			if (!res.ok) {
				const data = await res.json();
				error = data.message || 'Failed to add member';
				return;
			}
			addEmail = '';
			await loadTeam();
		} catch {
			error = 'Failed to add member';
		} finally {
			addLoading = false;
		}
	}

	async function removeMember(userId: string) {
		error = '';
		try {
			const res = await fetch('/api/billing/team/members', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (!res.ok) {
				const data = await res.json();
				error = data.message || 'Failed to remove member';
				return;
			}
			await loadTeam();
		} catch {
			error = 'Failed to remove member';
		}
	}

	async function openPortal() {
		const res = await fetch('/api/billing/portal', { method: 'POST' });
		const data = await res.json();
		if (data.url) window.location.href = data.url;
	}

	// Load team data on mount
	$effect(() => {
		loadTeam();
	});
</script>

<div class="max-w-2xl mx-auto p-6">
	<button class="text-sm text-zinc-400 hover:text-white mb-4" onclick={() => goto('/settings')}>
		← Back to Settings
	</button>

	<h1 class="text-2xl font-bold mb-6">Team Management</h1>

	{#if error}
		<div class="bg-red-900/30 border border-red-800 text-red-300 px-4 py-2 rounded mb-4 text-sm">
			{error}
		</div>
	{/if}

	{#if loading}
		<p class="text-zinc-400">Loading…</p>
	{:else if !team}
		<!-- Create team form -->
		<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
			<h2 class="text-lg font-semibold mb-4">Create a Team</h2>
			<p class="text-sm text-zinc-400 mb-4">
				Pay for multiple Pro seats under one bill. Assign Pro to any Martol user.
			</p>
			<div class="space-y-4">
				<div>
					<label for="team-name" class="block text-sm text-zinc-400 mb-1">Team name</label>
					<input
						id="team-name"
						type="text"
						bind:value={teamName}
						placeholder="My Team"
						class="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white"
						data-testid="team-name-input"
					/>
				</div>
				<div>
					<label for="team-seats" class="block text-sm text-zinc-400 mb-1">Seats ($10/user/mo)</label>
					<input
						id="team-seats"
						type="number"
						bind:value={teamSeats}
						min="1"
						max="100"
						class="w-32 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white"
						data-testid="team-seats-input"
					/>
				</div>
				<button
					onclick={createTeam}
					disabled={createLoading || !teamName.trim()}
					class="px-4 py-2 bg-amber-600 text-white rounded font-medium disabled:opacity-50"
					data-testid="create-team-btn"
				>
					{createLoading ? 'Redirecting to checkout…' : `Create Team — $${teamSeats * 10}/mo`}
				</button>
			</div>
		</div>
	{:else}
		<!-- Team info -->
		<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-lg font-semibold">{team.name}</h2>
				<span class="text-xs px-2 py-1 rounded {team.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}">
					{team.status}
				</span>
			</div>
			<div class="text-sm text-zinc-400 space-y-1">
				<p>Seats: {team.memberCount} / {team.seats} used</p>
				{#if team.currentPeriodEnd}
					<p>Renews: {new Date(team.currentPeriodEnd).toLocaleDateString()}</p>
				{/if}
			</div>
			<button
				onclick={openPortal}
				class="mt-3 px-3 py-1.5 bg-zinc-800 rounded text-sm hover:bg-zinc-700"
			>
				Manage Billing
			</button>
		</div>

		<!-- Add member -->
		{#if team.status === 'active' && team.memberCount < team.seats}
			<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
				<h3 class="font-medium mb-3">Add Member</h3>
				<div class="flex gap-2">
					<input
						type="email"
						bind:value={addEmail}
						placeholder="user@example.com"
						class="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-white"
						data-testid="add-member-email"
					/>
					<button
						onclick={addMember}
						disabled={addLoading || !addEmail.trim()}
						class="px-4 py-2 bg-amber-600 text-white rounded disabled:opacity-50"
						data-testid="add-member-btn"
					>
						{addLoading ? 'Adding…' : 'Add'}
					</button>
				</div>
			</div>
		{/if}

		<!-- Member list -->
		<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
			<h3 class="font-medium mb-3">Members</h3>
			{#if members.length === 0}
				<p class="text-sm text-zinc-500">No members assigned yet.</p>
			{:else}
				<div class="space-y-2">
					{#each members as m}
						<div class="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
							<div>
								<p class="text-sm font-medium">{m.displayName || m.username || 'Unknown'}</p>
								<p class="text-xs text-zinc-500">{m.email}</p>
							</div>
							<button
								onclick={() => removeMember(m.userId)}
								class="text-xs text-red-400 hover:text-red-300"
								data-testid="remove-member-btn"
							>
								Remove
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
```

- [ ] **Step 3: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings/team/
git commit -m "feat: add team management page

- Create team flow with name, seats, checkout redirect
- Add member by email, remove member
- Shows team status, seat usage, renewal date
- Manage Billing button opens Stripe portal"
```

---

## Chunk 7: Pricing Page Update

### Task 11: Add Monthly/Annual Toggle to Pricing Page

**Files:**
- Modify: `src/routes/docs/pricing/+page.svelte`

- [ ] **Step 1: Read current pricing page structure**

Read `src/routes/docs/pricing/+page.svelte` to understand the layout before modifying.

- [ ] **Step 2: Add billing interval toggle**

Add a monthly/annual toggle near the top of the pricing section. When annual is selected, show $8/mo (billed $96/yr) instead of $10/mo for Pro and Team plans. Free and Enterprise remain unchanged.

Add state:

```svelte
let annual = $state(false);
```

Add toggle UI near the top of the pricing cards section:

```svelte
<div class="flex items-center justify-center gap-3 mb-8">
	<span class="text-sm {!annual ? 'text-white' : 'text-zinc-500'}">Monthly</span>
	<button
		class="relative w-12 h-6 rounded-full {annual ? 'bg-amber-600' : 'bg-zinc-700'} transition-colors"
		onclick={() => annual = !annual}
		data-testid="pricing-interval-toggle"
	>
		<span
			class="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform {annual ? 'translate-x-6' : ''}"
		></span>
	</button>
	<span class="text-sm {annual ? 'text-white' : 'text-zinc-500'}">
		Annual <span class="text-amber-400 text-xs">save 20%</span>
	</span>
</div>
```

Update Pro and Team price displays to be dynamic:

```svelte
<!-- In Pro card price -->
{#if annual}
	<span class="text-3xl font-bold">$8</span>
	<span class="text-zinc-400">/user/mo</span>
	<span class="text-xs text-zinc-500 block">billed $96/year</span>
{:else}
	<span class="text-3xl font-bold">$10</span>
	<span class="text-zinc-400">/user/mo</span>
{/if}
```

- [ ] **Step 3: Run type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/docs/pricing/+page.svelte
git commit -m "feat: add monthly/annual toggle to pricing page

- Toggle switches between monthly ($10/mo) and annual ($8/mo)
- Annual shows 'save 20%' badge and 'billed $96/year' note
- Free and Enterprise plans unchanged"
```

---

## Chunk 8: Environment & Final Wiring

### Task 12: Add New Environment Variables

**Files:**
- Modify: `.dev.vars` (local dev)
- Modify: `wrangler.toml` (if env vars are listed there)

- [ ] **Step 1: Add annual price ID to .dev.vars**

Add to `.dev.vars`:

```
STRIPE_PRO_ANNUAL_PRICE_ID=price_xxxxx
```

Replace `price_xxxxx` with the actual Stripe annual price ID from the Stripe Dashboard.

- [ ] **Step 2: Add to wrangler.toml if applicable**

If `wrangler.toml` lists env var names (not values), add `STRIPE_PRO_ANNUAL_PRICE_ID` there too. For production, set it via `wrangler secret put STRIPE_PRO_ANNUAL_PRICE_ID`.

- [ ] **Step 3: Commit (do NOT commit .dev.vars)**

```bash
git add wrangler.toml
git commit -m "chore: add STRIPE_PRO_ANNUAL_PRICE_ID to wrangler config"
```

---

### Task 13: Verify Stripe Dashboard Webhook URL

This is a manual step — not code.

- [ ] **Step 1: Check Stripe Dashboard → Developers → Webhooks**

Ensure the webhook endpoint URL points to `https://your-domain.com/api/billing/webhook` (the new handler), NOT `/api/webhooks/stripe` (the deleted old handler).

- [ ] **Step 2: Verify events are configured**

Required events:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

- [ ] **Step 3: Configure Customer Portal**

In Stripe Dashboard → Settings → Billing → Customer Portal:
- Enable: subscription switching (to allow monthly ↔ annual)
- Enable: quantity updates (to allow Team seat changes)
- Enable: subscription cancellation

---

### Task 14: Final Type Check and Dev Server Verification

- [ ] **Step 1: Run full type check**

```bash
pnpm check
```

Expected: No errors.

- [ ] **Step 2: Start dev server**

```bash
pnpm dev
```

Expected: Server starts on localhost:5190 without errors.

- [ ] **Step 3: Smoke test the flows**

Manual verification:
1. Visit `/settings` — billing section shows plan, upgrade button with monthly/annual choice
2. Visit `/docs/pricing` — monthly/annual toggle works
3. Visit `/settings/team` — shows create team form (if no team exists)
4. Click Upgrade → should redirect to Stripe Checkout (test mode)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues found during smoke testing"
```
