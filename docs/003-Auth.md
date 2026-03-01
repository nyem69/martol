# 003 — Auth, Onboarding & Platform Safety

> Comprehensive design for user authentication, onboarding flow, identity management, content moderation, and regulatory compliance.
>
> Reviewed by four independent agents: privacy, security, legal, and devil's advocate.

---

## Table of Contents

1. [Design Decisions](#design-decisions)
2. [Onboarding Flow](#onboarding-flow)
3. [Identity & Username System](#identity--username-system)
4. [Two-Factor Authentication](#two-factor-authentication)
5. [Email Change & Account Recovery](#email-change--account-recovery)
6. [Age Verification](#age-verification)
7. [Content Moderation & Abuse Prevention](#content-moderation--abuse-prevention)
8. [Legal & Regulatory Compliance](#legal--regulatory-compliance)
9. [Database Schema Additions](#database-schema-additions)
10. [Better Auth Plugin Configuration](#better-auth-plugin-configuration)
11. [Security Hardening](#security-hardening)
12. [Pre-Launch Checklist](#pre-launch-checklist)

---

## Design Decisions

Key decisions made during the design process and review:

| Decision | Rationale |
|---|---|
| **Do not store DOB** | Bcrypt-hashed DOB has only ~36K possible values — brute-forced in seconds. Store only `age_verified_at` timestamp after verification. |
| **Globally unique username, auto-generated at signup** | Prevents impersonation, enables @mentions. Auto-generated at signup (e.g. `user-3f82d`) to reduce friction; users personalize later via inline prompt or settings. |
| **Passkey-preferred 2FA** | Zero cost (WebAuthn is browser-native). TOTP as fallback. Mandatory for room owners at room creation. |
| **72-hour email undo** (not 14-day) | Shorter window reduces ambiguous account state. New email is primary immediately. |
| **Better Auth plugins + Cloudflare native** | Minimize custom auth code (highest security risk). Use battle-tested plugins for auth, Cloudflare services for moderation. |
| **Honest moderation layers** | Launch with what's real (WAF, validation, user reporting), not aspirational (6 layers). Add automated scanning before enabling image uploads. |
| **Minimum age 16** | Matches strictest EU member states. Avoids COPPA parental consent complexity. Enforced as technical minimum; legal docs use jurisdiction-aware language. |
| **Age gate before email collection** | DOB entry happens before email, so no personal data is processed for underage users. |
| **Image uploads feature-flagged** | Upload endpoint disabled until NCMEC registration + image scanning pipeline are operational. |
| **Agent users via direct DB insert** | Do not use `signUpEmail` (requires `emailAndPassword: enabled` which creates a hidden auth bypass). Insert synthetic user directly via Drizzle. |

---

## Onboarding Flow

### First-Time User (organic signup)

```
[Landing / Login page]
    |
    v
[Age gate: DOB entry]  <-- BEFORE email, no personal data collected yet
    |  - Under 16 → BLOCKED immediately, no data retained
    |
    v
[Enter email + Terms acceptance]
    |  - ToS checkbox (versioned, recorded server-side)
    |  - Privacy Policy checkbox (separate, GDPR granular consent)
    |
    v
[Email OTP] (6-digit code + magic link)
    |
    v
[Chat — with auto-generated username (e.g. user-3f82d)]
    |  - Inline banner: "Personalize your username" (dismissible)
    |  - Auto-create personal room (user becomes owner)
```

### First-Time User (invited)

```
[Invitation link] --> [Age gate + Terms] --> [Email OTP]
    |
    v
[Land directly in invited room]
    |  - No personal room auto-created
    |  - Inline banner: "Personalize your username"
```

### Room Creation (triggers 2FA requirement)

```
User creates a room (becomes owner)
    |
    v
[2FA setup required]
    |  - "Room owners must enable 2FA to protect this room"
    |  - Passkey or TOTP — no skip option
    |  - Backup codes shown and acknowledged
    |
    v
[Room created]
```

### AI Processing Disclosure (first room entry)

```
User enters a room with AI agents for the first time
    |
    v
[Modal: AI Processing Notice]
    |  - "Messages in this room may be processed by [Provider Name]"
    |  - Link to provider's privacy policy
    |  - "I understand" button (recorded in terms_acceptances)
```

### Returning User

```
[Enter email]
    |
    v
[Email OTP]
    |
    v
[2FA challenge] (if enabled)
    |  - Passkey auto-prompted first
    |  - TOTP fallback
    |  - Backup code option
    |
    v
[Chat]
```

### Key Design Points

- **Age gate before email** — DOB entry happens first. If underage, no personal data is ever collected (GDPR Article 8, COPPA compliance). No data retained for blocked users.
- **Separate ToS and Privacy checkboxes** — GDPR requires granular consent. Two checkboxes, not one bundled agreement.
- **Terms versioned** — stored in DB with acceptance timestamp, IP, user agent. Re-prompted on version change.
- **Username auto-generated** — `user-{random}` assigned at signup to eliminate creative friction. Users personalize later via inline prompt or settings. Global uniqueness preserved.
- **2FA enforced at room creation** — not optional for owners. Triggered when a user creates their first room (organic) or any subsequent room. No skip option.
- **Invited users skip room creation** — land directly in invited room. No unwanted personal room.
- **AI processing disclosure** — explicit modal shown when user first enters a room with AI agents. Recorded as consent.
- **Re-acceptance flow** — when terms version changes, returning users see the terms screen again before accessing chat.

### Friction Mitigation

Organic signup has 2 mandatory screens before chat:
1. Age gate (DOB entry, no data stored)
2. Email + terms + OTP

That's it. Username is auto-generated, 2FA is deferred until room creation, and the user is in chat immediately after OTP verification.

Invited users also see 2 screens: age gate + email/terms/OTP, then land in the invited room.

---

## Identity & Username System

### User Fields

Better Auth's `user` table extended via `additionalFields`:

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `username` | TEXT | UNIQUE, NOT NULL | 3-32 chars, `[a-zA-Z0-9_]`, case-insensitive uniqueness. Auto-generated at signup. |
| `displayName` | TEXT | nullable, max 64 chars | Free-form, can contain unicode. Changeable anytime. |
| `ageVerifiedAt` | TIMESTAMP | NOT NULL | When age gate was passed. No DOB stored. |

### Username Rules

- **Auto-generated at signup**: `user-{random8}` (e.g. `user-3f82d9a1`). User can personalize later.
- **Globally unique**, case-insensitive (stored lowercase, displayed as entered)
- **3-32 characters**: letters, digits, underscore only
- **Reserved words blocked**: `admin`, `system`, `agent`, `bot`, `martol`, `support`, `help`, `sales`, `null`, `undefined`, `deleted`, etc.
- **Changes allowed** with **90-day cooldown**
- **Old username held** in `username_history` table for **90 days** (prevents impersonation)
- **Displayed in chat** as the nick color system already supports
- **Inline personalization prompt**: after first login, a dismissible banner says "Personalize your username" linking to settings

### Email Privacy

- Email is **never shown** to other users
- Only visible in the user's own account settings
- Chat displays username only
- Invitation table emails visible only to the inviter (not all room members)
- Invitations purged 7 days after acceptance/expiry

### Username Anti-Squatting

- Rate-limit account creation per IP (max 3 accounts per IP per day)
- Block known disposable email domains (maintain denylist)
- Username release on account deletion (no reservation delay)
- Reserved protected names cannot be claimed by regular users
- Inactive account reclamation: no login for 12+ months → username enters "reclaimable" state with email notification to original owner

---

## Two-Factor Authentication

### Better Auth Plugins

- `twoFactor` — TOTP (Google Authenticator, Authy, etc.)
- `passkey` — WebAuthn (fingerprint, Face ID, security keys)

### Enabling 2FA

```
Settings > Security > Enable 2FA
    |
    +--> [Passkey] --> Register device fingerprint/Face ID/security key
    |                  via navigator.credentials.create()
    |
    +--> [TOTP] --> Scan QR code with authenticator app
                    Enter 6-digit code to verify setup
                    Save backup codes (MANDATORY — must acknowledge)
```

### Login with 2FA

```
Email OTP verified
    |
    v
[2FA challenge screen]
    |
    +--> Passkey available? --> Auto-prompt biometric
    |
    +--> TOTP fallback --> Enter 6-digit code
    |
    +--> Backup code --> Enter one backup code (single-use)
```

### Rules

| Rule | Detail |
|---|---|
| **Passkey preferred** | Auto-prompted first on login (best UX, phishing-resistant) |
| **TOTP as fallback** | Always available if passkey fails |
| **Backup codes mandatory** | 8 single-use codes generated at 2FA enrollment. User MUST acknowledge they have saved them. Not optional. |
| **Backup code format** | 8-12 chars, alphanumeric, no ambiguous chars (0/O, 1/l). Generated via `crypto.getRandomValues()`. Stored as bcrypt hashes. |
| **Recovery email** | Optional secondary email for 2FA bypass. Must be verified. Provides alternative recovery path. |
| **No SMS** | Zero cost, no carrier dependency |
| **Optional for most users** | Can enable/disable in settings |
| **Mandatory for room owners** | Enforced at room creation — no skip. If promoted to owner of existing room, must set up 2FA before exercising owner privileges. |
| **Cost** | $0 — TOTP is algorithmic, passkeys are browser-native WebAuthn |

### Owner Lockout Prevention

Room owners with mandatory 2FA face higher lockout risk. Mitigations:

1. **Backup codes are mandatory** — cannot enable 2FA without saving them
2. **Recovery email** — strongly recommended for owners, prompted during 2FA setup
3. **Owner succession** — if owner cannot be contacted for 30 days, a designated lead can initiate ownership transfer with a 7-day cooling period (current owner notified at recovery email if set)
4. **Co-owners** (future) — allow rooms to have two owners for redundancy
5. **Manual recovery** — identity verification via support (username + recovery email + account creation date)

---

## Email Change & Account Recovery

### Primary Flow (user has access to old email)

```
Settings > Account > Change Email
    |
    v
[Re-authenticate: enter current email OTP]  <-- proves current email ownership
    |
    v
[If 2FA enabled: verify 2FA]  <-- additional security gate
    |
    v
[Enter new email] --> OTP sent to NEW email
    |
    v
[Enter new-email OTP] --> Email updated
    |
    v
New email is PRIMARY immediately
Old email receives notification with 72-hour undo link
All other sessions invalidated (forced re-login)
```

### 72-Hour Undo Window

- **New email is primary** for login and notifications during the undo period
- **Old email's only power**: click the undo link to revert the change
- **No OTPs sent to old email** during undo window
- **Undo cancels automatically** if old email bounces (detected via Resend webhook)
- **No chained changes**: cannot initiate another email change while one is pending
- **After 72 hours**: change is permanent, undo link expires

### Lost-Email Recovery

```
Recovery form (unauthenticated)
    |
    v
[Enter username + recovery email]
    |
    v
[If 2FA registered: verify TOTP/passkey/backup code]
    |
    v
[OTP sent to recovery email] --> verify
    |
    v
[Admin reviews request]  <-- manual step for safety
    |
    v
[Admin approves] --> user sets new primary email via OTP
    |
    v
All sessions invalidated
Old email notified (if deliverable)
```

### Audit Trail

Every email change logged in `account_audit` table:
- `email_change`: old (masked) → new (masked), IP, user agent, timestamp
- `email_revert`: revert action, IP, timestamp
- `2fa_enable`/`2fa_disable`: method, IP, timestamp
- `username_change`: old → new, IP, timestamp
- `account_delete`: IP, timestamp

---

## Age Verification

### Flow

```
[Landing page — BEFORE email entry]
    |
    v
[Date of birth entry]
    |
    +--> Under 16 --> BLOCKED
    |                  "You must be at least 16 to use this service"
    |                  Generic message (does not reveal exact threshold)
    |                  No email collected, no account created, no data retained
    |
    +--> 16+ --> ALLOWED, proceed to email + terms
    |
    v
[Store ONLY: age_verified_at timestamp on user record after account creation]
[DOB is NOT stored in any form]
```

### Key Decisions

| Decision | Rationale |
|---|---|
| **Age gate before email collection** | DOB entry is the first screen. No personal data (email, name) is collected until age is verified. If underage, nothing is stored. This is the correct GDPR posture. |
| **Minimum age: 16** | Matches strictest EU member states. Enforced as technical minimum. Legal documents use jurisdiction-aware language ("must meet minimum age in your jurisdiction, currently 16 in supported regions"). |
| **DOB not stored** | Only ~36K possible values — bcrypt hash is trivially brute-forced. GDPR data minimization (Art. 5(1)(c)) requires not storing data beyond its purpose. |
| **Store only `age_verified_at`** | Proves age gate was passed without retaining sensitive data |
| **Generic rejection message** | Does not reveal the exact age threshold (prevents gaming) |
| **DOB not editable** | Collected once at signup, verified once, discarded |
| **GeoIP hint** | Use `cf-ipcountry` header to display appropriate age context in UI, but enforce 16 as technical minimum |
| **No real ID verification** | Self-declared, same standard as Discord/Reddit/GitHub. Architecture supports adding stronger verification later if regulations require it. |

---

## Content Moderation & Abuse Prevention

### Honest Launch Capabilities

The moderation system is designed in layers, but only layers that are **actually implemented** are claimed. The design supports progressive enhancement.

### Layer 1: Cloudflare WAF (Launch)

- Rate limiting, bot detection, IP reputation
- DDoS protection
- Managed rulesets for common attacks
- **Status**: Available via Cloudflare dashboard configuration

### Layer 2: Input Validation (Launch)

- Message size limits (prevent DO memory exhaustion)
- File type allowlist with **magic byte validation** (not just Content-Type header)
  - Images: JPEG (FF D8 FF), PNG (89 50 4E 47), GIF (47 49 46), WebP (52 49 46 46)
  - Documents: PDF (25 50 44 46)
- Filename sanitization
- Per-user upload rate limits (100 MB/day)
- Per-org monthly upload limits
- Serve uploads from separate origin with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`
- **Status**: Partially implemented, needs magic byte validation

### Layer 3: User Reporting (Launch)

- Any user can report a message via context menu
- Report includes: reason (csam, nsfw, spam, scam, harassment, other) + optional details
- Reports go to room owner + platform admin queue
- Manual review by platform operator
- Moderation actions: warning, mute (timed), suspend, ban
- Statement of reasons provided for all moderation actions (DSA requirement)
- **Status**: Not yet implemented — required before launch

### Layer 4: Automated Image Scanning (Before enabling image uploads)

- Cloudflare Images CSAM detection (free for Cloudflare customers)
- Perceptual hash matching (requires NCMEC ESP registration + PhotoDNA access)
- NSFW classification via Cloudflare Workers AI
- Images scanned **before** display — blocked content never shown to users
- **Status**: Not implemented. **Do not enable image uploads until this layer is operational.**

### Layer 5: Text Analysis (Post-launch)

- Keyword/pattern matching (phone numbers, crypto wallet addresses, suspicious URLs)
- Link scanning against threat intelligence feeds
- Cloudflare Gateway URL filtering
- **Status**: Future enhancement

### Layer 6: Behavioral Signals (Post-launch)

- Rapid message volume (spam detection)
- Same message to multiple rooms (broadcast spam)
- New account + immediate file sharing (grooming pattern)
- Invitation spam (mass room invites)
- **Status**: Future enhancement

### Specific Threat Responses

| Threat | Detection | Response |
|---|---|---|
| **CSAM** | Hash matching (PhotoDNA), Cloudflare image scanning, user reports | Immediate block, content quarantined in isolated R2 bucket, account suspended, report to NCMEC (legally required). Content preserved 90 days per 18 USC 2258A(h). User NOT notified of report. |
| **NSFW** | Workers AI image classification, user reports | Auto-flag for review, blur in UI pending moderation, repeat offenders suspended |
| **Scam** | User reports, pattern matching (future) | Flag messages, warn recipients, suspend after confirmed reports |
| **Harassment** | User reports | Review, warning → mute → suspend → ban escalation |
| **Money laundering** | Not directly applicable (no payment features). User reports for coordination of financial fraud | Audit trail for law enforcement requests |
| **Human trafficking** | User reports, keyword patterns (NCMEC indicators, future) | Immediate escalation to platform admin, preserve evidence, report to authorities |

### NCMEC Registration

**Required before accepting any image uploads:**

1. Register as an Electronic Service Provider (ESP) with NCMEC CyberTipline
2. Apply for PhotoDNA or CSAI Match access
3. Implement mandatory 90-day content preservation for reported content
4. Build automated CyberTipline report submission
5. Reports must include: IP addresses, timestamps, user account details
6. User must NOT be notified of NCMEC reports

**Until NCMEC registration is complete, consider launching as text-only.**

---

## Legal & Regulatory Compliance

### Regulatory Landscape

| Jurisdiction | Key Requirements | Impact on martol |
|---|---|---|
| **EU (GDPR)** | Lawful basis, DPIA, DPAs, SCCs, data subject rights, Art. 27 representative | Core compliance requirement |
| **EU (DSA)** | Content moderation, notice-and-action, transparency reporting | Content moderation infrastructure |
| **EU (AI Act)** | AI transparency, disclosure obligations | AI agent labeling in UI |
| **EU (ePrivacy)** | Cookie consent for non-essential cookies | Cookie banner for analytics |
| **US (Federal)** | COPPA (under 13), NCMEC (CSAM), CAN-SPAM | Age gate, CSAM pipeline |
| **US (California)** | CCPA/CPRA — privacy notice, opt-out, deletion | Privacy policy, "Do Not Sell" link |
| **UK** | UK GDPR, AADC (children's code) | Privacy policy, age-appropriate design |
| **Australia** | Online Safety Act, age verification | Age gate, content moderation |

### Terms & Consent Infrastructure

#### Terms Versioning

```sql
CREATE TABLE terms_versions (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,       -- semver: '1.0.0'
  type TEXT NOT NULL CHECK(type IN ('tos','privacy','aup')),
  summary TEXT NOT NULL,              -- human-readable change summary
  url TEXT NOT NULL,                  -- link to full text
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Consent Recording

```sql
CREATE TABLE terms_acceptances (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  terms_version_id INT NOT NULL REFERENCES terms_versions(id),
  ip_address TEXT,
  user_agent TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- Every terms acceptance recorded server-side (not just a client checkbox)
- When terms version changes, users re-prompted before accessing chat
- Acceptance includes timestamp, IP, user agent for audit

### Data Subject Rights (GDPR Articles 15-22)

| Right | Implementation |
|---|---|
| **Access (Art. 15)** | "Download my data" in settings — exports profile, messages, uploads as JSON. Response within 30 days. |
| **Rectification (Art. 16)** | Username change, display name change, email change flows |
| **Erasure (Art. 17)** | Account deletion: purge PII, anonymize messages (sender → "[deleted user]"), delete R2 uploads, clear KV sessions, clear audit user references |
| **Restriction (Art. 18)** | Ability to "freeze" account data — keep but stop processing (for complaint resolution) |
| **Portability (Art. 20)** | JSON export of all user-generated content |
| **Object to AI (Art. 22)** | Users can request human review of automated content moderation decisions |

### Data Retention Schedules

| Data | Retention | Justification |
|---|---|---|
| Chat messages | Room-configurable, default 1 year | Service operation |
| Attachments (R2) | Same as parent message | Linked to message lifecycle |
| Session data (KV + DB) | 30 days after expiry | Security audit |
| Expired session rows | Purge via cron 30 days after expiry | Data minimization |
| Invitation records | 7 days after acceptance/expiry | Data minimization |
| Role audit log | 3 years | Legal compliance, fraud prevention |
| Account audit log | 3 years | Legal compliance |
| Terms acceptances | Indefinite | Proof of consent |
| Content moderation records | 3 years | DSA compliance |
| IP addresses in logs | 90 days | Legitimate interest (security) |
| NCMEC-reported content | 90 days minimum | 18 USC 2258A(h) requirement |
| Username history | 90 days after change | Impersonation prevention |
| OTP verification records | 24 hours | Security |
| Soft-deleted messages | 30 days then hard-delete | User expectation |

### Data Processing Agreements Required

| Processor | Data Processed | Action |
|---|---|---|
| Cloudflare | All HTTP traffic, session data, KV, R2, DO state | Execute Cloudflare DPA |
| Aiven | All PostgreSQL data (messages, users, auth) | Execute Aiven DPA, select EU region |
| Resend | Email addresses for OTP delivery | Execute Resend DPA |
| Anthropic | Chat messages (last 50 per context window) | Execute Anthropic DPA, confirm no model training |
| OpenAI (planned) | Chat messages | Execute OpenAI DPA |

Each DPA must include:
- Prohibition on using user data for model training (AI providers)
- Data deletion obligations
- Sub-processor notification requirements
- Standard Contractual Clauses (SCCs) for EU → US transfers

### AI Transparency (EU AI Act)

- AI agent messages clearly labeled as AI-generated in the UI (agent labels already exist)
- Per-room disclosure when agent is first connected: "Messages in this room may be sent to [Provider Name] for AI processing"
- AI content disclaimer in ToS: AI responses may be inaccurate, are not professional advice
- Typing indicators only broadcast to human participants, not to agents (privacy)

### Required Legal Documents

#### Terms of Service (must create before launch)

Required clauses:
1. Service description
2. Eligibility (age 16+)
3. Account responsibilities
4. Acceptable Use Policy — prohibited content and behavior
5. AI processing disclosure — messages processed by named AI providers
6. Intellectual property — user owns content, license to martol for service operation
7. Content moderation rights
8. Liability limitations — AI content disclaimer
9. Indemnification
10. Dispute resolution — governing law, jurisdiction
11. Modification procedure — notice period, re-acceptance
12. Termination — grounds, data handling post-termination
13. Third-party services disclosure

**Status:** Draft ToS created at `/legal/terms`. Covers acceptance, service description, eligibility, content ownership, prohibited conduct, AI agents, termination, disclaimers, liability, governing law. Needs legal counsel review before launch.

#### Privacy Policy (must create before launch)

Required disclosures (GDPR Art. 13 + CCPA):
1. Controller identity and contact details
2. DPO contact (if applicable)
3. Purposes and legal basis per processing activity
4. Categories of personal data
5. Recipients (Cloudflare, Aiven, Anthropic, Resend)
6. International transfers and safeguards
7. Retention periods per data category
8. Data subject rights (access, rectification, erasure, restriction, portability, objection)
9. Right to lodge complaint with supervisory authority
10. Automated decision-making disclosure (content moderation AI)
11. CCPA: "We do not sell your personal information" statement
12. CCPA: Right to opt out of sale/sharing
13. Cookie policy

### Record of Processing Activities (ROPA)

Required under GDPR Article 30. Must document:
- Each processing activity
- Purpose and legal basis
- Categories of data subjects and personal data
- Recipients
- International transfers
- Retention periods
- Technical and organizational security measures

### Data Protection Impact Assessment (DPIA)

Required under GDPR Article 35 because martol involves:
- AI processing of user messages (automated decision-making)
- Content moderation via automated classification (profiling)
- Processing that may include special category data (health, political opinions in chat)
- Cross-border transfers to US-based AI providers

DPIA must be completed before launch.

---

## Database Schema Additions

### New Tables

```sql
-- Username change history
CREATE TABLE username_history (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  old_username TEXT NOT NULL,
  new_username TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ  -- changed_at + 90 days
);

-- Terms versioning
CREATE TABLE terms_versions (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('tos','privacy','aup')),
  summary TEXT NOT NULL,
  url TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Terms acceptance audit trail
CREATE TABLE terms_acceptances (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  terms_version_id INT NOT NULL REFERENCES terms_versions(id),
  ip_address TEXT,
  user_agent TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Account audit log
CREATE TABLE account_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  action TEXT NOT NULL CHECK(action IN (
    'email_change','email_revert',
    '2fa_enable','2fa_disable',
    'username_change','account_delete',
    'login_success','login_failed',
    'otp_sent','otp_failed'
  )),
  old_value TEXT,          -- hashed/masked for sensitive values
  new_value TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content moderation reports
CREATE TABLE content_reports (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id),
  message_id BIGINT REFERENCES messages(id),
  reporter_id TEXT NOT NULL REFERENCES "user"(id),
  reason TEXT NOT NULL CHECK(reason IN ('csam','nsfw','spam','scam','harassment','other')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','actioned','dismissed')),
  reviewed_by TEXT REFERENCES "user"(id),
  reviewed_at TIMESTAMPTZ,
  action_taken TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User sanctions
CREATE TABLE user_sanctions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  sanction_type TEXT NOT NULL CHECK(sanction_type IN ('warning','mute','suspend','ban')),
  reason TEXT NOT NULL,
  report_id BIGINT REFERENCES content_reports(id),
  issued_by TEXT NOT NULL REFERENCES "user"(id),
  expires_at TIMESTAMPTZ,    -- null = permanent
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Legal holds (prevent data deletion during litigation)
CREATE TABLE legal_holds (
  id BIGSERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('user','room','date_range')),
  scope_id TEXT NOT NULL,        -- user_id or org_id
  date_from TIMESTAMPTZ,
  date_to TIMESTAMPTZ,
  reason TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### User Table Extensions

Via Better Auth `additionalFields`:

```typescript
user: {
  additionalFields: {
    username: { type: 'string', unique: true },
    displayName: { type: 'string', required: false },
    ageVerifiedAt: { type: 'date', required: false }
  }
}
```

---

## Better Auth Plugin Configuration

### Target Plugin Stack

```typescript
import { betterAuth } from 'better-auth';
import { emailOTP, organization, apiKey, twoFactor, passkey } from 'better-auth/plugins';

const auth = betterAuth({
  // ... database, secret, baseURL ...

  // NO emailAndPassword — agents created via direct DB insert
  // emailAndPassword is NOT enabled (creates hidden auth bypass)

  plugins: [
    emailOTP({
      expiresIn: 60 * 15,     // 15 minutes
      otpLength: 6,
      disableSignUp: false,
      sendVerificationOTP: async ({ email, otp }) => {
        // Magic link uses opaque token, NOT raw OTP in URL
        // OTP NOT in email subject line
      }
    }),

    organization(),

    apiKey(),

    twoFactor({
      issuer: 'Martol',
      backupCodes: {
        length: 10,               // characters per code
        count: 8                   // number of codes
      }
    }),

    passkey({
      rpName: 'Martol',
      rpID: 'martol.app',          // production domain
      origin: 'https://martol.app'
    })
  ],

  user: {
    additionalFields: {
      username: { type: 'string', unique: true },
      displayName: { type: 'string', required: false },
      ageVerifiedAt: { type: 'date', required: false }
    }
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,    // 7 days
    updateAge: 60 * 60 * 24,         // refresh every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5                  // 5 minutes (reduced from 30 for faster revocation)
    }
  }
});
```

### Agent User Creation (Direct DB Insert)

Instead of `auth.api.signUpEmail()` (which requires `emailAndPassword`), create synthetic agent users directly:

```typescript
const agentUserId = crypto.randomUUID();
const agentEmail = `agent-${crypto.randomUUID().slice(0, 12)}@agent.invalid`;

// Direct insert — no Better Auth signUpEmail needed
await db.insert(user).values({
  id: agentUserId,
  name: label,
  email: agentEmail,
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date()
});

// Create account record for Better Auth consistency
await db.insert(account).values({
  id: crypto.randomUUID(),
  accountId: agentUserId,
  providerId: 'agent',
  userId: agentUserId,
  createdAt: new Date(),
  updatedAt: new Date()
});

// Then proceed with member insert, binding, and API key creation
```

Uses `.invalid` TLD (RFC 2606 reserved) instead of `.local` to prevent accidental email delivery.

---

## Security Hardening

### Magic Link Fix

Replace raw email+OTP in URL with opaque token:

```typescript
// Generate single-use token
const magicToken = crypto.randomUUID();

// Store token → email+OTP mapping in KV (5-minute TTL)
await kv.put(`magic:${magicToken}`, JSON.stringify({ email, otp }), {
  expirationTtl: 60 * 5
});

// Magic link uses opaque token only
const magicUrl = `${baseURL}/api/auth/magic?token=${magicToken}`;

// Email subject — NO OTP
const subject = `Sign in to ${appName}`;
```

### Bot & Spam Prevention

The login and signup endpoints are the primary target for automated abuse: email enumeration (OSINT), OTP send spam (cost amplification + sender reputation damage), and mass account creation.

#### Cloudflare Turnstile (P0)

Turnstile is Cloudflare's free, privacy-preserving bot detection. It runs as an invisible challenge before the OTP send — no user interaction unless a bot is detected.

```
[Age gate] --> [Email + Terms]
                    |
                    v
              [Turnstile challenge (invisible)]
                    |
                    +--> Bot score high --> visible challenge widget
                    |
                    +--> Human verified --> send OTP
```

**Integration:**
- Client: embed Turnstile widget on login page (invisible mode)
- Client sends `cf-turnstile-response` token with OTP request
- Server validates token via `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Reject OTP send if validation fails
- No user friction for legitimate users (invisible mode passes silently)

**Cost:** $0 (free for all Cloudflare plans)

#### Layered Defense

| Layer | Mechanism | Stops | Priority |
|---|---|---|---|
| **Turnstile** | Invisible bot challenge before OTP send | Bots, scripts, headless browsers | P0 |
| **IP rate limit** | 10 OTP sends per IP per hour | Single-IP flooding | P0 |
| **Email rate limit** | 3 OTP sends per email per 15 min | Targeted harassment | P0 |
| **Global rate limit** | 100 OTP sends per minute globally | Cost amplification attacks | P0 |
| **Consistent responses** | Same response whether email exists or not | OSINT email enumeration | P0 |
| **Disposable email blocking** | Denylist of known disposable domains | Throwaway account spam | P0 |
| **Honeypot field** | Hidden form field — bots fill it, humans don't | Simple bots | P0 |
| **OTP verification limit** | 5 attempts per OTP generation | Brute force | P0 |
| **Account lockout** | 15 min lock after 3 consecutive OTP failures | Persistent brute force | P0 |

#### Email Enumeration Prevention

The OTP send endpoint must return **identical responses** regardless of whether the email is registered:
- Registered email: send OTP, respond "Check your email"
- Unregistered email: do nothing, respond "Check your email"
- Rate-limited: respond "Check your email" (do not reveal the rate limit was hit)

This prevents attackers from probing which emails have accounts. Better Auth's `emailOTP` with `disableSignUp: false` creates accounts on first OTP, which may already behave consistently — verify during implementation.

#### Disposable Email Blocking

Maintain a denylist of known disposable email domains (mailinator.com, tempmail.com, etc.). Block at the OTP send step, before any email is dispatched. Open-source lists available (e.g., `disposable-email-domains` on GitHub, ~3000 domains). Update periodically via cron or CI.

### WebSocket Identity Signing

Sign identity headers passed to Durable Objects with HMAC:

```typescript
const payload = JSON.stringify({ userId, role, orgId, timestamp: Date.now() });
const signature = await hmacSign(payload, SIGNING_KEY);
headers.set('X-Identity', payload);
headers.set('X-Identity-Sig', signature);
```

DO verifies signature and rejects if timestamp is older than 60 seconds.

### Email Leak Prevention

Never fall back to email in room-facing identifiers:

```typescript
// WRONG: user.name || user.email || 'Unknown'
// RIGHT: user.name || user.username || `User-${user.id.slice(0, 6)}`
```

### Session Cleanup

Cloudflare Cron Trigger (hourly) to:
- Purge expired session rows (30 days after expiry)
- Expire pending actions older than 24 hours
- Release reserved usernames past 90-day holdback
- Clean up orphaned agent users (no matching `agent_room_bindings` row)

### CSP Nonce Migration

Replace `'unsafe-inline'` with nonce-based CSP:

```typescript
// Use SvelteKit's built-in nonce support
"script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com"
```

### Content-Type Validation

Validate actual file content (magic bytes) server-side, not just the client-declared Content-Type header. Re-encode/re-process images via Cloudflare Image Transformations to strip embedded payloads.

### Atomic Agent Creation

Wrap all agent creation operations in a database transaction. On failure of any step, roll back all changes. Add cleanup cron for orphaned agent users.

---

## Pre-Launch Checklist

### P0 — Blockers (must complete before any public access)

- [x] Draft Terms of Service, Privacy Policy, and AUP as in-app pages (`/legal/terms`, `/legal/privacy`, `/legal/aup`) — ⚠️ STILL NEEDS LEGAL COUNSEL REVIEW
- [ ] Have legal counsel review and finalize ToS, Privacy Policy, AUP ⚠️ REQUIRES LEGAL
- [ ] Execute DPAs with Cloudflare, Aiven, Resend, Anthropic ⚠️ REQUIRES LEGAL
- [ ] Complete Record of Processing Activities (ROPA) ⚠️ REQUIRES LEGAL
- [ ] Complete Data Protection Impact Assessment (DPIA) ⚠️ REQUIRES LEGAL
- [x] Implement `terms_acceptances` table with server-side recording (separate ToS + Privacy checkboxes)
- [x] Implement age gate as first screen, before email collection (DOB verified, not stored)
- [x] Auto-generate username at signup (`user-{random}`)
- [x] Fix auto-create room: conditional on invite status (invited → land in invited room, organic → create personal room)
- [x] Feature-flag image uploads — disable `/api/upload` endpoint until NCMEC + scanning operational
- [x] Fix magic link (opaque token, remove OTP from subject)
- [x] Remove `emailAndPassword: { enabled: true }` — use direct DB insert for agents
- [x] Implement user reporting UI and `content_reports` table
- [x] Add OTP rate limiting (per-email: 3/15min, per-IP: 10/hr, global: 100/min)
- [x] Integrate Cloudflare Turnstile on login page (widget in email step, server-side validation in hooks.server.ts)
- [x] Add honeypot field to login form
- [x] Add consistent responses for OTP send (same response whether email exists or not)
- [x] Block disposable email domains (denylist)
- [x] Add OTP verification attempt limit (5 per generation) and account lockout (15min after 3 failures)
- [x] Reduce cookie cache to 5 minutes
- [x] Fix email leak in WebSocket X-User-Name header
- [x] Sign WebSocket identity headers with HMAC
- [x] Add AI processing disclosure modal (shown at first room entry with agents)

### P1 — Within 30 days of launch

- [ ] Register with NCMEC as ESP (before enabling image uploads)
- [x] Implement data subject rights endpoints (export JSON, account deletion with anonymization)
- [ ] Add image scanning pipeline (Cloudflare Images CSAM detection)
- [ ] Implement international data transfer mechanisms (SCCs)
- [ ] Add cookie consent mechanism for EU users
- [ ] Implement 2FA UI (twoFactor plugin configured, passkey pending plugin availability)
- [x] Add `account_audit` table (schema created, logging hooks P1)
- [x] Implement session listing and remote logout in settings
- [x] Migrate CSP to nonce-based (SvelteKit built-in `csp` config with `'nonce'` directive)
- [x] Atomic agent creation with transaction rollback (Drizzle `db.transaction()`)
- [x] Settings page with username change (90-day cooldown, reserved words, old username hold)
- [x] Terms re-acceptance middleware (hooks.server.ts checks latest terms versions, redirects to /accept-terms)
- [x] Username personalization prompt (inline banner in chat for auto-generated usernames)

### P2 — Within 90 days

- [ ] Implement data retention automation via Cron Trigger
- [ ] Add legal hold system
- [ ] Document breach notification procedure
- [ ] Add CCPA "Do Not Sell/Share" link
- [ ] Implement owner succession mechanism
- [ ] Implement username reclamation for inactive accounts
- [ ] Add file upload quotas (per-user daily, per-org monthly)
- [ ] Text analysis layer (keyword patterns, link scanning)

### P3 — Ongoing

- [ ] DSA transparency reporting (annual)
- [ ] Sub-processor monitoring
- [ ] Better Auth upgrade monitoring and abstraction layer
- [ ] Behavioral signal analysis
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] DPO assessment as user base grows
- [ ] Monitor Australian and UK age verification regulatory developments

---

## Review Summary

This design was reviewed by four independent agents:

| Reviewer | Critical Findings | Key Recommendation |
|---|---|---|
| **Privacy** | 5 critical, 7 warnings | Don't store DOB; rewrite privacy policy; implement consent audit trail |
| **Security** | 4 critical, 6 high | Fix magic link OTP leak; add OTP rate limiting; revert emailAndPassword; sign DO headers |
| **Legal** | 5 critical gaps | Draft ToS + Privacy Policy; execute DPAs; complete DPIA + ROPA; register with NCMEC |
| **Devil's Advocate** | 3 existential risks | Legal exposure, onboarding friction, and single-factor auth with no recovery are the three ways this project dies |

Full review transcripts available in session history.
