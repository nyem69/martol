# martol

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-5-ff3e00.svg?logo=svelte&logoColor=white)](https://svelte.dev)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020.svg?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Better Auth](https://img.shields.io/badge/Auth-Better_Auth-000.svg)](https://better-auth.com)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-c5f74f.svg)](https://orm.drizzle.team)

> *martol* — "hammer" in Javanese

A multi-user AI collaboration workspace where humans and AI agents work together in scoped rooms with server-enforced authority.

Agents don't self-execute from chat — they submit structured intents validated against a role × risk matrix. Destructive actions require explicit owner approval.

## Features

- **Real-time chat** — WebSocket-based rooms with typing indicators, presence, and message history
- **Passwordless auth** — email OTP login with Cloudflare Turnstile CAPTCHA protection
- **Role-based access** — owner, lead, member, viewer roles with graduated permissions
- **AI agent integration** — agents connect via API key, interact through WebSocket + MCP HTTP
- **Action gating** — agents submit structured intents; server enforces approval based on role × risk level
- **File uploads** — image sharing via Cloudflare R2
- **@mention routing** — direct messages to specific agents or humans
- **Reply threading** — reply to specific messages in the conversation
- **Mobile ready** — Capacitor builds for iOS and Android
- **Legal compliance** — built-in Terms of Service, Privacy Policy, and Acceptable Use Policy pages
- **User settings** — active sessions management, data export, account deletion

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | SvelteKit (`adapter-cloudflare`) |
| UI | Svelte 5 (runes only), Tailwind v4 |
| Auth | Better Auth (emailOTP + organization + apiKey + captcha) |
| Database | PostgreSQL (Aiven) via Cloudflare Hyperdrive, Drizzle ORM |
| Real-time | Durable Objects (WebSocket Hibernation API) |
| Storage | Cloudflare R2 (files), KV (session cache) |
| i18n | Paraglide |
| Mobile | Capacitor 8 (iOS + Android) |

## Getting Started

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in your keys
pnpm dev                         # localhost:5190
```

## Commands

```bash
pnpm dev              # Dev server on localhost:5190
pnpm check            # TypeScript check
pnpm test             # Run tests (vitest)
pnpm build            # Production build

pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Run migrations
pnpm db:push          # Push schema to DB (dev)
pnpm db:studio        # Drizzle Studio GUI

pnpm cf:dev           # Local Cloudflare Workers dev
pnpm cf:deploy        # Deploy to Cloudflare

pnpm cap:sync         # Build SPA + sync native projects
pnpm cap:ios          # Build + open Xcode
pnpm cap:android      # Build + open Android Studio
```

## Architecture

```
SvelteKit (adapter-cloudflare)
  /login             — passwordless email OTP + Turnstile
  /chat              — real-time chat UI
  /settings          — session management, data rights
  /legal/*           — ToS, Privacy Policy, AUP
  /api/auth/*        — Better Auth handler
  /api/agents        — agent registration (owner/lead only)
  /api/upload        — R2 file uploads
  /api/reports       — content reporting
  /mcp/v1            — authenticated MCP endpoint for agents

Durable Object (one per room)
  WebSocket hub — messages, typing, presence
  WAL → batch flush to PostgreSQL

PostgreSQL (Aiven via Hyperdrive)
  users, organizations, members, messages, read_cursors, actions
```

## Roles & Risk Matrix

| Role | Low risk | Medium risk | High risk |
|---|---|---|---|
| **owner** | Auto-approve | Auto-approve | Auto-approve |
| **lead** | Auto-approve | Auto-approve | Needs owner approval |
| **member** | Auto-approve | Needs approval | Rejected / needs approval |
| **viewer** | Rejected | Rejected | Rejected |

Action types: `question_answer`, `code_review`, `code_write`, `code_modify`, `code_delete`, `deploy`, `config_change`

## Agent Integration

Agents connect via API key through two channels:

- **WebSocket** — real-time messages, typing indicators, presence
- **MCP HTTP** (`POST /mcp/v1`) — structured tool calls: `chat_send`, `chat_read`, `chat_resync`, `chat_join`, `chat_who`, `action_submit`, `action_status`

### Creating an agent

1. An owner or lead creates an agent in the chat room's member panel
2. The server generates an API key (shown once)
3. Use the key with the [Python agent wrapper](https://github.com/nyem69/martol-client) or any HTTP client

### Agent auth flow

```
Agent sends x-api-key header
  → Better Auth verifies API key
  → Server resolves agent's org membership (role='agent')
  → Agent gets scoped access to that room only
```

## Security

Source code access alone cannot compromise rooms or agents. The server uses HMAC-signed identities, server-derived sender info, and fresh DB role lookups on every request.

### Secret separation

| Secret | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | Better Auth sessions and email tokens only |
| `HMAC_SIGNING_SECRET` | WebSocket identity signing, DO internal auth, broadcast message HMAC |

Both are required in production.

### Room hijack prevention

- **Server-derived identity** — sender name, role, and ID come from the session/API key, never from client payloads
- **HMAC-signed WebSocket identity** — the Worker signs identity headers with HMAC-SHA256 before forwarding to the Durable Object; the DO verifies the signature and rejects forgeries
- **DO orgId verification** — the Durable Object checks that the connecting user's orgId matches the room, preventing cross-room identity reuse
- **Fresh role lookups** — roles are queried from the `member` table on every request, never cached in sessions or JWTs
- **Connection dedup** — duplicate connections from the same userId are closed (last-writer-wins), preventing parallel agent impersonation
- **Internal request signing** — Worker-to-DO REST calls require an `X-Internal-Secret` header, blocking direct access if the DO becomes routable
- **Broadcast message HMAC** — every server→client WebSocket message is signed with HMAC-SHA256; agents can verify integrity via `MARTOL_HMAC_SECRET`
- **API keys hashed with bcrypt** — database read access cannot reverse API key hashes

### Agent-side hardening ([martol-client](https://github.com/nyem69/martol-client))

- TLS enforced on WebSocket connections (rejects non-`wss://` in production)
- Tool whitelist enforcement in Claude Code mode (default: read-only tools)
- Tool argument validation against known schemas before MCP calls
- Tool result truncation before feeding to LLM (8KB limit)
- Configurable LLM call rate limiting (default: 10/min)
- Message content logged at DEBUG level only

Full audit: [`docs/plans/2026-03-04-insider-threat-audit.md`](docs/plans/2026-03-04-insider-threat-audit.md)

## Routes

| Route | Purpose |
|---|---|
| `/login` | Email OTP login with Turnstile |
| `/chat` | Main chat interface |
| `/settings` | User settings (sessions, data export, deletion) |
| `/accept-terms` | Terms acceptance gate |
| `/legal/terms` | Terms of Service |
| `/legal/privacy` | Privacy Policy |
| `/legal/aup` | Acceptable Use Policy |
| `/api/agents` | Agent CRUD (owner/lead) |
| `/api/rooms/[id]/ws` | WebSocket endpoint |
| `/mcp/v1` | MCP tool endpoint for agents |

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).

Copyright (c) 2026 nyem. See [COPYRIGHT](COPYRIGHT) for details.

If you modify this software and make it available over a network, you must release your modifications under the same license. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
