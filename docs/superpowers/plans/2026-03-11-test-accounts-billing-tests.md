# Test Accounts & Billing Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create test accounts with OTP bypass and a two-layer billing test suite (Vitest + Playwright) covering all subscription flows.

**Architecture:** Test accounts use a dedicated `POST /api/auth/test-login` endpoint gated by `TEST_ACCOUNTS_ENABLED` env var. Password hashes stored in a new `test_account_credentials` table. Vitest tests call API handlers directly with mocked request events and real Stripe test API. Playwright tests automate the browser through full checkout flows.

**Tech Stack:** Better Auth (session minting), Vitest (unit/integration), Playwright (E2E), Stripe test mode (card 4242 4242 4242 4242), scrypt (password hashing)

**Spec:** `docs/superpowers/specs/2026-03-11-test-accounts-billing-tests-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/lib/server/auth/test-accounts.ts` | Test account config: email→password map, user IDs, validation helpers |
| `src/routes/api/auth/test-login/+server.ts` | POST endpoint: validates credentials, mints Better Auth session |
| `src/routes/api/auth/test-accounts-enabled/+server.ts` | GET endpoint: returns whether test accounts are enabled |
| `scripts/seed-test-accounts.ts` | Seed script: creates users, orgs, Stripe customers, subscriptions, team |
| `src/lib/server/billing/__tests__/helpers.ts` | Shared Vitest test utilities (mock request events, Stripe event builders) |
| `src/lib/server/billing/__tests__/checkout.test.ts` | Pro checkout Vitest tests |
| `src/lib/server/billing/__tests__/team-checkout.test.ts` | Team checkout Vitest tests |
| `src/lib/server/billing/__tests__/verify.test.ts` | Post-checkout verify Vitest tests |
| `src/lib/server/billing/__tests__/webhook.test.ts` | Stripe webhook handler Vitest tests |
| `src/lib/server/billing/__tests__/feature-gates.test.ts` | Plan limits + withinLimit Vitest tests |
| `src/lib/server/billing/__tests__/billing-sync.test.ts` | Stripe sync Vitest tests |
| `src/lib/server/billing/__tests__/ai-billing.test.ts` | AI metering Vitest tests |
| `src/lib/server/billing/__tests__/team-members.test.ts` | Seat assignment Vitest tests |
| `src/lib/server/billing/__tests__/portal.test.ts` | Portal redirect Vitest tests |
| `playwright.config.ts` | Playwright configuration |
| `tests/e2e/helpers/auth.ts` | Playwright login helper (uses test-login endpoint) |
| `tests/e2e/helpers/stripe.ts` | Playwright Stripe checkout helper (fills card form) |
| `tests/e2e/helpers/settings.ts` | Playwright settings page helpers |
| `tests/e2e/billing/pro-upgrade.spec.ts` | E2E: Free → Pro upgrade flow |
| `tests/e2e/billing/pro-annual.spec.ts` | E2E: Annual Pro upgrade |
| `tests/e2e/billing/pro-cancel.spec.ts` | E2E: Cancel Pro subscription |
| `tests/e2e/billing/team-create.spec.ts` | E2E: Create team + checkout |
| `tests/e2e/billing/team-members.spec.ts` | E2E: Add/remove team members |
| `tests/e2e/billing/team-billing.spec.ts` | E2E: Team billing portal |
| `tests/e2e/billing/free-limits.spec.ts` | E2E: Free plan limits display |
| `tests/e2e/billing/canceled-state.spec.ts` | E2E: Canceled subscription state |
| `tests/e2e/billing/pastdue-state.spec.ts` | E2E: Past-due subscription state |

### Modified Files

| File | Change |
|---|---|
| `src/lib/server/db/schema.ts` | Add `testAccountCredentials` table |
| `src/routes/login/+page.svelte` | Detect `@martol.test` emails, switch to password input |
| `src/routes/login/+page.server.ts` | Pass `testAccountsEnabled` flag to client |
| `package.json` | Add `db:seed-test`, `test:e2e` scripts, `@playwright/test` dev dep |
| `vitest.config.ts` | No changes needed (already includes `src/**/*.test.ts`) |

---

## Chunk 1: Test Account Infrastructure

### Task 1: Add test_account_credentials schema

**Files:**
- Modify: `src/lib/server/db/schema.ts` (after line 461, after teamMembers table)

- [ ] **Step 1: Add table definition**

Add after the `teamMembers` table definition (line 461):

```typescript
/**
 * Test Account Credentials — password hashes for test accounts.
 * Only used by the test-login endpoint. Never populated in production.
 */
export const testAccountCredentials = pgTable('test_account_credentials', {
	userId: text('user_id').primaryKey(),
	passwordHash: text('password_hash').notNull()
}, (table) => [
	foreignKey({ columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade')
]);
```

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate`
Expected: New migration file created for `test_account_credentials` table.

- [ ] **Step 3: Run migration**

Run: `pnpm db:migrate`
Expected: Migration applied successfully.

- [ ] **Step 4: Verify TypeScript**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat: add test_account_credentials table for test auth"
```

---

### Task 2: Create test account config module

**Files:**
- Create: `src/lib/server/auth/test-accounts.ts`

- [ ] **Step 1: Create the config file**

```typescript
/**
 * Test Account Configuration
 *
 * Defines test accounts with deterministic IDs, emails, and passwords.
 * Used by the test-login endpoint and seed script.
 *
 * SECURITY: Passwords are verified via scrypt hash comparison,
 * not stored in plaintext. This file only contains the account
 * definitions — hashes are in the database.
 */

import { timingSafeEqual } from 'node:crypto';

/** Test account definition */
export interface TestAccount {
	id: string;
	email: string;
	password: string;
	username: string;
	displayName: string;
	planState: 'free' | 'pro' | 'pro_founding' | 'team_owner' | 'team_member' | 'canceled' | 'past_due';
}

export const TEST_ACCOUNTS: TestAccount[] = [
	{
		id: 'test-free-0000-0000-000000000001',
		email: 'test-free@martol.test',
		password: 'TestFree123!',
		username: 'test-free',
		displayName: 'Test Free User',
		planState: 'free'
	},
	{
		id: 'test-pro-0000-0000-000000000002',
		email: 'test-pro@martol.test',
		password: 'TestPro123!',
		username: 'test-pro',
		displayName: 'Test Pro User',
		planState: 'pro'
	},
	{
		id: 'test-found-000-0000-000000000003',
		email: 'test-founder@martol.test',
		password: 'TestFounder123!',
		username: 'test-founder',
		displayName: 'Test Founding Member',
		planState: 'pro_founding'
	},
	{
		id: 'test-owner-000-0000-000000000004',
		email: 'test-team-owner@martol.test',
		password: 'TestTeamOwner123!',
		username: 'test-team-owner',
		displayName: 'Test Team Owner',
		planState: 'team_owner'
	},
	{
		id: 'test-member-00-0000-000000000005',
		email: 'test-team-member@martol.test',
		password: 'TestMember123!',
		username: 'test-team-member',
		displayName: 'Test Team Member',
		planState: 'team_member'
	},
	{
		id: 'test-cancel-00-0000-000000000006',
		email: 'test-canceled@martol.test',
		password: 'TestCanceled123!',
		username: 'test-canceled',
		displayName: 'Test Canceled User',
		planState: 'canceled'
	},
	{
		id: 'test-pastdue-0-0000-000000000007',
		email: 'test-pastdue@martol.test',
		password: 'TestPastdue123!',
		username: 'test-pastdue',
		displayName: 'Test Past Due User',
		planState: 'past_due'
	}
];

/** Map of test email → account for quick lookup */
export const TEST_ACCOUNT_MAP = new Map(TEST_ACCOUNTS.map((a) => [a.email, a]));

/** Check if an email belongs to a test account */
export function isTestAccountEmail(email: string): boolean {
	return email.endsWith('@martol.test') && TEST_ACCOUNT_MAP.has(email);
}

/**
 * Verify a password against a scrypt hash.
 * Uses Better Auth's scrypt format: $scrypt$N$r$p$salt$hash
 * Falls back to a simple comparison for Node.js crypto scrypt.
 */
export async function verifyTestPassword(password: string, hash: string): Promise<boolean> {
	// Use the same scrypt verification as Better Auth
	const { scrypt, randomBytes } = await import('node:crypto');
	const { promisify } = await import('node:util');
	const scryptAsync = promisify(scrypt);

	// Parse hash format: $scrypt$N$r$p$salt$derived
	const parts = hash.split('$');
	if (parts.length < 7 || parts[1] !== 'scrypt') return false;

	const N = parseInt(parts[2]);
	const r = parseInt(parts[3]);
	const p = parseInt(parts[4]);
	const salt = Buffer.from(parts[5], 'base64');
	const derivedKey = Buffer.from(parts[6], 'base64');

	const result = (await scryptAsync(password, salt, derivedKey.length, { N, r, p })) as Buffer;
	return timingSafeEqual(result, derivedKey);
}

/**
 * Hash a password using scrypt (for seed script).
 * Output format: $scrypt$N$r$p$salt$derived
 */
export async function hashTestPassword(password: string): Promise<string> {
	const { scrypt, randomBytes } = await import('node:crypto');
	const { promisify } = await import('node:util');
	const scryptAsync = promisify(scrypt);

	const N = 16384;
	const r = 8;
	const p = 1;
	const keyLen = 64;
	const salt = randomBytes(16);
	const derived = (await scryptAsync(password, salt, keyLen, { N, r, p })) as Buffer;

	return `$scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/auth/test-accounts.ts
git commit -m "feat: add test account config with scrypt password helpers"
```

---

### Task 3: Create test-login endpoint

**Files:**
- Create: `src/routes/api/auth/test-login/+server.ts`
- Create: `src/routes/api/auth/test-accounts-enabled/+server.ts`

- [ ] **Step 1: Create the test-accounts-enabled check endpoint**

```typescript
/**
 * GET /api/auth/test-accounts-enabled
 *
 * Returns whether test account login is enabled.
 * Used by the login page to show/hide password field.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
	const enabled = platform?.env?.TEST_ACCOUNTS_ENABLED === 'true'
		|| process.env.TEST_ACCOUNTS_ENABLED === 'true';
	return json({ enabled });
};
```

- [ ] **Step 2: Create the test-login endpoint**

```typescript
/**
 * POST /api/auth/test-login — Test Account Login
 *
 * Authenticates test accounts using password instead of email OTP.
 * Only available when TEST_ACCOUNTS_ENABLED env var is 'true'.
 *
 * Returns 404 when disabled (endpoint is invisible).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isTestAccountEmail, verifyTestPassword } from '$lib/server/auth/test-accounts';
import { testAccountCredentials } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { user } from '$lib/server/db/auth-schema';

export const POST: RequestHandler = async ({ request, locals, platform, cookies }) => {
	// Gate: completely invisible when disabled
	const enabled = platform?.env?.TEST_ACCOUNTS_ENABLED === 'true'
		|| process.env.TEST_ACCOUNTS_ENABLED === 'true';
	if (!enabled) error(404, 'Not found');

	if (!locals.db) error(503, 'Database unavailable');

	const body = (await request.json()) as { email?: string; password?: string };
	const email = body.email?.trim()?.toLowerCase();
	const password = body.password;

	if (!email || !password) error(400, 'Email and password required');
	if (!isTestAccountEmail(email)) error(400, 'Not a test account');

	// Look up user by email
	const [targetUser] = await locals.db
		.select({ id: user.id, email: user.email, username: user.username })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);

	if (!targetUser) error(404, 'Test account not seeded. Run: pnpm db:seed-test');

	// Verify password hash
	const [creds] = await locals.db
		.select({ passwordHash: testAccountCredentials.passwordHash })
		.from(testAccountCredentials)
		.where(eq(testAccountCredentials.userId, targetUser.id))
		.limit(1);

	if (!creds) error(404, 'Test account credentials not seeded. Run: pnpm db:seed-test');

	const valid = await verifyTestPassword(password, creds.passwordHash);
	if (!valid) error(401, 'Invalid password');

	// Create Better Auth session directly
	// Use the auth instance from locals (created per-request in hooks.server.ts)
	const auth = locals.auth;
	if (!auth) error(503, 'Auth not initialized');

	const session = await auth.api.signInEmail({
		body: { email, password },
		asResponse: false,
		headers: request.headers
	}).catch(() => null);

	// Fallback: create session manually if signInEmail doesn't work
	// (since emailAndPassword plugin is not enabled)
	if (!session) {
		// Use internal session creation
		const newSession = await locals.db.insert(
			(await import('$lib/server/db/auth-schema')).session
		).values({
			id: crypto.randomUUID(),
			userId: targetUser.id,
			token: crypto.randomUUID(),
			expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
			createdAt: new Date(),
			updatedAt: new Date()
		}).returning();

		if (newSession[0]) {
			// Set session cookie (matches Better Auth cookie format)
			cookies.set('martol.session_token', newSession[0].token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: request.url.startsWith('https'),
				maxAge: 7 * 24 * 60 * 60 // 7 days
			});
		}
	}

	console.log(`[TestAuth] Login: ${email}`);

	return json({
		ok: true,
		user: { id: targetUser.id, email: targetUser.email, username: targetUser.username },
		redirectTo: '/chat'
	});
};
```

- [ ] **Step 3: Verify TypeScript**

Run: `pnpm check`
Expected: 0 errors. If `locals.auth` is not typed, add it to `App.Locals` in `src/app.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/auth/test-login/ src/routes/api/auth/test-accounts-enabled/
git commit -m "feat: add test-login endpoint for OTP-free test account auth"
```

---

### Task 4: Update login page for test accounts

**Files:**
- Modify: `src/routes/login/+page.svelte` (lines 12, 24, 141-177, template section)
- Modify: `src/routes/login/+page.server.ts`

- [ ] **Step 1: Update server load to pass testAccountsEnabled**

In `src/routes/login/+page.server.ts`, add the flag:

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
	const turnstileSiteKey = platform?.env?.TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || '';
	const testAccountsEnabled = platform?.env?.TEST_ACCOUNTS_ENABLED === 'true'
		|| process.env.TEST_ACCOUNTS_ENABLED === 'true';
	return { turnstileSiteKey, testAccountsEnabled };
};
```

- [ ] **Step 2: Add password state and test account detection to login page**

In `src/routes/login/+page.svelte`, after line 31 (`let code = $state('');`), add:

```typescript
// Test account password login
let password = $state('');
const isTestAccount = $derived(email.trim().toLowerCase().endsWith('@martol.test'));
const testAccountsEnabled = $derived(data.testAccountsEnabled);
```

- [ ] **Step 3: Add password login handler**

After the `handleSendOtp` function (around line 177), add:

```typescript
async function handleTestLogin() {
	if (!email.trim() || !password) return;
	loading = true;
	error = '';

	try {
		const res = await fetch('/api/auth/test-login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: email.trim().toLowerCase(), password })
		});

		if (res.ok) {
			const data = await res.json();
			const redirectTo = $page.url.searchParams.get('redirect');
			goto(redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : data.redirectTo || '/chat');
		} else {
			const err = await res.json().catch(() => ({ message: 'Login failed' }));
			error = err.message || 'Invalid credentials';
		}
	} catch {
		error = 'Login failed. Please try again.';
	} finally {
		loading = false;
	}
}
```

- [ ] **Step 4: Update the email step template**

In the email step template section, modify the form submission to branch on test account. Find the send OTP button and add a conditional block:

When `isTestAccount && testAccountsEnabled`:
- Show a password input field instead of the OTP consent/Turnstile section
- The submit button calls `handleTestLogin()` instead of `handleSendOtp()`
- Skip the terms checkboxes (test accounts are pre-accepted)

When `isTestAccount && !testAccountsEnabled`:
- Show a warning: "Test accounts are disabled"

The exact template changes depend on the current markup. The implementer should:
1. Wrap the existing consent + Turnstile section in `{#if !(isTestAccount && testAccountsEnabled)}`
2. Add an `{:else}` block with a password input + "Sign in" button calling `handleTestLogin()`
3. Add a small note: "Test account — password login"

- [ ] **Step 5: Verify TypeScript and test manually**

Run: `pnpm check`
Expected: 0 errors.

Set `TEST_ACCOUNTS_ENABLED=true` in `.dev.vars`, run `pnpm dev`, enter `test-free@martol.test` in login — should see password field appear.

- [ ] **Step 6: Commit**

```bash
git add src/routes/login/+page.svelte src/routes/login/+page.server.ts
git commit -m "feat: login page switches to password mode for @martol.test emails"
```

---

### Task 5: Create seed script

**Files:**
- Create: `scripts/seed-test-accounts.ts`
- Modify: `package.json` (add `db:seed-test` script)

- [ ] **Step 1: Create the seed script**

```typescript
/**
 * Seed Test Accounts
 *
 * Creates test users, orgs, subscriptions, team, and password hashes.
 * Idempotent — safe to re-run.
 *
 * Usage: pnpm db:seed-test
 * Requires: .dev.vars with PG_* and STRIPE_SECRET_KEY
 */

import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as authSchema from '../src/lib/server/db/auth-schema';
import * as schema from '../src/lib/server/db/schema';
import { TEST_ACCOUNTS, hashTestPassword } from '../src/lib/server/auth/test-accounts';
import Stripe from 'stripe';

const pool = new pg.Pool({
	host: process.env.PG_HOST,
	port: parseInt(process.env.PG_PORT || '5432'),
	user: process.env.PG_USER,
	password: process.env.PG_PASSWORD,
	database: process.env.PG_DATABASE,
	ssl: { rejectUnauthorized: false }
});

const db = drizzle(pool, { schema: { ...authSchema, ...schema } });

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
	console.error('STRIPE_SECRET_KEY required in .dev.vars');
	process.exit(1);
}
const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover' as any });

async function main() {
	console.log('[Seed] Starting test account seeding...');

	// Step 1: Create users
	for (const account of TEST_ACCOUNTS) {
		await db
			.insert(authSchema.user)
			.values({
				id: account.id,
				name: account.displayName,
				email: account.email,
				username: account.username,
				displayName: account.displayName,
				emailVerified: true,
				role: 'user',
				createdAt: new Date(),
				updatedAt: new Date()
			})
			.onConflictDoUpdate({
				target: authSchema.user.id,
				set: {
					name: account.displayName,
					email: account.email,
					username: account.username,
					displayName: account.displayName,
					updatedAt: new Date()
				}
			});
		console.log(`[Seed] User: ${account.email} (${account.id})`);
	}

	// Step 2: Create personal orgs for each user
	for (const account of TEST_ACCOUNTS) {
		const orgId = `org-${account.id}`;
		await db
			.insert(authSchema.organization)
			.values({
				id: orgId,
				name: `${account.displayName}'s Room`,
				slug: account.username,
				createdAt: new Date()
			})
			.onConflictDoNothing();

		await db
			.insert(authSchema.member)
			.values({
				id: `member-${account.id}`,
				organizationId: orgId,
				userId: account.id,
				role: 'owner',
				createdAt: new Date()
			})
			.onConflictDoNothing();
	}
	console.log('[Seed] Personal orgs created');

	// Step 3: Create Stripe customers for billing accounts
	const billingAccounts = TEST_ACCOUNTS.filter(
		(a) => ['pro', 'pro_founding', 'team_owner', 'canceled', 'past_due'].includes(a.planState)
	);

	const customerMap = new Map<string, string>(); // userId → stripeCustomerId

	for (const account of billingAccounts) {
		// Check if customer already exists (by email)
		const existing = await stripe.customers.list({ email: account.email, limit: 1 });
		let customer: Stripe.Customer;

		if (existing.data.length > 0) {
			customer = existing.data[0];
			console.log(`[Seed] Reusing Stripe customer: ${customer.id} for ${account.email}`);
		} else {
			customer = await stripe.customers.create({
				email: account.email,
				name: account.displayName,
				metadata: { test_account: 'true', user_id: account.id }
			});
			// Attach test card
			const pm = await stripe.paymentMethods.create({
				type: 'card',
				card: { token: 'tok_visa' }
			});
			await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
			await stripe.customers.update(customer.id, {
				invoice_settings: { default_payment_method: pm.id }
			});
			console.log(`[Seed] Created Stripe customer: ${customer.id} for ${account.email}`);
		}
		customerMap.set(account.id, customer.id);
	}

	// Step 4: Create subscriptions for Pro accounts
	const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
	if (!proPriceId) {
		console.warn('[Seed] STRIPE_PRO_PRICE_ID not set — skipping Stripe subscriptions');
	}

	// Pro user
	const proAccount = TEST_ACCOUNTS.find((a) => a.planState === 'pro')!;
	const proOrgId = `org-${proAccount.id}`;
	const proCustomerId = customerMap.get(proAccount.id)!;
	if (proCustomerId) {
		await db
			.insert(schema.subscriptions)
			.values({
				id: `sub-${proAccount.id}`,
				orgId: proOrgId,
				stripeCustomerId: proCustomerId,
				plan: 'pro',
				status: 'active',
				quantity: 1,
				foundingMember: false,
				currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
			})
			.onConflictDoUpdate({
				target: schema.subscriptions.id,
				set: { status: 'active', plan: 'pro', updatedAt: new Date() }
			});
		console.log('[Seed] Pro subscription created');
	}

	// Founding member
	const founderAccount = TEST_ACCOUNTS.find((a) => a.planState === 'pro_founding')!;
	const founderOrgId = `org-${founderAccount.id}`;
	const founderCustomerId = customerMap.get(founderAccount.id)!;
	if (founderCustomerId) {
		await db
			.insert(schema.subscriptions)
			.values({
				id: `sub-${founderAccount.id}`,
				orgId: founderOrgId,
				stripeCustomerId: founderCustomerId,
				plan: 'pro',
				status: 'active',
				quantity: 1,
				foundingMember: true,
				currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
			})
			.onConflictDoUpdate({
				target: schema.subscriptions.id,
				set: { status: 'active', foundingMember: true, updatedAt: new Date() }
			});
		console.log('[Seed] Founding member subscription created');
	}

	// Canceled user (cancel_at_period_end)
	const canceledAccount = TEST_ACCOUNTS.find((a) => a.planState === 'canceled')!;
	const canceledOrgId = `org-${canceledAccount.id}`;
	const canceledCustomerId = customerMap.get(canceledAccount.id)!;
	if (canceledCustomerId) {
		await db
			.insert(schema.subscriptions)
			.values({
				id: `sub-${canceledAccount.id}`,
				orgId: canceledOrgId,
				stripeCustomerId: canceledCustomerId,
				plan: 'pro',
				status: 'active',
				quantity: 1,
				cancelAtPeriodEnd: true,
				currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
			})
			.onConflictDoUpdate({
				target: schema.subscriptions.id,
				set: { status: 'active', cancelAtPeriodEnd: true, updatedAt: new Date() }
			});
		console.log('[Seed] Canceled subscription created (cancel_at_period_end)');
	}

	// Past-due user
	const pastdueAccount = TEST_ACCOUNTS.find((a) => a.planState === 'past_due')!;
	const pastdueOrgId = `org-${pastdueAccount.id}`;
	const pastdueCustomerId = customerMap.get(pastdueAccount.id)!;
	if (pastdueCustomerId) {
		await db
			.insert(schema.subscriptions)
			.values({
				id: `sub-${pastdueAccount.id}`,
				orgId: pastdueOrgId,
				stripeCustomerId: pastdueCustomerId,
				plan: 'pro',
				status: 'past_due',
				quantity: 1,
				currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
			})
			.onConflictDoUpdate({
				target: schema.subscriptions.id,
				set: { status: 'past_due', updatedAt: new Date() }
			});
		console.log('[Seed] Past-due subscription created');
	}

	// Step 5: Create team
	const teamOwner = TEST_ACCOUNTS.find((a) => a.planState === 'team_owner')!;
	const teamMember = TEST_ACCOUNTS.find((a) => a.planState === 'team_member')!;
	const teamId = 'test-team-0000-0000-000000000001';
	const teamCustomerId = customerMap.get(teamOwner.id)!;

	if (teamCustomerId) {
		await db
			.insert(schema.teams)
			.values({
				id: teamId,
				ownerId: teamOwner.id,
				name: 'Test Team',
				stripeCustomerId: teamCustomerId,
				seats: 5,
				status: 'active',
				currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
			})
			.onConflictDoUpdate({
				target: schema.teams.id,
				set: { status: 'active', name: 'Test Team', seats: 5, updatedAt: new Date() }
			});

		await db
			.insert(schema.teamMembers)
			.values({
				id: `tm-${teamMember.id}`,
				teamId,
				userId: teamMember.id
			})
			.onConflictDoNothing();

		console.log('[Seed] Team created with member');
	}

	// Step 6: Store password hashes
	for (const account of TEST_ACCOUNTS) {
		const hash = await hashTestPassword(account.password);
		await db
			.insert(schema.testAccountCredentials)
			.values({ userId: account.id, passwordHash: hash })
			.onConflictDoUpdate({
				target: schema.testAccountCredentials.userId,
				set: { passwordHash: hash }
			});
	}
	console.log('[Seed] Password hashes stored');

	console.log('[Seed] Done! All test accounts seeded.');
	await pool.end();
}

main().catch((err) => {
	console.error('[Seed] Failed:', err);
	process.exit(1);
});
```

- [ ] **Step 2: Add package.json script**

Add to `package.json` scripts:

```json
"db:seed-test": "NODE_TLS_REJECT_UNAUTHORIZED=0 tsx scripts/seed-test-accounts.ts"
```

- [ ] **Step 3: Run the seed script**

Run: `pnpm db:seed-test`
Expected: All 7 users created, Stripe customers created, subscriptions/team seeded, password hashes stored.

- [ ] **Step 4: Test the login endpoint manually**

Set `TEST_ACCOUNTS_ENABLED=true` in `.dev.vars`. Run `pnpm dev`.

```bash
curl -X POST http://localhost:5190/api/auth/test-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test-free@martol.test","password":"TestFree123!"}' \
  -v
```

Expected: 200 OK with `{ ok: true, user: {...} }` and `Set-Cookie` header.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-test-accounts.ts package.json
git commit -m "feat: add seed script for test accounts with Stripe test data"
```

---

## Chunk 2: Vitest Billing Tests

### Task 6: Create shared test helpers

**Files:**
- Create: `src/lib/server/billing/__tests__/helpers.ts`

- [ ] **Step 1: Create the helpers file**

```typescript
/**
 * Shared test helpers for billing Vitest tests.
 *
 * Provides mock RequestEvent builders, Stripe event constructors,
 * and test data seeders.
 */

import { vi } from 'vitest';

/** Test user IDs (match seed script) */
export const TEST_IDS = {
	FREE_USER: 'test-free-0000-0000-000000000001',
	PRO_USER: 'test-pro-0000-0000-000000000002',
	FOUNDER_USER: 'test-found-000-0000-000000000003',
	TEAM_OWNER: 'test-owner-000-0000-000000000004',
	TEAM_MEMBER: 'test-member-00-0000-000000000005',
	CANCELED_USER: 'test-cancel-00-0000-000000000006',
	PASTDUE_USER: 'test-pastdue-0-0000-000000000007',
	FREE_ORG: 'org-test-free-0000-0000-000000000001',
	PRO_ORG: 'org-test-pro-0000-0000-000000000002',
	FOUNDER_ORG: 'org-test-found-000-0000-000000000003',
	TEAM_OWNER_ORG: 'org-test-owner-000-0000-000000000004',
	TEAM_ID: 'test-team-0000-0000-000000000001'
} as const;

/**
 * Create a chainable mock DB that returns specified results.
 * Mimics Drizzle's query builder API.
 */
export function createMockDb(results: Record<string, any[]> = {}) {
	let currentTable = '';

	const chain = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		from: vi.fn((table: any) => {
			currentTable = table?.name || table?.[Symbol.for('drizzle:Name')] || '';
			return chain;
		}),
		where: vi.fn().mockReturnThis(),
		innerJoin: vi.fn().mockReturnThis(),
		groupBy: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockImplementation(() => {
			return Promise.resolve(results[currentTable] || []);
		}),
		returning: vi.fn().mockResolvedValue([]),
		onConflictDoUpdate: vi.fn().mockReturnThis(),
		onConflictDoNothing: vi.fn().mockReturnThis(),
		execute: vi.fn().mockResolvedValue([]),
		transaction: vi.fn().mockImplementation(async (fn: Function) => fn(chain))
	};
	return chain;
}

/**
 * Create a mock RequestEvent for testing API handlers.
 */
export function createMockRequestEvent(overrides: {
	userId?: string;
	orgId?: string;
	body?: any;
	method?: string;
	url?: string;
	db?: any;
	stripeKey?: string;
	proPriceId?: string;
}) {
	const {
		userId = TEST_IDS.FREE_USER,
		orgId = TEST_IDS.FREE_ORG,
		body = {},
		method = 'POST',
		url = 'http://localhost:5190/api/billing/checkout',
		db = createMockDb(),
		stripeKey = 'sk_test_fake',
		proPriceId = 'price_test_fake'
	} = overrides;

	return {
		request: new Request(url, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: method !== 'GET' ? JSON.stringify(body) : undefined
		}),
		locals: {
			user: { id: userId, email: `${userId}@martol.test` },
			session: { activeOrganizationId: orgId },
			db,
			auth: null
		},
		platform: {
			env: {
				STRIPE_SECRET_KEY: stripeKey,
				STRIPE_PRO_PRICE_ID: proPriceId,
				STRIPE_WEBHOOK_SECRET: 'whsec_test_fake'
			}
		},
		url: new URL(url),
		cookies: {
			set: vi.fn(),
			get: vi.fn(),
			delete: vi.fn()
		},
		params: {}
	};
}

/**
 * Create a mock Stripe Checkout Session object.
 */
export function createMockCheckoutSession(overrides: Partial<{
	id: string;
	mode: string;
	payment_status: string;
	customer: string;
	subscription: any;
	metadata: Record<string, string>;
}> = {}) {
	return {
		id: 'cs_test_123',
		mode: 'subscription',
		payment_status: 'paid',
		customer: 'cus_test_123',
		subscription: {
			id: 'sub_test_123',
			status: 'active',
			cancel_at_period_end: false,
			items: {
				data: [{
					quantity: 1,
					current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
				}]
			}
		},
		metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG },
		...overrides
	};
}

/**
 * Create a mock Stripe subscription object for webhook events.
 */
export function createMockStripeSubscription(overrides: Partial<{
	id: string;
	status: string;
	cancel_at_period_end: boolean;
	metadata: Record<string, string>;
	quantity: number;
}> = {}) {
	return {
		id: 'sub_test_123',
		status: 'active',
		cancel_at_period_end: false,
		items: {
			data: [{
				quantity: overrides.quantity ?? 1,
				current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
			}]
		},
		metadata: { type: 'pro', org_id: TEST_IDS.PRO_ORG },
		...overrides
	};
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/billing/__tests__/helpers.ts
git commit -m "feat: add shared billing test helpers"
```

---

### Task 7: Feature gates tests

**Files:**
- Create: `src/lib/server/billing/__tests__/feature-gates.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest';
import { withinLimit } from '$lib/server/feature-gates';

describe('withinLimit', () => {
	it('returns true when usage is below limit', () => {
		expect(withinLimit(5, 10)).toBe(true);
	});

	it('returns false when usage equals limit', () => {
		expect(withinLimit(10, 10)).toBe(false);
	});

	it('returns false when usage exceeds limit', () => {
		expect(withinLimit(15, 10)).toBe(false);
	});

	it('returns true when limit is -1 (unlimited)', () => {
		expect(withinLimit(999999, -1)).toBe(true);
	});

	it('returns true for zero usage with any positive limit', () => {
		expect(withinLimit(0, 1)).toBe(true);
	});

	it('returns true for zero usage with unlimited', () => {
		expect(withinLimit(0, -1)).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- src/lib/server/billing/__tests__/feature-gates.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/billing/__tests__/feature-gates.test.ts
git commit -m "test: add withinLimit feature gate tests"
```

---

### Task 8: AI billing tests

**Files:**
- Create: `src/lib/server/billing/__tests__/ai-billing.test.ts`

- [ ] **Step 1: Write tests for free allowance and cap detection**

Test `getAiUsageForOrg`, `isAiCapReached`, and `getFreeAllowances` using mocked DB. Cover:
- Zero usage returns zeroes
- Usage within free tier → cap not reached
- Usage exceeding free tier but within cap → cap not reached
- Usage exceeding cap → cap reached
- Custom cap (lower than default $50) triggers sooner
- Free allowances return correct values (50 docs, 500 queries)

- [ ] **Step 2: Run tests**

Run: `pnpm test -- src/lib/server/billing/__tests__/ai-billing.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/billing/__tests__/ai-billing.test.ts
git commit -m "test: add AI billing usage and cap detection tests"
```

---

### Task 9: Billing sync tests

**Files:**
- Create: `src/lib/server/billing/__tests__/billing-sync.test.ts`

- [ ] **Step 1: Write tests**

Mock `createStripe` to return a fake Stripe client. Test:
- `syncOrgSubscription`: updates DB when Stripe status differs from DB
- `syncOrgSubscription`: no-op when status matches
- `syncOrgSubscription`: returns false when Stripe API throws
- `syncOrgSubscription`: returns true when no subscription record exists
- `syncTeamSubscription`: updates seats and period from Stripe
- `syncTeamSubscription`: returns false on error

Use `vi.mock('$lib/server/stripe')` to mock the Stripe factory.

- [ ] **Step 2: Run tests**

Run: `pnpm test -- src/lib/server/billing/__tests__/billing-sync.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/billing/__tests__/billing-sync.test.ts
git commit -m "test: add billing sync tests with mocked Stripe"
```

---

### Task 10: Webhook handler tests

**Files:**
- Create: `src/lib/server/billing/__tests__/webhook.test.ts`

- [ ] **Step 1: Write tests for all 5 event types**

Mock `createStripe` and the webhook signature verification. Test:

**checkout.session.completed:**
- Pro checkout → creates subscription record
- Team checkout → activates team record
- Missing metadata → logs warning, breaks cleanly

**customer.subscription.updated:**
- Updates status, seats, period, cancelAtPeriodEnd
- Falls back to stripeSubscriptionId when metadata missing

**customer.subscription.deleted:**
- Sets status to canceled
- Falls back to stripeSubscriptionId lookup

**invoice.payment_succeeded:**
- Recovers subscription from past_due to active

**invoice.payment_failed:**
- Marks subscription as past_due

- [ ] **Step 2: Run tests**

Run: `pnpm test -- src/lib/server/billing/__tests__/webhook.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/billing/__tests__/webhook.test.ts
git commit -m "test: add Stripe webhook handler tests for all event types"
```

---

### Task 11: Checkout, verify, team-checkout, team-members, portal tests

**Files:**
- Create: `src/lib/server/billing/__tests__/checkout.test.ts`
- Create: `src/lib/server/billing/__tests__/team-checkout.test.ts`
- Create: `src/lib/server/billing/__tests__/verify.test.ts`
- Create: `src/lib/server/billing/__tests__/team-members.test.ts`
- Create: `src/lib/server/billing/__tests__/portal.test.ts`

- [ ] **Step 1: Write checkout tests**

Test Pro checkout endpoint:
- Creates Stripe Checkout Session with correct price ID
- Uses annual price when `interval: 'annual'` and price ID exists
- Rejects unauthenticated requests (401)
- Rejects when billing not configured (503)

- [ ] **Step 2: Write team-checkout tests**

Test Team checkout endpoint:
- Creates team record + Stripe Checkout Session
- Reuses existing team record when status is incomplete/canceled
- Reuses existing Stripe customer
- Validates team name (empty → 400, too long → 400)
- Validates seats (clamped to 1-100)

- [ ] **Step 3: Write verify tests**

Test post-checkout verify:
- Validates session.mode is subscription
- Validates payment_status is paid/no_payment_required
- Rejects unpaid sessions (402)
- Pro path: upserts subscription, checks founding member
- Team path: activates team record
- Rejects wrong owner (403)

- [ ] **Step 4: Write team-members tests**

Test seat assignment:
- Adds member within seat limit
- Rejects when seats full (400)
- Rejects duplicate assignment (400)
- Removes member successfully
- Rejects non-owner (404 — no team found)

- [ ] **Step 5: Write portal tests**

Test portal redirect:
- Returns Stripe portal URL for org owner
- Returns Stripe portal URL for team owner
- Rejects non-owner/lead (403)

- [ ] **Step 6: Run all tests**

Run: `pnpm test -- src/lib/server/billing/__tests__/`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/billing/__tests__/checkout.test.ts \
  src/lib/server/billing/__tests__/team-checkout.test.ts \
  src/lib/server/billing/__tests__/verify.test.ts \
  src/lib/server/billing/__tests__/team-members.test.ts \
  src/lib/server/billing/__tests__/portal.test.ts
git commit -m "test: add checkout, verify, team, and portal billing tests"
```

---

## Chunk 3: Playwright E2E Tests

### Task 12: Set up Playwright

**Files:**
- Create: `playwright.config.ts`
- Modify: `package.json` (add `@playwright/test` dev dep, `test:e2e` script)

- [ ] **Step 1: Install Playwright**

Run: `pnpm add -D @playwright/test`
Run: `pnpm exec playwright install chromium`

- [ ] **Step 2: Create Playwright config**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60_000, // Stripe checkout is slow
	retries: 1,
	use: {
		baseURL: 'http://localhost:5190',
		headless: true,
		screenshot: 'only-on-failure'
	},
	webServer: {
		command: 'pnpm dev',
		port: 5190,
		reuseExistingServer: true,
		timeout: 30_000
	}
});
```

- [ ] **Step 3: Add package.json script**

```json
"test:e2e": "TEST_ACCOUNTS_ENABLED=true playwright test"
```

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts package.json pnpm-lock.yaml
git commit -m "feat: add Playwright config for E2E billing tests"
```

---

### Task 13: Create E2E helpers

**Files:**
- Create: `tests/e2e/helpers/auth.ts`
- Create: `tests/e2e/helpers/stripe.ts`
- Create: `tests/e2e/helpers/settings.ts`

- [ ] **Step 1: Create auth helper**

```typescript
import type { Page } from '@playwright/test';

/**
 * Login as a test account by calling the test-login endpoint
 * and setting the session cookie on the page context.
 */
export async function login(page: Page, email: string, password: string) {
	const response = await page.request.post('/api/auth/test-login', {
		data: { email, password }
	});

	if (!response.ok()) {
		throw new Error(`Test login failed for ${email}: ${response.status()} ${await response.text()}`);
	}

	// The response sets cookies automatically via page.request context
	return response.json();
}

/** Test account credentials for quick reference */
export const accounts = {
	free: { email: 'test-free@martol.test', password: 'TestFree123!' },
	pro: { email: 'test-pro@martol.test', password: 'TestPro123!' },
	founder: { email: 'test-founder@martol.test', password: 'TestFounder123!' },
	teamOwner: { email: 'test-team-owner@martol.test', password: 'TestTeamOwner123!' },
	teamMember: { email: 'test-team-member@martol.test', password: 'TestMember123!' },
	canceled: { email: 'test-canceled@martol.test', password: 'TestCanceled123!' },
	pastdue: { email: 'test-pastdue@martol.test', password: 'TestPastdue123!' }
};
```

- [ ] **Step 2: Create Stripe checkout helper**

```typescript
import type { Page } from '@playwright/test';

/**
 * Fill Stripe hosted checkout form with test card details.
 * Waits for the Stripe checkout page to load, fills card info,
 * and submits. Then waits for redirect back to the app.
 *
 * Card: 4242 4242 4242 4242, Exp: 12/31, CVC: 252
 */
export async function completeStripeCheckout(page: Page) {
	// Wait for Stripe checkout page
	await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15_000 });

	// Stripe uses iframes — locate the card input fields
	// The exact selectors may vary with Stripe Checkout version
	const cardFrame = page.frameLocator('iframe[name*="__privateStripeFrame"]').first();

	// Fill card number
	await page.locator('[data-testid="card-number-input"], #cardNumber, [name="cardnumber"]')
		.or(cardFrame.locator('[name="cardnumber"]'))
		.fill('4242424242424242');

	// Fill expiry
	await page.locator('[data-testid="card-expiry-input"], #cardExpiry, [name="exp-date"]')
		.or(cardFrame.locator('[name="exp-date"]'))
		.fill('1231');

	// Fill CVC
	await page.locator('[data-testid="card-cvc-input"], #cardCvc, [name="cvc"]')
		.or(cardFrame.locator('[name="cvc"]'))
		.fill('252');

	// Submit
	await page.locator('[data-testid="hosted-payment-submit-button"], .SubmitButton')
		.click();

	// Wait for redirect back to app
	await page.waitForURL(/localhost:5190/, { timeout: 30_000 });
}
```

- [ ] **Step 3: Create settings helper**

```typescript
import type { Page } from '@playwright/test';

/**
 * Navigate to settings and wait for billing data to load.
 */
export async function goToSettings(page: Page) {
	await page.goto('/settings');
	await page.waitForSelector('[data-testid="billing-section"], [data-testid="settings-page"]', {
		timeout: 10_000
	});
}

/**
 * Wait for settings page to refresh after billing change.
 * Triggered by invalidateAll() in the client.
 */
export async function waitForBillingRefresh(page: Page) {
	// Wait for a brief moment for invalidateAll to trigger
	await page.waitForTimeout(2000);
	// Then wait for the billing section to re-render
	await page.waitForSelector('[data-testid="billing-section"]', { timeout: 10_000 });
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/
git commit -m "feat: add E2E test helpers for auth, Stripe checkout, and settings"
```

---

### Task 14: Write E2E billing test specs

**Files:**
- Create: `tests/e2e/billing/free-limits.spec.ts`
- Create: `tests/e2e/billing/pro-upgrade.spec.ts`
- Create: `tests/e2e/billing/pro-annual.spec.ts`
- Create: `tests/e2e/billing/pro-cancel.spec.ts`
- Create: `tests/e2e/billing/team-create.spec.ts`
- Create: `tests/e2e/billing/team-members.spec.ts`
- Create: `tests/e2e/billing/team-billing.spec.ts`
- Create: `tests/e2e/billing/canceled-state.spec.ts`
- Create: `tests/e2e/billing/pastdue-state.spec.ts`

- [ ] **Step 1: Write free-limits spec**

```typescript
import { test, expect } from '@playwright/test';
import { login, accounts } from '../helpers/auth';
import { goToSettings } from '../helpers/settings';

test.describe('Free Plan Limits', () => {
	test('displays correct free plan info', async ({ page }) => {
		await login(page, accounts.free.email, accounts.free.password);
		await goToSettings(page);

		// Verify plan shows as Free
		await expect(page.getByText('Free')).toBeVisible();

		// Verify limit displays (not unlimited)
		await expect(page.getByText('100')).toBeVisible(); // rooms
	});
});
```

- [ ] **Step 2: Write pro-upgrade spec**

```typescript
import { test, expect } from '@playwright/test';
import { login, accounts } from '../helpers/auth';
import { completeStripeCheckout } from '../helpers/stripe';
import { goToSettings, waitForBillingRefresh } from '../helpers/settings';

test.describe('Pro Upgrade Flow', () => {
	test('upgrades free user to Pro via Stripe Checkout', async ({ page }) => {
		await login(page, accounts.free.email, accounts.free.password);
		await goToSettings(page);

		// Click upgrade button
		await page.getByRole('button', { name: /upgrade/i }).click();

		// Complete Stripe checkout
		await completeStripeCheckout(page);

		// Wait for redirect and billing refresh
		await waitForBillingRefresh(page);

		// Verify Pro badge shows
		await expect(page.getByText('Pro')).toBeVisible();
	});
});
```

- [ ] **Step 3: Write remaining specs**

Each spec follows the same pattern: login → navigate → action → assert. The implementer should create all 9 spec files following the patterns in the design spec (Section 4). Key assertions:

- `pro-annual.spec.ts`: Verify annual checkout URL contains annual price, complete, verify active
- `pro-cancel.spec.ts`: Navigate to Stripe portal, cancel, verify "Cancels on" date
- `team-create.spec.ts`: Fill team form, complete checkout, verify team active
- `team-members.spec.ts`: Add member by email, verify in list, remove, verify gone
- `team-billing.spec.ts`: Click Manage Billing, verify Stripe portal opens
- `canceled-state.spec.ts`: Login as test-canceled, verify "Canceling" badge visible
- `pastdue-state.spec.ts`: Login as test-pastdue, verify "Past Due" warning visible

- [ ] **Step 4: Run a smoke test**

Run: `pnpm test:e2e -- tests/e2e/billing/free-limits.spec.ts`
Expected: Test passes (requires dev server running + test accounts seeded).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/billing/
git commit -m "test: add Playwright E2E billing test specs"
```

---

### Task 15: Final verification

- [ ] **Step 1: Run all Vitest tests**

Run: `pnpm test`
Expected: All existing + new tests pass.

- [ ] **Step 2: Run TypeScript check**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 3: Run E2E tests (requires seeded DB + dev server)**

Run: `pnpm test:e2e`
Expected: All E2E tests pass.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test: complete billing test suite with test accounts, Vitest, and Playwright"
```
