# Architecture Review — Martol

**Date:** 2026-03-19
**Reviewer:** Claude Opus 4.6 (automated)
**Scope:** Dead code, file responsibilities, circular dependencies, pattern consistency, configuration sprawl, documentation accuracy

---

## 1. Dead Code

### 1.1 Commented-out AI SDK imports in responder.ts
**Severity:** Low
**File:** `src/lib/server/rag/responder.ts:8-10`

```
// AI SDK imports removed — streamText() doesn't work in DO context (see docs/026)
// import { createWorkersAI } from 'workers-ai-provider';
// import { createOpenAI } from '@ai-sdk/openai';
```

Also at line 162-163, the `createRagModel()` function stub is commented out. These comments serve as a historical breadcrumb but the commented imports should be removed. The JSDoc block for `createRagModel()` (lines 153-164) describes a function that no longer exists.

**Recommendation:** Remove commented imports and the orphaned JSDoc block. Keep a single one-line comment referencing docs/026 if needed.

### 1.2 Unused npm dependencies (production)
**Severity:** High
**Files:** `package.json`

Three production dependencies have **zero active imports** anywhere in `src/`:

| Package | Status | Note |
|---|---|---|
| `ai` (Vercel AI SDK) | 0 imports | Was used for `streamText()`, removed per docs/026 |
| `@ai-sdk/openai` | 0 imports | Only in commented-out code in `responder.ts` |
| `workers-ai-provider` | 0 imports | Only in commented-out code in `responder.ts` |

All three are in `dependencies` (not `devDependencies`), meaning they inflate the production bundle. The `ai` SDK alone is substantial.

**Recommendation:** Remove all three from `dependencies`. If re-enabling is planned (docs/026 Phase 5), add a comment in `package.json` or track in the feature doc instead.

### 1.3 `@modelcontextprotocol/sdk` used only in scripts/
**Severity:** Low
**File:** `package.json`

`@modelcontextprotocol/sdk` is a production dependency but is only imported in `scripts/mcp-rag-server.ts` (a debug tool, not bundled into the Worker). The MCP endpoint in `src/routes/mcp/v1/+server.ts` uses a custom implementation, not the SDK.

**Recommendation:** Move to `devDependencies`.

### 1.4 `dotenv` used only in scripts/
**Severity:** Low
**File:** `package.json`

`dotenv` is a devDependency (correct), but worth confirming it stays excluded from the Worker bundle. Currently only used in `scripts/seed-test-accounts.ts` and `drizzle.config.ts`.

**Status:** Already correctly placed. No action needed.

### 1.5 TODOs in production code
**Severity:** Info
**Files:**

| Location | TODO |
|---|---|
| `src/lib/server/rag/process-document.ts:181` | `chunkHash: null, // TODO: add per-chunk hashing for dedup` |
| `src/lib/server/db/schema.ts:8` | `// TODO: LO-09 — Add CHECK(length(id) <= 128)` |
| `src/routes/api/rooms/[roomId]/rag-usage/+server.ts:24` | `// TODO: determine limit from subscription plan` |

Three TODOs total. Low count is healthy. The RAG usage limit TODO is the most impactful (currently hardcoded).

---

## 2. File Size & Responsibilities

### 2.1 `chat-room.ts` is a 2,464-line monolith
**Severity:** High
**File:** `src/lib/server/chat-room.ts` (2,464 lines, ~69 methods)

The ChatRoom Durable Object handles 18+ distinct concerns:

1. WebSocket lifecycle (connect, message, close, error)
2. WAL storage (write, read, byte tracking)
3. Batch flush to PostgreSQL
4. Message handling and validation
5. Stream handling (start, delta, end, abort)
6. REST ingest (MCP bridge)
7. REST edit
8. REST notifications (brief, config, document-indexed, RAG config) -- 4 separate handlers
9. RAG responder (trigger detection, search, LLM call, streaming)
10. Delta sync (client reconnection)
11. Typing indicators
12. Read cursors
13. Command handling (`/repair`, `/clear`, etc.)
14. Room clearing
15. Presence tracking
16. Per-user rate limiting
17. RAG rate limiting
18. Helper/broadcast utilities

**Recommended split:**

| Extract to | Concerns | Est. lines saved |
|---|---|---|
| `chat-room-rag.ts` | RAG responder, RAG rate limiting, RAG config | ~250 |
| `chat-room-commands.ts` | Command handling (`/repair`, `/clear`, etc.) | ~400 |
| `chat-room-stream.ts` | Stream start/delta/end/abort | ~200 |
| `chat-room-flush.ts` | WAL flush logic, DB helper, read cursor flush | ~300 |

This would bring `chat-room.ts` from 2,464 to ~1,300 lines while keeping the DO class as the orchestrator.

**Caveat:** Durable Object methods must live on the class itself. Extracted modules would be helper functions receiving `this`-equivalent state as parameters, or could use a mixin/delegate pattern.

### 2.2 `hooks.server.ts` has 12 rate limit checks
**Severity:** Medium
**File:** `src/hooks.server.ts` (664 lines)

The file contains 12 calls to `checkRateLimit()` across 8 different endpoint categories. Each follows a nearly identical pattern:
1. Check if KV exists (fail closed in prod)
2. Call `checkRateLimit(kv, { key, maxRequests, windowSeconds })`
3. Return 429 or 200 (silent drop) if blocked

This repetitive boilerplate accounts for ~300 lines. The rate limit config is already partially centralized (lines 522-531 for `rateLimitedPaths`) but OTP, invite, upload, MCP, action, and email-change limits are handled as separate inline blocks.

**Recommendation:** Extract a middleware-style `applyRateLimit()` helper and consolidate all rate limit configs into a single declaration, similar to the existing `rateLimitedPaths` pattern.

### 2.3 Duplicate upload rate limiting
**Severity:** Medium (bug-adjacent)
**File:** `src/hooks.server.ts:437-461` and `src/hooks.server.ts:582-598`

Upload requests are rate-limited **twice**:
- **Line 439:** 30 per user per minute (key: `upload:{userId}`)
- **Line 583:** 100 per user per hour (key: `upload-user:{userId}`)

Both are intentional (burst + sustained), but they use different KV keys and different error response formats:
- First: `{ error: { message: "..." } }` (standard)
- Second: `{ message: "..." }` (missing `error` wrapper)

The second block also skips the KV-missing fail-closed check that the first block has.

**Recommendation:** Unify error format. Add fail-closed check to the hourly limit. Consider combining into the `rateLimitedPaths` table.

### 2.4 Files over 500 lines
**Severity:** Info

| File | Lines | Concern |
|---|---|---|
| `src/lib/server/chat-room.ts` | 2,464 | See 2.1 |
| `src/routes/docs/client/+page.svelte` | 2,188 | Documentation page (acceptable) |
| `src/routes/settings/+page.svelte` | 1,564 | Settings UI |
| `src/routes/+page.svelte` | 1,405 | Landing page |
| `src/lib/components/chat/MemberPanel.svelte` | 1,249 | Member panel UI |
| `src/routes/docs/chat/+page.svelte` | 1,098 | Documentation page |
| `src/lib/server/db/schema.ts` | 745 | Schema (expected for Drizzle) |
| `src/hooks.server.ts` | 664 | See 2.2 |
| `src/routes/login/+page.svelte` | 642 | Login page |
| `src/lib/components/chat/BriefModal.svelte` | 626 | Brief editor |
| `src/lib/stores/messages.svelte.ts` | 589 | Messages store |

The `settings/+page.svelte` (1,564 lines) and `MemberPanel.svelte` (1,249 lines) could benefit from decomposition into sub-components.

---

## 3. Circular Dependencies

### 3.1 No circular dependencies detected
**Severity:** None

Import chains checked:
- `auth/index.ts` imports from `db/auth-schema.ts` (one-way)
- `db/schema.ts` imports from `db/auth-schema.ts` (one-way, for foreign key references)
- `auth-schema.ts` has no imports from `auth/` or `schema.ts` -- no cycle
- RAG modules form a clean DAG: `process-document` -> `parser`, `chunker`, `embedder`, `metadata-extractor`; `search` -> `embedder`, `metadata-extractor`; `embedder` -> `chunker` (type only); `kreuzberg-provider` -> `parser` (type only)
- Stores do not import from components; components import from stores (one-way)

---

## 4. Design Pattern Consistency

### 4.1 API endpoint auth pattern is consistent
**Severity:** None

All API endpoints follow the same guard:
```typescript
if (!locals.user || !locals.session) error(401, 'Authentication required');
```
Admin endpoints add `if (!locals.isAdmin) error(403, 'Admin access required')`. The exception is `/api/contact/+server.ts` which is intentionally unauthenticated.

### 4.2 DO internal routes follow consistent validation
**Severity:** Low

All 6 REST handlers (`handleRestIngest`, `handleRestEdit`, `handleNotifyBrief`, `handleNotifyConfig`, `handleNotifyDocumentIndexed`, `handleNotifyRagConfig`) follow the same pattern:
1. `try { payload = await request.json() } catch { return 400 }`
2. Validate required fields
3. Process

However, `handleNotifyRagConfig` is the only handler that skips field validation -- it directly casts `request.json() as RagConfig` with no property checks. A malformed payload would silently set invalid config.

**Recommendation:** Add minimal field validation to `handleNotifyRagConfig` (at least check `ragEnabled` is boolean).

### 4.3 MCP tools follow consistent pattern
**Severity:** None

All MCP tools in `src/lib/server/mcp/tools/`:
- Accept an `AgentContext` parameter
- Return `McpResponse` type
- Use `{ ok: false, error: '...', code: '...' }` for errors
- Import from `'../auth'` for agent context

Pattern is clean and uniform.

### 4.4 MCP error handling inconsistency
**Severity:** Low

MCP tools return error codes inconsistently. Some use specific codes (`quota_exceeded`, `invalid_reply`, `send_failed`) while others return generic messages without codes. The `McpResponse` type should enforce a required `code` field on error responses.

---

## 5. Configuration Sprawl

### 5.1 Hardcoded AI model names across files
**Severity:** Medium

| Model | Location |
|---|---|
| `@cf/baai/bge-m3` | `src/lib/server/rag/embedder.ts:13` |
| `@cf/baai/bge-reranker-base` | `src/lib/server/rag/search.ts:12` |
| `@cf/meta/llama-3.1-8b-instruct` | `src/lib/server/db/schema.ts:609` (DB default) |
| `@cf/microsoft/resnet-50` | `src/lib/server/image-scan.ts:35` |

Each model name is defined as a `const` in its respective file. If Workers AI deprecates a model, changes must be made in multiple places.

**Recommendation:** Create `src/lib/server/ai-models.ts` to centralize all model identifiers.

### 5.2 Timeout/limit constants scattered across files
**Severity:** Low

| Constant | Value | File |
|---|---|---|
| `EXTRACTION_TIMEOUT_MS` | 120,000 | `rag/process-document.ts` |
| `STREAM_TIMEOUT_MS` | 120,000 | `chat-room.ts` |
| `FLUSH_INTERVAL_MS` | 500 | `chat-room.ts` |
| `MAX_BODY_SIZE` | 32 KB | `chat-room.ts` |
| `topK` default | 15 | `rag/search.ts` |
| 12 rate limit configs | various | `hooks.server.ts` |

The `chat-room.ts` constants (lines 26-48) are well-organized. The rate limit configs in `hooks.server.ts` are partially centralized (lines 522-531) but not fully.

**Recommendation:** Low priority. Current scoping is reasonable for a monorepo. Only centralize if cross-file sharing is needed.

### 5.3 Magic numbers
**Severity:** Low

| Value | Location | Meaning |
|---|---|---|
| `3000` | `responder.ts:129` | Word cap for RAG context (~12K chars) |
| `150` | `rag-usage/+server.ts:24` | Hardcoded RAG usage limit (TODO exists) |
| `50000` | `action-submit.ts:140` | Max simulation payload size (50KB) |

These should be named constants.

---

## 6. Documentation vs Reality

### 6.1 CLAUDE.md architecture diagram is outdated
**Severity:** Medium
**File:** `CLAUDE.md:75`

The ASCII architecture diagram says:
```
+-- Embed: Workers AI BGE-base-en-v1.5 (768-dim) -> Vectorize upsert
```

**Reality:** The codebase uses `@cf/baai/bge-m3` (1024-dim, multilingual) as of the migration documented in `embedder.ts:5-7`. The tech stack table at the top of CLAUDE.md is correct (BGE-M3, 1024-dim), creating an internal contradiction.

**Recommendation:** Update the architecture diagram to match the tech stack table.

### 6.2 i18n key count
**Severity:** Info

`messages/en.json` defines 478 keys. Approximately 787 unique `m.xxx` references were found in source files (some are partial matches from the regex). No obvious orphaned keys detected through sampling, but a precise audit would require tooling (e.g., `paraglide` unused key detection).

---

## Summary

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1.2 | 3 unused AI SDK production deps | High | 5 min |
| 2.1 | `chat-room.ts` 2,464-line monolith | High | 2-4 hours |
| 2.2 | `hooks.server.ts` rate limit boilerplate | Medium | 1 hour |
| 2.3 | Duplicate upload rate limiting with inconsistent format | Medium | 15 min |
| 5.1 | AI model names hardcoded across 4 files | Medium | 30 min |
| 6.1 | CLAUDE.md architecture diagram outdated | Medium | 5 min |
| 1.1 | Commented-out imports in responder.ts | Low | 5 min |
| 1.3 | `@modelcontextprotocol/sdk` should be devDependency | Low | 5 min |
| 4.2 | `handleNotifyRagConfig` skips validation | Low | 15 min |
| 4.4 | MCP error codes inconsistent | Low | 30 min |
| 5.2 | Timeout constants scattered (acceptable) | Low | -- |
| 5.3 | Magic numbers without named constants | Low | 15 min |
| 1.5 | 3 TODOs in production code | Info | -- |
| 3.1 | No circular dependencies | None | -- |
| 4.1 | API auth pattern consistent | None | -- |
| 4.3 | MCP tools pattern consistent | None | -- |

### Priority recommendations

1. **Remove unused AI SDK deps** (`ai`, `@ai-sdk/openai`, `workers-ai-provider`) from `package.json` -- reduces bundle size and attack surface.
2. **Fix CLAUDE.md** embedding model reference in the architecture diagram.
3. **Fix duplicate upload rate limit** error format inconsistency.
4. **Plan chat-room.ts decomposition** -- extract command handling (~400 lines) and RAG responder (~250 lines) as first targets.
5. **Consolidate rate limit config** in `hooks.server.ts` into a declarative table.
