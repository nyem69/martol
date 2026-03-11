# Test Accounts & Billing Test Suite

**Date:** 2026-03-11
**Status:** Approved

## Overview

Create special test accounts that bypass email OTP for automated testing, plus a comprehensive two-layer test suite (Vitest + Playwright) covering all billing/subscription flows. Revenue-critical — must be thorough before launch.

---

## 1. Test Accounts

7 test accounts with `@martol.test` domain (non-routable):

| Email | Password | Plan State | Purpose |
|---|---|---|---|
| `test-free@martol.test` | `TestFree123!` | Free | Baseline free user |
| `test-pro@martol.test` | `TestPro123!` | Pro (active) | Active Pro subscriber |
| `test-founder@martol.test` | `TestFounder123!` | Pro (founding member) | Founding member badge + Pro |
| `test-team-owner@martol.test` | `TestTeamOwner123!` | Team owner (active) | Owns team with seats |
| `test-team-member@martol.test` | `TestMember123!` | Team member (Pro via team) | Assigned Pro via team seat |
| `test-canceled@martol.test` | `TestCanceled123!` | Pro (cancel_at_period_end) | Canceled but active until period end |
| `test-pastdue@martol.test` | `TestPastdue123!` | Pro (past_due) | Payment failed, grace period |

Deterministic UUIDs:
```
test-free-0000-0000-000000000001
test-pro-0000-0000-000000000002
test-found-000-0000-000000000003
test-owner-000-0000-000000000004
test-member-00-0000-000000000005
test-cancel-00-0000-000000000006
test-pastdue-0-0000-000000000007
```

Shared org: "Test Room" — owned by test-team-owner, test-team-member assigned.

---

## 2. Test Login Endpoint

**`POST /api/auth/test-login`**

```
Request:  { email: string, password: string }
Response: { ok: true, user: { id, email, username }, redirectTo: '/chat' }
          + Set-Cookie: martol.session_token=...
```

**Security:**
- Returns `error(404, 'Not found')` when `TEST_ACCOUNTS_ENABLED` env var is unset/false
- Validates against hardcoded map of test emails → scrypt password hashes
- `@martol.test` domain only — rejects any other domain
- Rate limited: 10 attempts/minute per IP
- Logs: `[TestAuth] Login: <email>`

**Session creation:** Uses Better Auth internal API to create session for existing user (must be seeded first).

**Login page integration:** Detects `@martol.test` emails, switches to password input. Checks `GET /api/auth/test-accounts-enabled` to know if feature is on.

---

## 3. Database

New table `test_account_credentials`:
```
userId TEXT PK (FK → user, cascade delete)
passwordHash TEXT NOT NULL
```

Only read by test-login endpoint. Populated by seed script.

---

## 4. Seed Script

**`scripts/seed-test-accounts.ts`** — run via `pnpm db:seed-test`

Steps:
1. Create 7 test users in `user` table with deterministic UUIDs
2. Create personal orgs for each (Better Auth requirement) + shared "Test Room" org
3. Create Stripe test customers, attach payment method `pm_card_visa` (4242 4242 4242 4242, exp 12/31, CVC 252)
4. Create subscription records:
   - test-pro: active Pro
   - test-founder: active Pro, `foundingMember: true`
   - test-canceled: active Pro, `cancelAtPeriodEnd: true`, period end 30 days out
   - test-pastdue: Pro, `status: 'past_due'`
5. Create "Test Team" (5 seats, active) owned by test-team-owner, assign test-team-member
6. Store scrypt password hashes in `test_account_credentials`

Idempotent — uses upserts throughout. Safe to re-run.

---

## 5. Vitest Integration Tests

**Location:** `src/lib/server/billing/__tests__/`

| File | Coverage |
|---|---|
| `checkout.test.ts` | Pro checkout creation (monthly/annual), founding member detection, duplicate active rejection, metadata correctness |
| `team-checkout.test.ts` | Team checkout creation, customer reuse, seat validation (1-100), team record reuse for incomplete |
| `verify.test.ts` | Post-checkout verify for Pro + Team, payment_status validation, session.mode validation, ownership check, idempotent upsert |
| `webhook.test.ts` | All 5 events: checkout.session.completed (Pro + Team), subscription.updated, subscription.deleted, invoice.payment_succeeded, invoice.payment_failed. Metadata fallback to stripeSubscriptionId |
| `feature-gates.test.ts` | Free vs Pro limits, unlimited (-1) via withinLimit(), team Pro inheritance, storage/upload/room/message gates |
| `billing-sync.test.ts` | Org sync updates diverged status, team sync updates seats/period, returns false on API failure, no-op when unchanged |
| `ai-billing.test.ts` | Free allowance calculation, overage cap detection, Stripe meter reporting, skip orgs within free tier |
| `team-members.test.ts` | Transaction-protected seat assignment, race condition, duplicate rejection, removal, seat limit |
| `portal.test.ts` | Org portal (owner/lead only), team portal uses team's stripeCustomerId |

**Test helpers** (`src/lib/server/billing/__tests__/helpers.ts`):
- `createMockRequestEvent()` — RequestEvent with test user session, db, platform env
- `createTestStripeEvent()` — signed Stripe webhook events
- `seedTestSubscription()` / `seedTestTeam()` — insert deterministic test data
- Stripe test key from `TEST_STRIPE_SECRET_KEY` env var

---

## 6. Playwright E2E Tests

**Location:** `tests/e2e/billing/`

| File | Flow |
|---|---|
| `pro-upgrade.spec.ts` | Login as test-free → Settings → Upgrade to Pro → Stripe Checkout (4242, 12/31, 252) → Verify Pro badge + unlimited limits |
| `pro-annual.spec.ts` | Login as test-free → Annual upgrade → Verify annual price → Complete → Verify active |
| `pro-cancel.spec.ts` | Login as test-pro → Manage Billing → Cancel in portal → Verify "Cancels on [date]" → Still active |
| `team-create.spec.ts` | Login as test-free → Team tab → Fill name + seats → Checkout → Verify team active |
| `team-members.spec.ts` | Login as test-team-owner → Add member by email → Verify listed → Remove → Verify removed |
| `team-billing.spec.ts` | Login as test-team-owner → Manage Billing → Verify team portal (not org) |
| `free-limits.spec.ts` | Login as test-free → Verify Free plan + correct limits display |
| `canceled-state.spec.ts` | Login as test-canceled → Verify "Canceling" badge → Pro features still work |
| `pastdue-state.spec.ts` | Login as test-pastdue → Verify "Past Due" warning |

**Helpers** (`tests/e2e/helpers/`):
- `login(page, email)` — POST test-login, set session cookie on page context
- `stripeCheckout(page, card)` — fill Stripe hosted form (4242, 12/31, 252), wait for redirect
- `waitForSettingsUpdate(page)` — wait for invalidateAll() + billing section re-render

**Config** (`playwright.config.ts`):
- Base URL: `http://localhost:5190`
- webServer: `pnpm dev`
- Timeout: 60s (Stripe checkout is slow)
- Retries: 1
- `TEST_ACCOUNTS_ENABLED=true`

---

## 7. Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `TEST_ACCOUNTS_ENABLED` | `.dev.vars` / wrangler secret | Enable test login endpoint + UI password mode |
| `TEST_STRIPE_SECRET_KEY` | `.dev.vars` | Stripe test key for seed script (may be same as STRIPE_SECRET_KEY in dev) |

**Production safety:** `TEST_ACCOUNTS_ENABLED` must never be set in production. The test-login endpoint returns 404 when absent.

---

## 8. File Summary

| File | New/Modified | Purpose |
|---|---|---|
| `src/routes/api/auth/test-login/+server.ts` | New | Test login endpoint |
| `src/routes/api/auth/test-accounts-enabled/+server.ts` | New | Check if test accounts enabled |
| `src/lib/server/auth/test-accounts.ts` | New | Test account config, password map, validation |
| `src/routes/login/+page.svelte` | Modified | Password mode for @martol.test emails |
| `src/lib/server/db/schema.ts` | Modified | Add test_account_credentials table |
| `scripts/seed-test-accounts.ts` | New | Seed script |
| `vitest.config.ts` | Modified | Add billing test paths if needed |
| `playwright.config.ts` | New | Playwright config |
| `src/lib/server/billing/__tests__/helpers.ts` | New | Shared test utilities |
| `src/lib/server/billing/__tests__/*.test.ts` | New (9 files) | Vitest billing tests |
| `tests/e2e/helpers/*.ts` | New | Playwright helpers |
| `tests/e2e/billing/*.spec.ts` | New (9 files) | Playwright billing E2E tests |
| `package.json` | Modified | Add `db:seed-test`, `test:e2e` scripts |
