# Streaming Agent Responses (Server-Side) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebSocket streaming protocol, DO handlers, browser store accumulation, and UI rendering so agents can send progressive text deltas that render as live-building message bubbles.

**Architecture:** Three new ClientMessage types (stream_start/delta/end) and three ServerMessage types (stream_start/delta/abort). The DO holds ephemeral in-memory stream state, broadcasts deltas, and commits the final message via the existing WAL path. The browser store accumulates deltas using index assignment for Svelte 5 reactivity, and MessageBubble renders with a throttled markdown effect and streaming cursor.

**Tech Stack:** TypeScript, SvelteKit, Cloudflare Durable Objects (Hibernation API), Svelte 5 runes

**Spec:** `docs/superpowers/specs/2026-03-17-streaming-server-side-design.md`

---

## Chunk 1: Protocol Types + DO Handlers

### Task 1: Add streaming types to ws.ts

**Files:**
- Modify: `src/lib/types/ws.ts`

- [ ] **Step 1: Add three ClientMessage union members**

Add after line 15 (the `edit` member):

```typescript
	| { type: 'stream_start'; localId: string; replyTo?: number }
	| { type: 'stream_delta'; localId: string; delta: string }
	| { type: 'stream_end'; localId: string; body: string };
```

- [ ] **Step 2: Add three ServerMessage union members**

Add after line 41 (the `error` member):

```typescript
	| { type: 'stream_start'; localId: string; senderId: string; senderName: string; senderRole: string; replyTo?: number; timestamp: string }
	| { type: 'stream_delta'; localId: string; delta: string }
	| { type: 'stream_abort'; localId: string; reason: string };
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm check`
Expected: No errors related to ws.ts

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/ws.ts
git commit -m "feat: add streaming WebSocket protocol types (stream_start/delta/end/abort)"
```

### Task 2: Add streaming constants and state to ChatRoom DO

**Files:**
- Modify: `src/lib/server/chat-room.ts`

- [ ] **Step 5: Add streaming constants**

Add after line 34 (`LOCAL_ID_RE`):

```typescript
const MAX_STREAM_DELTA_SIZE = 4096;
const MAX_STREAM_BODY_SIZE = MAX_BODY_SIZE; // 32 KB — same limit as regular messages
const MAX_ACTIVE_STREAMS_PER_USER = 1;
const STREAM_TIMEOUT_MS = 120_000; // 2 minutes — abort stale streams
```

- [ ] **Step 6: Add activeStreams type and instance field**

Add after line 80 (`private degraded = false;`):

```typescript
	private activeStreams = new Map<string, {
		senderId: string;
		senderName: string;
		senderRole: string;
		orgId: string;
		replyTo?: number;
		timestamp: string;
		startedAt: number;
		accumulatedBytes: number;
	}>();
```

- [ ] **Step 7: Verify types compile**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/chat-room.ts
git commit -m "feat: add streaming constants and activeStreams state to ChatRoom DO"
```

### Task 3: Add stream handler methods to ChatRoom DO

**Files:**
- Modify: `src/lib/server/chat-room.ts`

- [ ] **Step 9: Add handleStreamStart method**

Add after `handleChatMessage` (after line 548):

```typescript
	private async handleStreamStart(
		ws: WebSocket,
		msg: Extract<ClientMessage, { type: 'stream_start' }>
	): Promise<void> {
		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		const role = this.extractTag(tags, 'role:');
		const name = this.extractTag(tags, 'name:');
		const orgId = this.extractTag(tags, 'org:');

		if (!userId || !role) {
			await this.sendError(ws, 'unauthorized', 'Missing user identity');
			return;
		}
		if (role === 'viewer') {
			await this.sendError(ws, 'unauthorized', 'Viewers cannot send messages');
			return;
		}
		if (this.degraded) {
			await this.sendError(ws, 'degraded', 'Room is in degraded mode — messages paused');
			return;
		}
		if (
			typeof msg.localId !== 'string' ||
			msg.localId.length === 0 ||
			msg.localId.length > MAX_LOCAL_ID_LENGTH ||
			!LOCAL_ID_RE.test(msg.localId)
		) {
			await this.sendError(ws, 'invalid_message', 'Invalid localId');
			return;
		}
		if (msg.replyTo !== undefined && msg.replyTo !== null) {
			if (typeof msg.replyTo !== 'number' || !Number.isInteger(msg.replyTo) || msg.replyTo <= 0) {
				await this.sendError(ws, 'invalid_message', 'Invalid replyTo');
				return;
			}
		}
		if (this.isRateLimited(userId)) {
			await this.sendError(ws, 'rate_limited', 'Too many messages — slow down');
			return;
		}
		if (
			this.walMessageCount >= MAX_WAL_MESSAGES ||
			this.walByteSize >= MAX_WAL_BYTES
		) {
			await this.sendError(ws, 'room_full', 'Room buffer full — try again shortly');
			return;
		}

		// Enforce one active stream per user
		for (const [lid, session] of this.activeStreams) {
			if (session.senderId === userId) {
				await this.abortStream(lid, 'new_stream_started');
				break;
			}
		}

		// Guard against localId collision with another user's active stream
		if (this.activeStreams.has(msg.localId)) {
			await this.sendError(ws, 'invalid_message', 'localId already in use by another stream');
			return;
		}

		const timestamp = new Date().toISOString();
		this.activeStreams.set(msg.localId, {
			senderId: userId,
			senderName: name,
			senderRole: role,
			orgId,
			replyTo: msg.replyTo,
			timestamp,
			startedAt: Date.now(),
			accumulatedBytes: 0,
		});

		await this.broadcast({
			type: 'stream_start',
			localId: msg.localId,
			senderId: userId,
			senderName: name,
			senderRole: role,
			replyTo: msg.replyTo,
			timestamp,
		});
	}
```

- [ ] **Step 10: Add handleStreamDelta method**

Add after `handleStreamStart`:

```typescript
	private async handleStreamDelta(
		ws: WebSocket,
		msg: Extract<ClientMessage, { type: 'stream_delta' }>
	): Promise<void> {
		const session = this.activeStreams.get(msg.localId);
		if (!session) return; // Unknown/aborted stream — silently ignore

		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		if (userId !== session.senderId) return; // Not the stream owner

		const deltaBytes = new TextEncoder().encode(msg.delta ?? '').byteLength;
		if (typeof msg.delta !== 'string' || deltaBytes > MAX_STREAM_DELTA_SIZE) {
			await this.abortStream(msg.localId, 'delta_too_large');
			return;
		}

		session.accumulatedBytes += deltaBytes;
		if (session.accumulatedBytes > MAX_STREAM_BODY_SIZE) {
			await this.abortStream(msg.localId, 'body_too_large');
			return;
		}

		await this.broadcast({ type: 'stream_delta', localId: msg.localId, delta: msg.delta });
	}
```

- [ ] **Step 11: Add handleStreamEnd method**

Add after `handleStreamDelta`:

```typescript
	private async handleStreamEnd(
		ws: WebSocket,
		msg: Extract<ClientMessage, { type: 'stream_end' }>
	): Promise<void> {
		const session = this.activeStreams.get(msg.localId);
		if (!session) return; // Unknown/aborted stream — silently ignore

		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		if (userId !== session.senderId) return; // Not the stream owner

		this.activeStreams.delete(msg.localId);

		if (!msg.body || typeof msg.body !== 'string') {
			return; // Empty body — nothing to commit
		}

		const bodyBytes = new TextEncoder().encode(msg.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			// Body too large to commit — already sent deltas though, so abort
			await this.broadcast({ type: 'stream_abort', localId: msg.localId, reason: 'body_too_large' });
			return;
		}

		// Commit via the same WAL path as handleChatMessage
		const seqId = this.nextLocalId++;

		const stored: StoredMessage = {
			localId: msg.localId,
			orgId: session.orgId,
			senderId: session.senderId,
			senderRole: session.senderRole,
			senderName: session.senderName,
			body: msg.body,
			replyTo: session.replyTo,
			timestamp: session.timestamp,
			flushed: false,
		};

		const entrySize = measureBytes(stored);
		this.unflushedIds.push(seqId);
		this.walMessageCount++;
		this.walByteSize += entrySize;

		await this.ctx.storage.put({
			[storageKey(seqId)]: stored,
			'meta:nextId': this.nextLocalId,
			'meta:walByteSize': this.walByteSize,
			'meta:walMessageCount': this.walMessageCount,
			'meta:unflushedIds': this.unflushedIds,
		});

		const payload: ServerMessagePayload = {
			localId: msg.localId,
			serverSeqId: seqId,
			senderId: session.senderId,
			senderRole: session.senderRole,
			senderName: session.senderName,
			body: msg.body,
			replyTo: session.replyTo,
			timestamp: session.timestamp,
		};

		await this.broadcast({ type: 'message', message: payload });

		// Schedule flush (same logic as handleChatMessage)
		if (this.unflushedIds.length >= FLUSH_BATCH_THRESHOLD) {
			const existing = await this.ctx.storage.getAlarm();
			if (existing) await this.ctx.storage.deleteAlarm();
			await this.ctx.storage.setAlarm(Date.now());
		} else if (this.unflushedIds.length === 1) {
			const existing = await this.ctx.storage.getAlarm();
			if (!existing) {
				await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
			}
		}
	}
```

- [ ] **Step 12: Add abortStream helper**

Add after `handleStreamEnd`:

```typescript
	private async abortStream(localId: string, reason: string): Promise<void> {
		this.activeStreams.delete(localId);
		await this.broadcast({ type: 'stream_abort', localId, reason });
	}
```

- [ ] **Step 13: Verify types compile**

Run: `pnpm check`
Expected: No errors (methods exist but aren't wired yet)

- [ ] **Step 14: Commit**

```bash
git add src/lib/server/chat-room.ts
git commit -m "feat: add stream handler methods to ChatRoom DO"
```

### Task 4: Wire streaming into router and lifecycle hooks

**Files:**
- Modify: `src/lib/server/chat-room.ts`

- [ ] **Step 15: Add stream cases to webSocketMessage switch**

In `webSocketMessage` (line 304 switch), add before the `default` case:

```typescript
			case 'stream_start':
				await this.handleStreamStart(ws, msg);
				break;
			case 'stream_delta':
				await this.handleStreamDelta(ws, msg);
				break;
			case 'stream_end':
				await this.handleStreamEnd(ws, msg);
				break;
```

- [ ] **Step 16: Add stream abort on disconnect**

In `webSocketClose` (line 325-332), add stream cleanup before the existing `broadcastPresenceOffline`:

```typescript
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	): Promise<void> {
		// Abort any active streams owned by this socket
		try {
			const tags = this.ctx.getTags(ws);
			const userId = this.extractTag(tags, 'user:');
			if (userId) {
				for (const [lid, session] of this.activeStreams) {
					if (session.senderId === userId) {
						await this.abortStream(lid, 'client_disconnected');
					}
				}
			}
		} catch { /* socket may already be dead */ }
		await this.broadcastPresenceOffline(ws);
	}
```

Do the same for `webSocketError` (line 334-336):

```typescript
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		try {
			const tags = this.ctx.getTags(ws);
			const userId = this.extractTag(tags, 'user:');
			if (userId) {
				for (const [lid, session] of this.activeStreams) {
					if (session.senderId === userId) {
						await this.abortStream(lid, 'client_disconnected');
					}
				}
			}
		} catch { /* socket may already be dead */ }
		await this.broadcastPresenceOffline(ws);
	}
```

- [ ] **Step 17: Add stream timeout check to alarm handler**

In the `alarm()` method (line 340), add at the very beginning before any other logic:

```typescript
		// Abort stale streams (agent may have crashed without disconnecting)
		const now = Date.now();
		for (const [lid, session] of this.activeStreams) {
			if (now - session.startedAt > STREAM_TIMEOUT_MS) {
				await this.abortStream(lid, 'stream_timeout');
			}
		}
```

- [ ] **Step 18: Verify full build**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 19: Commit**

```bash
git add src/lib/server/chat-room.ts
git commit -m "feat: wire streaming into WS router, lifecycle hooks, and alarm timeout"
```

## Chunk 2: Browser Store + UI Rendering

### Task 5: Add streaming support to MessagesStore

**Files:**
- Modify: `src/lib/stores/messages.svelte.ts`

- [ ] **Step 20: Add streaming field to DisplayMessage**

At line 28 (after `isOwn: boolean;`), add:

```typescript
	streaming?: boolean;
```

- [ ] **Step 21: Add streamingMessages map**

After line 54 (`private pendingTimers`), add:

```typescript
	private streamingMessages = new Map<string, number>(); // localId → index in messages array
```

- [ ] **Step 22: Add stream handler methods**

Add after `handleClear` (after line 279):

```typescript
	private handleStreamStart(msg: Extract<ServerMessage, { type: 'stream_start' }>): void {
		const display: DisplayMessage = {
			localId: msg.localId,
			senderId: msg.senderId,
			senderName: msg.senderName,
			senderRole: msg.senderRole,
			body: '',
			replyTo: msg.replyTo,
			timestamp: msg.timestamp,
			pending: false,
			failed: false,
			isOwn: msg.senderId === this.userId,
			streaming: true,
		};
		this.messages.push(display);
		this.streamingMessages.set(msg.localId, this.messages.length - 1);

		// Suppress typing indicator for this sender
		this.handleTyping(msg.senderId, msg.senderName, false);
	}

	private handleStreamDelta(msg: Extract<ServerMessage, { type: 'stream_delta' }>): void {
		const idx = this.streamingMessages.get(msg.localId);
		if (idx === undefined) return;
		const dm = this.messages[idx];
		if (!dm) return;
		// Index assignment with spread triggers Svelte 5 $state reactivity
		this.messages[idx] = { ...dm, body: dm.body + msg.delta };
	}

	private handleStreamAbort(msg: Extract<ServerMessage, { type: 'stream_abort' }>): void {
		const idx = this.streamingMessages.get(msg.localId);
		if (idx === undefined) return;
		const dm = this.messages[idx];
		if (!dm) return;
		this.messages[idx] = { ...dm, streaming: false, failed: true };
		this.streamingMessages.delete(msg.localId);
	}
```

- [ ] **Step 23: Wire stream cases into handleServerMessage**

In `handleServerMessage` (line 89-125), add three cases before the `case 'error'` block:

```typescript
			case 'stream_start':
				this.handleStreamStart(msg);
				break;
			case 'stream_delta':
				this.handleStreamDelta(msg);
				break;
			case 'stream_abort':
				this.handleStreamAbort(msg);
				break;
```

- [ ] **Step 24: Add streaming finalization to handleMessage**

In `handleMessage` (line 127), add at the very beginning (before `const existingIdx`):

```typescript
		// Finalize streaming message — replace placeholder with confirmed version
		const streamIdx = this.streamingMessages.get(payload.localId);
		if (streamIdx !== undefined) {
			this.streamingMessages.delete(payload.localId);
			this.messages[streamIdx] = {
				localId: payload.localId,
				serverSeqId: payload.serverSeqId,
				senderId: payload.senderId,
				senderName: payload.senderName,
				senderRole: payload.senderRole,
				body: payload.body,
				replyTo: payload.replyTo,
				timestamp: payload.timestamp,
				pending: false,
				failed: false,
				isOwn: payload.senderId === this.userId,
				streaming: false,
			};
			if (payload.serverSeqId > this.lastServerSeqId) {
				this.lastServerSeqId = payload.serverSeqId;
				this.ws.updateLastKnownId(payload.serverSeqId);
			}
			return; // Skip normal dedup path
		}
```

- [ ] **Step 25: Clear streamingMessages in handleClear**

In `handleClear` (line 271-279), add after `this.messages = [];`:

```typescript
		this.streamingMessages.clear();
```

- [ ] **Step 26: Verify types compile**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 27: Commit**

```bash
git add src/lib/stores/messages.svelte.ts
git commit -m "feat: add streaming message accumulation to MessagesStore"
```

### Task 6: Add streaming UI to MessageBubble

**Files:**
- Modify: `src/lib/components/chat/MessageBubble.svelte`
- Modify: `messages/en.json`

- [ ] **Step 28: Add i18n key**

In `messages/en.json`, add after line 43 (`"chat_sending": "Sending..."`) :

```json
  "chat_streaming": "generating…",
```

- [ ] **Step 29: Add throttled markdown rendering for streaming**

In `MessageBubble.svelte`, replace line 26:

```typescript
	const htmlBody = $derived(renderMarkdown(message.body));
```

With throttled rendering:

```typescript
	// Throttle markdown rendering during streaming to avoid per-delta re-renders
	let streamRenderedHtml = $state('');
	let streamThrottleTimer: ReturnType<typeof setTimeout> | null = null;

	const htmlBody = $derived.by(() => {
		if (!message.streaming) {
			// Not streaming — render immediately (normal path)
			if (streamThrottleTimer) {
				clearTimeout(streamThrottleTimer);
				streamThrottleTimer = null;
			}
			return renderMarkdown(message.body);
		}
		// During streaming, return the last throttled render
		return streamRenderedHtml || renderMarkdown(message.body);
	});

	$effect(() => {
		if (!message.streaming) return;
		// Throttle: re-render markdown every 150ms during streaming
		const body = message.body; // track dependency
		if (streamThrottleTimer) return; // already scheduled
		streamThrottleTimer = setTimeout(() => {
			streamThrottleTimer = null;
			streamRenderedHtml = renderMarkdown(body);
		}, 150);
	});
```

- [ ] **Step 30: Add streaming cursor after body**

In `MessageBubble.svelte`, replace line 119:

```svelte
		{@html htmlBody}
```

With:

```svelte
			{@html htmlBody}{#if message.streaming}<span class="streaming-cursor"></span>{/if}
```

- [ ] **Step 31: Add streaming footer label**

In `MessageBubble.svelte`, replace lines 126-129 (the pending block):

```svelte
		{#if message.pending}
			<span class="text-[10px] animate-pulse" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 70%, transparent)' : 'var(--text-muted)'};">
				{m.chat_sending()}
			</span>
```

With:

```svelte
		{#if message.streaming}
			<span class="text-[10px] animate-pulse" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 70%, transparent)' : 'var(--text-muted)'};">
				{m.chat_streaming()}
			</span>
		{:else if message.pending}
			<span class="text-[10px] animate-pulse" style="color: {message.isOwn ? 'color-mix(in oklch, var(--bubble-own-text) 70%, transparent)' : 'var(--text-muted)'};">
				{m.chat_sending()}
			</span>
```

- [ ] **Step 32: Extend action buttons guard**

In `MessageBubble.svelte`, replace line 158:

```svelte
		{#if !message.pending && !message.failed && message.dbId}
```

With:

```svelte
		{#if !message.pending && !message.streaming && !message.failed && message.dbId}
```

- [ ] **Step 33: Add streaming cursor CSS**

In the `<style>` block at the end of `MessageBubble.svelte`, add:

```css
	.streaming-cursor {
		display: inline-block;
		width: 2px;
		height: 1em;
		background: var(--accent);
		margin-left: 1px;
		vertical-align: text-bottom;
		animation: cursor-blink 1s step-end infinite;
	}

	@keyframes cursor-blink {
		0%, 50% { opacity: 1; }
		51%, 100% { opacity: 0; }
	}
```

- [ ] **Step 34: Verify full build**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 35: Commit**

```bash
git add src/lib/components/chat/MessageBubble.svelte messages/en.json
git commit -m "feat: add streaming cursor, throttled markdown, and generating label to MessageBubble"
```

### Task 7: Final verification

- [ ] **Step 36: Run full type check**

Run: `pnpm check`
Expected: Clean pass, no errors or warnings related to streaming

- [ ] **Step 37: Start dev server and verify no runtime errors**

Run: `pnpm dev`
Expected: Dev server starts on localhost:5190 without errors. Open chat page, verify existing message rendering unchanged.
