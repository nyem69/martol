# Stripe Configuration — Martol

**Date:** 2026-03-17
**Purpose:** Document all Stripe objects so they can be recreated in a new account if needed.

## Account

- **Account ID:** `DYxjkmKVhX` (suffix from price IDs)
- **Currency:** USD
- **Mode:** Live (no test prefix on IDs)

## Products

### Pro Plan

| Field | Value |
|---|---|
| **Product ID** | `prod_U7XMwqLGNDV4mj` |
| **Name** | Pro |
| **Type** | service |
| **Description** | Per-seat Pro plan for Martol workspace |

## Prices

All prices are attached to the **Pro** product (`prod_U7XMwqLGNDV4mj`).

### Monthly — Per-seat ($10/user/month)

| Field | Value |
|---|---|
| **Price ID** | `price_1T9IHODYxjkmKVhXk1qnh7JH` |
| **Amount** | $10.00 (1000 cents) |
| **Currency** | USD |
| **Type** | recurring |
| **Interval** | month (1) |
| **Usage type** | licensed (per-seat) |
| **Trial** | none |

### Yearly — Per-seat ($96/user/year)

| Field | Value |
|---|---|
| **Price ID** | `price_1T9IHNDYxjkmKVhXRgAkdSXG` |
| **Amount** | $96.00 (9600 cents) = $8/user/month effective |
| **Currency** | USD |
| **Type** | recurring |
| **Interval** | year (1) |
| **Usage type** | licensed (per-seat) |
| **Trial** | none |

### Monthly — Metered (amount=null)

| Field | Value |
|---|---|
| **Price ID** | `price_1T9IPNDYxjkmKVhXJpbIiPeM` |
| **Amount** | null (metered/tiered) |
| **Currency** | USD |
| **Type** | recurring |
| **Interval** | month (1) |
| **Usage type** | licensed |
| **Trial** | none |
| **Notes** | Likely unused or draft — amount is null |

## Coupons

None configured.

## Subscriptions

None active (as of 2026-03-17).

## Recreation Script

To recreate these objects in a new Stripe account:

```bash
# Create product
stripe products create \
  --name="Pro" \
  --type=service \
  --description="Per-seat Pro plan for Martol workspace"

# Create monthly price ($10/user/month)
stripe prices create \
  --product=prod_REPLACE \
  --unit-amount=1000 \
  --currency=usd \
  --recurring[interval]=month \
  --recurring[usage_type]=licensed

# Create yearly price ($96/user/year — 20% discount)
stripe prices create \
  --product=prod_REPLACE \
  --unit-amount=9600 \
  --currency=usd \
  --recurring[interval]=year \
  --recurring[usage_type]=licensed
```

After creation, update these references in the codebase:
- `src/lib/server/billing.ts` — price IDs
- `.dev.vars` — `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY`
- `wrangler.toml` — any Stripe-related env bindings

## Billing Model Reference

See `MEMORY.md` → Billing Model section:
- Subscription is **per user**, not per room
- Room limits inherit from the **creator's plan**
- Free: up to 100 rooms; Pro: unlimited
- AI agents are never billed
