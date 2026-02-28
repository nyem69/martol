/**
 * ChatRoom Durable Object — Per-room WebSocket hub
 *
 * Uses the Hibernation API for efficient WebSocket management.
 * Messages are buffered in DO transactional storage (WAL) and
 * batch-flushed to PostgreSQL via the Alarm API.
 */

import { DurableObject } from 'cloudflare:workers';
import type {
	ClientMessage,
	ServerMessage,
	StoredMessage,
	ServerMessagePayload,
	ErrorCode
} from '../types/ws';
import { createHyperdriveDb } from './db/hyperdrive';
import { messages as messagesTable } from './db/schema';

// ── Constants ───────────────────────────────────────────────────────

const MAX_BODY_SIZE = 32 * 1024; // 32 KB
const MAX_WAL_MESSAGES = 1000;
const MAX_WAL_BYTES = 5 * 1024 * 1024; // 5 MB
const FLUSH_INTERVAL_MS = 500;
const FLUSH_BATCH_THRESHOLD = 10;
const MAX_FLUSH_FAILURES = 3;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_PER_USER = 10;
const PAD_WIDTH = 20;
const STORAGE_BATCH_LIMIT = 128;
const MAX_LOCAL_ID_LENGTH = 64;
const LOCAL_ID_RE = /^[a-zA-Z0-9_-]+$/;

function padId(id: number): string {
	return String(id).padStart(PAD_WIDTH, '0');
}

function storageKey(id: number): string {
	return `msg:${padId(id)}`;
}

function measureBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

// ── Chunked Storage Helpers (DO batch ops limited to 128 keys) ──────

async function batchGet<T>(
	storage: DurableObjectStorage,
	keys: string[]
): Promise<Map<string, T>> {
	const result = new Map<string, T>();
	for (let i = 0; i < keys.length; i += STORAGE_BATCH_LIMIT) {
		const chunk = keys.slice(i, i + STORAGE_BATCH_LIMIT);
		const partial = await storage.get<T>(chunk);
		for (const [k, v] of partial) {
			result.set(k, v);
		}
	}
	return result;
}

async function batchDelete(storage: DurableObjectStorage, keys: string[]): Promise<void> {
	for (let i = 0; i < keys.length; i += STORAGE_BATCH_LIMIT) {
		await storage.delete(keys.slice(i, i + STORAGE_BATCH_LIMIT));
	}
}

// ── ChatRoom Durable Object ─────────────────────────────────────────

export class ChatRoom extends DurableObject<App.Platform['env']> {
	// In-memory state (rebuilt from storage on wake)
	private nextLocalId = 1;
	private walByteSize = 0;
	private walMessageCount = 0;
	private unflushedIds: number[] = [];
	private flushFailures = 0;
	private degraded = false;

	// Per-user rate limiting
	private userMessageTimestamps = new Map<string, number[]>();

	constructor(ctx: DurableObjectState, env: App.Platform['env']) {
		super(ctx, env);

		// Rebuild in-memory state from storage on every wake
		this.ctx.blockConcurrencyWhile(async () => {
			const [nextId, walBytes, walCount, unflushed, failures] = await Promise.all([
				this.ctx.storage.get<number>('meta:nextId'),
				this.ctx.storage.get<number>('meta:walByteSize'),
				this.ctx.storage.get<number>('meta:walMessageCount'),
				this.ctx.storage.get<number[]>('meta:unflushedIds'),
				this.ctx.storage.get<number>('meta:flushFailures')
			]);

			this.nextLocalId = nextId ?? 1;
			this.walByteSize = walBytes ?? 0;
			this.walMessageCount = walCount ?? 0;
			this.unflushedIds = unflushed ?? [];
			this.flushFailures = failures ?? 0;
			this.degraded = this.flushFailures >= MAX_FLUSH_FAILURES;

			// If there are unflushed messages, schedule a flush
			if (this.unflushedIds.length > 0) {
				const existing = await this.ctx.storage.getAlarm();
				if (!existing) {
					const delay = this.degraded
						? Math.min(60_000 * 2 ** (this.flushFailures - MAX_FLUSH_FAILURES), 3_600_000)
						: FLUSH_INTERVAL_MS;
					await this.ctx.storage.setAlarm(Date.now() + delay);
				}
			}
		});
	}

	// ── HTTP Entry Point ─────────────────────────────────────────────

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// REST message ingest — used by MCP chat_send to route through the DO
		if (request.method === 'POST' && url.pathname.endsWith('/ingest')) {
			return this.handleRestIngest(request);
		}

		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}

		const userId = request.headers.get('X-User-Id');
		const userRole = request.headers.get('X-User-Role') ?? 'member';
		const userName = request.headers.get('X-User-Name') ?? 'Unknown';
		const orgId = request.headers.get('X-Org-Id') ?? '';

		if (!userId) {
			return new Response('Missing user identity', { status: 401 });
		}

		// [C3] Persist orgId for alarm-triggered flush (when no sockets connected)
		await this.ctx.storage.put('meta:orgId', orgId);

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		// [H8] URI-encode tag values to prevent prefix collisions
		this.ctx.acceptWebSocket(server, [
			`user:${encodeURIComponent(userId)}`,
			`role:${encodeURIComponent(userRole)}`,
			`name:${encodeURIComponent(userName)}`,
			`org:${encodeURIComponent(orgId)}`
		]);

		this.broadcast(
			{ type: 'presence', senderId: userId, senderName: userName, status: 'online' },
			server
		);

		// [M5] Wrap delta sync in try/catch to prevent zombie sockets on failure
		const lastKnownId = url.searchParams.get('lastKnownId');
		if (lastKnownId) {
			const id = parseInt(lastKnownId, 10);
			if (!isNaN(id)) {
				try {
					await this.sendDeltaSync(server, id);
				} catch (err) {
					console.error('[ChatRoom] Delta sync failed:', err);
				}
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
				break;
			default:
				this.sendError(ws, 'invalid_message', 'Unknown message type');
		}
	}

	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean
	): Promise<void> {
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
				console.error(
					`[ChatRoom] Degraded mode after ${this.flushFailures} flush failures`,
					err
				);
				this.broadcast({
					type: 'error',
					code: 'degraded',
					message: 'Room temporarily unavailable — messages paused'
				});
				// [C4] Schedule retry with exponential backoff (self-healing)
				const backoffMs = Math.min(
					60_000 * 2 ** (this.flushFailures - MAX_FLUSH_FAILURES),
					3_600_000 // cap at 1 hour
				);
				await this.ctx.storage.setAlarm(Date.now() + backoffMs);
				return;
			}

			console.error(`[ChatRoom] Flush failed (attempt ${this.flushFailures})`, err);
		}

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

		if (role === 'viewer') {
			this.sendError(ws, 'unauthorized', 'Viewers cannot send messages');
			return;
		}

		if (this.degraded) {
			this.sendError(ws, 'degraded', 'Room is in degraded mode — messages paused');
			return;
		}

		// [H4] Validate localId
		if (
			typeof msg.localId !== 'string' ||
			msg.localId.length === 0 ||
			msg.localId.length > MAX_LOCAL_ID_LENGTH ||
			!LOCAL_ID_RE.test(msg.localId)
		) {
			this.sendError(
				ws,
				'invalid_message',
				'Invalid localId (max 64 chars, alphanumeric/-/_)'
			);
			return;
		}

		// Validate replyTo (untyped from JSON.parse — could be any type)
		if (msg.replyTo !== undefined && msg.replyTo !== null) {
			if (typeof msg.replyTo !== 'number' || !Number.isInteger(msg.replyTo) || msg.replyTo <= 0) {
				this.sendError(ws, 'invalid_message', 'Invalid replyTo (must be a positive integer)');
				return;
			}
		}

		if (!msg.body || typeof msg.body !== 'string') {
			this.sendError(ws, 'invalid_message', 'Message body required');
			return;
		}

		const bodyBytes = new TextEncoder().encode(msg.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			this.sendError(
				ws,
				'invalid_message',
				`Message too large (max ${MAX_BODY_SIZE / 1024}KB)`
			);
			return;
		}

		// [H1] Per-user rate limiting
		if (this.isRateLimited(userId)) {
			this.sendError(ws, 'rate_limited', 'Too many messages — slow down');
			return;
		}

		if (
			this.walMessageCount >= MAX_WAL_MESSAGES ||
			this.walByteSize + bodyBytes > MAX_WAL_BYTES
		) {
			this.sendError(ws, 'room_full', 'Room buffer full — try again shortly');
			return;
		}

		const seqId = this.nextLocalId++;
		const timestamp = new Date().toISOString();

		const stored: StoredMessage = {
			localId: msg.localId,
			orgId, // [C3] Persist orgId per message for reliable flush
			senderId: userId,
			senderRole: role,
			senderName: name,
			body: msg.body,
			replyTo: msg.replyTo,
			timestamp,
			flushed: false
		};

		// [H5] Use byte count, not string length
		const entrySize = measureBytes(stored);

		// [C1] Atomic write: message + metadata in a single storage.put()
		this.unflushedIds.push(seqId);
		this.walMessageCount++;
		this.walByteSize += entrySize;

		await this.ctx.storage.put({
			[storageKey(seqId)]: stored,
			'meta:nextId': this.nextLocalId,
			'meta:walByteSize': this.walByteSize,
			'meta:walMessageCount': this.walMessageCount,
			'meta:unflushedIds': this.unflushedIds
		});

		// [H7] Include serverSeqId for delta sync cursor
		const payload: ServerMessagePayload = {
			localId: msg.localId,
			serverSeqId: seqId,
			senderId: userId,
			senderRole: role,
			senderName: name,
			body: msg.body,
			replyTo: msg.replyTo,
			timestamp
		};

		this.broadcast({ type: 'message', message: payload });

		// Schedule flush
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

	// ── REST Ingest (for MCP chat_send) ──────────────────────────────

	private async handleRestIngest(request: Request): Promise<Response> {
		let payload: {
			localId: string;
			senderId: string;
			senderRole: string;
			senderName: string;
			orgId: string;
			body: string;
			replyTo?: number;
		};

		try {
			payload = await request.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
		}

		// Validate required fields
		if (!payload.localId || !payload.senderId || !payload.body || !payload.orgId) {
			return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
		}

		if (typeof payload.body !== 'string') {
			return new Response(JSON.stringify({ error: 'Body must be a string' }), { status: 400 });
		}

		const bodyBytes = new TextEncoder().encode(payload.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			return new Response(JSON.stringify({ error: 'Message too large' }), { status: 413 });
		}

		if (this.degraded) {
			return new Response(JSON.stringify({ error: 'Room in degraded mode' }), { status: 503 });
		}

		if (
			this.walMessageCount >= MAX_WAL_MESSAGES ||
			this.walByteSize + bodyBytes > MAX_WAL_BYTES
		) {
			return new Response(JSON.stringify({ error: 'Room buffer full' }), { status: 429 });
		}

		// Validate replyTo
		if (payload.replyTo !== undefined && payload.replyTo !== null) {
			if (typeof payload.replyTo !== 'number' || !Number.isInteger(payload.replyTo) || payload.replyTo <= 0) {
				return new Response(JSON.stringify({ error: 'Invalid replyTo' }), { status: 400 });
			}
		}

		// Persist orgId for flush
		await this.ctx.storage.put('meta:orgId', payload.orgId);

		const seqId = this.nextLocalId++;
		const timestamp = new Date().toISOString();

		const stored: StoredMessage = {
			localId: payload.localId,
			orgId: payload.orgId,
			senderId: payload.senderId,
			senderRole: payload.senderRole || 'agent',
			senderName: payload.senderName || 'Agent',
			body: payload.body,
			replyTo: payload.replyTo,
			timestamp,
			flushed: false
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
			'meta:unflushedIds': this.unflushedIds
		});

		// Broadcast to all connected WebSocket clients
		const broadcastPayload: ServerMessagePayload = {
			localId: payload.localId,
			serverSeqId: seqId,
			senderId: payload.senderId,
			senderRole: payload.senderRole || 'agent',
			senderName: payload.senderName || 'Agent',
			body: payload.body,
			replyTo: payload.replyTo,
			timestamp
		};

		this.broadcast({ type: 'message', message: broadcastPayload });

		// Schedule flush
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

		return new Response(
			JSON.stringify({ ok: true, serverSeqId: seqId, timestamp }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// ── Flush to PostgreSQL ───────────────────────────────────────────

	private async flushToDb(): Promise<void> {
		if (this.unflushedIds.length === 0) return;

		// [C5] Chunked batch get (DO storage limited to 128 keys per call)
		const keys = this.unflushedIds.map(storageKey);
		const entries = await batchGet<StoredMessage>(this.ctx.storage, keys);

		const toFlush: Array<{ seqId: number; stored: StoredMessage }> = [];
		for (const id of this.unflushedIds) {
			const stored = entries.get(storageKey(id));
			if (stored && !stored.flushed) {
				toFlush.push({ seqId: id, stored });
			}
		}

		if (toFlush.length === 0) {
			this.unflushedIds = [];
			await this.ctx.storage.put('meta:unflushedIds', this.unflushedIds);
			return;
		}

		// [C3] Get orgId from stored messages (persisted at write time, not from sockets)
		const orgId =
			toFlush[0].stored.orgId ||
			(await this.ctx.storage.get<string>('meta:orgId')) ||
			this.ctx.id.name ||
			'';

		const { db, client, connectPromise } = createHyperdriveDb(this.env.HYPERDRIVE);
		await connectPromise;

		try {
			// [C6] Individual inserts in a transaction for guaranteed ID correlation
			const mappings: Array<{ localId: string; dbId: number }> = [];
			const updates: Record<string, StoredMessage> = {};

			await db.transaction(async (tx) => {
				for (const { seqId, stored } of toFlush) {
					const [inserted] = await tx
						.insert(messagesTable)
						.values({
							orgId,
							senderId: stored.senderId,
							senderRole: stored.senderRole as
								| 'owner'
								| 'lead'
								| 'member'
								| 'viewer'
								| 'agent',
							type: 'chat' as const,
							body: stored.body,
							replyTo: stored.replyTo ?? null,
							createdAt: new Date(stored.timestamp)
						})
						.returning({ id: messagesTable.id });

					stored.flushed = true;
					stored.dbId = inserted.id;
					updates[storageKey(seqId)] = stored;
					mappings.push({ localId: stored.localId, dbId: inserted.id });
				}
			});

			await this.ctx.storage.put(updates);

			const flushedSet = new Set(toFlush.map((f) => f.seqId));
			this.unflushedIds = this.unflushedIds.filter((id) => !flushedSet.has(id));
			await this.ctx.storage.put('meta:unflushedIds', this.unflushedIds);

			if (mappings.length > 0) {
				this.broadcast({ type: 'id_map', mappings });
			}

			await this.pruneOldEntries();
		} finally {
			// [H6] Wrap client.end() to prevent successful flush counted as failure
			try {
				await client.end();
			} catch {
				// Connection already closed
			}
		}
	}

	// ── Delta Sync ────────────────────────────────────────────────────

	private async sendDeltaSync(ws: WebSocket, lastKnownSeqId: number): Promise<void> {
		// [H7] Use serverSeqId (DO-local counter) for delta sync cursor
		const afterKey = `msg:${padId(lastKnownSeqId)}`;
		const entries = await this.ctx.storage.list<StoredMessage>({
			startAfter: afterKey,
			prefix: 'msg:',
			limit: 200
		});

		if (entries.size === 0) return;

		const history: ServerMessagePayload[] = [];
		for (const [key, stored] of entries) {
			const seqId = parseInt(key.slice(4), 10);
			history.push({
				localId: stored.localId,
				serverSeqId: seqId,
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
			ws
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

	// ── Rate Limiting (per-user) ──────────────────────────────────────

	// [H1] Keyed by userId to prevent one user from silencing the room
	private isRateLimited(userId: string): boolean {
		const now = Date.now();
		const timestamps = (this.userMessageTimestamps.get(userId) ?? []).filter(
			(t) => now - t < RATE_LIMIT_WINDOW_MS
		);
		if (timestamps.length >= RATE_LIMIT_MAX_PER_USER) {
			this.userMessageTimestamps.set(userId, timestamps);
			return true;
		}
		timestamps.push(now);
		this.userMessageTimestamps.set(userId, timestamps);
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
				// Dead socket — cleaned up by webSocketClose/Error
			}
		}
	}

	private safeSend(ws: WebSocket, msg: ServerMessage): void {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// Dead socket
		}
	}

	private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
		this.safeSend(ws, { type: 'error', code, message });
	}

	// [H8] Decode URI-encoded tag values
	private extractTag(tags: string[], prefix: string): string {
		const tag = tags.find((t) => t.startsWith(prefix));
		return tag ? decodeURIComponent(tag.slice(prefix.length)) : '';
	}

	// [C2] Only prune flushed entries; [M1] Use limit to avoid loading all into memory
	private async pruneOldEntries(): Promise<void> {
		// Skip expensive list if WAL is small enough — walMessageCount tracks total stored messages
		if (this.walMessageCount <= 200) return;

		const all = await this.ctx.storage.list<StoredMessage>({ prefix: 'msg:', limit: 500 });
		if (all.size <= 200) return;

		const keys = [...all.keys()];
		const toDelete = keys.slice(0, keys.length - 200).filter((key) => {
			const stored = all.get(key);
			return stored?.flushed === true;
		});

		if (toDelete.length === 0) return;

		// [H5] Use byte measurement consistent with write path
		let bytesRemoved = 0;
		for (const key of toDelete) {
			const stored = all.get(key);
			if (stored) bytesRemoved += measureBytes(stored);
		}

		// [C5] Chunked delete
		await batchDelete(this.ctx.storage, toDelete);
		this.walMessageCount = Math.max(0, this.walMessageCount - toDelete.length);
		this.walByteSize = Math.max(0, this.walByteSize - bytesRemoved);

		await this.ctx.storage.put({
			'meta:walMessageCount': this.walMessageCount,
			'meta:walByteSize': this.walByteSize
		});
	}
}
