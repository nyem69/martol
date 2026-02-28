/**
 * ChatRoom Durable Object — Per-room WebSocket hub
 *
 * Uses the Hibernation API for efficient WebSocket management.
 * Messages are buffered in DO transactional storage (WAL) and
 * batch-flushed to PostgreSQL via the Alarm API.
 */

import { DurableObject } from 'cloudflare:workers';
import type { CloudflareEnv } from '../../app.d.ts';
import type {
	ClientMessage,
	ServerMessage,
	StoredMessage,
	ServerMessagePayload,
	ErrorCode
} from '$lib/types/ws';
import { createHyperdriveDb } from '$lib/server/db/hyperdrive';
import { messages as messagesTable } from '$lib/server/db/schema';

// ── Constants ───────────────────────────────────────────────────────

const MAX_BODY_SIZE = 32 * 1024; // 32 KB
const MAX_WAL_MESSAGES = 1000;
const MAX_WAL_BYTES = 5 * 1024 * 1024; // 5 MB
const FLUSH_INTERVAL_MS = 500;
const FLUSH_BATCH_THRESHOLD = 10;
const MAX_FLUSH_FAILURES = 3;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 50;
const PAD_WIDTH = 20;

function padId(id: number): string {
	return String(id).padStart(PAD_WIDTH, '0');
}

function storageKey(id: number): string {
	return `msg:${padId(id)}`;
}

// ── ChatRoom Durable Object ─────────────────────────────────────────

export class ChatRoom extends DurableObject<CloudflareEnv> {
	// In-memory state (rebuilt from storage on wake)
	private nextLocalId = 1;
	private walByteSize = 0;
	private walMessageCount = 0;
	private unflushedIds: number[] = [];
	private flushFailures = 0;
	private degraded = false;

	// Rate limiting
	private messageTimestamps: number[] = [];

	constructor(ctx: DurableObjectState, env: CloudflareEnv) {
		super(ctx, env);

		// Rebuild in-memory state from storage on every wake
		this.ctx.blockConcurrencyWhile(async () => {
			const nextId = await this.ctx.storage.get<number>('meta:nextId');
			this.nextLocalId = nextId ?? 1;

			const walBytes = await this.ctx.storage.get<number>('meta:walByteSize');
			this.walByteSize = walBytes ?? 0;

			const walCount = await this.ctx.storage.get<number>('meta:walMessageCount');
			this.walMessageCount = walCount ?? 0;

			const unflushed = await this.ctx.storage.get<number[]>('meta:unflushedIds');
			this.unflushedIds = unflushed ?? [];

			const failures = await this.ctx.storage.get<number>('meta:flushFailures');
			this.flushFailures = failures ?? 0;
			this.degraded = this.flushFailures >= MAX_FLUSH_FAILURES;

			// If there are unflushed messages, schedule a flush
			if (this.unflushedIds.length > 0) {
				const existing = await this.ctx.storage.getAlarm();
				if (!existing) {
					await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
				}
			}
		});
	}

	// ── WebSocket Upgrade ─────────────────────────────────────────────

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Only handle WebSocket upgrades
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}

		// Extract user info from headers (set by the SvelteKit route)
		const userId = request.headers.get('X-User-Id');
		const userRole = request.headers.get('X-User-Role') ?? 'member';
		const userName = request.headers.get('X-User-Name') ?? 'Unknown';
		const orgId = request.headers.get('X-Org-Id') ?? '';

		if (!userId) {
			return new Response('Missing user identity', { status: 401 });
		}

		// Create WebSocket pair
		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		// Accept with Hibernation API — tags encode user metadata
		this.ctx.acceptWebSocket(server, [
			`user:${userId}`,
			`role:${userRole}`,
			`name:${userName}`,
			`org:${orgId}`
		]);

		// Broadcast presence to others
		this.broadcast(
			{ type: 'presence', senderId: userId, senderName: userName, status: 'online' },
			server
		);

		// Delta sync: send missed messages if client provides lastKnownId
		const lastKnownId = url.searchParams.get('lastKnownId');
		if (lastKnownId) {
			const id = parseInt(lastKnownId, 10);
			if (!isNaN(id)) {
				await this.sendDeltaSync(server, id);
			}
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	// ── Hibernation API Handlers ──────────────────────────────────────

	async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
		if (typeof rawMessage !== 'string') return;

		let msg: ClientMessage;
		try {
			msg = JSON.parse(rawMessage);
		} catch {
			this.sendError(ws, 'invalid_message', 'Invalid JSON');
			return;
		}

		switch (msg.type) {
			case 'message':
				await this.handleChatMessage(ws, msg);
				break;
			case 'typing':
				this.handleTyping(ws, msg.active);
				break;
			case 'read':
				// Read receipts — acknowledged, no broadcast needed for now
				break;
			default:
				this.sendError(ws, 'invalid_message', 'Unknown message type');
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		this.broadcastPresenceOffline(ws);
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		this.broadcastPresenceOffline(ws);
	}

	// ── Alarm: Batch Flush to DB ──────────────────────────────────────

	async alarm(): Promise<void> {
		if (this.unflushedIds.length === 0) return;

		try {
			await this.flushToDb();
			this.flushFailures = 0;
			this.degraded = false;
			await this.ctx.storage.put('meta:flushFailures', 0);
		} catch (err) {
			this.flushFailures++;
			await this.ctx.storage.put('meta:flushFailures', this.flushFailures);

			if (this.flushFailures >= MAX_FLUSH_FAILURES) {
				this.degraded = true;
				console.error(`[ChatRoom] Degraded mode after ${MAX_FLUSH_FAILURES} flush failures`, err);
				// Notify all connected clients
				this.broadcast({
					type: 'error',
					code: 'degraded',
					message: 'Room temporarily unavailable — messages paused'
				});
				return; // Don't reschedule
			}

			console.error(`[ChatRoom] Flush failed (attempt ${this.flushFailures})`, err);
		}

		// Reschedule if there are still unflushed messages
		if (this.unflushedIds.length > 0) {
			await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
		}
	}

	// ── Message Handling ──────────────────────────────────────────────

	private async handleChatMessage(
		ws: WebSocket,
		msg: Extract<ClientMessage, { type: 'message' }>
	): Promise<void> {
		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		const role = this.extractTag(tags, 'role:');
		const name = this.extractTag(tags, 'name:');
		const orgId = this.extractTag(tags, 'org:');

		if (!userId || !role) {
			this.sendError(ws, 'unauthorized', 'Missing user identity');
			return;
		}

		// Viewers cannot send messages
		if (role === 'viewer') {
			this.sendError(ws, 'unauthorized', 'Viewers cannot send messages');
			return;
		}

		// Degraded mode check
		if (this.degraded) {
			this.sendError(ws, 'degraded', 'Room is in degraded mode — messages paused');
			return;
		}

		// Validate body
		if (!msg.body || typeof msg.body !== 'string') {
			this.sendError(ws, 'invalid_message', 'Message body required');
			return;
		}

		const bodyBytes = new TextEncoder().encode(msg.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			this.sendError(ws, 'invalid_message', `Message too large (max ${MAX_BODY_SIZE / 1024}KB)`);
			return;
		}

		// Rate limiting
		if (this.isRateLimited()) {
			this.sendError(ws, 'rate_limited', 'Too many messages — slow down');
			return;
		}

		// WAL capacity check
		if (this.walMessageCount >= MAX_WAL_MESSAGES || this.walByteSize + bodyBytes > MAX_WAL_BYTES) {
			this.sendError(ws, 'room_full', 'Room buffer full — try again shortly');
			return;
		}

		// Assign local monotonic ID
		const localId = this.nextLocalId++;
		const timestamp = new Date().toISOString();

		const stored: StoredMessage = {
			localId: msg.localId,
			senderId: userId,
			senderRole: role,
			senderName: name,
			body: msg.body,
			replyTo: msg.replyTo,
			timestamp,
			flushed: false
		};

		// Estimate storage size
		const entrySize = JSON.stringify(stored).length;

		// Write to DO transactional storage
		await this.ctx.storage.put(storageKey(localId), stored);
		this.unflushedIds.push(localId);
		this.walMessageCount++;
		this.walByteSize += entrySize;

		// Persist metadata
		await this.ctx.storage.put({
			'meta:nextId': this.nextLocalId,
			'meta:walByteSize': this.walByteSize,
			'meta:walMessageCount': this.walMessageCount,
			'meta:unflushedIds': this.unflushedIds
		});

		// Broadcast to all connected clients
		const payload: ServerMessagePayload = {
			localId: msg.localId,
			senderId: userId,
			senderRole: role,
			senderName: name,
			body: msg.body,
			replyTo: msg.replyTo,
			timestamp
		};

		this.broadcast({ type: 'message', message: payload });

		// Schedule flush if needed
		if (this.unflushedIds.length >= FLUSH_BATCH_THRESHOLD) {
			// Immediate flush
			const existing = await this.ctx.storage.getAlarm();
			if (existing) {
				await this.ctx.storage.deleteAlarm();
			}
			await this.ctx.storage.setAlarm(Date.now());
		} else if (this.unflushedIds.length === 1) {
			// First unflushed message — schedule flush
			const existing = await this.ctx.storage.getAlarm();
			if (!existing) {
				await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
			}
		}
	}

	// ── Flush to PostgreSQL ───────────────────────────────────────────

	private async flushToDb(): Promise<void> {
		if (this.unflushedIds.length === 0) return;

		// Collect unflushed messages from storage
		const keys = this.unflushedIds.map(storageKey);
		const entries = await this.ctx.storage.get<StoredMessage>(keys);

		const toFlush: Array<{ localId: number; stored: StoredMessage }> = [];
		for (const id of this.unflushedIds) {
			const stored = entries.get(storageKey(id));
			if (stored && !stored.flushed) {
				toFlush.push({ localId: id, stored });
			}
		}

		if (toFlush.length === 0) {
			this.unflushedIds = [];
			await this.ctx.storage.put('meta:unflushedIds', this.unflushedIds);
			return;
		}

		// Get org ID from first connected WebSocket's tags (or from stored messages context)
		const orgId = this.getOrgId();

		// Create Hyperdrive DB connection
		const { db, client, connectPromise } = createHyperdriveDb(this.env.HYPERDRIVE);
		await connectPromise;

		try {
			// Multi-row INSERT with .returning() for DB-assigned IDs
			const rows = toFlush.map(({ stored }) => ({
				orgId,
				senderId: stored.senderId,
				senderRole: stored.senderRole as 'owner' | 'lead' | 'member' | 'viewer' | 'agent',
				type: 'chat' as const,
				body: stored.body,
				replyTo: stored.replyTo ?? null,
				createdAt: new Date(stored.timestamp)
			}));

			const inserted = await db.insert(messagesTable).values(rows).returning({
				id: messagesTable.id,
				createdAt: messagesTable.createdAt
			});

			// Build id_map and mark as flushed
			const mappings: Array<{ localId: string; dbId: number }> = [];
			const updates: Record<string, StoredMessage> = {};

			for (let i = 0; i < toFlush.length; i++) {
				const { localId, stored } = toFlush[i];
				const dbRow = inserted[i];
				stored.flushed = true;
				stored.dbId = dbRow.id;
				updates[storageKey(localId)] = stored;
				mappings.push({ localId: stored.localId, dbId: dbRow.id });
			}

			// Update storage: mark flushed + clear unflushed list
			await this.ctx.storage.put(updates);

			// Remove flushed IDs from unflushed list
			const flushedSet = new Set(toFlush.map((f) => f.localId));
			this.unflushedIds = this.unflushedIds.filter((id) => !flushedSet.has(id));
			await this.ctx.storage.put('meta:unflushedIds', this.unflushedIds);

			// Broadcast id_map to all connected clients
			if (mappings.length > 0) {
				this.broadcast({ type: 'id_map', mappings });
			}

			// Prune old flushed entries (keep last 100 for reconnection)
			await this.pruneOldEntries();
		} finally {
			await client.end();
		}
	}

	// ── Delta Sync ────────────────────────────────────────────────────

	private async sendDeltaSync(ws: WebSocket, lastKnownId: number): Promise<void> {
		// List all messages after the given ID
		const afterKey = `msg:${padId(lastKnownId)}`;
		const entries = await this.ctx.storage.list<StoredMessage>({
			startAfter: afterKey,
			prefix: 'msg:'
		});

		if (entries.size === 0) return;

		const history: ServerMessagePayload[] = [];
		for (const stored of entries.values()) {
			history.push({
				localId: stored.localId,
				senderId: stored.senderId,
				senderRole: stored.senderRole,
				senderName: stored.senderName,
				body: stored.body,
				replyTo: stored.replyTo,
				timestamp: stored.timestamp
			});
		}

		this.safeSend(ws, { type: 'history', messages: history });
	}

	// ── Typing ────────────────────────────────────────────────────────

	private handleTyping(ws: WebSocket, active: boolean): void {
		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		const name = this.extractTag(tags, 'name:');

		if (!userId) return;

		this.broadcast(
			{ type: 'typing', senderId: userId, senderName: name, active },
			ws // exclude sender
		);
	}

	// ── Presence ──────────────────────────────────────────────────────

	private broadcastPresenceOffline(ws: WebSocket): void {
		try {
			const tags = this.ctx.getTags(ws);
			const userId = this.extractTag(tags, 'user:');
			const name = this.extractTag(tags, 'name:');

			if (userId) {
				this.broadcast(
					{ type: 'presence', senderId: userId, senderName: name, status: 'offline' },
					ws
				);
			}
		} catch {
			// WebSocket may already be closed
		}
	}

	// ── Rate Limiting ─────────────────────────────────────────────────

	private isRateLimited(): boolean {
		const now = Date.now();
		// Remove timestamps outside the window
		this.messageTimestamps = this.messageTimestamps.filter(
			(t) => now - t < RATE_LIMIT_WINDOW_MS
		);
		if (this.messageTimestamps.length >= RATE_LIMIT_MAX) {
			return true;
		}
		this.messageTimestamps.push(now);
		return false;
	}

	// ── Helpers ───────────────────────────────────────────────────────

	private broadcast(msg: ServerMessage, exclude?: WebSocket): void {
		const json = JSON.stringify(msg);
		const sockets = this.ctx.getWebSockets();
		for (const ws of sockets) {
			if (ws === exclude) continue;
			try {
				ws.send(json);
			} catch {
				// Socket dead — will be cleaned up by webSocketClose/Error
			}
		}
	}

	private safeSend(ws: WebSocket, msg: ServerMessage): void {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// Socket dead
		}
	}

	private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
		this.safeSend(ws, { type: 'error', code, message });
	}

	private extractTag(tags: string[], prefix: string): string {
		const tag = tags.find((t) => t.startsWith(prefix));
		return tag ? tag.slice(prefix.length) : '';
	}

	private getOrgId(): string {
		// Try to get org ID from any connected WebSocket's tags
		const sockets = this.ctx.getWebSockets();
		for (const ws of sockets) {
			try {
				const tags = this.ctx.getTags(ws);
				const orgId = this.extractTag(tags, 'org:');
				if (orgId) return orgId;
			} catch {
				continue;
			}
		}
		// Fallback: derive from DO name (the DO is named by orgId)
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	private async pruneOldEntries(): Promise<void> {
		// Keep at most 200 messages in DO storage for reconnection
		const all = await this.ctx.storage.list<StoredMessage>({ prefix: 'msg:' });
		if (all.size <= 200) return;

		const keys = [...all.keys()];
		const toDelete = keys.slice(0, keys.length - 200);

		// Calculate byte size reduction
		let bytesRemoved = 0;
		for (const key of toDelete) {
			const stored = all.get(key);
			if (stored) {
				bytesRemoved += JSON.stringify(stored).length;
			}
		}

		await this.ctx.storage.delete(toDelete);
		this.walMessageCount = Math.max(0, this.walMessageCount - toDelete.length);
		this.walByteSize = Math.max(0, this.walByteSize - bytesRemoved);

		await this.ctx.storage.put({
			'meta:walMessageCount': this.walMessageCount,
			'meta:walByteSize': this.walByteSize
		});
	}
}
