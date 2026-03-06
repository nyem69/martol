# 012 — Sysadmin System + Support Tickets

Platform-level admin role, admin dashboard, support ticket system, and MCP ticket tools.

## Admin Role

A `role` column on the `user` table (`'user' | 'admin'`, default `'user'`) controls platform-level access. This is separate from room-level roles (owner/lead/member/viewer/agent).

- Registered as a Better Auth `additionalField` with `input: false` — included in session automatically, no extra DB query, not settable by clients.
- `event.locals.isAdmin` derived in `hooks.server.ts` from `user.role === 'admin'`.
- Seed admin: `UPDATE "user" SET role = 'admin' WHERE email = 'nyem69@gmail.com';`

## Database Schema

### `support_tickets`

| Column | Type | Notes |
|---|---|---|
| id | text PK | nanoid |
| user_id | text FK → user | submitter |
| title | text | 3-200 chars |
| description | text | 10-5000 chars |
| category | text CHECK | bug, feature_request, question, issue, other |
| status | text CHECK | open, in_progress, resolved, closed |
| assigned_to | jsonb | array of user IDs |
| resolved_at/by | timestamp/text | set on resolve |
| closed_at/by | timestamp/text | set on close |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `ticket_comments`

| Column | Type | Notes |
|---|---|---|
| id | text PK | nanoid |
| ticket_id | text FK → support_tickets | cascade delete |
| user_id | text FK → user | human commenter (nullable) |
| agent_user_id | text FK → user | MCP agent commenter (nullable) |
| content | text | 1-5000 chars |
| parent_id | text FK → self | threaded replies |
| created_at | timestamptz | default now() |

Migration: `drizzle/0012_tiny_toad.sql`

## API Routes

### Support Tickets

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/support/tickets` | POST | any user | Create ticket |
| `/api/support/tickets` | GET | any user | List (admin: all, user: own). Query: `?status=open&limit=50&offset=0` |
| `/api/support/tickets/[id]` | GET | owner/admin | Ticket detail with comment count |
| `/api/support/tickets/[id]` | PATCH | admin | Update status/assignment |
| `/api/support/tickets/[id]/comments` | GET | owner/admin | List comments |
| `/api/support/tickets/[id]/comments` | POST | owner/admin | Add comment |

### Admin

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/users/[id]/role` | PATCH | admin | Set role to `"user"` or `"admin"`. Cannot change own role. |

## Pages

### Admin Dashboard (`/admin/*`)

Guarded by `+layout.server.ts` — redirects to `/login` if no session, returns 403 if not admin.

- `/admin` — Dashboard with stats: total users, rooms, messages today, active agents, open tickets.
- `/admin/users` — User list with admin role toggle button.
- `/admin/tickets` — All tickets with status filter tabs and inline status actions.
- `/admin/tickets/[id]` — Ticket detail with description, status management, and comment thread.

### Support (`/support/*`)

- `/support` — Create ticket form + list own tickets. Shows "Admin Tickets" link for admins.
- `/support/[id]` — Own ticket detail with comment thread. Closed tickets hide the comment form.

## Chat `/ticket` Command

Available to all roles. Usage: `/ticket <title>`

Handler in `chat-room.ts`:
1. Validates title (min 3 chars, max 200)
2. Inserts into `support_tickets` via `this.withDb()` (category: `issue`)
3. Broadcasts system message with ticket link: `→ /support/{ticketId}`

## MCP Ticket Tools

Four tools added to the MCP endpoint (`/mcp/v1`). All require `agent.isAdmin === true`.

| Tool | Params | Response |
|---|---|---|
| `ticket_list` | `status?`, `limit` (1-100, default 20) | `{ tickets: TicketListItem[], total }` |
| `ticket_read` | `ticket_id` | `TicketDetail` with comments |
| `ticket_comment` | `ticket_id`, `content` | `{ comment_id }` |
| `ticket_update` | `ticket_id`, `status?`, `assigned_to?` | `{ id, status }` |

`AgentContext` now includes `isAdmin: boolean`, derived from `user.role` during API key authentication.

## Files

**New files (26):**
- `src/routes/api/support/tickets/+server.ts`
- `src/routes/api/support/tickets/[id]/+server.ts`
- `src/routes/api/support/tickets/[id]/comments/+server.ts`
- `src/routes/api/admin/users/[id]/role/+server.ts`
- `src/routes/admin/+layout.server.ts`, `+layout.svelte`
- `src/routes/admin/+page.server.ts`, `+page.svelte`
- `src/routes/admin/users/+page.server.ts`, `+page.svelte`
- `src/routes/admin/tickets/+page.server.ts`, `+page.svelte`
- `src/routes/admin/tickets/[id]/+page.server.ts`, `+page.svelte`
- `src/routes/support/+page.server.ts`, `+page.svelte`
- `src/routes/support/[id]/+page.server.ts`, `+page.svelte`
- `src/lib/server/mcp/tools/ticket-list.ts`
- `src/lib/server/mcp/tools/ticket-read.ts`
- `src/lib/server/mcp/tools/ticket-comment.ts`
- `src/lib/server/mcp/tools/ticket-update.ts`
- `drizzle/0012_tiny_toad.sql`
- `docs/012-SysAdmin.md`

**Modified files (12):**
- `src/lib/server/db/auth-schema.ts` — role column
- `src/lib/server/db/schema.ts` — supportTickets, ticketComments tables
- `src/lib/server/auth/index.ts` — role additionalField
- `src/app.d.ts` — isAdmin in App.Locals
- `src/hooks.server.ts` — isAdmin derivation
- `src/lib/chat/commands.ts` — /ticket command
- `src/lib/server/chat-room.ts` — ticket handler
- `src/lib/types/mcp.ts` — 4 ticket schemas + response types
- `src/lib/server/mcp/auth.ts` — isAdmin in AgentContext
- `src/routes/mcp/v1/+server.ts` — 4 tool dispatches
- `src/lib/components/chat/SlashMenu.svelte` — ticket description
- `src/lib/components/chat/MemberPanel.svelte` — /support link
- `messages/en.json` — ~55 i18n keys
