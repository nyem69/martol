# Streaming Agent Responses

**Date:** 2026-03-17
**Status:** Complete
**Priority:** 1 (highest)
**Inspired by:** [jinn](https://github.com/lanteanio/jinn) — streams Claude Code JSONL deltas to browser in real-time

## Summary

Currently agents send atomic full messages via MCP `chat_send` — users see nothing until the complete response arrives. This feature adds streaming: agents send text deltas over WebSocket as they generate, the DO broadcasts each delta, and the browser renders a progressively-building message bubble with a streaming cursor.

## Architecture

**Agent-driven delta streaming over the existing WebSocket connection, finalized via the normal message ingest path, with ephemeral in-memory DO state for active streams.**

```
Agent (Python)
  │  stream_start {localId, replyTo}
  │──────────────────────────────────► DO.handleStreamStart
  │                                      activeStreams.set(localId, session)
  │                                      broadcast stream_start → browsers
  │
  │  stream_delta {localId, delta} ×N
  │──────────────────────────────────► DO.handleStreamDelta
  │                                      accumulatedBody += delta (size guard)
  │                                      broadcast stream_delta → browsers
  │
  │  stream_end {localId, body}
  │──────────────────────────────────► DO.handleStreamEnd
  │                                      activeStreams.delete(localId)
  │                                      WAL write (seqId assigned)
  │                                      broadcast type:'message' (confirmed)
  │
  └─ (WS disconnects during stream)
       DO.webSocketClose → abortStream(localId)
       broadcast stream_abort → browsers
```

### Why WebSocket (not REST/SSE)

The agent already has an authenticated WS connection. A second HTTP channel would require new auth, fight Cloudflare's 30s request timeout, and double per-event overhead.

### Why not persist deltas to WAL

Deltas are ephemeral. Persisting hundreds of 10-byte fragments to DO storage would inflate WAL size and costs. Only the final committed message is persisted.

### Late joiners

Clients connecting mid-stream miss the stream but receive the committed message on history load. This is correct for the Hibernation API model.

## WebSocket Protocol

### New ClientMessage types (agent → DO)

| Type | Fields | Purpose |
|------|--------|---------|
| `stream_start` | `localId`, `replyTo?` | Declare intent to stream; DO creates in-memory session |
| `stream_delta` | `localId`, `delta` | One text chunk; rate-limit exempt |
| `stream_end` | `localId`, `body` | Stream complete; body is canonical final text for WAL |

### New ServerMessage types (DO → browsers)

| Type | Fields | Purpose |
|------|--------|---------|
| `stream_start` | `localId`, `senderId`, `senderName`, `senderRole`, `replyTo?`, `timestamp` | Browser creates streaming placeholder |
| `stream_delta` | `localId`, `delta` | Browser appends delta to placeholder |
| `stream_abort` | `localId`, `reason` | Stream interrupted; mark placeholder failed |

Finalization reuses existing `type: 'message'` — `MessagesStore.handleMessage` deduplicates by `localId`, replacing the streaming placeholder with the confirmed message.

## DO Internals

### In-memory state

```
activeStreams = Map<localId, { senderId, senderName, senderRole, orgId, replyTo?, timestamp, accumulatedBody }>
```

Not persisted to DO storage. On DO eviction, WS drops and agent reconnects fresh.

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_STREAM_DELTA_SIZE` | 4096 bytes | Per-delta frame limit |
| `MAX_STREAM_BODY_ACCUMULATION` | 32 KB | Same as `MAX_BODY_SIZE`; exceed → abort |
| `MAX_ACTIVE_STREAMS_PER_USER` | 1 | Agent can only have one active stream |

### Rate limiting

- `stream_start` — checked once (gates stream initiation)
- `stream_delta` — exempt (not a message)
- `stream_end` — exempt (already gated at start)

### Degraded mode

`stream_start` checks `this.degraded` and rejects immediately — same pattern as `handleChatMessage`.

## Browser UI

### MessagesStore changes

- `DisplayMessage` gains `streaming?: boolean` field
- New `streamingMessages: SvelteMap<localId, DisplayMessage>` for O(1) delta lookups
- `handleStreamStart` → create placeholder with `streaming: true, body: ''`
- `handleStreamDelta` → `msg.body += delta` (Svelte 5 fine-grained reactivity)
- `handleStreamAbort` → `streaming: false, failed: true`
- `handleMessage` (finalization) → clear `streamingMessages` entry, set `streaming: false`

### MessageBubble changes

- Streaming cursor: blinking inline `span` after accumulated body
- Debounced markdown rendering: raw text displayed immediately, `renderMarkdown` re-runs after 100ms of no deltas (avoids per-token re-render cost)
- Footer label: `chat_streaming` = "generating..."
- Reply/report buttons hidden while `streaming === true`
- Typing indicator suppressed for sender with active stream

## martol-client (Python) Changes

### base_wrapper.py

New methods:
- `send_stream_start(local_id, reply_to=None)`
- `send_stream_delta(local_id, delta)`
- `send_stream_end(local_id, body)`

`send_message` stays intact for atomic messages.

### LLM providers

Add `stream_chat()` to `LLMProvider` ABC returning `AsyncIterator[str]`. Implement for:
- `anthropic.py` — uses `messages.stream()` context manager + `.text_stream`
- `openai_compat.py` — uses `completions.create(stream=True)` + `delta.content`

### wrapper.py

Replace `_generate_response` with streaming version:
1. `send_stream_start` before LLM call
2. Iterate `provider.stream_chat()` deltas → accumulate + `send_stream_delta`
3. On tool use: send `"\n\n[working...]"` delta, process tool, continue streaming
4. On completion: `send_stream_end(local_id, full_body)`
5. On exception: abort stream cleanly

Remove `send_typing` calls from `_generate_response` — `stream_start` replaces typing indicator.

## Build Sequence

### Phase 1 — Protocol ✅

- [x] Add `stream_start`, `stream_delta`, `stream_end` to `ClientMessage` in `ws.ts`
- [x] Add `stream_start`, `stream_delta`, `stream_abort` to `ServerMessage` in `ws.ts`
- [x] Add `activeStreams` map and constants to `chat-room.ts`
- [x] Implement `handleStreamStart`, `handleStreamDelta`, `handleStreamEnd`, `abortStream`
- [x] Wire into `webSocketMessage` router
- [x] Add abort-on-disconnect to `webSocketClose` / `webSocketError`
- [x] Add streaming methods to `base_wrapper.py`

### Phase 2 — Browser accumulation ✅

- [x] Add `streaming` field to `DisplayMessage`
- [x] Add `streamingMessages` Set to `MessagesStore`
- [x] Implement `handleStreamStart`, `handleStreamDelta`, `handleStreamAbort`
- [x] Update `handleMessage` finalization to clear streaming entry

### Phase 3 — UI rendering ✅

- [x] Add streaming cursor + `chat_streaming` footer label to `MessageBubble.svelte`
- [x] Add throttled markdown rendering `$effect`
- [x] Guard reply/report buttons behind `!message.streaming`
- [x] Add `chat_streaming` key to `messages/en.json`

### Phase 4 — Provider streaming ✅

- [x] Add `stream_chat` to `LLMProvider` ABC
- [x] Implement in `providers/anthropic.py`
- [x] Implement in `providers/openai_compat.py`
- [x] Replace `_generate_response` with streaming version in `wrapper.py`
- [ ] Wire streaming into `claude_code_wrapper.py` — deferred (different execution model)

### Phase 5 — Hardening ✅

- [x] Verify rate-limit counter not incremented for deltas
- [x] Verify WAL byte size guard on `stream_end` only
- [x] Verify `stream_abort` fires on WS disconnect mid-stream
- [x] Verify late-joining browser gets completed message from history
- [x] Verify simultaneous streams from two agents render separately
- [x] Add `data-testid` attributes

## Files

### Modify

| File | Change |
|------|--------|
| `src/lib/types/ws.ts` | Add 6 new message types |
| `src/lib/server/chat-room.ts` | Stream handlers, activeStreams map, abort-on-close |
| `src/lib/stores/messages.svelte.ts` | `streaming` field, `streamingMessages` map, 3 new handlers |
| `src/lib/components/chat/MessageBubble.svelte` | Streaming cursor, debounced markdown, footer label |
| `messages/en.json` | `chat_streaming` key |
| `martol-client/martol_agent/base_wrapper.py` | 3 streaming send methods |
| `martol-client/martol_agent/providers/__init__.py` | `stream_chat` ABC method |
| `martol-client/martol_agent/providers/anthropic.py` | `stream_chat` implementation |
| `martol-client/martol_agent/providers/openai_compat.py` | `stream_chat` implementation |
| `martol-client/martol_agent/wrapper.py` | Streaming `_generate_response` |
| `martol-client/martol_agent/claude_code_wrapper.py` | Wire streaming for Claude Code SDK |
