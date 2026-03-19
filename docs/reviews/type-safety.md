# Type Safety Review

**Date:** 2026-03-19
**Scope:** All `.ts` and `.svelte` files in `src/`
**Total `any` occurrences:** 235 across 58 files

---

## Summary

| Category | Count | Notes |
|---|---|---|
| Production source files | ~80 | Core server + client code |
| Test files | ~155 | Billing, MCP, RAG test suites |
| `as unknown` casts | 10 | Mostly SDK/platform workarounds |
| eslint-disable no-explicit-any | 30 | All acknowledged suppressions |

---

## 1. `any` Usage by File (Production Only)

### CRITICAL: `src/app.d.ts` (4 occurrences)

Every request handler inherits untyped locals. This is the root cause of `db: any` propagation across the entire codebase.

| Line | Code | Severity |
|---|---|---|
| 38 | `auth: any` | CRITICAL |
| 40 | `user: any \| null` | CRITICAL |
| 42 | `session: any \| null` | CRITICAL |
| 44 | `db: any \| null` | CRITICAL |

**Impact:** Because `App.Locals` types are `any`, every server function that accepts `db`, `user`, or `session` from locals inherits `any`. This single file is responsible for ~40 downstream `db: any` parameters across MCP tools, RAG pipeline, billing, and feature gates.

**Recommended fix:** Define proper types for Better Auth and Drizzle instances:

```typescript
import type { BetterAuthInstance } from 'better-auth'; // or the actual exported type
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '$lib/server/db/schema';

interface Locals {
  auth: BetterAuthInstance; // or ReturnType<typeof createAuth>
  user: { id: string; name: string; email: string; role: string; /* ... */ } | null;
  session: { id: string; activeOrganizationId: string | null; /* ... */ } | null;
  db: PostgresJsDatabase<typeof schema> | null;
  isAdmin: boolean;
}
```

**Note:** Better Auth's type exports are historically unstable, which likely motivated the `any` escape hatch. A pragmatic intermediate step: define a minimal interface for `user` and `session` matching the fields actually accessed across the codebase.

---

### HIGH: `db: any` Parameter Propagation (30+ functions)

All of these accept `db: any` because `App.Locals.db` is `any`:

| File | Line | Function |
|---|---|---|
| `src/lib/server/rag/process-document.ts` | 37 | `processDocument(db: any, ...)` |
| `src/lib/server/rag/process-document.ts` | 235 | `markFailed(db: any, ...)` |
| `src/lib/server/rag/process-document.ts` | 244 | `finishJob(db: any, ...)` |
| `src/lib/server/rag/process-document.ts` | 276 | unnamed helper `(db: any, ...)` |
| `src/lib/server/rag/search.ts` | 31 | `searchDocuments(db: any, ...)` |
| `src/lib/server/chat-room.ts` | 1826 | `withDb<T>(fn: (db: any) => ...)` |
| `src/lib/server/chat-room.ts` | 1866 | `flushReadCursors(db: any)` |
| `src/lib/server/ai-billing.ts` | 27, 55, 89 | `getAiUsageForOrg`, `isAiCapReached`, `reportAiUsageToStripe` |
| `src/lib/server/billing-sync.ts` | 36, 95 | `syncOrgSubscription`, `syncTeamSubscription` |
| `src/lib/server/feature-gates.ts` | 64, 75, 153 | `checkUserTeamPro`, `checkOrgLimits`, `checkUserRoomCount` |
| `src/lib/server/mcp/auth.ts` | 26 | `authenticateAgent(... db: any ...)` |
| `src/lib/server/mcp/tools/*.ts` | various | All 14 MCP tool functions |
| `src/lib/server/db/brief.ts` | 25 | `getActiveBrief(db: any, ...)` |
| `src/routes/api/billing/webhook/+server.ts` | 66 | `updateStatusBySubId(db: any, ...)` |

**Severity:** HIGH -- Drizzle queries on `any` lose all schema-level type checking. Column name typos, wrong table references, and incorrect `where` conditions will not be caught at compile time.

**Recommended fix:** Create a shared type alias:

```typescript
// src/lib/server/db/types.ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';
export type AppDb = PostgresJsDatabase<typeof schema>;
```

Then replace all `db: any` parameters with `db: AppDb`. The Hyperdrive and direct pool both produce the same Drizzle interface.

---

### HIGH: Workers AI Response Casting (`src/lib/server/chat-room.ts`)

| Line | Code | Severity |
|---|---|---|
| 1432 | `} as any)` -- AI.run options cast | HIGH |
| 1435 | `(aiResult as any)?.response` -- response shape unknown | HIGH |

The Workers AI `Ai.run()` method has incomplete TypeScript types for chat-completion models. The `as any` on the options object bypasses parameter validation, and the response is accessed without type narrowing.

**Recommended fix:** Define a local interface for the expected response:

```typescript
interface AiChatResponse { response?: string }
const aiResult = await this.env.AI.run(config.ragModel as Parameters<Ai['run']>[0], {
  messages: [...],
  temperature: config.ragTemperature ?? 0.3,
  max_tokens: config.ragMaxTokens ?? 2048,
} as AiRunOptions) as AiChatResponse;
```

---

### HIGH: Workers AI Reranker Casting (`src/lib/server/rag/search.ts`)

| Line | Code | Severity |
|---|---|---|
| 92 | `(m.metadata as any)?.filename` -- Vectorize metadata untyped | HIGH |
| 140 | `{ query, contexts } as any` -- reranker input untyped | HIGH |
| 144 | `response as any` -- reranker output untyped | HIGH |

**Recommended fix:** Define interfaces for Vectorize metadata and reranker I/O:

```typescript
interface VectorMetadata { filename: string; orgId: string }
interface RerankerResponse { response: Array<{ id: number; score: number }> }
```

---

### MEDIUM: Turnstile `window` Casting (`src/routes/login/+page.svelte`)

| Line | Code | Severity |
|---|---|---|
| 81, 82, 98, 99, 107, 108 | `(window as any).turnstile` | MEDIUM |

Six occurrences accessing the Cloudflare Turnstile SDK via `window`. No type declarations exist.

**Recommended fix:** Add a global type declaration:

```typescript
// src/turnstile.d.ts
interface TurnstileWidget {
  render(element: HTMLElement, options: { sitekey: string; callback: (token: string) => void }): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileWidget }
}
```

---

### MEDIUM: `result: any` for `res.json()` Responses (Client Pages)

| File | Line(s) | Count |
|---|---|---|
| `src/routes/settings/+page.svelte` | 230, 255, 282, 486, 487, 531 | 6 |
| `src/routes/admin/users/+page.svelte` | 20, 26 | 2 |
| `src/routes/admin/tickets/[id]/+page.svelte` | 24, 44 | 2 |
| `src/routes/admin/tickets/+page.svelte` | 49 | 1 |
| `src/routes/support/+page.svelte` | 39 | 1 |
| `src/routes/support/[id]/+page.svelte` | 21 | 1 |
| `src/routes/accept-terms/+page.svelte` | 59 | 1 |

**Severity:** MEDIUM -- `fetch().then(r => r.json())` returns `any` by default. Each call site manually types as `any` instead of defining response interfaces.

**Recommended fix:** Define response types per API endpoint and use typed fetch helpers:

```typescript
const result: { ok: boolean; error?: string } = await res.json();
```

---

### MEDIUM: MCP Server Result Casting (`src/routes/mcp/v1/+server.ts`)

| Line | Code | Severity |
|---|---|---|
| 117 | `(result as any)?.data?.total` | MEDIUM |
| 129 | `(req as any).tool` (in `never` branch) | LOW |
| 135 | `(result as any).code === 'action_rejected'` | MEDIUM |

Line 135 is particularly concerning: the `McpResponse` type has `code` on the `McpError` variant, but the code accesses it via `as any` instead of narrowing with `result.ok`.

**Recommended fix for line 135:**
```typescript
const status = result.ok ? 200 : result.code === 'action_rejected' ? 403 : 400;
```
This works because `McpError` already has a `code` field. No cast needed.

---

### MEDIUM: `onSave: (config: any)` in RagConfigModal (`src/lib/components/chat/RagConfigModal.svelte:25`)

The callback prop accepts `any` instead of a typed config object matching the RAG config shape.

**Recommended fix:** Use the same shape as `RagConfig` or the local `ragConfig` prop type.

---

### MEDIUM: `data: any` in ChatView (`src/lib/components/chat/ChatView.svelte:20`)

```typescript
let { data }: { data: any } = $props();
```

The `data` prop from the page load function is untyped.

**Recommended fix:** Import the `PageData` type from `$types` or define the expected shape.

---

### LOW: `as unknown` Casts (Acceptable SDK Workarounds)

| File | Line | Reason | Severity |
|---|---|---|---|
| `src/routes/api/upload/+server.ts` | 268 | Hyperdrive env access (Cloudflare types incomplete) | LOW |
| `src/routes/api/upload/+server.ts` | 284 | Same pattern for env passthrough | LOW |
| `src/routes/api/upload/files/retry/+server.ts` | 71 | Same env passthrough | LOW |
| `src/routes/api/rooms/[roomId]/ocr/+server.ts` | 179 | Same env passthrough | LOW |
| `src/lib/components/chat/MessageBubble.svelte` | 179 | KeyboardEvent to MouseEvent (reusing handler) | LOW |
| `src/lib/utils/markdown.ts` | 38 | `return false as unknown as string` (marked renderer API requires this) | LOW |

---

### LOW: Better Auth API Key Result (`src/routes/api/agents/+server.ts`)

| Line | Code | Severity |
|---|---|---|
| 106 | `catch (e: any)` | LOW |
| 112 | `let keyResult: any` | MEDIUM |
| 121 | `catch (e: any)` | LOW |

`keyResult` from `auth.api.createApiKey()` is untyped because Better Auth's return type is not well-exported.

---

### LOW: Kreuzberg Provider (`src/lib/server/rag/kreuzberg-provider.ts:79`)

```typescript
const bg = (globalThis as Record<string, unknown>).__kreuzbergBg as any;
```

Accessing a manually-set global for the WASM background worker. Acceptable given the manual WASM init pattern.

---

## 2. Missing Type Annotations

### Transaction Callbacks

| File | Line | Code |
|---|---|---|
| `src/routes/open/+page.server.ts` | 70, 134 | `async (tx: any) => {` |
| `src/routes/chat/+page.server.ts` | 67 | `async (tx: any) => {` |

Drizzle's `db.transaction()` provides typed `tx` if `db` itself is typed. Fixing `App.Locals.db` resolves these.

### MCP Auth `verifyApiKey` Return

`src/lib/server/mcp/auth.ts:38`: `let keyData: any` -- Better Auth's `verifyApiKey` return type is not narrowed. The accessed fields are `valid`, `key.referenceId`, and `key.id`. A minimal interface would suffice:

```typescript
interface ApiKeyResult {
  valid: boolean;
  key?: { id: string; referenceId?: string };
}
```

---

## 3. Type Assertions

### Non-null Assertions (`!`)

No non-null assertions (`!.`) were found in production server code. The `chunkMap.get(m.id)!` in `search.ts:88` is safe because it's preceded by a `.filter((m) => chunkMap.has(m.id))`.

### `room_config_changed` Handler Casts

`src/lib/stores/messages.svelte.ts:401, 404`:
```typescript
this.roomName = msg.value as string;
this.ocrEnabled = msg.value as boolean;
```

The `value` field is typed as `string | boolean` in the `ServerMessage` union. These casts are correct per the `field` discriminator but not narrowed by TypeScript. A discriminated union on `field` would eliminate the need.

---

## 4. Interface Completeness

### `DisplayMessage` (`src/lib/stores/messages.svelte.ts`)

All fields are properly typed. `dbId?: number` is optional (set via `id_map` after flush). `streaming?: boolean` and `subtype?: string` are correctly optional. No issues found.

### `ServerMessage` Union (`src/lib/types/ws.ts`)

The union has 14 variants. The switch in `handleServerMessage` covers all 14 cases. However, there is **no `default` exhaustiveness check** -- if a new variant is added to `ServerMessage`, the handler will silently ignore it. The MCP server (`+server.ts:127`) does have a `const _exhaustive: never = req` guard.

**Recommended fix:** Add exhaustiveness check:
```typescript
default: {
  const _exhaustive: never = msg;
  console.warn('Unhandled server message type', (_exhaustive as any).type);
}
```

### `RagConfig` Interface vs DB Schema

`RagConfig` in `responder.ts` has 8 fields. The `roomConfig` DB table (schema.ts lines 608-621) has exactly the same 8 RAG-related columns: `ragEnabled`, `ragModel`, `ragTemperature`, `ragMaxTokens`, `ragTrigger`, `ragProvider`, `ragBaseUrl`, `ragApiKeyId`. The types align correctly:

| Field | Interface | DB |
|---|---|---|
| `ragEnabled` | `boolean` | `boolean NOT NULL DEFAULT false` |
| `ragModel` | `string` | `text NOT NULL DEFAULT '...'` |
| `ragTemperature` | `number` | `real NOT NULL DEFAULT 0.3` |
| `ragMaxTokens` | `number` | `integer NOT NULL DEFAULT 2048` |
| `ragTrigger` | `'explicit' \| 'always'` | `text CHECK IN ('explicit','always')` |
| `ragProvider` | `'workers_ai' \| 'openai'` | `text CHECK IN ('workers_ai','openai')` |
| `ragBaseUrl` | `string?` | `text (nullable)` |
| `ragApiKeyId` | `string?` | `text (nullable)` |

No misalignment found.

### `SearchResult` Interface

`SearchResult` in `search.ts` has `documentDate`, `documentTitle`, and `language` typed as `string | null | undefined` (optional + nullable). The DB schema (`documentChunks`) has these as nullable `text` columns. The `ChunkRow` interface (line 70-80) correctly types them as `string | null`. No issues.

---

## 5. Zod Schema Alignment

### MCP Schemas (`src/lib/types/mcp.ts`)

The MCP endpoint (`src/routes/mcp/v1/+server.ts`) correctly uses `mcpRequestSchema.safeParse(body)` with a discriminated union on `tool`. All 15 tool schemas are registered. The `default` branch has an exhaustiveness guard (`const _exhaustive: never = req`).

**Issue:** `docSearchSchema` has `.default({ query: '', top_k: 5 })` on the params object, which means an empty `params: {}` would pass validation with `query: ''`. However, the inner `query` field has `.min(1)`, so Zod would reject `query: ''` after defaults are applied. This is a **dead default** -- the `.default()` on the outer object allows omitting `params` entirely, but the inner `query: z.string().min(1)` would then fail. This is confusing but not a bug since Zod applies defaults before validation.

### API Endpoints Without Zod

Several API endpoints parse `request.json()` with only `as Record<string, unknown>` or `as { field?: type }` casts, without Zod validation:

| File | Pattern | Severity |
|---|---|---|
| `src/routes/api/account/email/+server.ts` | `as { email?: string }` | MEDIUM |
| `src/routes/api/billing/verify/+server.ts` | `as { session_id?: string }` | MEDIUM |
| `src/routes/api/billing/team/members/+server.ts` | `as { email?: string }` | MEDIUM |
| `src/routes/api/billing/team/checkout/+server.ts` | `as Record<string, unknown>` | MEDIUM |
| `src/routes/api/account/age-verify/+server.ts` | `as Record<string, unknown>` | MEDIUM |
| `src/routes/api/admin/users/[id]/role/+server.ts` | `as Record<string, unknown>` | MEDIUM |
| `src/routes/api/support/tickets/+server.ts` | `as Record<string, unknown>` | MEDIUM |
| `src/routes/api/support/tickets/[id]/+server.ts` | `as Record<string, unknown>` | MEDIUM |
| `src/routes/api/support/tickets/[id]/comments/+server.ts` | `as Record<string, unknown>` | MEDIUM |
| `src/routes/api/terms/+server.ts` | `as Record<string, unknown>` | LOW |

These endpoints perform manual field checks (`if (!body.email)`) rather than schema validation. While the manual checks do validate at runtime, they don't provide the same guarantees as Zod schemas (no type narrowing, no detailed error messages, no consistent error format).

**Recommended fix:** Add Zod schemas for all API endpoints, similar to the `rag-config` endpoint which already uses Zod.

---

## 6. Test Files

Test files account for ~155 of the 235 `any` occurrences, primarily in billing test suites. These use `any` extensively for mock DB chains (`const db: any = { select: vi.fn()... }`). While less critical than production code, the mocks could benefit from a shared `MockDb` type to catch mock setup errors.

**Severity:** LOW -- test-only, but makes tests fragile to schema changes.

---

## Priority Recommendations

1. **Fix `src/app.d.ts`** -- Type `db` as `AppDb | null` and define minimal interfaces for `user`/`session`. This single change eliminates ~40 downstream `db: any` parameters.
2. **Create `AppDb` type alias** -- `PostgresJsDatabase<typeof schema>` in a shared module.
3. **Add `Window.turnstile` declaration** -- Eliminates 6 casts in login page.
4. **Fix MCP server line 135** -- Use type narrowing instead of `as any` for `result.code`.
5. **Add exhaustiveness check** to `messages.svelte.ts` switch statement.
6. **Add Zod schemas** to remaining API endpoints (billing, support, admin).
7. **Type Workers AI responses** -- Define interfaces for chat-completion and reranker responses.
8. **Type `res.json()` calls** in client pages -- Define response interfaces per endpoint.
