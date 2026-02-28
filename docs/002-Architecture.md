# 002 — Architecture

> As-built architecture documentation for **martol** — the multi-user AI collaboration workspace.
>
> This document describes what is **currently implemented and deployed**, not aspirational features. See `001-Features.md` for the full roadmap.

---

## System Overview

```
                          ┌─────────────────────────────────────────────┐
                          │         Cloudflare Workers (martol)         │
                          │                                             │
  Browser ──HTTPS──►      │  SvelteKit (adapter-cloudflare)             │
                          │    ├── /login          Email OTP login      │
                          │    ├── /chat           Chat placeholder     │
                          │    ├── /api/auth/*     Better Auth handler  │
                          │    └── hooks.server.ts Per-request auth+DB  │
                          │                                             │
  (future)                │  Durable Object: ChatRoom (stub)            │
  Agent ──API key──►      │    └── WebSocket hub (not yet implemented)  │
                          │                                             │
                          ├─────────────────────────────────────────────┤
                          │  Bindings:                                  │
                          │    HYPERDRIVE ──► Aiven PostgreSQL          │
                          │    CACHE (KV)    Session cache              │
                          │    STORAGE (R2)  File storage               │
                          │    CHAT_ROOM     Durable Object namespace   │
                          └─────────────────────────────────────────────┘
```

**Domain:** `martol.plitix.com` (Cloudflare route on zone `plitix.com`)

---

## Tech Stack (Implemented)

| Layer | Technology | Status |
|---|---|---|
| Framework | SvelteKit + `adapter-cloudflare` | Deployed |
| UI | Svelte 5 (runes only) | Login page implemented |
| Auth | Better Auth (`emailOTP` + `organization` + `apiKey`) | Working |
| Database | Aiven PostgreSQL via Cloudflare Hyperdrive | Connected |
| ORM | Drizzle (PostgreSQL adapter) | Schema migrated |
| Session cache | Cloudflare KV (`CACHE` binding) | Connected |
| File storage | Cloudflare R2 (`STORAGE` binding) | Bound, not yet used |
| Real-time | Durable Object (`ChatRoom` class) | Stub only |
| CSS | Tailwind v4 + CSS custom properties | Working |
| Email | Resend API | Working (OTP delivery) |
| Native | Capacitor 8 (dual adapter) | Scaffolded |
| i18n | Paraglide (`@inlang/paraglide-js`) | Configured, not yet used |

---

## Worker Entry Point

The Cloudflare Worker uses a single entry file (`worker-entry.ts`) that re-exports both the SvelteKit handler and Durable Object classes:

```
worker-entry.ts
  ├── export default  ← SvelteKit HTTP handler (.svelte-kit/cloudflare/_worker.js)
  └── export ChatRoom ← Durable Object class (src/lib/server/chat-room.ts)
```

Wrangler config (`wrangler.toml`) points `main` to this file. The compatibility flags `nodejs_compat_v2` and `nodejs_als` enable Node.js APIs required by `pg` and Better Auth.

---

## Request Lifecycle

Every HTTP request flows through `hooks.server.ts`:

```
Request
  │
  ├── CORS check (OPTIONS preflight for Capacitor/localhost origins)
  │
  ├── Detect environment:
  │     ├── Cloudflare Workers (has platform.env.HYPERDRIVE)
  │     │     └── createHyperdriveDb() → Drizzle instance
  │     └── Local dev (has process.env.PG_HOST)
  │           └── createDirectDb() → pg.Pool → Drizzle instance
  │
  ├── Create Better Auth instance (per-request, not module-level)
  │     └── Plugins: emailOTP, organization, apiKey
  │
  ├── Validate session from request cookies
  │     └── Populate event.locals.{user, session, db, auth}
  │
  ├── Resolve route (SvelteKit)
  │
  └── Add security headers to response:
        ├── X-Content-Type-Options: nosniff
        ├── X-Frame-Options: DENY
        ├── Referrer-Policy: strict-origin-when-cross-origin
        ├── Permissions-Policy (camera, mic, geo disabled)
        └── Content-Security-Policy
```

### Why Per-Request Auth

Cloudflare Workers don't have persistent module-level state across requests. The auth instance depends on request-scoped values (DB connection via Hyperdrive, env secrets). Creating it per-request is both correct and required.

---

## Database Architecture

### Connection Topology

```
Production:
  pg.Client ──(ssl:false)──► Hyperdrive proxy ──(TLS)──► Aiven PostgreSQL

Wrangler dev (cf:dev):
  pg.Client ──(ssl:false)──► Hyperdrive local proxy
       ──(plaintext)──► pg-tls-proxy.mjs (localhost:5434)
       ──(STARTTLS)──► Aiven PostgreSQL

Local dev (pnpm dev):
  pg.Pool ──(TLS, rejectUnauthorized:false)──► Aiven PostgreSQL
```

**Key insight:** In production, Hyperdrive handles TLS termination, so the pg client connects with `ssl: false`. In wrangler dev, miniflare's `cloudflare:sockets` cannot do STARTTLS, so a local Node.js proxy (`scripts/pg-tls-proxy.mjs`) performs the PostgreSQL STARTTLS handshake and bridges plaintext TCP to Aiven over TLS.

### Schema

Two schema files feed Drizzle:

| File | Tables | Managed by |
|---|---|---|
| `src/lib/server/db/auth-schema.ts` | `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `apikey` | Better Auth |
| `src/lib/server/db/schema.ts` | `messages`, `attachments`, `todos`, `agent_room_bindings`, `agent_cursors`, `read_cursors`, `pending_actions`, `role_audit` | Application |

**Migrated tables (8):** All Better Auth tables are created via `drizzle/0001_spooky_spot.sql`. Application tables are defined in Drizzle schema but not yet migrated (no data flows yet).

### ID Strategy

| Table group | ID type | Rationale |
|---|---|---|
| Better Auth tables | `TEXT` (nanoid) | Framework convention |
| Application tables | `BIGSERIAL` | Insert-ordered, no B-tree page splits |
| FK references to users/orgs | `TEXT` | Matches Better Auth IDs |

### Connection Modules

| Module | Used when | Connection type |
|---|---|---|
| `db/hyperdrive.ts` | `platform.env.HYPERDRIVE` exists | `pg.Client` per-request, `ssl: false` |
| `db/direct.ts` | Local dev (`process.env.PG_HOST`) | `pg.Pool` cached at module level, `ssl: { rejectUnauthorized: false }` |

---

## Authentication

### Better Auth Configuration

```
Plugins:
  ├── emailOTP     — Passwordless 6-digit code + magic link
  ├── organization — Rooms modeled as organizations (membership, roles)
  └── apiKey       — Agent authentication (future)

Session:
  ├── Expires: 7 days
  ├── Refresh: every 24 hours
  ├── Cookie cache: 30 minutes (compact strategy)
  └── Cookie prefix: "martol"

Trusted origins:
  ├── localhost:5190
  ├── capacitor://martol.app
  └── https://martol.app
```

### Login Flow

```
User enters email → POST /api/auth/email-otp/send-verification-otp
  │
  ├── Better Auth generates 6-digit OTP (15min expiry)
  ├── Resend API sends email with:
  │     ├── Magic link: /api/auth/verify-otp?email=...&code=...
  │     └── 6-digit code in large monospace font
  │
  └── User completes sign-in via either:
        ├── Click magic link → auto-verify → redirect to /chat
        └── Type code → POST /api/auth/sign-in/email-otp → redirect to /chat
```

### Client Auth

`src/lib/auth-client.ts` exports a Svelte-flavored Better Auth client:

```typescript
createAuthClient({
  plugins: [emailOTPClient(), organizationClient()]
})
// Exports: signIn, signOut, useSession, emailOtp
```

### Secondary Storage (KV)

When available, Cloudflare KV (`CACHE` binding) serves as Better Auth's `secondaryStorage` for session data. The KV adapter wraps `get`/`put`/`delete` with TTL support.

---

## Cloudflare Bindings

| Binding | Type | ID/Name | Usage |
|---|---|---|---|
| `HYPERDRIVE` | Hyperdrive Config | `14081dac30c2` | PostgreSQL connection pooling |
| `CACHE` | KV Namespace | `3f35237a9470` | Better Auth session cache |
| `STORAGE` | R2 Bucket | `opensesame` | File uploads (future) |
| `CHAT_ROOM` | Durable Object | `ChatRoom` class | Per-room WebSocket hub (stub) |
| `ASSETS` | Static Assets | auto | SvelteKit static files |
| `CF_VERSION_METADATA` | Version Metadata | auto | Sentry release tracking |

### Environment Variables (via `.dev.vars` / Workers secrets)

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | Session encryption (min 32 chars) |
| `APP_BASE_URL` | `https://martol.plitix.com` |
| `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` | Aiven PostgreSQL credentials |
| `RESEND_API_KEY` | Transactional email delivery |
| `EMAIL_FROM`, `EMAIL_NAME` | Sender address and display name |
| `R2_*` vars | R2 access credentials |
| `KV_ID`, `KV_NAME` | KV namespace identifiers |
| `CLOUDFLARE_HYPERDRIVE_*` | Hyperdrive connection string |

---

## Route Structure

```
src/routes/
  ├── +layout.server.ts       Root layout server load
  ├── +layout.svelte           Root layout (CSS variables, dark theme)
  ├── +page.server.ts          Root page → redirects to /login or /chat
  ├── +page.svelte             Root page
  ├── api/
  │   └── auth/
  │       └── [...auth]/
  │           └── +server.ts   Better Auth catch-all handler
  ├── chat/
  │   └── +page.svelte         Chat page (placeholder)
  └── login/
      └── +page.svelte         Email OTP login (fully implemented)
```

### Auth Route Handler

The `[...auth]/+server.ts` route delegates all `/api/auth/*` requests to Better Auth's handler. This covers:
- `POST /api/auth/email-otp/send-verification-otp`
- `POST /api/auth/sign-in/email-otp`
- `GET /api/auth/get-session`
- `GET /api/auth/ok` (health check)
- All other Better Auth endpoints (organization, apiKey, etc.)

---

## Local Development

### `pnpm dev` (Vite dev server)

Standard SvelteKit dev server. Connects directly to Aiven PostgreSQL via `pg.Pool` with TLS. No Cloudflare bindings available — no KV, R2, Hyperdrive, or Durable Objects.

### `pnpm cf:dev` (Wrangler dev)

Full Cloudflare Workers emulation with all bindings. Requires the STARTTLS proxy:

```
pnpm cf:dev  →  runs:
  1. node scripts/pg-tls-proxy.mjs &    (background: localhost:5434)
  2. source .dev.vars                    (load env)
  3. wrangler dev --port 8788            (miniflare with Hyperdrive)
```

**Why the proxy exists:** Miniflare's `cloudflare:sockets` implementation cannot perform PostgreSQL STARTTLS handshakes to external databases. The proxy accepts plaintext TCP from the Hyperdrive local proxy, performs the PostgreSQL SSLRequest protocol (`0x00000008 04D2162F` → `S` → TLS upgrade), and bridges the encrypted tunnel.

### Database Commands

```bash
pnpm db:generate   # Generate Drizzle migration SQL
pnpm db:migrate    # Apply migrations (NODE_TLS_REJECT_UNAUTHORIZED=0)
pnpm db:push       # Push schema directly (dev only)
pnpm db:studio     # Drizzle Studio GUI
```

`drizzle.config.ts` loads env from `.dev.vars` (not `.env`) and includes both schema files. The `db:migrate` command requires `NODE_TLS_REJECT_UNAUTHORIZED=0` because Aiven's SSL certificate chain is not trusted by default in Node.js.

---

## Dual Adapter (Cloudflare + Capacitor)

```javascript
// svelte.config.js
const isCapacitor = process.env.CAPACITOR === 'true';

adapter: isCapacitor
  ? adapterStatic({ fallback: 'index.html' })  // SPA for native
  : adapterCloudflare({ ... })                  // SSR for web
```

| Mode | Build command | Adapter | Output |
|---|---|---|---|
| Web | `pnpm build` | `adapter-cloudflare` | `.svelte-kit/cloudflare/` |
| Native | `pnpm cap:build` | `adapter-static` | `build/` (SPA) |

Capacitor config (`capacitor.config.ts`): `appId: 'app.martol'`, hostname `martol.app` for first-party cookies.

---

## Security Headers

Applied to every response in `hooks.server.ts`:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation disabled |
| `Content-Security-Policy` | `default-src 'self'`; scripts/styles `'unsafe-inline'`; connect `wss:`; frames `'none'` |

CORS is restricted to explicit origins: `localhost:5190`, Capacitor scheme, and `martol.app`.

---

## Observability

Configured in `wrangler.toml`:

| Feature | Status |
|---|---|
| Worker logs | Enabled (100% sampling, persisted) |
| Invocation logs | Enabled |
| Traces | Disabled (can be enabled per-need) |
| Smart placement | Enabled (auto-selects nearest region) |
| Version metadata | Bound for Sentry release tracking |

---

## What's Not Yet Implemented

These are defined in schema/config but have no runtime code yet:

| Component | Current state | Blocked by |
|---|---|---|
| ChatRoom Durable Object | Stub (returns 501) | Chat UI development |
| WebSocket real-time | Not started | ChatRoom implementation |
| Application tables migration | Schema defined, not migrated | No data flows yet |
| MCP `/mcp/v1` endpoint | Not started | Agent integration |
| Action gating (pending_actions) | Schema defined | MCP + ChatRoom |
| R2 file uploads | Binding exists | Upload API route |
| Agent API key auth | Plugin configured | Agent wrapper |
| Paraglide i18n | Configured | UI string extraction |
| Capacitor native build | Scaffolded | Feature parity |

---

## File Map

```
martol/
├── worker-entry.ts                    Cloudflare Worker entry (re-exports)
├── wrangler.toml                      Cloudflare config (bindings, routes)
├── svelte.config.js                   Dual adapter (Cloudflare / Capacitor)
├── drizzle.config.ts                  Drizzle ORM config (.dev.vars, both schemas)
├── scripts/
│   └── pg-tls-proxy.mjs              Local STARTTLS proxy for wrangler dev
├── drizzle/
│   └── 0001_spooky_spot.sql          Initial migration (Better Auth tables)
├── src/
│   ├── app.d.ts                       TypeScript: CloudflareEnv, App.Locals
│   ├── hooks.server.ts                Per-request auth, DB, CORS, security headers
│   ├── lib/
│   │   ├── auth-client.ts             Client-side Better Auth (Svelte)
│   │   └── server/
│   │       ├── auth/
│   │       │   └── index.ts           Better Auth config (emailOTP, org, apiKey)
│   │       ├── db/
│   │       │   ├── auth-schema.ts     Better Auth tables (Drizzle)
│   │       │   ├── schema.ts          Application tables (Drizzle)
│   │       │   ├── hyperdrive.ts      Hyperdrive connection (production/cf:dev)
│   │       │   └── direct.ts          Direct pg.Pool (local dev)
│   │       ├── email.ts               Resend API + OTP email template
│   │       └── chat-room.ts           ChatRoom Durable Object (stub)
│   └── routes/
│       ├── +layout.server.ts          Root layout data
│       ├── +layout.svelte             Root layout (dark theme, CSS vars)
│       ├── +page.server.ts            Root redirect logic
│       ├── api/auth/[...auth]/        Better Auth catch-all
│       ├── chat/+page.svelte          Chat placeholder
│       └── login/+page.svelte         Email OTP login (implemented)
└── .dev.vars                          Environment variables (not committed)
```
