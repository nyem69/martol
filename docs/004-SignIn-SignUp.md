# 004 — Auth Implementation Reference

> How authentication actually works in the codebase. For design rationale, see `003-Auth.md`.

---

## Table of Contents

1. [Sign-In / Sign-Up (Email OTP)](#1-sign-in--sign-up-email-otp)
2. [Magic Link Flow](#2-magic-link-flow)
3. [Invitation Flow](#3-invitation-flow)
4. [Session Management](#4-session-management)
5. [API Key Authentication (Agents)](#5-api-key-authentication-agents)
6. [Rate Limiting & Abuse Prevention](#6-rate-limiting--abuse-prevention)
7. [Terms Re-acceptance](#7-terms-re-acceptance)
8. [Known Issues & Root Causes](#8-known-issues--root-causes)
9. [Environment Variables](#9-environment-variables)
10. [File Reference](#10-file-reference)

---

## 1. Sign-In / Sign-Up (Email OTP)

Sign-up is not a separate flow. First-time users create accounts automatically on first successful OTP verification (`disableSignUp: false`).

### Sequence

```
Browser                          Server (hooks.server.ts)              Better Auth
  |                                  |                                     |
  |  1. Age gate (client-side)       |                                     |
  |  2. Enter email + accept terms   |                                     |
  |  3. Turnstile challenge          |                                     |
  |                                  |                                     |
  |  POST /api/auth/email-otp/      |                                     |
  |    send-verification-otp         |                                     |
  |  headers: x-captcha-response     |                                     |
  |--------------------------------->|                                     |
  |                                  |  4. Validate Turnstile token        |
  |                                  |  5. Check disposable email          |
  |                                  |  6. Check rate limits (IP/email/    |
  |                                  |     global) via KV                  |
  |                                  |  7. Forward to Better Auth          |
  |                                  |---------------------------------->  |
  |                                  |                                     |  8. Generate 6-digit OTP
  |                                  |                                     |  9. INSERT into verification table
  |                                  |                                     | 10. Call sendVerificationOTP hook
  |                                  |                                     |     -> store magic token in KV
  |                                  |                                     |     -> send email via Resend
  |                                  |  <---------------------------------|
  |  <-------------------------------|                                     |
  |                                  |                                     |
  |  POST /api/auth/sign-in/        |                                     |
  |    email-otp { email, otp }      |                                     |
  |--------------------------------->|                                     |
  |                                  | 11. Check lockout flag in KV        |
  |                                  | 12. Check verify rate limit (5/15m) |
  |                                  | 13. Forward to Better Auth          |
  |                                  |---------------------------------->  |
  |                                  |                                     | 14. Lookup verification record
  |                                  |                                     | 15. Validate OTP + attempts
  |                                  |                                     | 16. If new user: CREATE user
  |                                  |                                     |     (auto-generate username)
  |                                  |                                     | 17. Create session
  |                                  |                                     | 18. Set cookies
  |                                  |  <---------------------------------|
  |  <-------------------------------|                                     |
  |                                  |                                     |
  | 19. POST /api/terms (record      |                                     |
  |     terms acceptance, non-block) |                                     |
  | 20. goto('/chat')                |                                     |
```

### Step Details

**Age gate** (`login/+page.svelte`): Date of birth entry, minimum age 16. Stored in `localStorage` only — DOB is never sent to the server.

**Email + terms** (`login/+page.svelte`): Two separate checkboxes (ToS, Privacy Policy). Honeypot hidden field traps bots (if filled, silently "succeeds"). Invitation pre-fills and locks email via `?email=` URL param.

**Turnstile** (`hooks.server.ts:204-243`): Cloudflare Turnstile widget rendered in dark theme. Token passed as `x-captcha-response` header. Verified server-side against `challenges.cloudflare.com/turnstile/v0/siteverify`. Only enforced on OTP send, not verify.

**OTP storage**: Better Auth inserts into `verification` table:
- `identifier`: `sign-in-otp-{email}`
- `value`: `{otp}:{attemptCount}` (e.g., `"920902:0"`)
- `expiresAt`: now + 15 minutes

**Email delivery** (`lib/server/email.ts`): OTP email includes both a magic link (opaque token) and the 6-digit code. OTP is NOT in the subject line (prevents lock-screen exposure).

**New user creation** (`lib/server/auth/index.ts`): Database hook auto-generates username `user-{8-char-uuid}` if not set. The `twoFactorEnabled` column defaults to `false` (required by twoFactor plugin).

**Resend code** (`login/+page.svelte`): Button on code entry step calls `sendVerificationOtp` again. No Turnstile on resend (token is single-use, already consumed on first send).

---

## 2. Magic Link Flow

Two-step process to prevent email client prefetching from consuming the OTP.

### KV Storage

```
Key:   magic:{uuid}
Value: { "email": "user@example.com", "otp": "123456" }
TTL:   5 minutes
```

### Sequence

```
Email client                     GET /api/auth/magic?token=xxx
  |  (prefetch or click)         |
  |----------------------------->|
  |                              |  1. Read magic:{token} from KV
  |                              |  2. Extract email (do NOT consume token)
  |                              |  3. Redirect 302 → /login?magic={token}&email={email}
  |  <---------------------------|
  |                              |
Browser (login page)             POST /api/auth/magic { token }
  |  User clicks "Sign in"      |
  |----------------------------->|
  |                              |  4. Read magic:{token} from KV
  |                              |  5. Validate: email has @, OTP is 6 digits
  |                              |  6. DELETE token from KV (single-use)
  |                              |  7. Internal fetch to Better Auth sign-in
  |                              |     POST /api/auth/sign-in/email-otp
  |                              |  8. Forward Set-Cookie headers
  |  <---------------------------|
  |  goto('/chat')               |
```

**Why two steps**: Email clients (Gmail, Outlook) prefetch links via GET. If GET consumed the token, the link would be dead by the time the user clicks it.

**Errors**: `410 Gone` (token expired/used), `400` (missing token), `401` (OTP verification failed).

Source: `src/routes/api/auth/magic/+server.ts`

---

## 3. Invitation Flow

### Sending an Invitation

```
Owner/Lead (MemberPanel)         POST (Better Auth organization plugin)
  |  inviteMember({              |
  |    email, role, orgId })     |
  |----------------------------->|
  |                              |  1. Create invitation record
  |                              |     status: 'pending'
  |                              |     expiresAt: +7 days
  |                              |  2. Call sendInvitationEmail hook
  |                              |     → Resend email with accept link
  |  <---------------------------|
```

The `sendInvitationEmail` callback in `lib/server/auth/index.ts` uses `invitationEmailTemplate()` from `lib/server/email.ts`. Accept link: `{baseURL}/accept-invitation/{invitationId}`.

### Accepting an Invitation

```
Invitee clicks link              /accept-invitation/[id]
  |                              |
  |----------------------------->|  +page.server.ts load:
  |                              |  1. Fetch invitation + org + inviter
  |                              |  2. Check: expired? canceled? rejected?
  |                              |  3. If logged in + already member → redirect /chat
  |                              |  4. If logged in + not member → show "Join" button
  |                              |  5. If not logged in → show "Sign in to join" link
  |                              |     → /login?redirect=/accept-invitation/{id}&email={email}
  |                              |
  |  (after login, user returns) |
  |  POST ?/accept               |
  |----------------------------->|
  |                              |  6. auth.api.acceptInvitation({ invitationId })
  |                              |  7. Creates member record
  |                              |  8. Sets invitation status → 'accepted'
  |                              |  9. Redirect → /chat
  |  <---------------------------|
```

**Decline**: `POST ?/decline` sets status to `rejected`.

Source: `src/routes/accept-invitation/[id]/+page.server.ts`, `+page.svelte`

---

## 4. Session Management

### Per-Request Session Loading

Every request in `hooks.server.ts`:

1. Create DB connection (Hyperdrive or direct)
2. Create Better Auth instance (`createAuth()`)
3. Call `auth.api.getSession({ headers: request.headers })`
4. Populate `event.locals.user` and `event.locals.session`

### Session Configuration

```typescript
// src/lib/server/auth/index.ts
session: {
  expiresIn: 60 * 60 * 24 * 7,    // 7-day absolute expiration
  updateAge: 60 * 60 * 24,         // Refresh token every 24 hours
  cookieCache: {
    enabled: true,
    maxAge: 60 * 5                  // 5-minute client-side cache
  }
}
```

### Cookies

- `martol.session_token` — HTTP-only, session token (secure in production)
- Cookie prefix: `martol` (set via `advanced.cookiePrefix`)
- Secure cookies: enabled when `baseURL` starts with `https`

### Session Listing & Revocation

`GET /api/account/sessions` — list all active sessions for current user.
`DELETE /api/account/sessions` — revoke a specific session by ID (cannot revoke current session).

Source: `src/routes/api/account/sessions/+server.ts`

### Sign Out

Client calls `signOut()` from `$lib/auth-client`. Better Auth clears cookies and invalidates session.

---

## 5. API Key Authentication (Agents)

### Agent Creation

`POST /api/agents` (session-authenticated, owner/lead only):

1. Generate synthetic email: `agent-{12-char-random}@agent.invalid`
2. In DB transaction:
   - INSERT user (synthetic, `emailVerified: true`)
   - INSERT account (`providerId: 'agent'`)
   - INSERT member (`role: 'agent'`, bound to active org)
3. Create API key via Better Auth plugin (prefix: `mtl`)
4. Return full key (shown once, never retrievable again)

### Agent Authentication (WebSocket)

`src/routes/api/rooms/[roomId]/ws/+server.ts`:

1. Check `x-api-key` header
2. Call `auth.api.verifyApiKey({ body: { key } })`
3. Query DB: verify user exists, has `role: 'agent'` membership
4. Create signed identity payload (HMAC-SHA256 with `BETTER_AUTH_SECRET`):
   ```json
   { "userId": "...", "role": "agent", "userName": "...", "orgId": "...", "timestamp": ... }
   ```
5. Forward to Durable Object with `X-Identity` + `X-Identity-Sig` headers

### Agent Authentication (MCP)

`src/lib/server/mcp/auth.ts`:

1. Extract `x-api-key` header
2. Verify via Better Auth API Key plugin
3. Optional KV revocation check (`revoked:{keyId}`)
4. Query DB for agent membership
5. Return `AgentContext { agentUserId, agentName, orgId, orgRole }`

---

## 6. Rate Limiting & Abuse Prevention

### OTP Send Rate Limits

Applied in `hooks.server.ts` before Better Auth processes the request:

| Limit | Key | Max | Window | Response |
|-------|-----|-----|--------|----------|
| Per-IP | `otp-ip:{ip}` | 10 | 1 hour | Silent 200 OK |
| Per-email | `otp-email:{email}` | 3 | 15 min | Silent 200 OK |
| Global | `otp-global` | 100 | 1 min | Silent 200 OK |

All blocked requests return `200 OK` to prevent enumeration.

### OTP Verify Rate Limits

| Limit | Key | Max | Window | Response |
|-------|-----|-----|--------|----------|
| Per-email | `otp-verify:{email}` | 5 | 15 min | 429 + error message |
| Lockout | `lockout:{email}` | — | 15 min TTL | 429 "Too many attempts" |

Lockout flag set in KV after exceeding verify limit. Subsequent requests fail-fast without incrementing counter.

### Disposable Email Blocking

`src/lib/server/disposable-emails.ts`: 35+ known disposable domains. Silent drop (200 OK).

### Rate Limiter Implementation

`src/lib/server/rate-limit.ts`: Sliding window counter in Cloudflare KV.

```
Key:   rl:{config.key}
Value: { count: number, windowStart: number }
TTL:   windowSeconds
```

Fail-open on KV errors (logs but doesn't block).

---

## 7. Terms Re-acceptance

`hooks.server.ts:128-192` — runs on every authenticated page request (excludes `/api/*`, `/login`, `/legal/*`, `/accept-terms`, `/accept-invitation`).

1. Fetch latest version of each required type: `tos`, `privacy`, `aup`
2. Check if user has accepted each latest version in `termsAcceptances`
3. If any acceptance missing → `302` redirect to `/accept-terms`
4. Fail-open on errors (don't block user if check fails)

---

## 8. Known Issues & Root Causes

### twoFactorEnabled Column (Fixed 2026-03-02)

**Symptom**: New user sign-up via OTP fails with 500 error.

**Root cause**: The `twoFactor` plugin adds `twoFactorEnabled: boolean` to the user model. When Better Auth creates a new user, it includes `twoFactorEnabled: false` in the INSERT. If the Drizzle schema doesn't define this column, the adapter throws:

```
BetterAuthError: The field "twoFactorEnabled" does not exist in the "user" Drizzle schema
```

**Fix**: Added `twoFactorEnabled: boolean('twoFactorEnabled').default(false)` to user table in `auth-schema.ts` and ran `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT FALSE` on production.

**Prevention**: After adding any Better Auth plugin, run `npx @better-auth/cli generate` to check for required schema changes.

### Hyperdrive SELECT Caching

**Observation**: INSERT via Hyperdrive succeeds (RETURNING returns data, record confirmed via direct psql), but SELECT in the same request returns 0 rows.

**Impact**: None for auth flows — OTP SEND and VERIFY are always separate HTTP requests, so the verification record is visible by the time VERIFY runs.

---

## 9. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `BETTER_AUTH_SECRET` | Yes | Session encryption + HMAC signing (min 32 chars) |
| `RESEND_API_KEY` | Production | Email delivery via Resend |
| `EMAIL_FROM` | No | Sender address (default: `noreply@martol.app`) |
| `EMAIL_NAME` | No | Sender name (default: `Martol`) |
| `APP_BASE_URL` | No | Base URL for callbacks (default: `http://localhost:5190`) |
| `TURNSTILE_SITE_KEY` | Production | Cloudflare Turnstile public key |
| `TURNSTILE_SECRET_KEY` | Production | Cloudflare Turnstile secret |
| `CACHE` | Production | Cloudflare KV binding (rate limits, magic tokens, sessions) |
| `HYPERDRIVE` | Production | Cloudflare Hyperdrive binding (PostgreSQL) |
| `PG_HOST` | Local dev | Direct PostgreSQL host |

---

## 10. File Reference

| File | Responsibility |
|------|----------------|
| `src/hooks.server.ts` | Per-request auth, rate limiting, Turnstile, CORS, terms check |
| `src/lib/server/auth/index.ts` | Better Auth config: plugins, hooks, session, email callbacks |
| `src/lib/auth-client.ts` | Client-side auth: `signIn`, `signOut`, `emailOtp`, `organization` |
| `src/lib/server/db/auth-schema.ts` | Drizzle schema for all auth tables |
| `src/lib/server/email.ts` | Email sending (Resend) + OTP/invitation templates |
| `src/lib/server/rate-limit.ts` | KV sliding window rate limiter |
| `src/lib/server/disposable-emails.ts` | Disposable email domain denylist |
| `src/lib/server/mcp/auth.ts` | MCP agent authentication helper |
| `src/routes/login/+page.svelte` | Login UI: age gate, email, OTP, magic link |
| `src/routes/login/+page.server.ts` | Load Turnstile site key |
| `src/routes/api/auth/[...auth]/+server.ts` | Better Auth catch-all handler |
| `src/routes/api/auth/magic/+server.ts` | Magic link GET (redirect) + POST (verify) |
| `src/routes/accept-invitation/[id]/` | Invitation acceptance page + server logic |
| `src/routes/api/agents/+server.ts` | Agent CRUD + API key generation |
| `src/routes/api/account/sessions/+server.ts` | Session listing + revocation |
| `src/routes/api/rooms/[roomId]/ws/+server.ts` | WebSocket upgrade with session/API key auth |
| `src/routes/accept-terms/` | Terms re-acceptance page |
| `src/routes/api/terms/+server.ts` | Terms acceptance recording |
