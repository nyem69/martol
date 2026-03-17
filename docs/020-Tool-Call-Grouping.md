# Tool Call Grouping in Chat UI

**Date:** 2026-03-17
**Status:** Phase 1+2+3 complete; Phase 4 (agent emission) pending
**Priority:** 2
**Inspired by:** [jinn](https://github.com/lanteanio/jinn) — groups consecutive tool calls with collapsible summary

## Summary

When agents use MCP tools (`doc_search`, `action_submit`, `chat_read`), each tool result appears as a separate verbose message in the chat, creating noise. This feature groups consecutive tool-call messages from the same agent into a single collapsible unit — collapsed: "3 tools used", expanded: per-tool name + input + result.

## Architecture

**Pure client-side grouping derived from message metadata — no DB migration required.**

Grouping is a rendering concern. The server needs only one small addition: a `subtype: 'tool_call'` marker on the message payload. Everything else — grouping logic, collapse state, the group component — lives in the client.

### Phased approach

- **Phase 1:** Client-side heuristic (body prefix `[tool:<name>]`) — works against existing messages, no server changes
- **Phase 2:** Wire field (`subtype: 'tool_call'`) for authoritative detection
- **Phase 3:** Streaming interaction (coordinate with docs/019)

## Grouping Rules

A group forms when consecutive messages satisfy ALL of:
1. Same `senderId` (same agent)
2. Identified as tool-call messages (by `subtype` or body heuristic)
3. No non-message items (system events, actions) between them

A group breaks when any condition fails.

## Data Types

### TimelineItem (new file: `src/lib/types/timeline.ts`)

```
TimelineItem =
  | { kind: 'message'; data: DisplayMessage }
  | { kind: 'system'; data: SystemEvent }
  | { kind: 'action'; data: PendingAction }
  | { kind: 'tool_group'; data: ToolCallGroup }

ToolCallGroup = {
  groupId: string           // first message's localId (stable key)
  agentId: string
  agentName: string
  messages: ToolCallMessage[]
  timestamp: string         // last message timestamp
  isStreaming: boolean      // true when last message is pending
}

ToolCallMessage = {
  localId: string
  toolName: string          // parsed from body or subtype metadata
  inputSummary: string      // first 120 chars of input args
  resultBody: string        // full body (markdown rendered on expand)
  status: 'ok' | 'error' | 'running'
  timestamp: string
}
```

## Component Design

### ToolCallGroup.svelte (new)

**Collapsed view:**
- Agent avatar/name row (same visual language as `MessageBubble`)
- Pill-style summary: "3 tools used" / "2 tools running..."
- Chevron icon (ChevronRight / ChevronDown)
- Timestamp of last tool call
- Entire pill is a `<button>` toggling `expanded`

**Expanded view (below pill):**
- Per-tool row: tool name badge, truncated input summary, status icon (ok/error/running)
- Inner expand toggle for full output (rendered via `renderMarkdown`)
- No reply/report actions on tool call rows

**Props:** `group: ToolCallGroup`, `isStreaming?: boolean`
**State:** `expanded = $state(false)`

### MessageList.svelte (modified)

In the `$derived.by()` `timeline` block, add a second pass `groupToolCalls(items)` that:
1. Scans the sorted array
2. Collapses consecutive tool-call messages from the same agent
3. Replaces the run with a `kind: 'tool_group'` item

Add `{:else if item.kind === 'tool_group'}` branch rendering `<ToolCallGroup>`.

### Tool Call Detection

**`src/lib/utils/tool-call-parser.ts`** (new):

`isToolCallMessage(msg)` — Phase 1: checks `senderRole === 'agent'` AND body matches `[tool:<name>]` prefix. Phase 2: checks `msg.subtype === 'tool_call'` first, fallback to heuristic.

`parseToolCallBody(body)` — extracts `toolName`, `inputSummary`, `resultBody`, `status` from body convention.

## Phase 2: Wire Field

Add `subtype?: 'tool_call'` to:
- `chatSendSchema` in `src/lib/types/mcp.ts` (agent client sends it)
- `ServerMessagePayload` and `StoredMessage` in `src/lib/types/ws.ts`
- DO ingest handler in `chat-room.ts` (passthrough)
- `DisplayMessage` in `messages.svelte.ts`

The `subtype` is a runtime-only wire field — NOT stored in the DB `messages.type` column. No migration needed.

## Phase 3: Streaming Interaction

When docs/019 streaming lands:
- `ToolCallGroup` receives `isStreaming` derived from `group.messages.some(m => m.status === 'running')`
- While streaming: group stays expanded, last row shows spinner
- Auto-collapse 1s after `isStreaming` transitions to false (via `$effect`)

## Build Sequence

### Phase 1 — Client heuristic (no server changes) ✅

- [x] Create `src/lib/types/timeline.ts` with `ToolCallGroup`, `ToolCallMessage`, `TimelineItem`
- [x] Create `src/lib/utils/tool-call-parser.ts` with `isToolCallMessage`, `parseToolCallBody`
- [x] Add i18n keys to `messages/en.json`: `tool_calls_used`, `tool_calls_running`
- [x] Create `src/lib/components/chat/ToolCallGroup.svelte`
- [x] Modify `MessageList.svelte` — add `groupToolCalls()` pass and `tool_group` branch

### Phase 2 — Wire field (server change, no migration) ✅

- [x] Add `subtype?: 'tool_call'` to `chatSendSchema` in `mcp.ts`
- [x] Add `subtype?: string` to `ServerMessagePayload` and `StoredMessage` in `ws.ts`
- [x] Update `handleMessage` / `handleHistory` in `messages.svelte.ts` to map `subtype`
- [x] Update DO ingest handler in `chat-room.ts` to pass through `subtype`
- [x] Update `isToolCallMessage` to check `subtype` first

### Phase 3 — Streaming (after docs/019) ✅

- [x] Add `isStreaming` prop to `ToolCallGroup`
- [x] Implement auto-collapse `$effect`
- [x] Verify reactivity under streaming updates

### Phase 4 — Agent emission (martol-client)

- [ ] Add `chat_send` MCP tool with `subtype: 'tool_call'` to agent wrapper
- [ ] Emit tool call messages with `[tool:<name>]` prefix during tool loop
- [ ] End-to-end verification: agent tool calls render as grouped pills in browser

## Files

### Create

| File | Purpose |
|------|---------|
| `src/lib/types/timeline.ts` | Timeline item union + tool group types |
| `src/lib/utils/tool-call-parser.ts` | Tool call detection + body parsing |
| `src/lib/components/chat/ToolCallGroup.svelte` | Collapsible tool group component |

### Modify

| File | Change |
|------|--------|
| `src/lib/components/chat/MessageList.svelte` | `groupToolCalls()` pass, `tool_group` render branch |
| `src/lib/stores/messages.svelte.ts` | `subtype` on `DisplayMessage` |
| `src/lib/types/ws.ts` | `subtype` on `ServerMessagePayload`, `StoredMessage` |
| `src/lib/types/mcp.ts` | `subtype` on `chatSendSchema` |
| `src/lib/server/chat-room.ts` | Passthrough `subtype` in ingest |
| `messages/en.json` | Tool grouping i18n keys |
