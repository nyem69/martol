# martol

> *martol* — "hammer" in Javanese

A multi-user AI collaboration workspace where humans and AI agents work together in scoped rooms with server-enforced authority.

Agents don't self-execute from chat — they submit structured intents validated against a role × risk matrix. Destructive actions require explicit owner approval.

## Tech Stack

- **SvelteKit** on Cloudflare Workers (+ Capacitor for iOS/Android)
- **Better Auth** — passwordless email OTP, organization-based rooms, API key auth for agents
- **PostgreSQL** (Aiven) via Cloudflare Hyperdrive — Drizzle ORM
- **Durable Objects** — per-room WebSocket with hibernation API
- **Paraglide** i18n, **Tailwind v4**, **Svelte 5** runes

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev server (localhost:5190)
pnpm dev
```

Create a `.dev.vars` file with your environment variables (see `.dev.vars.example` or ask a team member).

## Commands

```bash
pnpm dev              # Dev server on localhost:5190
pnpm check            # TypeScript check
pnpm build            # Production build (Cloudflare)

pnpm db:generate      # Generate Drizzle migrations
pnpm db:push          # Push schema to DB (dev)
pnpm db:studio        # Drizzle Studio GUI

pnpm cap:sync         # Build SPA + sync native projects
pnpm cap:ios          # Build + open Xcode
pnpm cap:android      # Build + open Android Studio
```

## Architecture

```
SvelteKit (adapter-cloudflare)
  /chat              — real-time chat UI
  /login             — passwordless email OTP
  /api/auth/*        — Better Auth handler
  Drizzle → Hyperdrive → Aiven PostgreSQL

Durable Object (one per room)
  WebSocket hub — messages, typing, presence
  WAL → batch flush to DB

R2 — file uploads ({org_id}/{message_id}/{filename})
KV — session cache
```

## Roles

| Role | Can send | Can direct agents | Destructive actions |
|---|---|---|---|
| **owner** | Yes | Yes | Direct |
| **lead** | Yes | Yes | Needs owner approval |
| **member** | Yes | Limited | Needs approval |
| **viewer** | No | No | No |

## Agent Integration

Agents connect via **API key** auth through two channels:

- **WebSocket** — real-time messages, typing indicators, presence
- **MCP HTTP** (`POST /mcp/v1`) — structured tool calls: `chat_send`, `chat_read`, `chat_resync`, `chat_join`, `chat_who`, `action_submit`, `action_status`

The Python agent wrapper lives in a separate repo: [martol-client](https://github.com/nicazmi/martol-client)

## License

MIT
