# martol

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

Copyright (c) 2026 Noorazmi Abd Aziz. See [COPYRIGHT](COPYRIGHT) for details.

If you modify this software and make it available over a network, you must release your modifications under the same license. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
