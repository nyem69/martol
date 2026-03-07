# Inline Action Approval UI

**Date:** 2026-03-04
**Status:** Implemented

## Summary

Agents submit structured actions via MCP `action_submit` that require human approval before execution. Action cards now appear **inline in the chat timeline**, interleaved chronologically with messages and system events. Owners and leads can approve or reject directly from the chat flow.

Previously, pending actions rendered in a fixed panel between the message list and chat input — disconnected from context. This made it hard to correlate actions with the agent messages that triggered them.

## Architecture

```
Agent submits action via MCP
        │
        ▼
┌─────────────────────┐
│  pending_actions DB  │  status: pending
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  GET /api/actions    │  ?status=recent
│  (last 24h + pending)│
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  ChatView.svelte     │  fetches recentActions, passes to MessageList
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  MessageList.svelte  │  merges actions into timeline by timestamp
│  ┌─────────────────┐ │
│  │ MessageBubble   │ │  ← agent message
│  │ PendingActionLine│ │  ← action card (approve / reject)
│  │ MessageBubble   │ │  ← human reply
│  └─────────────────┘ │
└──────────────────────┘
```

## API: `?status=recent` Mode

**Endpoint:** `GET /api/actions?status=recent`

Returns all actions from the last 24 hours (any status) **plus** all pending actions regardless of age. This ensures the timeline shows resolved actions for context while never hiding a pending action that still needs a decision.

```sql
WHERE org_id = :orgId
  AND (created_at >= NOW() - INTERVAL '24 hours' OR status = 'pending')
ORDER BY created_at DESC
LIMIT 50
```

The existing single-status filters (`pending`, `approved`, `rejected`, `expired`, `executed`) remain unchanged.

## Timeline Merge

`MessageList.svelte` merges three item types into one sorted timeline:

| Kind | Source | Key | Timestamp field |
|------|--------|-----|-----------------|
| `message` | `DisplayMessage[]` | `localId` | `timestamp` |
| `system` | `SystemEvent[]` | `id` | `timestamp` |
| `action` | `PendingAction[]` | `action-${id}` | `timestamp` |

All items are sorted by timestamp ascending so actions appear at the correct chronological position relative to the agent messages that triggered them.

## Component Wiring

### ChatView → MessageList

```
<MessageList
  messages={store.messages}
  systemEvents={store.systemEvents}
  actions={recentActions}            ← NEW
  canApproveActions={...}            ← NEW
  onApproveAction={handleApprove}    ← NEW
  onRejectAction={handleReject}      ← NEW
/>
```

The fixed panel between MessageList and ChatInput has been removed.

### PendingActionLine (unchanged)

Reused as-is. Renders a risk-colored card with:
- Risk level badge (high = red, medium = amber, low = muted)
- Action type and description
- Approve / Reject buttons (when `status === 'pending'` and user can approve)
- Status badge (when already resolved)

## Optimistic Updates

Approve and reject handlers update the local `recentActions` array immediately before the API call returns. If the API call fails, the array reverts to its previous state.

```
User clicks Approve
  → recentActions[i].status = 'approved'  (instant UI update)
  → POST /api/actions/:id/approve
  → on failure: revert to previous array
```

## Auto-Refresh

A `$effect` watches `store.messages` for new agent messages. When the latest message is from an agent, a debounced refresh (2 seconds) fetches updated actions. This catches newly submitted actions without polling.

## Authorization Matrix

| Role | View actions | Approve low/medium | Approve high | Reject |
|------|-------------|-------------------|-------------|--------|
| Owner | Yes | Yes | Yes | Yes |
| Lead | Yes | Yes | No | Yes |
| Member | No | No | No | No |
| Viewer | No | No | No | No |

## Files Changed

| File | Change |
|------|--------|
| `src/routes/api/actions/+server.ts` | Added `?status=recent` query mode |
| `src/lib/components/chat/MessageList.svelte` | Actions as third timeline item type |
| `src/lib/components/chat/ChatView.svelte` | Inline wiring, removed fixed panel, optimistic updates, auto-refresh |
| `src/lib/components/chat/PendingActionLine.svelte` | Unchanged — reused as-is |

---

## Review Findings

Multi-agent review conducted 2026-03-04 covering Cloudflare infrastructure, database, security, UI/UX, and martol-client compatibility.

### martol-client Compatibility

martol-client is a **Python agent daemon** (not a web UI). It connects AI models to chat rooms via WebSocket + MCP HTTP at `/mcp/v1`. It never calls the REST `/api/actions` endpoints.

| Aspect | Status | Detail |
|--------|--------|--------|
| `action_submit` via MCP | OK | Both provider and Claude Code modes |
| `action_status` polling | OK | Polls every 3s, handles `rejected` + `denied` |
| `trigger_message_id` | **Missing** | Claude Code mode's `_handle_permission()` omits it — field is `required` in tool schema |
| `executed` status | Partial | Client doesn't handle it; server goes through `approved` first |
| Real-time approval notification | None | Client polls; no WS push event for status changes |
| Action visibility in LLM context | None | Agent's context window has no action history |

### Critical: Security

**S1 — Agent self-approval.** Neither the REST `approve` endpoint nor the DO `handleActionApproval` checks whether the approver is the same entity that submitted the action. A compromised agent with `lead` role can submit and immediately approve its own actions, bypassing the human-in-the-loop gate.

- **File:** `src/routes/api/actions/[id]/approve/+server.ts`
- **Fix:** `if (action.agentUserId === locals.user.id) error(403, 'Cannot approve own action')`

**S2 — TOCTOU race on approve/reject.** Both endpoints do a SELECT (check `status = 'pending'`) then a separate UPDATE (set new status). Two concurrent requests both pass the check; the second overwrites the first. A rejection can be overridden by a late approval.

- **Files:** `approve/+server.ts`, `reject/+server.ts`
- **Fix:** Single atomic UPDATE with `WHERE status = 'pending'` + check `RETURNING` row count

### Critical: UI/UX

**U1 — No loading state / double-submit guard.** Approve/reject buttons remain interactive during the API call. Rapid clicks fire duplicate requests. On slow networks, the optimistic update snaps back jarringly on failure.

- **Files:** `ChatView.svelte`, `PendingActionLine.svelte`
- **Fix:** Track `actionsInFlight: Set<number>`, pass `loading` prop, disable buttons

### Important: Infrastructure

**I1 — REST approve/reject bypasses DO broadcast.** UI buttons call REST directly. Other WebSocket clients (second lead, owner on another device) receive no notification. The DO path (slash commands) does broadcast, creating two inconsistent approval paths.

- **Fix:** Either route UI buttons through the DO, or have REST endpoints forward status-change events to the DO after DB write

**I2 — OR query defeats composite index.** `?status=recent` uses `OR(gte(created_at, cutoff), eq(status, 'pending'))`. The single index `(org_id, status, created_at)` cannot serve both arms efficiently. PostgreSQL falls back to bitmap-or or sequential scan.

- **Fix:** Split into two indexed queries (all pending + recent non-pending) and merge in application code

**I3 — `$effect` timer cancelled on human messages.** The cleanup function runs unconditionally on every re-run. If a human message arrives after an agent message, the cleanup cancels the pending refresh timer before it fires.

- **Fix:** Return cleanup only when the agent branch is taken:
  ```ts
  if (lastMsg?.senderRole !== 'agent') return;
  const timerId = setTimeout(() => loadRecentActions(), 2000);
  return () => clearTimeout(timerId);
  ```

**I4 — 50-item LIMIT can drop pending actions.** For active orgs with many resolved actions in 24h, the LIMIT truncates oldest items. A pending action could be pushed out by newer resolved ones.

- **Fix:** Fetch all pending (uncapped) separately, then recent resolved (capped), merge

**I5 — No rate limiting on approve/reject endpoints.** `hooks.server.ts` only rate-limits OTP and invite paths. Approve/reject have no limit, enabling enumeration and spam.

- **Fix:** Add per-user rate limit (e.g., 60/min) via existing `checkRateLimit` helper

### Important: UI/UX

**I6 — `role="alert"` causes screen reader storm.** Every action card fires an immediate screen reader announcement. Multiple cards on load or refresh interrupts the user repeatedly. The parent container already has `role="log"` + `aria-live="polite"`.

- **Fix:** Change to `role="group"` with `aria-label`

**I7 — `replace('_', ' ')` only replaces first underscore.** `action.actionType.replace('_', ' ')` is string replacement, not regex. `send_slack_message` renders as `send slack_message`.

- **Fix:** `.replace(/_/g, ' ')`

**I8 — Auto-scroll triggers on action refresh.** The `$effect` watching `timeline.length` fires when actions are added/updated, not just messages. The "New messages" pill appears for action refreshes.

- **Fix:** Only set `hasNewMessages = true` when new item is `kind === 'message'`

**I9 — Action cards have insufficient visual separation.** Cards use `my-1.5` (6px) vertical margin, nearly identical to message spacing. In dense chat, action cards blend in rather than commanding attention.

- **Fix:** Increase to `my-3` or add a visual divider

**I10 — Touch targets below 44px minimum.** Buttons use `px-3 py-1 text-xs` (~30px tall). Below Apple HIG and Material Design minimums for Capacitor mobile builds.

- **Fix:** Add `min-h-[44px]` and `min-w-[72px]`; add `flex-wrap` to meta row

**I11 — Members/viewers see no action lifecycle.** Members see agent messages requesting approval but zero action cards — the agent appears to act autonomously. Undermines the "server-enforced authority" trust model.

- **Fix:** Pass actions to all roles; let `canApprove` control button visibility. `PendingActionLine` already handles the no-button case.

**I12 — UPDATE missing `orgId` in WHERE clause.** The approve endpoint's final UPDATE filters only by action ID, not org ID. The prior SELECT checks org membership, but defense-in-depth requires the constraint on the write path too.

- **Fix:** Add `eq(pendingActions.orgId, orgId)` to the UPDATE WHERE clause

### Design Considerations (Devil's Advocate)

1. **Inline timeline may not be the right metaphor.** Actions have a lifecycle (pending → resolved) unlike ephemeral messages. A dedicated sidebar or pinned section might serve the approval workflow better than forcing cards into the message stream.

2. **Two approval paths (REST + DO) is a synchronization trap.** Optimistic UI on top of two unsynchronized paths creates false consistency. Consider a single canonical path.

3. **Polling on agent messages is fragile.** If an agent submits an action via MCP without sending a chat message, the UI never learns about it until next page load.

4. **The 24h window is arbitrary.** Creates an audit cliff — actions resolved more than 24h after submission vanish from the timeline. Consider tracking `updated_at` for resolution-time queries.
