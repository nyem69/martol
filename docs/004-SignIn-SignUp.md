# 004 — Auth Implementation Reference

> How authentication actually works in the codebase. For design rationale, see `003-Auth.md`.

---

## Table of Contents

1. [Sign-In / Sign-Up (Email OTP)](#1-sign-in--sign-up-email-otp)
2. [Magic Link Flow](#2-magic-link-flow)
3. [Invitation Flow](#3-invitation-flow)
4. [Room Resolution](#4-room-resolution)
5. [Session Management](#5-session-management)
6. [API Key Authentication (Agents)](#6-api-key-authentication-agents)
7. [Rate Limiting & Abuse Prevention](#7-rate-limiting--abuse-prevention)
8. [Terms Re-acceptance](#8-terms-re-acceptance)
9. [Security Audit & Known Issues](#9-security-audit--known-issues)
10. [Environment Variables](#10-environment-variables)
11. [File Reference](#11-file-reference)

---

## 1. Sign-In / Sign-Up (Email OTP)

Sign-up is not a separate flow. First-time users create accounts automatically on first successful OTP verification (`disableSignUp: false`).

### Full OTP Flow

```mermaid
flowchart TD
    Start([User visits /login]) --> AgeGate[Age gate: DOB entry]
    AgeGate -->|Under 16| Blocked[Blocked — no data retained]
    AgeGate -->|16+| EmailStep[Enter email + accept ToS & Privacy]

    EmailStep --> Honeypot{Honeypot filled?}
    Honeypot -->|Yes — bot| SilentOK[Silent 200 OK\nno email sent]
    Honeypot -->|No| Turnstile[Turnstile CAPTCHA challenge]

    Turnstile -->|Failed| CaptchaError[400: CAPTCHA failed]
    Turnstile -->|Passed| SendOTP

    subgraph Server [hooks.server.ts — OTP Send]
        SendOTP[POST /api/auth/email-otp/send-verification-otp] --> Disposable{Disposable\nemail?}
        Disposable -->|Yes| SilentDrop[Silent 200 OK]
        Disposable -->|No| IPRate{IP rate limit\n10/hr?}
        IPRate -->|Exceeded| SilentDrop
        IPRate -->|OK| EmailRate{Email rate limit\n3/15min?}
        EmailRate -->|Exceeded| SilentDrop
        EmailRate -->|OK| GlobalRate{Global rate limit\n100/min?}
        GlobalRate -->|Exceeded| SilentDrop
        GlobalRate -->|OK| BetterAuth[Forward to Better Auth]
    end

    BetterAuth --> GenerateOTP[Generate 6-digit OTP]
    GenerateOTP --> StoreVerification[INSERT verification table\nidentifier: sign-in-otp-email\nvalue: otp:attemptCount\nexpires: +15min]
    StoreVerification --> SendHook[sendVerificationOTP hook]
    SendHook --> StoreMagic[Store magic:uuid in KV\nTTL 5min]
    StoreMagic --> SendEmail[Send email via Resend\ncontains: magic link + OTP code\nNO OTP in subject line]

    SendEmail --> UserGetsEmail([User receives email])
    UserGetsEmail -->|Enter 6-digit code| VerifyOTP
    UserGetsEmail -->|Click magic link| MagicFlow([See §2 Magic Link])

    subgraph VerifyServer [hooks.server.ts — OTP Verify]
        VerifyOTP[POST /api/auth/sign-in/email-otp] --> Lockout{lockout:email\nin KV?}
        Lockout -->|Yes| TooMany[429: Too many attempts]
        Lockout -->|No| VerifyRate{Verify rate limit\n5/15min?}
        VerifyRate -->|Exceeded| SetLockout[Set lockout:email\nTTL 15min] --> TooMany
        VerifyRate -->|OK| ForwardVerify[Forward to Better Auth]
    end

    ForwardVerify --> LookupOTP[Lookup verification record]
    LookupOTP --> ValidateOTP{OTP correct\n& not expired?}
    ValidateOTP -->|No| IncrementAttempt[Increment attempt count]
    ValidateOTP -->|Yes| NewUser{First-time\nuser?}

    NewUser -->|Yes| CreateUser[CREATE user\nauto-generate username\nuser-random8\ntwoFactorEnabled: false]
    NewUser -->|No| ExistingUser[Load existing user]

    CreateUser --> CreateSession[Create session + set cookies]
    ExistingUser --> CreateSession

    CreateSession --> RecordTerms[POST /api/terms\nnon-blocking]
    RecordTerms --> CheckRedirect{redirect param\nin URL?}
    CheckRedirect -->|Yes| GoRedirect[goto redirect path]
    CheckRedirect -->|No| GoChat[goto /chat]

    GoRedirect --> RoomResolution([See §4 Room Resolution])
    GoChat --> RoomResolution
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

```mermaid
sequenceDiagram
    participant EC as Email Client
    participant B as Browser
    participant S as /api/auth/magic
    participant KV as Cloudflare KV
    participant BA as Better Auth

    Note over EC: Email contains magic link:<br/>GET /api/auth/magic?token=xxx

    EC->>S: GET /api/auth/magic?token=xxx<br/>(prefetch or user click)
    S->>KV: Read magic:{token}
    KV-->>S: { email, otp }
    Note over S: Do NOT consume token<br/>(prefetch safe)
    S-->>EC: 302 → /login?magic={token}&email={email}

    EC->>B: Browser navigates to login page
    Note over B: Login page shows<br/>"Sign in" button<br/>(pre-filled email)

    B->>S: POST /api/auth/magic { token }
    S->>KV: Read magic:{token}
    KV-->>S: { email, otp }
    S->>KV: DELETE magic:{token}<br/>(single-use consumed)
    S->>BA: Internal POST /api/auth/sign-in/email-otp<br/>{ email, otp }
    BA-->>S: 200 OK + Set-Cookie
    S-->>B: 200 OK + Set-Cookie forwarded
    B->>B: goto('/chat')
```

**Why two steps**: Email clients (Gmail, Outlook) prefetch links via GET. If GET consumed the token, the link would be dead by the time the user clicks it.

**Errors**: `410 Gone` (token expired/used), `400` (missing token), `401` (OTP verification failed).

Source: `src/routes/api/auth/magic/+server.ts`

---

## 3. Invitation Flow

### Sending an Invitation

```mermaid
sequenceDiagram
    participant O as Owner/Lead
    participant C as Client (MemberPanel)
    participant BA as Better Auth
    participant DB as Database
    participant R as Resend

    O->>C: Enter email + role, click "Send invite"
    C->>BA: organization.inviteMember({ email, role, orgId })
    BA->>DB: INSERT invitation<br/>status: 'pending'<br/>expiresAt: +7 days
    BA->>BA: Call sendInvitationEmail hook
    BA->>R: Send invitation email<br/>link: /accept-invitation/{id}
    R-->>BA: Email sent
    BA-->>C: Success
    C-->>O: "Invitation sent"
```

### Accepting an Invitation — All Scenarios

```mermaid
flowchart TD
    Start([Invitee clicks email link]) --> LoadPage[GET /accept-invitation/id]
    LoadPage --> FetchInvite[Fetch invitation + org + inviter]
    FetchInvite --> NotFound{Invitation\nexists?}
    NotFound -->|No| Error404[404: Invitation not found]
    NotFound -->|Yes| CheckStatus{Status?}

    CheckStatus -->|canceled / rejected| ShowInvalid[Show: invitation no longer valid]
    CheckStatus -->|expired| ShowExpired[Show: invitation has expired]

    CheckStatus -->|pending| CheckAuth{User logged in?}
    CheckStatus -->|accepted| CheckAuthAccepted{User logged in?}

    CheckAuthAccepted -->|No| LoginLinkAccepted[Show: Sign in to continue]
    CheckAuthAccepted -->|Yes| SetActiveAccepted[Set activeOrganizationId\non session] --> RedirectChat1([302 → /chat])

    CheckAuth -->|No| LoginLink[Show: Sign in to join\n→ /login?redirect=...&email=...]
    CheckAuth -->|Yes| CheckMember{Already a\nmember?}

    CheckMember -->|Yes| MarkAccepted[Mark invitation accepted\nSet activeOrganizationId] --> RedirectChat2([302 → /chat])
    CheckMember -->|No| ShowAcceptUI[Show invitation details\nJoin / Decline buttons]

    ShowAcceptUI -->|Decline| DeclineAction[POST ?/decline\nSet status: rejected] --> RedirectChat3([302 → /chat])
    ShowAcceptUI -->|Join| AcceptAction

    subgraph AcceptAction [POST ?/accept]
        Accept1[auth.api.acceptInvitation] --> Accept2[Creates member record\nSets invitation: accepted]
        Accept2 --> Accept3[Query invitation.organizationId]
        Accept3 --> Accept4[UPDATE session\nactiveOrganizationId = orgId]
    end

    AcceptAction --> RedirectChat4([302 → /chat\nlands in invited room])

    LoginLink --> LoginFlow[Login via OTP]
    LoginFlow --> RedirectBack[goto /accept-invitation/id\nvia redirect param]
    RedirectBack --> LoadPage
```

### Invitation for New User (end-to-end)

```mermaid
sequenceDiagram
    participant I as Invitee
    participant B as Browser
    participant S as Server

    Note over I: Receives invitation email

    I->>B: Click invitation link
    B->>S: GET /accept-invitation/{id}
    S-->>B: Not logged in → show "Sign in to join"

    I->>B: Click sign-in link
    B->>S: GET /login?redirect=/accept-invitation/{id}&email=invitee@example.com
    Note over B: Email pre-filled & locked<br/>Age gate → Terms → OTP

    I->>B: Complete OTP verification
    Note over S: Better Auth creates new user<br/>(auto-generates username)
    S-->>B: Session created

    B->>S: goto('/accept-invitation/{id}')<br/>via redirect param
    S-->>B: Now logged in → show "Join" button

    I->>B: Click "Join room"
    B->>S: POST ?/accept
    Note over S: acceptInvitation() → creates member<br/>Set activeOrganizationId on session
    S-->>B: 302 → /chat

    B->>S: GET /chat
    Note over S: activeOrganizationId set → lands in invited room<br/>No auto-room created
```

Source: `src/routes/accept-invitation/[id]/+page.server.ts`, `+page.svelte`

---

## 4. Room Resolution

When `/chat` loads, the server resolves which room to show. This is a cascade with multiple fallback paths.

```mermaid
flowchart TD
    Start([GET /chat — page.server.ts]) --> CheckAuth{Authenticated?}
    CheckAuth -->|No| LoginRedirect([302 → /login])
    CheckAuth -->|Yes| CheckActiveOrg{session.activeOrganizationId\nset?}

    CheckActiveOrg -->|Yes| UseActiveOrg[roomId = activeOrganizationId]
    CheckActiveOrg -->|No| FirstMembership{User has any\nmemberships?}

    FirstMembership -->|Yes| UseFirst[roomId = first membership.orgId]
    FirstMembership -->|No| CheckPending{Pending invitation\nfor user's email?\ncase-insensitive}

    CheckPending -->|Yes| AutoAccept[Insert member record\nMark invitation accepted\nroomId = invitation.orgId]
    CheckPending -->|No| AutoCreate[Create personal room\nname: 'username's Room'\nrole: owner\nroomId = new org]

    UseActiveOrg --> SyncSession
    UseFirst --> SyncSession
    AutoAccept --> SyncSession
    AutoCreate --> SyncSession

    SyncSession{activeOrganizationId\n== roomId?}
    SyncSession -->|Yes| LoadRoom
    SyncSession -->|No| UpdateSession[UPDATE session\nactiveOrganizationId = roomId] --> LoadRoom

    LoadRoom[Load room data:\n- org name\n- user rooms list\n- invitations\n- recent messages\n- read cursors\n- agent presence]
    LoadRoom --> Render([Render chat UI])
```

### Room Resolution Priority

| Priority | Condition | Result |
|----------|-----------|--------|
| 1 | `activeOrganizationId` set on session | Use that room |
| 2 | User has any memberships | Use first membership |
| 3 | Pending invitation matches email (case-insensitive) | Auto-accept and join that room |
| 4 | None of the above | Auto-create personal room |

Source: `src/routes/chat/+page.server.ts`

---

## 5. Session Management

### Per-Request Session Loading

```mermaid
flowchart LR
    Request([Incoming request]) --> ConnectDB

    subgraph hooks.server.ts
        ConnectDB{Hyperdrive\navailable?}
        ConnectDB -->|Yes| HyperdriveDB[Connect via Hyperdrive]
        ConnectDB -->|No| CheckLocal{PG_HOST +\nBETTER_AUTH_SECRET?}
        CheckLocal -->|Yes| DirectDB[Connect via pg.Pool]
        CheckLocal -->|No| NoAuth[No auth — locals.user = null]

        HyperdriveDB --> CreateAuth[createAuth with db, secret, baseURL]
        DirectDB --> CreateAuth

        CreateAuth --> GetSession[auth.api.getSession]
        GetSession -->|Valid| PopulateLocals[locals.user = user\nlocals.session = session]
        GetSession -->|Invalid/None| NullLocals[locals.user = null\nlocals.session = null]
    end

    PopulateLocals --> Continue([Continue to route handler])
    NullLocals --> Continue
    NoAuth --> Continue
```

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

### Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active: OTP verified → session created
    Active --> Cached: Cookie cache (5 min)
    Cached --> Active: Cache expired → DB lookup
    Active --> Refreshed: 24h elapsed → new token
    Refreshed --> Active
    Active --> Expired: 7 days elapsed
    Active --> Revoked: User signs out / remote revoke
    Expired --> [*]
    Revoked --> [*]
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

## 6. API Key Authentication (Agents)

### Agent Creation

```mermaid
sequenceDiagram
    participant O as Owner/Lead
    participant S as POST /api/agents
    participant DB as Database
    participant BA as Better Auth

    O->>S: POST { name: "claude:backend" }
    Note over S: Verify session + role ∈ {owner, lead}

    S->>DB: BEGIN transaction
    S->>DB: INSERT user<br/>email: agent-{random}@agent.invalid<br/>emailVerified: true
    S->>DB: INSERT account<br/>providerId: 'agent'
    S->>DB: INSERT member<br/>role: 'agent', orgId: activeOrg
    S->>BA: Create API key (prefix: mtl)
    BA-->>S: Full key (mtl_...)
    S->>DB: COMMIT
    S-->>O: { key: "mtl_..." }<br/>shown once, never retrievable
```

### Agent Authentication (WebSocket)

```mermaid
flowchart TD
    Agent([Agent connects]) --> CheckKey{x-api-key\nheader present?}
    CheckKey -->|No| CheckSession{Session cookie?}
    CheckSession -->|No| Reject401[401 Unauthorized]
    CheckSession -->|Yes| HumanAuth[Session-based auth\nnormal user flow]

    CheckKey -->|Yes| VerifyKey[auth.api.verifyApiKey]
    VerifyKey -->|Invalid| Reject401
    VerifyKey -->|Valid| QueryMember[Query DB: user + member\nverify role = 'agent']
    QueryMember -->|Not agent| Reject403[403 Forbidden]
    QueryMember -->|Valid agent| SignIdentity

    subgraph SignIdentity [HMAC Identity Signing]
        Payload["payload = { userId, role: 'agent',\nuserName, orgId, timestamp }"]
        Payload --> HMAC[HMAC-SHA256 with\nBETTER_AUTH_SECRET]
        HMAC --> Headers[Set X-Identity + X-Identity-Sig]
    end

    SignIdentity --> ForwardDO[Forward to Durable Object\nwith signed headers]
    HumanAuth --> ForwardDO
```

### Agent Authentication (MCP)

`src/lib/server/mcp/auth.ts`:

1. Extract `x-api-key` header
2. Verify via Better Auth API Key plugin
3. Optional KV revocation check (`revoked:{keyId}`)
4. Query DB for agent membership
5. Return `AgentContext { agentUserId, agentName, orgId, orgRole }`

---

## 7. Rate Limiting & Abuse Prevention

### Defense Layers

```mermaid
flowchart TD
    Request([OTP Send Request]) --> L1

    subgraph L1 [Layer 1: Turnstile]
        Turnstile{CAPTCHA\nvalid?}
    end
    L1 -->|Failed| Block400[400: CAPTCHA failed]
    L1 -->|Passed| L2

    subgraph L2 [Layer 2: Disposable Email]
        DisposableCheck{Known disposable\ndomain?}
    end
    L2 -->|Yes| Silent200a[Silent 200 OK]
    L2 -->|No| L3

    subgraph L3 [Layer 3: IP Rate Limit]
        IPCheck{"otp-ip:{ip}\n> 10 / hour?"}
    end
    L3 -->|Exceeded| Silent200b[Silent 200 OK]
    L3 -->|OK| L4

    subgraph L4 [Layer 4: Email Rate Limit]
        EmailCheck{"otp-email:{email}\n> 3 / 15min?"}
    end
    L4 -->|Exceeded| Silent200c[Silent 200 OK]
    L4 -->|OK| L5

    subgraph L5 [Layer 5: Global Rate Limit]
        GlobalCheck{"otp-global\n> 100 / min?"}
    end
    L5 -->|Exceeded| Silent200d[Silent 200 OK]
    L5 -->|OK| Forward[Forward to Better Auth\n→ Generate & send OTP]
```

### OTP Send Rate Limits

Applied in `hooks.server.ts` before Better Auth processes the request:

| Limit | Key | Max | Window | Response |
|-------|-----|-----|--------|----------|
| Per-IP | `otp-ip:{ip}` | 10 | 1 hour | Silent 200 OK |
| Per-email | `otp-email:{email}` | 3 | 15 min | Silent 200 OK |
| Global | `otp-global` | 100 | 1 min | Silent 200 OK |

All blocked requests return `200 OK` to prevent enumeration.

### OTP Verify Rate Limits

```mermaid
flowchart TD
    Verify([OTP Verify Request]) --> CheckLockout{lockout:email\nin KV?}
    CheckLockout -->|Yes| Locked[429: Too many attempts\nfail-fast, no counter increment]
    CheckLockout -->|No| CheckVerifyRate{"otp-verify:{email}\n> 5 / 15min?"}
    CheckVerifyRate -->|Exceeded| SetLockout[Set lockout:email\nTTL: 15 min] --> Locked
    CheckVerifyRate -->|OK| Forward[Forward to Better Auth]
    Forward --> BACheck{OTP\ncorrect?}
    BACheck -->|Yes| Success[Create session]
    BACheck -->|No| Increment[Increment attempt count\nin verification record]
```

| Limit | Key | Max | Window | Response |
|-------|-----|-----|--------|----------|
| Per-email | `otp-verify:{email}` | 5 | 15 min | 429 + error message |
| Lockout | `lockout:{email}` | — | 15 min TTL | 429 "Too many attempts" |

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

## 8. Terms Re-acceptance

```mermaid
flowchart TD
    Request([Authenticated page request]) --> SkipCheck{Path is /api/*\nor /login\nor /legal/*\nor /accept-terms\nor /accept-invitation?}

    SkipCheck -->|Yes| Continue([Continue to route])
    SkipCheck -->|No| FetchTerms[Fetch latest version of\ntos, privacy, aup]

    FetchTerms --> AnyExist{Any terms\nversions exist?}
    AnyExist -->|No| Continue
    AnyExist -->|Yes| CheckAcceptance[Check user's acceptances\nfor each latest version]

    CheckAcceptance --> AllAccepted{All required\ntypes accepted?}
    AllAccepted -->|Yes| Continue
    AllAccepted -->|No| Redirect([302 → /accept-terms])

    FetchTerms -->|Error| FailOpen[Log error\nfail-open → continue]
    FailOpen --> Continue
```

`hooks.server.ts:128-192` — runs on every authenticated page request.

1. Fetch latest version of each required type: `tos`, `privacy`, `aup`
2. Check if user has accepted each latest version in `termsAcceptances`
3. If any acceptance missing → `302` redirect to `/accept-terms`
4. Fail-open on errors (don't block user if check fails)

---

## 9. Security Audit & Known Issues

### Known Issues & Root Causes

#### twoFactorEnabled Column (Fixed 2026-03-02)

**Symptom**: New user sign-up via OTP fails with 500 error.

**Root cause**: The `twoFactor` plugin adds `twoFactorEnabled: boolean` to the user model. When Better Auth creates a new user, it includes `twoFactorEnabled: false` in the INSERT. If the Drizzle schema doesn't define this column, the adapter throws:

```
BetterAuthError: The field "twoFactorEnabled" does not exist in the "user" Drizzle schema
```

**Fix**: Added `twoFactorEnabled: boolean('twoFactorEnabled').default(false)` to user table in `auth-schema.ts` and ran `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN DEFAULT FALSE` on production.

**Prevention**: After adding any Better Auth plugin, run `npx @better-auth/cli generate` to check for required schema changes.

#### Turnstile Site Key Missing from Vars (Fixed 2026-03-03)

**Symptom**: OTP send returns 400 "CAPTCHA verification required" on production.

**Root cause**: `TURNSTILE_SITE_KEY` was stored only as a Cloudflare secret (encrypted, server-only). The login page SSR couldn't access it, so the Turnstile widget never rendered. No `x-captcha-response` header was sent.

**Fix**: Added `TURNSTILE_SITE_KEY` to `wrangler.toml` `[vars]` (public vars accessible during SSR). Kept `TURNSTILE_SECRET_KEY` as a Cloudflare secret.

#### Invited User Lands in Wrong Room (Fixed 2026-03-03)

**Symptom**: User accepts invitation but lands in auto-created personal room instead of invited room.

**Root cause**: The `accept` action called `acceptInvitation()` (which creates the member record) but did not set `activeOrganizationId` on the session. When redirected to `/chat`, room resolution fell through to the first membership or auto-created room.

**Fix**: After `acceptInvitation()`, query the invitation's `organizationId` and update `session.activeOrganizationId` before redirecting. Applied to all three redirect paths in `accept-invitation/[id]/+page.server.ts`.

#### Hyperdrive SELECT Caching

**Observation**: INSERT via Hyperdrive succeeds (RETURNING returns data, record confirmed via direct psql), but SELECT in the same request returns 0 rows.

**Impact**: None for auth flows — OTP SEND and VERIFY are always separate HTTP requests, so the verification record is visible by the time VERIFY runs.

### Design vs Implementation Gaps

| 003-Auth.md Design | Current Implementation | Status |
|---|---|---|
| 2FA mandatory for room owners | Owners without 2FA redirected to settings (`5fe412d`) | **Fixed** 2026-03-03 |
| Passkey plugin | Not yet added (pending plugin availability) | **Gap** — P1 |
| 72-hour email undo | Email change flow not implemented | **Gap** — P1 |
| Lost-email recovery | Not implemented | **Gap** — P2 |
| Account audit logging | Login events logged via hooks (`295ea35`) | **Fixed** 2026-03-03 |
| Username history table | Schema exists, not populated on change | **Gap** — P2 |
| Invitation purge (7 days) | Cron purges expired invitations (`b5340b2`) | **Fixed** 2026-03-03 |
| Session cleanup cron | Cron trigger configured but cleanup logic TBD | **Gap** — P2 |
| Age gate stores `ageVerifiedAt` | Server-side age verification endpoint (`3599a84`) | **Fixed** 2026-03-03 |

### Identified Security Considerations

> **All items below were fixed on 2026-03-03.** See `docs/plans/2026-03-03-security-remediation.md` for details.

#### Critical — Fixed

| Item | Fix | Commit |
|------|-----|--------|
| Invitation decline has no auth check | Added email ownership verification before decline | `5b1909c` |
| Magic link GET leaks email in URL | Removed email from redirect URL | `1e299db` |

#### High — Fixed

| Item | Fix | Commit |
|------|-----|--------|
| Resend OTP bypasses Turnstile | Require Turnstile token for OTP resend, re-render widget | `8e5b998` |
| Report endpoint no membership check | Verify membership before accepting report | `082040c` |
| Inviter email leaked in template | Fall back to "A Martol user" instead of email | `1ef7c98` |
| Dev fallback exposes raw OTP | Block raw OTP in URL for production without KV | `688ffc5` |

#### Medium — Fixed

| Item | Fix | Commit |
|------|-----|--------|
| Chat auto-accept bypasses Better Auth | Use `acceptInvitation` API instead of raw INSERT | `ddab0ef` |
| Magic link POST no rate limit | Add IP-based rate limit (10/15min) to POST | `d3b82b5` |
| Agent auth non-deterministic room | Add `orderBy(createdAt)` for deterministic binding | `b977098` |
| `/whois` exposes user IDs | Restrict to owner/lead, remove user ID from response | `2e9567c` |
| No invitation rate limit | Add per-user rate limit (20/hr) for invitations | `08a82f1` |

#### Low — Fixed

| Item | Fix | Commit |
|------|-----|--------|
| Invitation list visible to all | Filter: owners see all, others see own invitations | `6e29197` |
| Missing reserved usernames | Expanded reserved words list (+14 entries) | `fec9486` |
| Age gate client-side only | Server-side age verification endpoint | `3599a84` |
| Upload trusts client content-type | Magic byte validation for JPEG/PNG/GIF/WebP/PDF | `60eecf1` |
| Room auto-creation race | Advisory lock prevents duplicate rooms | `2bf119d` |

---

## 10. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `BETTER_AUTH_SECRET` | Yes | Session encryption + HMAC signing (min 32 chars) |
| `RESEND_API_KEY` | Production | Email delivery via Resend |
| `EMAIL_FROM` | No | Sender address (default: `noreply@martol.app`) |
| `EMAIL_NAME` | No | Sender name (default: `Martol`) |
| `APP_BASE_URL` | No | Base URL for callbacks (default: `http://localhost:5190`) |
| `TURNSTILE_SITE_KEY` | Production | Cloudflare Turnstile public key (in wrangler.toml `[vars]`) |
| `TURNSTILE_SECRET_KEY` | Production | Cloudflare Turnstile secret (Cloudflare secret) |
| `CACHE` | Production | Cloudflare KV binding (rate limits, magic tokens, sessions) |
| `HYPERDRIVE` | Production | Cloudflare Hyperdrive binding (PostgreSQL) |
| `PG_HOST` | Local dev | Direct PostgreSQL host |

---

## 11. File Reference

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
| `src/routes/chat/+page.server.ts` | Room resolution, auto-creation, data loading |
| `src/routes/api/agents/+server.ts` | Agent CRUD + API key generation |
| `src/routes/api/account/sessions/+server.ts` | Session listing + revocation |
| `src/routes/api/rooms/[roomId]/ws/+server.ts` | WebSocket upgrade with session/API key auth |
| `src/routes/accept-terms/` | Terms re-acceptance page |
| `src/routes/api/terms/+server.ts` | Terms acceptance recording |
