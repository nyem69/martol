# Martol Global TODO

## KIV (Keep In View)

### Metered Storage Overage Billing
- **Priority**: Future (post-launch)
- **Description**: Bill users for storage usage beyond their plan limit using Stripe's Usage Records API with graduated tiers
- **Stripe Setup**: Already configured — graduated tiered price on Pro product (5 GB free, $2/GB for 6-20, $1.50/GB for 21-50, $1/GB for 51+)
- **Implementation needed**:
  - Cron job or scheduled worker to calculate per-org storage usage at end of billing cycle
  - Report GB count to Stripe via Usage Records API
  - Add metered subscription item alongside the flat-rate Pro subscription
  - Handle overage disputes and billing failures
- **Current state**: `storageBytesUsed` field exists on `subscriptions` table, storage tracking in place. Hard cap enforced via feature gates for now.
