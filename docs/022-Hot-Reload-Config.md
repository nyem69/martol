# Hot-Reload Room Config Broadcasting

**Date:** 2026-03-17
**Status:** Complete (Phase 1-6; Phase 7 verification pending)
**Priority:** 4
**Inspired by:** [jinn](https://github.com/lanteanio/jinn) — watches config files, broadcasts changes via WebSocket, all clients refresh automatically

## Summary

Currently, changing room settings (name, OCR toggle) requires a page refresh for other connected clients to see changes. This feature adds push-on-write broadcasting: when a REST endpoint mutates a room setting, it notifies the Durable Object, which broadcasts the change to all connected clients. Svelte 5 reactivity updates the UI instantly.

## Architecture

**Push-on-write via internal DO POST, carrying the full config delta inline.**

This generalizes the existing `brief_changed` pattern. Each REST endpoint that mutates a setting fires an internal POST to the DO with a typed payload. The DO broadcasts a `room_config_changed` message with the field name and new value — clients apply it immediately without a secondary fetch.

`brief_changed` is retained as-is (large content, versioned, fetched on demand). All other scalar/boolean settings use the new `room_config_changed` event.

### Data Flow

```
User changes setting (e.g. OCR toggle)
  → PATCH /api/rooms/[roomId]/ocr
  → +server.ts: validate role, UPDATE organization
  → POST stub.fetch('https://do/notify-config')
      headers: { X-Internal-Secret }
      body: { field: 'ocr_enabled', value: true, changedBy: userId }
  → ChatRoom DO: handleNotifyConfig()
      broadcast { type: 'room_config_changed', field, value, changedBy }
  → All connected WebSockets receive event
  → MessagesStore.handleServerMessage()
      this.ocrEnabled = msg.value
  → Svelte 5 reactivity: UI re-renders
```

## Settings That Trigger Broadcasts

| Setting | Endpoint | Broadcast? | Notes |
|---------|----------|------------|-------|
| Room name | `PATCH /api/rooms/[roomId]/name` (new) | Yes | Visible in header for all members |
| Brief | `PUT /api/rooms/[roomId]/brief` | Already has `brief_changed` | Special: versioned, large |
| OCR toggle | `PATCH /api/rooms/[roomId]/ocr` | Yes | Affects upload UI |
| AI opt-out | `PATCH /api/rooms/[roomId]/ai-opt-out` | No | Personal setting, affects only the user |
| Member changes | Better Auth org membership | Out of scope | Already handled via `roster`/`presence` |

## WebSocket Protocol

### New ServerMessage type

```
{ type: 'room_config_changed'; field: 'name' | 'ocr_enabled'; value: string | boolean; changedBy: string }
```

Adding a new field later means adding to the `field` union and one new case in `MessagesStore` — no structural changes.

## Component Design

### chat-room.ts (DO)

Add `/notify-config` route to `fetch()` dispatcher (alongside existing `/notify-brief`, `/notify-document`).

Handler: validate `X-Internal-Secret`, parse body `{ field, value, changedBy }`, call `this.broadcast()`. Mirrors `handleNotifyBrief` exactly.

### OCR endpoint (existing)

After `UPDATE organization` succeeds in the PATCH handler, add DO notification call (same try/catch pattern as brief endpoint). Payload: `{ field: 'ocr_enabled', value: body.enabled, changedBy }`.

### Name endpoint (new)

`PATCH /api/rooms/[roomId]/name/+server.ts`:
- Auth + membership check (owner/admin)
- Validate name (non-empty, max 100 chars)
- `UPDATE organization SET name = ?`
- DO notify-config: `{ field: 'name', value: newName, changedBy }`
- Return `{ ok: true, name }`

### MessagesStore (client)

Add `$state` fields:
- `roomName = $state<string>('')`
- `ocrEnabled = $state<boolean>(false)`

Initialized from `+page.server.ts` load data. Updated via `case 'room_config_changed'` in `handleServerMessage`.

### Chat page

Derive displayed room name from `store.roomName`. OCR toggle state from `store.ocrEnabled`. No explicit `$effect` polling — direct `$state` mutation triggers Svelte 5 reactivity.

## Build Sequence

### Phase 1 — Type contract ✅

- [x] Add `room_config_changed` to `ServerMessage` in `ws.ts`

### Phase 2 — DO internal handler ✅

- [x] Add `/notify-config` branch in `fetch()` dispatcher in `chat-room.ts`
- [x] Implement `handleNotifyConfig()` private method

### Phase 3 — Wire OCR endpoint ✅

- [x] Add DO notify-config call to `PATCH /ocr` after DB write

### Phase 4 — Room name endpoint ✅

- [x] Create `src/routes/api/rooms/[roomId]/name/+server.ts`

### Phase 5 — Client store ✅

- [x] Add `roomName` and `ocrEnabled` state to `MessagesStore`
- [x] Add constructor params for initial values
- [x] Add `case 'room_config_changed'` handler

### Phase 6 — Chat page wiring ✅

- [x] Pass initial values from `+page.server.ts` load to `MessagesStore`
- [x] Bind UI elements to `store.roomName` and `store.ocrEnabled`

### Phase 7 — Verification

- [ ] Test: two browser tabs, change OCR in one → other updates without refresh
- [ ] Test: change room name → all connected tabs update live

## Design Decisions

**Why inline payload (not signal + re-fetch)?** Settings are simple scalars. Inline eliminates a round-trip. Brief is the exception — large, versioned, correctly fetched on demand.

**Why not DO polling?** The DO has no persistent Postgres connection or scheduler. The REST handler is the authoritative write point.

**Why does the changer receive the broadcast too?** Keeps multi-tab consistency. `MessagesStore` overwrites idempotently — no loop risk since config changes never go over WS from client to server.

**Why no DO storage?** Config is not cached in DO transactional storage. The DO is a pure broadcast relay. Authoritative state lives in the Postgres organization row, read at page load.

## Files

### Create

| File | Purpose |
|------|---------|
| `src/routes/api/rooms/[roomId]/name/+server.ts` | Room name PATCH endpoint |

### Modify

| File | Change |
|------|--------|
| `src/lib/types/ws.ts` | Add `room_config_changed` to `ServerMessage` |
| `src/lib/server/chat-room.ts` | `/notify-config` route + handler |
| `src/routes/api/rooms/[roomId]/ocr/+server.ts` | Add DO notify-config call |
| `src/lib/stores/messages.svelte.ts` | `roomName`, `ocrEnabled` state + handler |
| `src/routes/chat/+page.server.ts` | Pass initial config to store |
| `src/routes/chat/+page.svelte` | Bind UI to reactive store fields |
