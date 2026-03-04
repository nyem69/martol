# Image Upload/View + Stripe Subscription Design

**Date:** 2026-03-04
**Status:** Approved

## Summary

Add image upload/view in chat with a freemium model: 5 free uploads per user, then $5/month subscription to unlock unlimited images via Stripe.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Quota scope | Per user (global) | Simplest to enforce, fair across rooms |
| Pricing model | $5/month subscription | Recurring revenue; R2 costs negligible (~$0.15/month per 1000 images) |
| Image in messages | Body markers (`![alt](r2:key)`) | Zero schema migration on messages table; works with existing WAL/WS pipeline |
| Checkout | Stripe hosted Checkout | Avoids PCI scope; minimal custom UI |
| Billing management | Stripe Customer Portal | Zero custom cancellation/card UI |
| Display | Inline thumbnail + lightbox | Click thumbnail opens existing ImageModal |

## Architecture

### Image Upload Flow

```
User clicks image btn → file picker → client validates (type, size)
  → POST /api/upload → R2 storage
  → returns { key }
  → client inserts ![filename](r2:orgId/ts-file.png) into textarea
  → user adds optional text, sends message normally
```

### Image Display Flow

```
MessageBubble receives body with ![alt](r2:key) markers
  → regex extracts markers
  → renders <img> thumbnails (max 300px wide, lazy-loaded)
  → surrounding text renders normally
  → click thumbnail → ImageModal lightbox (GET /api/upload?key=...)
```

### Quota Enforcement

```
Upload attempt → GET /api/upload/quota → { used, limit, canUpload, plan }
  → if canUpload: proceed with file picker
  → if !canUpload: show UpgradeModal → Stripe Checkout
Server-side: POST /api/upload also checks quota (defense in depth)
```

### Stripe Payment Flow

```
UpgradeModal → "Subscribe $5/month" button
  → POST /api/checkout → Stripe Checkout Session URL
  → redirect to Stripe hosted page
  → user pays → Stripe webhook fires
  → POST /api/webhooks/stripe handles:
      checkout.session.completed → create subscription record
      invoice.payment_succeeded → update currentPeriodEnd
      customer.subscription.deleted → set status canceled
  → user returns via success_url → quota check passes
```

## Database Changes

### New table: `subscriptions`

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'image_upload')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due')),
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
```

### Existing table changes: `attachments`

Add `uploaded_by TEXT NOT NULL` column (for per-user quota counting).
Make `message_id` nullable (upload happens before message send).

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/upload` | POST | Upload image to R2 (existing, add quota check) |
| `/api/upload` | GET | Retrieve image from R2 (existing) |
| `/api/upload/quota` | GET | Return `{ used, limit, canUpload, plan }` |
| `/api/checkout` | POST | Create Stripe Checkout session |
| `/api/webhooks/stripe` | POST | Handle Stripe webhook events |
| `/api/billing/portal` | GET | Return Stripe Customer Portal URL |

## UI Components

### Modified

- **ChatInput.svelte** — Add image button (paperclip icon), drag-and-drop zone, upload progress
- **MessageBubble.svelte** — Parse `![alt](r2:key)` markers, render inline thumbnails

### New

- **UpgradeModal.svelte** — "5 free uploads used. Unlock unlimited for $5/month." Subscribe button → Stripe
- **UploadProgress.svelte** — Thin progress bar during upload

## Environment Variables

```
STRIPE_SECRET_KEY      # Stripe API secret key
STRIPE_WEBHOOK_SECRET  # Stripe webhook signing secret
STRIPE_PRICE_ID        # Price ID for image_upload plan
```

## Future Extensions

- Document upload unlock ($5/month additional): PDF, CSV, Excel
- Per-room storage limits
- Agent image upload via MCP tool
