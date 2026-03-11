# Document Intelligence: Fix & Harden — Design Spec

**Date:** 2026-03-11
**Sub-project:** A of 2 (Fix & Harden)
**Status:** Approved

## Problem

Martol has a complete Document Intelligence pipeline (upload → extract → chunk → embed → index → search), but it is broken in production:

1. **Kreuzberg WASM crashes silently** — PDFs uploaded show "Pending" forever. The ingestion job starts (`status = running`) but never completes. No error code is written to the DB.
2. **No error recovery** — Stuck jobs are never retried. No cron cleanup. Users see eternal "Pending" with no way to understand or fix the issue.
3. **Agent can't access documents** — Since nothing gets indexed, the `doc_search` MCP tool returns empty results. The agent has no awareness that documents exist in the room.

### Evidence from production DB

```
attachments:
  id=6, filename=DRIVE_Summary.pdf, processing_status=pending, extraction_error_code=null

ingestion_jobs:
  id=3, attachment_id=6, status=running, error=null, finished_at=null
  (started 2026-03-10 17:56:08 — never finished)
```

## Scope

### In scope (Sub-project A)
- Debug and fix Kreuzberg WASM extraction in Cloudflare Workers
- Harden pipeline with retry logic, cron recovery, structured error codes
- Agent auto-notify when documents finish indexing
- Verify full end-to-end flow: upload → extract → index → agent searches

### Out of scope (Sub-project B)
- Document preview / PDF viewer
- Chunk visualization
- Semantic search in documents panel
- Expanding allowed file types
- Processing progress UI beyond status badges

## Architecture

Three workstreams, executed in order:

### Workstream 1: Fix Kreuzberg WASM Extraction

**Root cause analysis:**

The crash happens between lines 74-158 of `process-document.ts` — after marking `processing` but before the `catch` block writes the error. Most likely: `ensureWasm()` in `kreuzberg-provider.ts` throws in a way that breaks the Worker's `waitUntil()` promise chain.

**Debugging approach:**

1. Add granular try/catch logging around each step in `processDocument()` — wrap Kreuzberg extraction separately to distinguish "WASM load failed" from "extraction failed" from "embedding failed"
2. Test locally via `pnpm cf:dev` (emulates Workers runtime)
3. If WASM init fails: check if `@kreuzberg/wasm` v4.4.4 needs explicit WASM binary configuration for Workers
4. If extraction fails: add 30s timeout wrapper so it never hangs
5. Fix silent failure: add fallback `console.error` before DB writes in catch path

**Files:**
- `src/lib/server/rag/kreuzberg-provider.ts` — debug/fix WASM init
- `src/lib/server/rag/process-document.ts` — granular logging, timeout wrapper

### Workstream 2: Harden Pipeline

**Cron recovery job** (in `worker-entry.ts`, every 5 minutes):

1. **Stuck jobs**: `processing_status = 'processing'` AND `updated_at < now - 5min` → mark `failed` with `processing_timeout`
2. **Retry eligible**: `processing_status = 'failed'` AND ingestion job `attempt_count < 3` → reset to `pending`, dispatch `processDocument()`
3. **Orphaned pending**: `processing_status = 'pending'` AND no ingestion job → create job and dispatch

**Retry with backoff:**
- Attempt 1: immediate
- Attempt 2: after 1 minute
- Attempt 3: after 5 minutes
- After 3 failures: stop retrying

**Structured error codes:**

| Error Code | Meaning |
|---|---|
| `wasm_init_failed` | Kreuzberg WASM couldn't load |
| `extraction_failed` | Kreuzberg loaded but extraction threw |
| `extraction_empty` | Extraction returned no text |
| `extraction_timeout` | Extraction took >30s |
| `embedding_failed` | Workers AI embedding call failed |
| `vectorize_upsert_failed` | Vectorize index write failed |
| `r2_object_missing` | File disappeared from R2 |
| `processing_timeout` | Job stuck for >5min (cron cleanup) |
| `ai_cap_reached` | Org hit AI spending cap |

**UI improvements:**
- `failed` badge shows error code as tooltip on hover
- `processing` badge shows spinner animation
- `pending` shows "Queued" instead of "Pending"

**Files:**
- `src/lib/server/rag/process-document.ts` — structured error codes, step-level catch
- `worker-entry.ts` — cron handler for stuck/retry/orphan recovery
- `src/lib/components/chat/DocumentPanel.svelte` — error tooltip, status text

### Workstream 3: Agent Auto-Notify + Verify Search

**Flow:**

```
processDocument() completes indexing
  → POST /chat-room/{roomId}/notify-document
  → Durable Object broadcasts to all connected WebSocket clients:
    { type: "document_indexed", filename, pages, words, chunks, attachmentId }
  → Injects system message into room:
    "[System] DRIVE_Summary.pdf has been indexed (12 pages, ~4,200 words, 9 chunks).
     Agents can query it with doc_search."
```

**Why system message (not just WebSocket event):** Persists in chat history. Reconnecting agents see it in `chat_read` and know documents are available.

**Data flow:**
- `processDocument()` needs the room ID — look it up from the attachment's association (attachments already have `room_id` from upload context)
- After marking `indexed`, call the Durable Object REST endpoint
- Durable Object creates system message, broadcasts, buffers to WAL

**Files:**
- `src/lib/server/rag/process-document.ts` — call DO notify after indexing
- `src/lib/server/chat-room.ts` — add `handleNotifyDocumentIndexed()`
- `src/lib/stores/websocket.svelte.ts` — handle `document_indexed` event
- `src/lib/components/chat/DocumentPanel.svelte` — refresh on WebSocket event

## Key Files Summary

| File | Change |
|---|---|
| `src/lib/server/rag/kreuzberg-provider.ts` | Debug/fix WASM init, add error wrapping |
| `src/lib/server/rag/process-document.ts` | Granular logging, structured errors, timeout, room notify |
| `src/lib/server/chat-room.ts` | Add `handleNotifyDocumentIndexed()` REST endpoint |
| `worker-entry.ts` | Cron job for stuck/retry/orphan recovery |
| `src/lib/components/chat/DocumentPanel.svelte` | Error tooltip, spinner, "Queued" text, WebSocket refresh |
| `src/lib/stores/websocket.svelte.ts` | Handle `document_indexed` broadcast event |

## Verification Plan

### End-to-end acceptance

1. Upload PDF to room → status: Queued → Processing → Indexed (real-time, no refresh)
2. Documents panel shows: filename, page count, word count, indexed timestamp
3. Chat shows system message with document metadata
4. User asks agent about document content → agent calls `doc_search` → responds with citations

### Error paths

5. Upload corrupt/empty PDF → status: Failed with error code tooltip
6. Retry button → re-queues and processes (or fails again with clear reason)
7. Upload when AI cap reached → status: Skipped

### Cron recovery

8. Stuck `processing` attachment (>5min old) → cron marks `failed` with `processing_timeout`
9. Failed attachment with `attempt_count < 3` → cron retries

### Test suite

- Existing 109 billing Vitest tests remain passing
- New unit tests for structured error codes
- New unit tests for cron recovery logic
- New unit test for `extractText()` with mocked Kreuzberg provider

## Sub-project B (future)

After this sub-project is verified working:
- Inline document preview (PDF viewer / text preview)
- Chunk visualization (see what the agent "sees")
- Real semantic search in documents panel
- Processing progress beyond status badges
- Expand allowed file types
