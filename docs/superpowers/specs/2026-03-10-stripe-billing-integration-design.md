# Stripe Billing Integration — Design Spec

**Date**: 2026-03-10
**Status**: Approved (revised after spec review)

## Overview

Fix critical bugs in existing Stripe integration and extend with annual plan, Team subscription, and seat management. Metered storage overage billing is KIV (tracked in TODO.md).

## Billing Model Clarification

Two billing models coexist:

- **Pro (individual)**: Per-org/room billing. A room owner upgrades their room to Pro. All members of that room get Pro limits within it. The `subscriptions` table tracks this with `orgId`.
- **Team**: Per-user billing. A team owner pays for N seats and assigns Pro to specific users. Those users get Pro limits across ALL their rooms, regardless of each room's own subscription.

**Priority chain for feature gates**: Team Pro (user-level) > Room subscription (org-level) > Free default.

## 1. Webhook Handler Consolidation

Two webhook handlers exist:
- **Old**: `src/routes/api/webhooks/stripe/+server.ts` — has bugs (`plan: 'image_upload'`, reads `martolOrgId`)
- **New**: `src/routes/api/billing/webhook/+server.ts` — bugs already fixed, uses `constructEventAsync` (correct for Cloudflare Workers), has `mapStripeStatus()`, handles `invoice.payment_failed`

**Action**: Delete the old handler. Extend the new handler at `/api/billing/webhook/` with Team support. Update the Stripe Dashboard webhook endpoint URL if it points to the old path.

## 2. Annual Plan Support

### Env vars
- New: `STRIPE_PRO_ANNUAL_PRICE_ID`
- Existing: `STRIPE_PRO_PRICE_ID` (monthly)

### Schema change
- No `interval` column needed — derive from Stripe subscription data or price ID when displaying. Avoids sync burden.

### Checkout changes
- Accept `interval: 'monthly' | 'annual'` param
- Select price ID based on interval
- Set `subscription_data.metadata` (not just session metadata) so `subscription.updated` and `subscription.deleted` events carry `org_id`

### UI changes
- Settings: show billing interval (derived from `currentPeriodEnd` duration or Stripe API), offer monthly/annual choice on upgrade
- Pricing page: monthly/annual toggle

### Plan switching
- Handled via Stripe Customer Portal (no custom API)
- Requires portal config: enable subscription switching

## 3. Team Subscription

### New tables

```sql
teams
  id                      TEXT PRIMARY KEY (nanoid)
  owner_id                TEXT NOT NULL → user.id (ON DELETE RESTRICT)
  name                    TEXT NOT NULL
  stripe_customer_id      TEXT
  stripe_subscription_id  TEXT UNIQUE
  seats                   INTEGER NOT NULL DEFAULT 5
  status                  TEXT (active | past_due | canceled | incomplete)
  current_period_end      TIMESTAMP
  cancel_at_period_end    BOOLEAN DEFAULT false
  created_at              TIMESTAMP
  updated_at              TIMESTAMP

team_members
  id          TEXT PRIMARY KEY (nanoid)
  team_id     TEXT NOT NULL → teams.id (ON DELETE CASCADE)
  user_id     TEXT NOT NULL → user.id (ON DELETE CASCADE)
  assigned_at TIMESTAMP
  UNIQUE(team_id, user_id)
```

**Removed**: `teams.plan` column — teams always grant Pro. No need for a redundant column.

### Flow
1. Team owner creates team, picks seat count
2. Stripe Checkout with `quantity = seats`
3. Owner assigns Pro to users via team settings (search by email/username)
4. Assigned users get Pro across all their rooms
5. Seat changes via Stripe Customer Portal

### API routes
- `POST /api/billing/team/checkout` — create Team checkout session
- `GET /api/billing/team` — get team info + members (team owner only)
- `POST /api/billing/team/members` — assign user to seat (team owner only)
- `DELETE /api/billing/team/members` — remove user from seat (team owner only)

### Edge cases

**Team owner cancellation:**
- `cancel_at_period_end = true`: members keep Pro until period ends, then all lose Pro
- Immediate cancellation: all members lose Pro immediately
- Webhook sets `status: 'canceled'`, feature gate checks `status === 'active'`

**Seat reduction below member count:**
- Stripe Portal allows reducing quantity
- On `subscription.updated`, if `quantity < current member count`, do NOT auto-remove members
- Owner must manually remove members via team settings to match new seat count
- New assignments blocked until `member count <= seats`

**User in multiple teams:**
- Allowed — each team pays independently
- If one team cancels, user retains Pro from other team
- Feature gate: check if user is in ANY active team

**Team owner account deletion:**
- `ON DELETE RESTRICT` on `teams.owner_id` — must transfer ownership or delete team first

### Feature gate changes
- `checkOrgLimits()` accepts optional `userId` parameter
- New check: query `teamMembers` joined with `teams` where `teams.status = 'active'` and `teamMembers.userId = userId`
- Priority: team Pro (user-level) > room subscription (org-level) > free default

## 4. Webhook Handler Updates

### Metadata convention
Set on BOTH `session.metadata` and `subscription_data.metadata`:
```
Pro checkout:   { type: 'pro', org_id: '...' }
Team checkout:  { type: 'team', team_id: '...', owner_id: '...' }
```

Setting metadata on `subscription_data` ensures `subscription.updated` and `subscription.deleted` events carry routing info — avoids fragile dual-table lookups.

### Event handling
- `checkout.session.completed`: check `metadata.type` to route to `subscriptions` or `teams` table
- `customer.subscription.updated`: read `metadata.type` from subscription object to route
- `customer.subscription.deleted`: read `metadata.type`, set status to `canceled`
- `invoice.payment_failed`: fallback to dual lookup by `stripeSubscriptionId` (invoice events don't carry custom metadata)

### Idempotency
- All handlers use upsert pattern (check existing, update or insert)
- Duplicate `checkout.session.completed` with `type: 'team'` must not create duplicate team rows (lookup by `owner_id`)

## 5. Files Touched

| File | Change |
|---|---|
| `src/routes/api/webhooks/stripe/+server.ts` | **DELETE** — old handler with bugs |
| `src/routes/api/billing/webhook/+server.ts` | Extend with team handling, metadata routing |
| `src/routes/api/billing/checkout/+server.ts` | Add interval param, set subscription_data.metadata |
| `src/routes/api/billing/team/checkout/+server.ts` | New — team checkout |
| `src/routes/api/billing/team/+server.ts` | New — get team info + members |
| `src/routes/api/billing/team/members/+server.ts` | New — assign/remove seats |
| `src/lib/server/db/schema.ts` | Add `teams`, `teamMembers` tables |
| `src/lib/server/feature-gates.ts` | Add userId param, check team membership |
| `src/routes/settings/+page.svelte` | Show interval, annual option, team section |
| `src/routes/settings/+page.server.ts` | Load team data |
| `src/routes/docs/pricing/+page.svelte` | Monthly/annual toggle |

## 6. Env Vars

| Variable | Purpose |
|---|---|
| `STRIPE_PRO_PRICE_ID` | Monthly price (existing) |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Annual price (new) |
| `STRIPE_WEBHOOK_SECRET` | Webhook verification (existing) |

**Note**: No separate `STRIPE_TEAM_PRICE_ID` — Team uses the same Pro price ($10/user/mo). The distinction is in metadata (`type: 'team'`), not the price.

## 7. Stripe Dashboard Config

- Customer Portal: enable subscription switching (monthly ↔ annual)
- Customer Portal: enable quantity updates (for Team seats)
- Webhook endpoint: update URL to `/api/billing/webhook` if currently pointing to old `/api/webhooks/stripe`
- No new webhook events needed

## 8. KIV — Metered Storage Overage

Deferred to post-launch. Tracked in `TODO.md`. Stripe graduated tiers already configured. Current approach: hard cap via feature gates.
