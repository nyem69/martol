# Performance Review — Martol

**Date:** 2026-03-19
**Reviewer:** Performance Engineer (automated)
**Scope:** Database queries, bundle size, Workers performance, frontend reactivity, memory/leaks

---

## CRITICAL

### P-01: N+1 unread count queries in chat page loader

**File:** `src/routes/chat/+page.server.ts`, lines 217-229
**Description:** The unread count calculation issues one `SELECT count(*)` query per room inside a for-loop. A user with 50 rooms triggers 50 sequential queries on every page load.

```ts
for (const room of userRooms) {
    const lastRead = cursorMap.get(room.id) ?? 0;
    const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messagesTable)
        .where(...)
}
```

**Impact:** Linear latency growth with room count. At 50 rooms with ~100ms per query, this adds ~5 seconds to initial page load.

**Fix:** Replace with a single query using a lateral join or CTE:

```sql
SELECT rc.org_id, count(m.id)::int AS unread
FROM read_cursors rc
JOIN messages m ON m.org_id = rc.org_id
  AND m.id > rc.last_read_message_id
  AND m.deleted_at IS NULL
WHERE rc.user_id = $1
  AND rc.org_id = ANY($2)
GROUP BY rc.org_id
```

---

### P-02: `storage.list` full WAL scan on every flush

**File:** `src/lib/server/chat-room.ts`, line 1580
**Description:** During `flushToDb()`, a `storage.list` call scans up to 500 entries to build the `seqToDbId` map for replyTo resolution. This runs on every flush cycle (every 500ms under load), reading far more data than needed.

```ts
const allEntries = await this.ctx.storage.list<StoredMessage>({ prefix: 'msg:', limit: 500 });
```

**Impact:** Each flush reads up to 500 stored messages from DO storage, even when flushing only 1-10 messages. On a busy room this is ~500 reads every 500ms. DO storage has a 128-key batch limit internally, so this becomes 4 sequential reads.

**Fix:** Maintain the `seqToDbId` map in memory (populated during flush when `stored.dbId` is set). It only needs to survive within a single DO instance lifetime (same as `activeStreams`). No storage scan needed.

---

## HIGH

### P-03: Cron orphan cleanup sequential Vectorize + DB deletes

**File:** `worker-entry.ts`, lines 195-219
**Description:** The cron handler deletes orphaned attachments one by one: for each orphan, it queries document_chunks, calls `vectorize.deleteByIds`, then calls `r2Bucket.delete`, then `db.delete`. With 100 orphans, this creates up to 400 sequential operations.

**Impact:** Cron handler may timeout (30s for Workers scheduled events) if many orphans accumulate. The current `limit(100)` on the orphan query makes this worse.

**Fix:** Batch the chunk lookup into a single query (`WHERE attachment_id = ANY($1)`), batch vectorize deletes, and batch DB deletes. R2 has no batch delete API, but the DB and Vectorize operations can be consolidated.

---

### P-04: `findIndex` linear scans in message store hot path

**File:** `src/lib/stores/messages.svelte.ts`, lines 164, 189, 376, 386, 417
**Description:** Every `stream_delta` event triggers `this.messages.findIndex(m => m.localId === msg.localId)` — a linear scan over the entire message array. During streaming with 500+ messages, this runs hundreds of times per second.

**Impact:** O(n) per delta on the UI thread. With 1000 messages and 20 deltas/second, that is 20,000 comparisons/second.

**Fix:** Maintain a `Map<string, number>` index mapping `localId` to array index. Update it on push/splice/clear operations. Reduces lookup from O(n) to O(1).

---

### P-05: RAG search missing LIMIT on document_chunks query

**File:** `src/lib/server/rag/search.ts`, lines 54-67
**Description:** The chunk content lookup uses `inArray(documentChunks.vectorId, vectorIds)` with up to 100 vector IDs (MAX_VECTORIZE_TOPK) but has no `LIMIT` clause. While the `inArray` naturally bounds results, the query plan may still do a full index scan if the planner underestimates cardinality.

**Impact:** With a large corpus (10K+ chunks per org), the query plan may degrade. The `idx_doc_chunks_org` index is on `(org_id)` alone, so filtering by `vector_id IN (...)` requires a secondary filter step.

**Fix:** Add a composite index `idx_doc_chunks_org_vector` on `(org_id, vector_id)` to allow an efficient index-only lookup. Also add `.limit(oversampleK)` as a safety cap.

---

### P-06: Individual INSERT per message in flushToDb

**File:** `src/lib/server/chat-room.ts`, lines 1588-1698
**Description:** Each WAL message is inserted individually with its own `INSERT ... RETURNING`. A burst of 10 messages means 10 round-trips to Aiven PostgreSQL via Hyperdrive.

**Impact:** With Aiven at ~10-20ms per query over Hyperdrive, flushing 10 messages takes 100-200ms. Under high load with FLUSH_BATCH_THRESHOLD=10, this delays subsequent flushes.

**Fix:** Use a batch insert for the common case (no replyTo resolution needed), falling back to individual inserts only for messages with replyTo. Drizzle supports multi-row `.values([...]).returning()`.

---

## MEDIUM

### P-07: Cron handler creates a single DB connection for all operations

**File:** `worker-entry.ts`, lines 133-447
**Description:** The scheduled handler opens one DB connection at line 133 and uses it for 10+ sequential operations (expire actions, purge invitations, clean orphans, recalculate storage, purge jobs, fix stuck jobs, dispatch pending, retry failed, report usage, purge IPs, check neurons). If any operation is slow, the entire cron run delays.

**Impact:** The cron handler may approach the 30-second Workers execution limit on a busy system.

**Fix:** Parallelize independent operations with `Promise.all()` where possible (e.g., expire actions + purge invitations + purge old jobs can run concurrently). Consider splitting into separate cron schedules.

---

### P-08: TextEncoder instantiation on every message validation

**File:** `src/lib/server/chat-room.ts`, lines 58-60, 563, 788, 820, 933, 1058, 1141
**Description:** `new TextEncoder().encode(msg.body).byteLength` is called for every message, delta, and edit. `TextEncoder` is lightweight but the pattern is repeated in 7+ places.

**Impact:** Minor per-call overhead but the real issue is the full encoding of the body just to measure byte length. For a 32KB body, this allocates a 32KB Uint8Array that is immediately discarded.

**Fix:** Create a module-level `const encoder = new TextEncoder()` and reuse it. Consider using `Blob` for byte measurement: `new Blob([str]).size` avoids the intermediate allocation.

---

### P-09: `handleStreamDelta` spread creates new object on every delta

**File:** `src/lib/stores/messages.svelte.ts`, line 380
**Description:** Every stream delta creates a new DisplayMessage object via spread: `{ ...dm, body: dm.body + msg.delta }`. During fast streaming (20+ deltas/sec), this creates 20+ objects/sec that immediately become garbage.

**Impact:** GC pressure during streaming. Combined with the 150ms throttled markdown re-render, the user sees smooth output, but memory churn is higher than needed.

**Fix:** This is intentional for Svelte 5 reactivity (index assignment with new reference). The spread itself is fine; the real optimization is P-04 (avoiding the findIndex before the spread).

---

### P-10: `messages.some(m => m.streaming)` in ResizeObserver callback

**File:** `src/lib/components/chat/MessageList.svelte`, line 172
**Description:** The ResizeObserver callback runs `messages.some(m => m.streaming)` on every resize event. During streaming, the content element resizes frequently (every rendered delta), causing this linear scan to run dozens of times per second.

**Impact:** O(n) scan on every resize during streaming.

**Fix:** Track a `hasStreamingMessage` derived state outside the observer, or use a simple counter that increments on stream_start and decrements on stream_end/abort.

---

### P-11: HMAC key re-imported on every WebSocket connection

**File:** `worker-entry.ts`, lines 595-602
**Description:** Every WebSocket upgrade calls `crypto.subtle.importKey` to import the HMAC signing secret. This is a cryptographic operation that could be cached.

**Impact:** ~0.5-1ms per connection. Not critical but unnecessary when the key never changes.

**Fix:** Cache the imported CryptoKey in a module-level variable (or WeakMap keyed by the secret string). The Worker instance persists across requests within the same isolate.

---

### P-12: `messageByDbId` derived map rebuilds on every message change

**File:** `src/lib/components/chat/MessageList.svelte`, line 48
**Description:** `const messageByDbId = $derived(new Map(messages.filter(m => m.dbId).map(m => [m.dbId!, m])))` rebuilds the entire Map on every messages array change — which happens on every new message, edit, or streaming delta.

**Impact:** O(n) Map construction on every update. With 500 messages and streaming at 20 deltas/sec, this rebuilds a 500-entry Map 20 times per second.

**Fix:** Use a memoized approach that only rebuilds when the array reference changes and message count differs, or maintain the map incrementally.

---

### P-13: Auto-accept invitation loop with sequential API calls

**File:** `src/routes/chat/+page.server.ts`, lines 170-192
**Description:** On every chat page load, all pending invitations for the user are fetched, then each is accepted sequentially via `auth.api.acceptInvitation`. This blocks the page load.

**Impact:** Each acceptInvitation involves DB writes (member insert, invitation update). Multiple pending invitations can add significant latency to page load.

**Fix:** Move auto-accept to a background job or `ctx.waitUntil`. At minimum, use `Promise.all` for parallel acceptance.

---

## LOW

### P-14: `addProcessingFile` timeout never cleared on explicit removal

**File:** `src/lib/stores/messages.svelte.ts`, lines 553-561
**Description:** The 3-minute fallback timeout in `addProcessingFile` is never cleared when the file is removed via the `document_indexed` handler. The timer reference is not stored, so it will fire even after the file has been successfully indexed.

**Impact:** Minimal — the filter operation is a no-op if the file is already removed. But it is a code smell indicating a potential leak pattern.

**Fix:** Store the timeout reference in a Map and clear it when the file is removed from `processingFiles`.

---

### P-15: `timeline` derived recalculates on systemEvents or actions changes

**File:** `src/lib/components/chat/MessageList.svelte`, lines 81-109
**Description:** The `timeline` derived merges messages + systemEvents + actions, sorts, and groups tool calls. Any change to systemEvents (join/leave) triggers a full recalculation including the sort and groupToolCalls pass.

**Impact:** The sort is O(n log n) on every presence change. With many agents connecting/disconnecting, this can cause unnecessary work.

**Fix:** Consider splitting the timeline into message-only and event-only streams, merged only for rendering.

---

### P-16: Large dependency footprint near Worker size limit

**File:** `package.json`
**Description:** The Worker is at ~9.3MB of the 10MB gzipped limit. Key large dependencies:
- `@kreuzberg/wasm`: ~7.5MB (WASM binary for document extraction)
- `@sentry/cloudflare` + `@sentry/sveltekit`: significant overhead
- `stripe`: large SDK, only needed in a few routes
- `ai` + `@ai-sdk/openai` + `workers-ai-provider`: AI SDK trio

**Impact:** Only 0.7MB headroom. Adding any significant dependency will exceed the limit.

**Fix:** Evaluate whether `stripe` can be loaded via dynamic import only in billing routes (it likely already is via SvelteKit code splitting for server routes). Consider if Sentry can be configured with a lighter bundle. Monitor with `wrangler deploy --dry-run` after dependency updates.

---

### P-17: `handleIdMap` and `handleEdit` use `Array.find` for lookups

**File:** `src/lib/stores/messages.svelte.ts`, lines 274-279, 283-287
**Description:** `handleIdMap` iterates mappings and uses `this.messages.find()` for each. `handleEdit` also uses `find` by `serverSeqId`. Both are O(n) per lookup.

**Impact:** Low frequency (id_map sent once per flush, edits are rare), so practical impact is minimal.

**Fix:** Same as P-04 — maintain lookup indices for both `localId` and `serverSeqId`.

---

### P-18: Attachment backfill in flushToDb uses sequential per-key updates

**File:** `src/lib/server/chat-room.ts`, lines 1712-1735
**Description:** After flushing, the code scans message bodies for `r2:` references and updates each attachment individually. A message with 5 images triggers 5 sequential UPDATE queries.

**Impact:** Low frequency (only messages with attachments), but adds latency to the flush cycle.

**Fix:** Collect all (r2Key, messageId) pairs and issue a single UPDATE with a VALUES list or use a CTE.

---

### P-19: Rate limiter timestamp arrays grow without bound within window

**File:** `src/lib/server/chat-room.ts`, lines 111-116
**Description:** `ragRoomTimestamps`, `ragUserTimestamps`, and `userMessageTimestamps` are arrays that grow with each message/RAG call. They are pruned to the window on check, but between checks they accumulate.

**Impact:** Negligible memory — timestamps are small. But `ragUserTimestamps` is a `Map<string, number[]>` that never removes entries for users who have left. Over a long DO lifetime with many unique users, this Map grows unbounded.

**Fix:** Clear entries from `ragUserTimestamps` and `userMessageTimestamps` when a user disconnects (in `broadcastPresenceOffline`).

---

### P-20: `measureBytes` JSON-serializes then encodes for every WAL write

**File:** `src/lib/server/chat-room.ts`, lines 58-60
**Description:** `measureBytes` calls `JSON.stringify` then `new TextEncoder().encode()` on every stored message to track WAL byte size. This double-serializes the message (once for measurement, once for storage.put).

**Impact:** ~0.1ms per message. Minor but wasteful.

**Fix:** Estimate byte size from the body length (body accounts for >90% of message size). Use `body.length * 3 + 200` as a conservative UTF-8 upper bound, or measure after serialization (pass the serialized form to both measureBytes and storage.put).

---

## Summary

| Severity | Count | Key Areas |
|----------|-------|-----------|
| CRITICAL | 2 | N+1 unread query loop, WAL full scan on flush |
| HIGH | 4 | Cron N+1 deletes, findIndex linear scans, missing index, individual INSERTs |
| MEDIUM | 7 | Cron timeout risk, TextEncoder reuse, GC pressure, ResizeObserver scan |
| LOW | 7 | Timer leaks, Map growth, dependency size, minor inefficiencies |

**Top 3 recommendations by impact:**
1. **P-01**: Replace N+1 unread count loop with a single aggregate query — immediate page load improvement
2. **P-02**: Maintain seqToDbId map in memory instead of scanning DO storage on every flush
3. **P-04**: Add localId index Map to messages store — eliminates O(n) findIndex on streaming hot path
