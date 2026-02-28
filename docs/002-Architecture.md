# 002 — Architecture

> As-built architecture documentation for **martol** — the multi-user AI collaboration workspace.
>
> This document describes what is **currently implemented and deployed**, not aspirational features. See `001-Features.md` for the full roadmap.
>
> Last updated: 2026-02-28

---

## System Overview

```
                          ┌──────────────────────────────────────────────────┐
                          │           Cloudflare Workers (martol)            │
                          │                                                  │
  Browser ──HTTPS──►      │  SvelteKit (adapter-cloudflare)                  │
                          │    ├── /login             Email OTP login        │
                          │    ├── /chat              Real-time chat UI      │
                          │    ├── /api/auth/*        Better Auth handler    │
                          │    ├── /api/messages      Cursor-based history   │
                          │    ├── /api/actions       Action approval queue  │
                          │    ├── /api/upload        R2 image upload        │
                          │    ├── /mcp/v1            Agent MCP endpoint     │
                          │    └── hooks.server.ts    Per-request auth+DB    │
                          │                                                  │
  Agent ──API key──►      │  Durable Object: ChatRoom (per-room instance)    │
                          │    ├── WebSocket hub (Hibernation API)           │
                          │    ├── WAL buffer → batch flush to DB            │
                          │    ├── Presence, typing, read cursors            │
                          │    ├── Slash commands (/approve, /reject, etc.)  │
                          │    └── Server-side action gating                 │
                          │                                                  │
                          │  Cron Trigger (hourly)                           │
                          │    └── Expire pending actions > 24h              │
                          │                                                  │
                          ├──────────────────────────────────────────────────┤
                          │  Bindings:                                       │
                          │    HYPERDRIVE ──► Aiven PostgreSQL               │
                          │    CACHE (KV)    Session cache                   │
                          │    STORAGE (R2)  File storage                    │
                          │    CHAT_ROOM     Durable Object namespace        │
                          └──────────────────────────────────────────────────┘
```

**Domain:** `martol.plitix.com` (Cloudflare route on zone `plitix.com`)

---

## Tech Stack (Implemented)

| Layer | Technology | Status |
|---|---|---|
| Framework | SvelteKit + `adapter-cloudflare` | Deployed |
| UI | Svelte 5 (runes only) | Chat UI, login, components |
| Auth | Better Auth (`emailOTP` + `organization` + `apiKey`) | Working |
| Database | Aiven PostgreSQL via Cloudflare Hyperdrive | Connected, schema migrated |
| ORM | Drizzle (PostgreSQL adapter) | All tables operational |
| Session cache | Cloudflare KV (`CACHE` binding) | Connected |
| File storage | Cloudflare R2 (`STORAGE` binding) | Upload endpoint working |
| Real-time | Durable Object (`ChatRoom` class) | WebSocket hub, WAL, presence |
| MCP | `/mcp/v1` endpoint (7 tools) | Working, API key auth |
| CSS | Tailwind v4 + CSS custom properties | Dark theme |
| Email | Resend API | Working (OTP delivery) |
| Native | Capacitor 8 (dual adapter) | iOS + Android scaffolded |
| i18n | Paraglide (`@inlang/paraglide-js`) | All UI strings localized (en) |
| Scheduled | Cron Trigger (hourly) | Pending action expiry |

---

## Worker Entry Point

The Cloudflare Worker uses a single entry file (`worker-entry.ts`) that combines the SvelteKit handler, Durable Object exports, and the cron trigger:

```
worker-entry.ts
  ├── export default.fetch      ← SvelteKit HTTP handler
  ├── export default.scheduled  ← Cron Trigger (action expiry)
  └── export ChatRoom           ← Durable Object class
```

Wrangler config (`wrangler.toml`) points `main` to this file. The compatibility flags `nodejs_compat_v2` and `nodejs_als` enable Node.js APIs required by `pg` and Better Auth.

**Important:** The `scheduled` handler uses dynamic `import()` for `pg`/drizzle modules to avoid pulling `node:fs` (used by `pg` at module init) into the top-level entry scope where wrangler's bundler cannot resolve it.

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
| `STORAGE` | R2 Bucket | `opensesame` | File uploads |
| `CHAT_ROOM` | Durable Object | `ChatRoom` class | Per-room WebSocket hub |
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
  ├── +layout.server.ts           Root layout server load
  ├── +layout.svelte              Root layout (CSS variables, dark theme)
  ├── +page.server.ts             Root page → redirects to /login or /chat
  ├── +page.svelte                Root page
  ├── api/
  │   ├── auth/
  │   │   └── [...auth]/
  │   │       └── +server.ts     Better Auth catch-all handler
  │   ├── actions/
  │   │   ├── +server.ts          GET pending actions list
  │   │   └── [id]/
  │   │       ├── approve/+server.ts  POST approve action
  │   │       └── reject/+server.ts   POST reject action
  │   ├── messages/
  │   │   └── +server.ts          GET cursor-based message history
  │   ├── rooms/
  │   │   └── [roomId]/
  │   │       └── ws/+server.ts   WebSocket upgrade → Durable Object
  │   └── upload/
  │       └── +server.ts          POST R2 image upload
  ├── chat/
  │   ├── +page.server.ts         Chat page server load (room, user, initial messages)
  │   └── +page.svelte            Chat UI (messages, input, actions, members)
  ├── login/
  │   └── +page.svelte            Email OTP login (i18n)
  └── mcp/
      └── v1/
          └── +server.ts          MCP endpoint (7 tools, API key auth)
```

### Auth Route Handler

The `[...auth]/+server.ts` route delegates all `/api/auth/*` requests to Better Auth's handler. This covers:
- `POST /api/auth/email-otp/send-verification-otp`
- `POST /api/auth/sign-in/email-otp`
- `GET /api/auth/get-session`
- `GET /api/auth/ok` (health check)
- All other Better Auth endpoints (organization, apiKey, etc.)

### Message History API

`GET /api/messages?before=<id>&limit=50` — Cursor-based pagination for loading older messages. Returns chronological order with `has_more` flag. Auth: session-based, any org member.

### Action Approval API

- `GET /api/actions?status=pending` — List pending actions for the user's org
- `POST /api/actions/:id/approve` — Approve a pending action (owner/lead only)
- `POST /api/actions/:id/reject` — Reject a pending action (owner/lead only)

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

## ChatRoom Durable Object

One instance per room (organization). Uses the WebSocket Hibernation API for connection persistence across DO sleep.

### Message Flow

```
Client WebSocket → ChatRoom.webSocketMessage()
  ├── Validate sender (session/API key, not payload)
  ├── Assign serverSeqId (monotonic counter)
  ├── Write to DO transactional storage (WAL: msg:<id> key)
  ├── Broadcast to all connected WebSockets (sub-ms)
  └── Schedule alarm for batch DB flush
```

### WAL + Batch Flush

- Messages buffered in DO transactional storage (`msg:<seqId>` keys)
- Alarm fires every 500ms or when 10 messages accumulate
- Flush: multi-row INSERT into PostgreSQL via Hyperdrive, then delete WAL keys
- Read cursors piggyback on the same flush (or flush independently via 5s alarm)
- Backpressure: WAL capped at 1000 messages / 5 MB; excess returns 503

### Features

- **Presence**: `online`/`offline` events broadcast on connect/disconnect
- **Typing indicators**: Throttled per-user, 4s timeout
- **Read cursors**: Debounced in-memory Map, flushed to `read_cursors` table
- **Slash commands**: `/approve`, `/reject`, `/actions`, `/clear` routed server-side
- **Action gating**: `/approve` and `/reject` validated against role × risk matrix
- **Clear room**: Soft-deletes messages in DB, purges WAL, broadcasts clear event
- **Delta sync**: Client sends `lastKnownId` on reconnect, DO sends missed messages

### `withDb<T>` Helper

Encapsulates the Hyperdrive connection lifecycle (connect → execute → cleanup) for one-shot DB operations outside the main flush path (e.g., action approval, listing actions).

---

## MCP Endpoint (`/mcp/v1`)

Authenticated via `x-api-key` header (Better Auth `apiKey` plugin). 7 tools:

| Tool | Description |
|---|---|
| `chat_send` | Send message (sender derived from API key) |
| `chat_read` | Read new messages since agent cursor |
| `chat_resync` | Full refresh, reset cursor to 0 |
| `chat_join` | Register presence in room |
| `chat_who` | List current room members with roles |
| `action_submit` | Submit structured intent for validation |
| `action_status` | Check status of a pending action |

All tools enforce room scoping via the API key's org binding. Agent identity is always server-derived.

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

Remaining work for MVP completion:

| Component | Current state | Notes |
|---|---|---|
| Integration tests | Missing | Auth flows, WebSocket protocol, MCP tools |
| Message virtualization | Not started | @tanstack/svelte-virtual for long conversations |
| Multi-room / room switching | Not started | Team phase feature |
| Settings panel | Not started | Team phase feature |
| Agent wrapper | Skeleton only | `wrapper.py` needs WebSocket + MCP integration |
| Push notifications | Not started | Capacitor plugin, post-MVP |
| Full-text search | Not started | Team phase feature |

---

## File Map

```
martol/
├── worker-entry.ts                    Cloudflare Worker entry (fetch + scheduled + DO)
├── wrangler.toml                      Cloudflare config (bindings, routes, cron)
├── svelte.config.js                   Dual adapter (Cloudflare / Capacitor)
├── capacitor.config.ts                Capacitor native config (appId, schemes)
├── drizzle.config.ts                  Drizzle ORM config (.dev.vars, both schemas)
├── scripts/
│   └── pg-tls-proxy.mjs              Local STARTTLS proxy for wrangler dev
├── drizzle/
│   └── 0001_spooky_spot.sql          Initial migration (Better Auth tables)
├── messages/
│   └── en.json                        Paraglide i18n strings (English)
├── src/
│   ├── app.d.ts                       TypeScript: CloudflareEnv, App.Locals
│   ├── app.css                        Global CSS (dark theme, markdown prose)
│   ├── hooks.server.ts                Per-request auth, DB, CORS, security headers
│   ├── lib/
│   │   ├── auth-client.ts             Client-side Better Auth (Svelte)
│   │   ├── types/
│   │   │   ├── ws.ts                  WebSocket message types (client ↔ server)
│   │   │   └── chat.ts               Chat types (PendingAction, etc.)
│   │   ├── stores/
│   │   │   ├── websocket.svelte.ts    WebSocket connection (reconnect, backoff)
│   │   │   └── messages.svelte.ts     Messages, typing, presence, system events
│   │   ├── chat/
│   │   │   └── commands.ts            Slash command definitions + parser
│   │   ├── utils/
│   │   │   └── markdown.ts            Marked + DOMPurify renderer
│   │   ├── components/chat/
│   │   │   ├── ConnectionBanner.svelte
│   │   │   ├── ChatHeader.svelte
│   │   │   ├── MessageList.svelte     Scrollable timeline, pull-to-load
│   │   │   ├── MessageBubble.svelte   Message with markdown body
│   │   │   ├── SystemLine.svelte      Join/leave/clear notices
│   │   │   ├── ChatInput.svelte       Textarea, slash commands, mentions
│   │   │   ├── MemberPanel.svelte     Online users sidebar
│   │   │   ├── PendingActionLine.svelte  Approve/reject inline UI
│   │   │   └── ImageModal.svelte      Image preview overlay
│   │   └── server/
│   │       ├── auth/
│   │       │   └── index.ts           Better Auth config (emailOTP, org, apiKey)
│   │       ├── db/
│   │       │   ├── auth-schema.ts     Better Auth tables (Drizzle)
│   │       │   ├── schema.ts          Application tables (8 tables)
│   │       │   ├── hyperdrive.ts      Hyperdrive connection (production/cf:dev)
│   │       │   └── direct.ts          Direct pg.Pool (local dev)
│   │       ├── chat-room.ts           ChatRoom Durable Object (WebSocket, WAL, actions)
│   │       ├── email.ts               Resend API + OTP email template
│   │       └── mcp/
│   │           ├── index.ts           MCP endpoint handler
│   │           ├── auth.ts            API key authentication
│   │           └── tools/             7 MCP tools (chat_send, chat_read, etc.)
│   └── routes/
│       ├── +layout.server.ts          Root layout data
│       ├── +layout.svelte             Root layout (dark theme, CSS vars)
│       ├── +page.server.ts            Root redirect logic
│       ├── api/
│       │   ├── auth/[...auth]/        Better Auth catch-all
│       │   ├── actions/               Action queue (list, approve, reject)
│       │   ├── messages/              Cursor-based message history
│       │   ├── rooms/[roomId]/ws/     WebSocket upgrade → DO
│       │   └── upload/                R2 image upload
│       ├── chat/
│       │   ├── +page.server.ts        Load room, user, initial messages
│       │   └── +page.svelte           Chat UI (stores → components)
│       ├── login/+page.svelte         Email OTP login (i18n)
│       └── mcp/v1/                    MCP endpoint (API key auth)
└── .dev.vars                          Environment variables (not committed)
```
