# Project Brief — Guide

**Date:** 2026-03-10
**Status:** Implemented (Phase A complete)

---

## What Is the Brief?

The **Project Brief** is a room-level document that tells AI agents what they need to know about your project. It is injected into every agent's system prompt, ensuring agents always have current context — even after long conversations where earlier instructions would otherwise scroll out of view.

Think of it as the "README for your AI teammates."

### What to Put in a Brief

- Project goals and current phase
- Tech stack and frameworks
- Coding conventions and naming patterns
- Constraints (performance budgets, accessibility requirements, browser support)
- Architecture decisions and folder structure
- What NOT to do (common pitfalls, deprecated patterns)

### Example

```
## Project: Acme Dashboard

**Goal:** Ship v2.0 of the admin dashboard by March 30.

**Stack:** Next.js 15, TypeScript, Tailwind v4, Drizzle ORM, PostgreSQL.

**Conventions:**
- Use server components by default; client components only for interactivity
- All API routes use Zod validation at boundaries
- snake_case for DB columns, camelCase for TypeScript
- Tests: Vitest for units, Playwright for E2E

**Current phase:** Migrating auth from NextAuth to Better Auth.
Do NOT touch the billing module — it ships separately.
```

---

## Who Can Edit the Brief?

| Role | Can View | Can Edit |
|------|----------|----------|
| Owner | Yes | Yes |
| Lead (admin) | Yes | Yes |
| Member | Yes | No |
| Agent | Yes (via tools) | No |

---

## How Agents Use the Brief

### Automatic Injection

When an agent connects to a room, it calls `chat_who` during startup. The brief content is included in the response and stored locally. The agent's system prompt includes:

```
PROJECT BRIEF:
<your brief content here>
```

This means agents receive the brief on every LLM call — they never "forget" it.

### Stale Brief Detection

When an agent performs a resync (triggered by reconnection or server request), it calls `brief_get_active` and compares the version number. If the brief has changed, the agent updates its local copy and logs the version transition.

### Brief-Related MCP Tools

Agents have access to these tools:

| Tool | Description | Parameters |
|------|-------------|------------|
| `chat_who` | Get room info, members, and brief | None |
| `brief_get_active` | Fetch the current active brief with version | None |

Both tools return the brief content. `brief_get_active` is purpose-built for refreshing the brief mid-conversation, while `chat_who` provides the brief as part of broader room context.

---

## REST API

### `GET /api/rooms/{roomId}/brief`

Returns the active brief for a room.

**Auth:** Session cookie, must be a room member.

**Response:**

```json
{
  "ok": true,
  "brief": "Your brief content...",
  "version": 3
}
```

- `version: 0` means the brief is from legacy storage (organization metadata).
- `version: 1+` means the brief is stored in the versioned `project_brief` table.

### `PUT /api/rooms/{roomId}/brief`

Update the brief. Creates a new version and archives the previous one.

**Auth:** Session cookie, must be owner or lead.

**Request:**

```json
{
  "brief": "Updated brief content...",
  "expectedVersion": 3
}
```

- `expectedVersion` is optional. If provided and the current version doesn't match, the server returns 409 Conflict.
- Maximum length: 10,000 characters.
- Rate limit: 10 updates per user per hour.

**Response (success):**

```json
{ "ok": true, "version": 4 }
```

**Response (conflict):**

```json
{
  "ok": false,
  "error": "Brief was updated by another user. Please reload and try again.",
  "currentVersion": 4
}
```

---

## Versioning

Every brief save creates a new version. The previous active brief is archived (`status: 'archived'`). A partial unique index enforces that only one brief can be active per room at any time.

### Version Lifecycle

```
v1 (active)  →  user saves  →  v1 (archived), v2 (active)
                                user saves  →  v2 (archived), v3 (active)
```

### Retention

Only the last 20 archived versions are kept. Older versions are pruned automatically during writes. This prevents unbounded storage growth.

### Concurrency Safety

- A `SELECT ... FOR UPDATE` lock on the organization row serializes concurrent writes.
- The partial unique index acts as a database-level safety net — if two active briefs exist for the same room, the insert fails.
- The client sends `expectedVersion` for optimistic concurrency control; the server returns 409 if the versions don't match.

---

## Caching

Brief reads go through a 3-tier lookup:

1. **Cloudflare KV** — 60-second TTL cache. Fast, edge-local.
2. **PostgreSQL** — `project_brief` table, active row.
3. **Legacy fallback** — `organization.metadata` JSON field (version 0).

On write, the KV cache is invalidated immediately.

---

## Database Schema

**Table:** `project_brief`

| Column | Type | Description |
|--------|------|-------------|
| `id` | bigserial | Primary key |
| `org_id` | text | FK → organization.id (CASCADE on delete) |
| `content` | text | Brief content (max 10,000 chars enforced at API level) |
| `version` | integer | Sequential version number |
| `status` | text | `'active'` or `'archived'` |
| `created_by` | text | FK → user.id (RESTRICT on delete) |
| `created_at` | timestamptz | When this version was created |

**Indexes:**

| Index | Type | Purpose |
|-------|------|---------|
| `idx_project_brief_org_active` | Unique partial (`WHERE status = 'active'`) | Enforces one active brief per org |
| `idx_project_brief_org_version` | B-tree | Version history lookups |

**Constraint:** `CHECK (status IN ('active', 'archived'))`

---

## UI — Current Implementation

The brief is currently edited in a collapsible section within the **MemberPanel** (right sidebar). It includes:

- Textarea with placeholder guidance
- Live character counter (x/10,000)
- Save button with status feedback (saving → saved → idle)
- Error banner (red) on save failure
- Conflict banner (yellow) on version conflict, with auto-reload
- Read-only mode for non-owner/lead users

### Planned: Brief Modal Dialog

The brief deserves a dedicated modal dialog for a better editing experience:

- **More editing space** — the sidebar textarea is cramped (6 rows in a narrow panel)
- **Version info** — show version number, last edited by, and timestamp
- **Markdown preview** — side-by-side edit/preview for structured briefs
- **Template suggestions** — pre-fill with common sections (Goals, Stack, Conventions)
- **In-modal help** — explain what makes a good brief, with examples
- **History** — list previous versions with ability to view (not yet restore)

The MemberPanel section would become a read-only preview with a "View / Edit" button that opens the modal.

---

## File Map

| File | Purpose |
|------|---------|
| `src/lib/server/db/schema.ts` | `projectBrief` table definition |
| `src/lib/server/db/brief.ts` | Shared `getActiveBrief()` helper with KV caching |
| `src/routes/api/rooms/[roomId]/brief/+server.ts` | REST API (GET/PUT) |
| `src/lib/server/mcp/tools/brief-get.ts` | MCP `brief_get_active` tool |
| `src/lib/server/mcp/tools/chat-who.ts` | MCP `chat_who` tool (includes brief) |
| `src/lib/types/mcp.ts` | `BriefGetResult`, `ChatWhoResult` types |
| `src/lib/components/chat/MemberPanel.svelte` | Brief UI (edit/view) |
| `messages/en.json` | i18n keys (`chat_brief_*`) |
| `martol-client/martol_agent/tools.py` | Agent tool definition |
| `martol-client/martol_agent/base_wrapper.py` | Agent brief state + refresh |
| `martol-client/martol_agent/wrapper.py` | System prompt injection |
| `scripts/migrate-metadata-briefs.sql` | One-time legacy data migration |

---

## Related Documents

- `docs/013-Brief-System.md` — Original brainstorming notes
- `docs/014-Brief-System-Review.md` — Multi-expert review with phase roadmap
