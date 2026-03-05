# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**martol** ("hammer" in Javanese) is a multi-user AI collaboration workspace. Multiple humans and AI agents collaborate in scoped rooms with server-enforced authority. Agents submit structured intents validated against a role × risk matrix — they never self-execute from raw chat.

Feature plan: `docs/001-Features.md`

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit (`adapter-cloudflare` / `adapter-static` for Capacitor) |
| UI | Svelte 5 components (runes only) |
| i18n | Paraglide (`@inlang/paraglide-js`) |
| Native | Capacitor 8 (iOS + Android) |
| Auth | Better Auth (`emailOTP` + `organization` + `apiKey` plugins) |
| Database | Aiven PostgreSQL via Cloudflare Hyperdrive |
| ORM | Drizzle (PostgreSQL adapter) |
| Real-time | Durable Objects (WebSocket Hibernation API) |
| File storage | Cloudflare R2 |
| Session cache | Cloudflare KV |
| CSS | Tailwind v4 |

## Commands

```bash
# Development
pnpm dev              # Start dev server on localhost:5190
pnpm check            # TypeScript check

# Database
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Run migrations
pnpm db:studio        # Drizzle Studio GUI
# IMPORTANT: Always use db:generate + db:migrate for schema changes. Never use db:push.

# Cloudflare
pnpm cf:dev           # Local Cloudflare Workers dev
pnpm cf:deploy        # Deploy to Cloudflare

# Capacitor (mobile)
pnpm cap:build        # Build static SPA
pnpm cap:sync         # Build + sync native projects
pnpm cap:ios          # Build + sync + open Xcode
pnpm cap:android      # Build + sync + open Android Studio
```

## Architecture

```
SvelteKit (adapter-cloudflare)
  +-- /chat              — single-page chat UI (Svelte 5 components)
  +-- /login             — passwordless email OTP login
  +-- /api/auth/*        — Better Auth handler
  +-- Drizzle → Hyperdrive → Aiven PostgreSQL

Durable Object (per-room instance, same Worker)
  +-- WebSocket: real-time messages, typing, presence
  +-- Transactional storage as WAL (crash-safe buffer)
  +-- Batch flush to DB every 500ms or 10 messages

R2 (file storage)
  +-- Namespaced: {org_id}/{message_id}/{filename}
```

### Key Files

| File | Responsibility |
|---|---|
| `src/hooks.server.ts` | Per-request auth, DB connection, CORS, security headers |
| `src/lib/server/auth/index.ts` | Better Auth config (emailOTP, organization, apiKey) |
| `src/lib/server/db/schema.ts` | Drizzle PostgreSQL schema |
| `src/lib/server/db/hyperdrive.ts` | Hyperdrive connection (production) |
| `src/lib/server/db/direct.ts` | Direct pg.Pool (local dev) |
| `src/lib/server/email.ts` | Resend API email sending |
| `src/lib/server/chat-room.ts` | Durable Object stub |
| `src/lib/auth-client.ts` | Client-side Better Auth |
| `src/routes/login/+page.svelte` | Email OTP login page |
| `src/routes/chat/+page.svelte` | Chat placeholder |

## Coding Patterns

### Svelte 5 Runes Only

- Use `$state()`, `$derived()`, `$effect()`, `$props()`
- Never use `export let`, `$:`, `<slot>`, `createEventDispatcher`, `writable`/`readable`
- Use `{@render children()}` not `<slot />`
- Use `onclick` not `on:click`
- Use `@lucide/svelte` for icons (not `lucide-svelte`)

### Auth

- Auth instance created **per-request** in `hooks.server.ts` (not module-level)
- Sender always server-derived (from session or API key, never from client payload)
- DB connection: Hyperdrive for prod (single client per request), direct pool for dev

### i18n

- All user-facing strings through `import * as m from '$lib/paraglide/messages'`
- Message keys in `messages/en.json`

### Frontend

- `goto()` for navigation (not `window.location.href`)
- `data-testid` on interactive elements
- Zod for validation at system boundaries
- CSS custom properties via `var(--accent)` etc.
- Dark theme only (industrial forge aesthetic)

### Database

- BIGSERIAL for message IDs (not UUIDs)
- TEXT CHECK constraints (not ENUMs)
- `sender_role` denormalized on messages (records authority at write time)
- Soft deletes via `deleted_at` on messages

## Configuration

- `.dev.vars` — Environment variables (not committed)
- `wrangler.toml` — Cloudflare Workers config
- `drizzle.config.ts` — Drizzle ORM config
- `capacitor.config.ts` — Capacitor mobile config
- `project.inlang/settings.json` — Paraglide i18n config
