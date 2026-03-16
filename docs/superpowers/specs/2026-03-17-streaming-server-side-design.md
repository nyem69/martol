# Design: Streaming Agent Responses — Server-Side (Phases 1-3)

**Date:** 2026-03-17
**Scope:** WebSocket protocol + DO handlers + browser store + UI rendering (martol repo only, no Python changes)
**Parent spec:** `docs/019-Streaming-Agent-Responses.md`

## Goal

Add streaming support to the martol server and browser so that when agents send progressive text deltas, users see a live-building message bubble instead of waiting for the full response.

## Scope Boundary

This spec covers **only** the martol repo changes:
- Phase 1: WebSocket protocol types + DO stream handlers
- Phase 2: MessagesStore accumulation logic
- Phase 3: MessageBubble streaming UI

Python client changes (martol-client providers, wrapper.py streaming) are **out of scope** — they'll be a separate spec.

Testing will be done via a manual WebSocket script or browser devtools to simulate agent streaming before the Python client is updated.

## Phase 1: Protocol + DO Handlers

### New ClientMessage types in `src/lib/types/ws.ts` (line 10-15)

Add three new union members after the existing five:

| Type | Fields | Purpose |
|------|--------|---------|
| `stream_start` | `localId: string`, `replyTo?: number` | Agent declares intent to stream |
| `stream_delta` | `localId: string`, `delta: string` | One text chunk (rate-exempt) |
| `stream_end` | `localId: string`, `body: string` | Final canonical text for WAL persistence |

### New ServerMessage types in `src/lib/types/ws.ts` (line 30-41)

Add three new union members:

| Type | Fields | Purpose |
|------|--------|---------|
| `stream_start` | `localId`, `senderId`, `senderName`, `senderRole`, `replyTo?`, `timestamp` | Browser creates placeholder |
| `stream_delta` | `localId`, `delta` | Browser appends delta |
| `stream_abort` | `localId`, `reason` | Stream interrupted |

Finalization reuses existing `type: 'message'` — dedup by `localId` replaces the streaming placeholder.

### DO changes in `src/lib/server/chat-room.ts`

**New in-memory state** (near line 80, alongside `degraded`):
```
private activeStreams = new Map<string, {
  senderId: string; senderName: string; senderRole: string;
  orgId: string; replyTo?: number; timestamp: string;
  accumulatedBytes: number;
}>()
```

**New constants** (near line 23-32):
```
MAX_STREAM_DELTA_SIZE = 4096
MAX_STREAM_BODY_SIZE = 32 * 1024  (same as MAX_BODY_SIZE)
MAX_ACTIVE_STREAMS_PER_USER = 1
STREAM_TIMEOUT_MS = 120_000  (2 minutes — abort stale streams)
```

**Stream timeout**: The existing cron alarm or a new periodic check should iterate `activeStreams` and abort any stream older than `STREAM_TIMEOUT_MS`. This handles the case where an agent sends `stream_start` but crashes without disconnecting (TCP keepalive may not fire for minutes). Implementation: check in the existing flush alarm handler (runs every 500ms when active).

**webSocketMessage router** (line 290-323): Add three new cases in the switch:
- `'stream_start'` → `handleStreamStart(ws, msg)`
- `'stream_delta'` → `handleStreamDelta(ws, msg)`
- `'stream_end'` → `handleStreamEnd(ws, msg)`

**handleStreamStart(ws, msg)**:
1. Extract identity from WS tags (same pattern as handleChatMessage line 419-423)
2. Check `this.degraded` → reject with `sendError(ws, 'degraded', ...)`
3. Reject `viewer` role (same guard as handleChatMessage line 430-433)
4. Check `isRateLimited(userId)` → reject (gates stream initiation)
5. Check WAL capacity → reject if full
6. Validate `localId` with `LOCAL_ID_RE`
7. Reject if sender already has an active stream (`MAX_ACTIVE_STREAMS_PER_USER`)
8. Create entry in `activeStreams`
9. Broadcast `{ type: 'stream_start', localId, senderId, senderName, senderRole, replyTo, timestamp }`

**handleStreamDelta(ws, msg)**:
1. Look up session by `localId` in `activeStreams`. If not found → silently ignore (delta for unknown/aborted stream)
2. Validate ownership (senderId matches WS tag). If mismatch → silently ignore
3. Validate `delta.length <= MAX_STREAM_DELTA_SIZE`. If exceeded → `abortStream(localId, 'delta_too_large')`
4. `session.accumulatedBytes += delta.length`
5. If accumulated > `MAX_STREAM_BODY_SIZE` → `abortStream(localId, 'body_too_large')`
6. Broadcast `{ type: 'stream_delta', localId, delta }`
7. No rate-limit increment, no WAL write

**handleStreamEnd(ws, msg)**:
1. Look up session by `localId` in `activeStreams`. If not found → silently ignore (end for unknown/aborted stream)
2. Validate ownership (senderId matches WS tag)
3. Remove session from `activeStreams`
4. Validate `msg.body.length <= MAX_BODY_SIZE`
5. Use `msg.body` as canonical final text (not accumulated deltas)
6. Use `replyTo` from the `activeStreams` session (captured at `stream_start`), not from `stream_end` message
7. Follow same WAL write + broadcast path as handleChatMessage (lines 495-547):
   - Create `StoredMessage` with the session's `senderId`, `senderName`, `senderRole`, `orgId`, `replyTo`, `timestamp` + final body
   - Atomic storage put
   - Broadcast `{ type: 'message', message: payload }`
   - Schedule flush alarm
8. Skip rate-limit check (already gated at stream_start)

**abortStream(localId, reason)**:
1. Remove from `activeStreams`
2. Broadcast `{ type: 'stream_abort', localId, reason }`

**webSocketClose / webSocketError** (find existing handlers):
- Extract `userId` from WS tags via `this.ctx.getTags(ws)` (same pattern as other handlers — tags persist through hibernation)
- Iterate `activeStreams` values, find entries where `senderId === userId`
- Call `abortStream(localId, 'client_disconnected')` for each

## Phase 2: Browser Accumulation

### MessagesStore changes in `src/lib/stores/messages.svelte.ts`

**DisplayMessage** (line 15-29): Add `streaming?: boolean` field.

**New private state**: `private streamingMessages = new Map<string, number>()` — maps `localId` to index in `this.messages` array. We use an index (not an object reference) because Svelte 5 `$state` arrays are reactive at the element level only when mutated via array methods or index assignment.

**handleServerMessage** (line 89-125): Add three cases:
- `'stream_start'` → `handleStreamStart(msg)`
- `'stream_delta'` → `handleStreamDelta(msg)`
- `'stream_abort'` → `handleStreamAbort(msg)`

**handleStreamStart(msg)**:
- Create `DisplayMessage` with `streaming: true`, `pending: false`, `failed: false`, `body: ''`, no `serverSeqId`
- Push to `this.messages` — record its index
- Register in `streamingMessages` map: `localId → index`
- Suppress any existing typing indicator for this sender

**handleStreamDelta(msg)**:
- Look up index by `localId` in `streamingMessages`. If not found → ignore
- **Reactivity strategy**: Use index assignment to trigger Svelte 5 reactivity:
  ```
  const idx = this.streamingMessages.get(msg.localId);
  const dm = this.messages[idx];
  this.messages[idx] = { ...dm, body: dm.body + msg.delta };
  ```
  Spreading creates a new object reference at that index, which Svelte 5 `$state` arrays detect as a change. This is the same pattern used elsewhere in the store for updating individual messages.

**handleStreamAbort(msg)**:
- Look up index by `localId` in `streamingMessages`. If not found → ignore
- Update via index assignment: `this.messages[idx] = { ...dm, streaming: false, failed: true }`
- Remove from `streamingMessages`

**handleMessage** (line 127-156) — finalization:
- **Before** the existing dedup logic, check if `localId` exists in `streamingMessages`
- If found: remove from `streamingMessages`, update via index assignment with confirmed fields (`streaming: false`, `serverSeqId`, `dbId`, final `body`), and return early (skip creating a new DisplayMessage)
- If not found: fall through to existing dedup logic (handles normal messages and optimistic sends)

**handleClear** (line 271-279):
- After resetting `this.messages = []`, also clear `this.streamingMessages` to avoid stale index references

## Phase 3: UI Rendering

### MessageBubble.svelte changes

**Streaming cursor**: When `message.streaming === true`, append a blinking cursor span after the body content.

**Throttled markdown**: The current `htmlBody = $derived(renderMarkdown(message.body))` re-evaluates on every delta (expensive). Replace with a throttled approach: always render markdown (never show raw text), but throttle re-renders to every 150ms during streaming. Use a `$state` for `renderedHtml` updated via a throttled `$effect` that checks `message.streaming` — when streaming stops, do one final render immediately.

**Footer label**: Add a streaming state between pending and confirmed:
```
{#if message.pending}
  ... "Sending..."
{:else if message.streaming}
  <span class="text-[10px] animate-pulse">{m.chat_streaming()}</span>
{:else if message.failed}
  ... "Failed to send"
```

**Action buttons guard** (line 158): Extend to `!message.pending && !message.streaming && !message.failed && message.dbId`.

### i18n in `messages/en.json`

Add: `"chat_streaming": "generating…"`

## Testing Strategy

Since the Python client isn't updated yet, test with a manual WebSocket script:

```javascript
// Connect as an agent, send stream_start, N deltas, stream_end
ws.send(JSON.stringify({ type: 'stream_start', localId: 'test-001' }));
for (const chunk of ['Hello ', 'world, ', 'this is ', 'streaming!']) {
  ws.send(JSON.stringify({ type: 'stream_delta', localId: 'test-001', delta: chunk }));
}
ws.send(JSON.stringify({ type: 'stream_end', localId: 'test-001', body: 'Hello world, this is streaming!' }));
```

Verify:
- Streaming bubble appears on `stream_start`
- Body builds progressively on each `stream_delta`
- Bubble transitions to confirmed on `stream_end` (gets serverSeqId)
- Disconnecting mid-stream triggers `stream_abort` → bubble shows failed state
- Late-joining browser gets the committed message from history (no orphan)
