# Fix Plan — Prioritized by Severity and Impact

**Date:** 2026-03-19
**Source:** Consolidated multi-perspective code review (5 reviewers)

## Batch 1 — CRITICAL Security + Performance (ship immediately)

### Fix 1: Remove HMAC secret from browser page data
**Finding:** C-01 (Security CRITICAL)
**File:** `src/routes/chat/+page.server.ts:342-346`
**Change:** Stop passing `HMAC_SIGNING_SECRET` to the client. The client uses it for external agent connection display — derive a separate, non-sensitive token for that purpose or remove the feature.
```typescript
// REMOVE:
hmacSecret = platform.env.HMAC_SIGNING_SECRET ?? null;
// REPLACE with: a derived, non-privileged display token or null
```

### Fix 2: Replace N+1 unread count queries with single aggregate
**Finding:** P-01 (Performance CRITICAL)
**File:** `src/routes/chat/+page.server.ts:217-229`
**Change:** Replace the per-room COUNT loop with a single CTE/lateral join:
```sql
WITH unread AS (
  SELECT m.org_id, count(*) as cnt
  FROM messages m
  JOIN read_cursors rc ON rc.org_id = m.org_id AND rc.user_id = $1
  WHERE m.id > rc.last_read_id AND m.deleted_at IS NULL
  GROUP BY m.org_id
)
SELECT o.id, o.name, COALESCE(u.cnt, 0) as unread_count
FROM organization o
LEFT JOIN unread u ON u.org_id = o.id
WHERE ...
```

### Fix 3: Type `App.Locals` properly
**Finding:** T-01 (Type Safety CRITICAL)
**File:** `src/app.d.ts:38-44`
**Change:** Replace `any` with proper types from Better Auth and Drizzle:
```typescript
interface Locals {
    auth: ReturnType<typeof createAuth>;
    user: User | null;
    session: Session | null;
    db: PostgresJsDatabase<typeof schema> | null;
}
```
This eliminates ~40 downstream `db: any` parameters across 30+ files.

## Batch 2 — HIGH Security (ship within 1 day)

### Fix 4: Add membership check to `/rag-usage` endpoint
**Finding:** H-03 (Security HIGH)
**File:** `src/routes/api/rooms/[roomId]/rag-usage/+server.ts`
**Change:** Add the same membership verification used in other room endpoints.

### Fix 5: Add membership check to `/rag-key` GET handler
**Finding:** H-04 (Security HIGH)
**File:** `src/routes/api/rooms/[roomId]/rag-key/+server.ts`
**Change:** Verify the requesting user is a member of the room before returning key existence/masked data.

### Fix 6: Guard test credentials with environment check
**Finding:** H-01 (Security HIGH)
**Change:** Wrap test login endpoint with `if (dev)` or `if (process.env.NODE_ENV !== 'production')` guard.

### Fix 7: Add `secure` flag to test login cookie
**Finding:** H-02 (Security HIGH)
**Change:** Set `secure: true` on the test login session cookie.

## Batch 3 — HIGH Performance + Architecture (ship within 1 week)

### Fix 8: Add composite index on document_chunks
**Finding:** P-05 (Performance HIGH)
**File:** `src/lib/server/db/schema.ts`
**Change:** Add index for the RAG search query pattern:
```typescript
index('idx_doc_chunks_org_vector').on(table.orgId, table.vectorId)
```

### Fix 9: Replace linear findIndex with Map lookup for streaming
**Finding:** P-04 (Performance HIGH)
**File:** `src/lib/stores/messages.svelte.ts`
**Change:** Maintain a `localIdToIndex` Map alongside the messages array. Update on push/splice. Use for `handleStreamDelta` instead of `findIndex`.

### Fix 10: Remove unused AI SDK packages
**Finding:** A-02 (Architecture HIGH)
**File:** `package.json`
**Change:** `pnpm remove ai workers-ai-provider @ai-sdk/openai`
**Note:** All imports are already commented out. Zero bundle impact currently (tree-shaken), but removing cleans up the dependency tree.

### Fix 11: Batch INSERTs in WAL flush
**Finding:** P-06 (Performance HIGH)
**File:** `src/lib/server/chat-room.ts`
**Change:** Replace individual `INSERT` per message with a single batch insert using Drizzle's `.values([...])`.

## Batch 4 — HIGH UX (ship within 1 week)

### Fix 12: Replace hardcoded English aria-labels with paraglide
**Finding:** UX-01 (UX HIGH)
**Files:** ConfirmDialog, ChatHeader, DocumentPanel, MemberPanel, ChatInput, OnlineBar
**Change:** Add ~20 new i18n keys to `messages/en.json` and replace hardcoded strings with `m.xxx()` calls.

### Fix 13: Replace hardcoded English strings in DocumentPanel
**Finding:** UX-02 (UX HIGH)
**File:** `src/lib/components/chat/DocumentPanel.svelte`
**Change:** Add ~15 i18n keys for status labels, headings, empty states, and placeholders.

### Fix 14: Add focus trapping to ConfirmDialog and revoke dialog
**Finding:** UX-03 (UX HIGH)
**Files:** ConfirmDialog.svelte, MemberPanel.svelte
**Change:** Add `inert` on background content or implement a focus-trap utility.

## Batch 5 — MEDIUM (ship within 2 weeks)

### Fix 15-22: Security MEDIUM items
- SSRF DNS rebinding mitigation (add DNS resolution check)
- Terms check: fail closed instead of open
- Prompt injection: add output guardrails

### Fix 23-30: Performance MEDIUM items
- Cache HMAC CryptoKey import (store in instance variable)
- Reuse TextEncoder instance
- Optimize messageByDbId derivation (incremental update)

### Fix 31-37: UX MEDIUM items
- ConfirmDialog: focus cancel button instead of confirm
- Increase touch targets to 44px minimum
- DocumentPanel: add error feedback on network failures
- Upload errors: increase timeout to 10s or persist until dismissed

### Fix 38-42: Architecture MEDIUM items
- Centralize AI model constants
- Remove duplicate upload rate limit
- Clean up commented code in responder.ts
- Fix CLAUDE.md architecture diagram (BGE-M3, not BGE-base)

## Batch 6 — LOW (backlog)

21 LOW findings across all reviews — see individual review files. Address opportunistically during related work.

## Summary

| Batch | Findings | Priority | Timeline |
|---|---|---|---|
| 1 | 3 CRITICAL | Ship immediately | Today |
| 2 | 4 HIGH (security) | Ship within 1 day | Tomorrow |
| 3 | 4 HIGH (perf + arch) | Ship within 1 week | This week |
| 4 | 3 HIGH (UX) | Ship within 1 week | This week |
| 5 | 20 MEDIUM | Ship within 2 weeks | Next sprint |
| 6 | 21 LOW | Backlog | Opportunistic |

**Total: 55 findings across 5 perspectives.**
