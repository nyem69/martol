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
import { messages as messagesTable, readCursors, pendingActions, attachments, supportTickets, aiUsage } from './db/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';
import { shouldRespond, extractQuestion, buildSystemPrompt, buildUserPrompt, createRagModel, type RagConfig } from './rag/responder';
import { searchDocuments } from './rag/search';
import { isAiCapReached } from './ai-billing';

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
const MAX_STREAM_DELTA_SIZE = 4096;
const MAX_STREAM_BODY_SIZE = MAX_BODY_SIZE; // 32 KB — same limit as regular messages
const MAX_ACTIVE_STREAMS_PER_USER = 1;
const STREAM_TIMEOUT_MS = 120_000; // 2 minutes — abort stale streams

// RAG-specific rate limiting (separate from message rate limiter)
const RAG_RATE_LIMIT_ROOM_MAX = 3;        // Max 3 RAG responses per minute per room
const RAG_RATE_LIMIT_ROOM_WINDOW_MS = 60_000;
const RAG_RATE_LIMIT_USER_MAX = 5;        // Max 5 RAG responses per minute per user (across rooms not enforced here — per-DO)
const RAG_RATE_LIMIT_USER_WINDOW_MS = 60_000;
const RAG_ALWAYS_COOLDOWN_MS = 30_000;    // Min 30s between RAG responses in "always" mode

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

	// RAG responder config (loaded via /notify-rag-config internal route)
	private ragConfig: RagConfig | null = null;
	private ragResponseActive = false;

	// RAG-specific rate limiting (separate from message rate limiter)
	private ragRoomTimestamps: number[] = [];
	private ragUserTimestamps = new Map<string, number[]>();
	private ragLastResponseTime = 0;

	// Per-user rate limiting
	private userMessageTimestamps = new Map<string, number[]>();

	// Debounced read cursor updates — flushed alongside WAL or on 5s timeout
	private pendingReadCursors = new Map<string, { orgId: string; userId: string; lastReadId: number }>();

	// Pending edits to already-flushed messages — processed during flushToDb()
	private pendingEdits = new Map<number, { dbId: number; body: string; editedAt: string; orgId: string }>();

	// [R6] Pre-imported HMAC key for signing broadcast messages
	private broadcastSigningKey: CryptoKey | null = null;

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

			// Import broadcast signing key for R6 message integrity
			const hmacSecret = this.env.HMAC_SIGNING_SECRET;
			if (hmacSecret) {
				this.broadcastSigningKey = await crypto.subtle.importKey(
					'raw',
					new TextEncoder().encode(hmacSecret),
					{ name: 'HMAC', hash: 'SHA-256' },
					false,
					['sign']
				);
			} else {
				console.warn('[ChatRoom] HMAC_SIGNING_SECRET not set — broadcast messages will not be signed');
			}

			// If there are unflushed messages, schedule a flush
			if (this.unflushedIds.length > 0) {
				const existing = await this.ctx.storage.getAlarm();
				if (!existing) {
					const delay = this.degraded
						? Math.min(60_000 * 2 ** (this.flushFailures - MAX_FLUSH_FAILURES), 600_000) // 10 min cap
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

		// REST message edit — used by MCP chat_edit to route through the DO
		if (request.method === 'POST' && url.pathname.endsWith('/edit')) {
			return this.handleRestEdit(request);
		}

		// REST brief-changed broadcast — used by brief update endpoints
		if (request.method === 'POST' && url.pathname.endsWith('/notify-brief')) {
			return this.handleNotifyBrief(request);
		}

		// REST config-changed broadcast — used by room settings endpoints
		if (request.method === 'POST' && url.pathname.endsWith('/notify-config')) {
			return this.handleNotifyConfig(request);
		}

		// REST RAG config notification — used by rag-config endpoints
		if (request.method === 'POST' && url.pathname.endsWith('/notify-rag-config')) {
			return this.handleNotifyRagConfig(request);
		}

		// REST document-indexed notification — used after RAG pipeline completes
		if (request.method === 'POST' && url.pathname.endsWith('/notify-document')) {
			return this.handleNotifyDocumentIndexed(request);
		}

		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected WebSocket upgrade', { status: 426 });
		}

		// Verify HMAC-signed identity headers
		const identityPayload = request.headers.get('X-Identity');
		const identitySig = request.headers.get('X-Identity-Sig');

		if (!identityPayload || !identitySig) {
			return new Response('Missing signed identity', { status: 401 });
		}

		const signingKey = this.env.HMAC_SIGNING_SECRET;
		if (!signingKey) {
			return new Response('Signing key unavailable', { status: 503 });
		}

		let parsedIdentity: { userId: string; role: string; userName: string; orgId: string; timestamp: number };
		try {
			parsedIdentity = JSON.parse(identityPayload);
		} catch {
			return new Response('Invalid identity payload', { status: 400 });
		}

		// Verify HMAC signature
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(signingKey),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		);
		const sigBytes = Uint8Array.from(atob(identitySig), (c) => c.charCodeAt(0));
		const valid = await crypto.subtle.verify(
			'HMAC',
			key,
			sigBytes,
			new TextEncoder().encode(identityPayload)
		);

		if (!valid) {
			return new Response('Invalid identity signature', { status: 403 });
		}

		// Reject stale signatures (older than 60 seconds)
		if (Date.now() - parsedIdentity.timestamp > 60_000) {
			return new Response('Identity signature expired', { status: 403 });
		}

		// Verify orgId matches this DO's room
		const storedOrgId = await this.ctx.storage.get<string>('meta:orgId');
		if (storedOrgId && storedOrgId !== parsedIdentity.orgId) {
			return new Response('Room mismatch', { status: 403 });
		}

		const userId = parsedIdentity.userId;
		const userRole = parsedIdentity.role;
		const userName = parsedIdentity.userName;
		const orgId = parsedIdentity.orgId;

		if (!userId) {
			return new Response('Missing user identity', { status: 401 });
		}

		// [C3] Persist orgId for alarm-triggered flush (when no sockets connected)
		await this.ctx.storage.put('meta:orgId', orgId);

		// Allow multiple connections per user (multi-tab support).
		// Presence "offline" is only broadcast when the LAST connection closes.

		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		// [H8] URI-encode tag values to prevent prefix collisions
		this.ctx.acceptWebSocket(server, [
			`user:${encodeURIComponent(userId)}`,
			`role:${encodeURIComponent(userRole)}`,
			`name:${encodeURIComponent(userName)}`,
			`org:${encodeURIComponent(orgId)}`
		]);

		await this.broadcast(
			{ type: 'presence', senderId: userId, senderName: userName, senderRole: userRole, status: 'online' },
			server
		);

		// Send roster of already-connected users to the new socket
		const existingSockets = this.ctx.getWebSockets();
		const seen = new Set<string>();
		const members: Array<{ id: string; name: string; role: string }> = [];
		for (const s of existingSockets) {
			if (s === server) continue;
			const sTags = this.ctx.getTags(s);
			const sId = this.extractTag(sTags, 'user:');
			if (!sId || seen.has(sId)) continue;
			seen.add(sId);
			members.push({
				id: sId,
				name: this.extractTag(sTags, 'name:'),
				role: this.extractTag(sTags, 'role:')
			});
		}
		if (members.length > 0) {
			await this.safeSend(server, { type: 'roster', members });
		}

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
		if (typeof rawMessage !== 'string') {
			await this.safeSend(ws, { type: 'error', code: 'invalid_message', message: 'Binary frames not supported' });
			return;
		}

		let msg: ClientMessage;
		try {
			msg = JSON.parse(rawMessage);
		} catch {
			await this.sendError(ws, 'invalid_message', 'Invalid JSON');
			return;
		}

		switch (msg.type) {
			case 'message':
				await this.handleChatMessage(ws, msg);
				break;
			case 'typing':
				await this.handleTyping(ws, msg.active);
				break;
			case 'read':
				await this.handleReadCursor(ws, msg.lastReadId);
				break;
			case 'edit':
				await this.handleEditMessage(ws, msg);
				break;
			case 'command':
				await this.handleCommand(ws, msg.name, msg.args);
				break;
			case 'stream_start':
				await this.handleStreamStart(ws, msg);
				break;
			case 'stream_delta':
				await this.handleStreamDelta(ws, msg);
				break;
			case 'stream_end':
				await this.handleStreamEnd(ws, msg);
				break;
			default:
				await this.sendError(ws, 'invalid_message', 'Unknown message type');
		}
	}

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
				const toAbort: string[] = [];
				for (const [lid, session] of this.activeStreams) {
					if (session.senderId === userId) {
						toAbort.push(lid);
					}
				}
				for (const lid of toAbort) {
					await this.abortStream(lid, 'client_disconnected');
				}
			}
		} catch { /* socket may already be dead */ }
		await this.broadcastPresenceOffline(ws);
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		try {
			const tags = this.ctx.getTags(ws);
			const userId = this.extractTag(tags, 'user:');
			if (userId) {
				const toAbort: string[] = [];
				for (const [lid, session] of this.activeStreams) {
					if (session.senderId === userId) {
						toAbort.push(lid);
					}
				}
				for (const lid of toAbort) {
					await this.abortStream(lid, 'client_disconnected');
				}
			}
		} catch { /* socket may already be dead */ }
		await this.broadcastPresenceOffline(ws);
	}

	// ── Alarm: Batch Flush to DB ──────────────────────────────────────

	async alarm(): Promise<void> {
		// Abort stale streams (agent may have crashed without disconnecting)
		const now = Date.now();
		const staleStreams: string[] = [];
		for (const [lid, session] of this.activeStreams) {
			if (now - session.startedAt > STREAM_TIMEOUT_MS) {
				staleStreams.push(lid);
			}
		}
		for (const lid of staleStreams) {
			await this.abortStream(lid, 'stream_timeout');
		}

		// Flush read cursors and pending edits even if no WAL messages
		if (this.unflushedIds.length === 0) {
			if (this.pendingReadCursors.size > 0 || this.pendingEdits.size > 0) {
				try {
					await this.withDb(async (db) => {
						// Flush pending edits
						if (this.pendingEdits.size > 0) {
							const edits = [...this.pendingEdits.values()];
							this.pendingEdits.clear();
							for (const edit of edits) {
								try {
									await db
										.update(messagesTable)
										.set({ body: edit.body, editedAt: new Date(edit.editedAt) })
										.where(and(eq(messagesTable.id, edit.dbId), eq(messagesTable.orgId, edit.orgId)));
								} catch (editErr) {
									console.error(`[ChatRoom] Edit flush failed for dbId=${edit.dbId}:`, editErr);
								}
							}
						}
						await this.flushReadCursors(db);
					});
				} catch (err) {
					console.error('[ChatRoom] Standalone flush failed:', err);
				}
			}
			return;
		}

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
				await this.broadcast({
					type: 'error',
					code: 'degraded',
					message: `Room temporarily unavailable — messages paused. Owner: use /repair to retry flush (${this.unflushedIds.length} buffered). Use /repair drop only as last resort (drops unflushed messages).`
				});
				// [C4] Schedule retry with exponential backoff (self-healing)
				const backoffMs = Math.min(
					60_000 * 2 ** (this.flushFailures - MAX_FLUSH_FAILURES),
					600_000 // cap at 10 minutes
				);
				await this.ctx.storage.setAlarm(Date.now() + backoffMs);
				return;
			}

			const pgCode =
				(err as { code?: string })?.code ||
				(err as { cause?: { code?: string } })?.cause?.code;
			console.error(
				`[ChatRoom] Flush failed (attempt ${this.flushFailures}, unflushed: ${this.unflushedIds.length}${pgCode ? `, pg: ${pgCode}` : ''})`,
				err
			);
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

		// [H4] Validate localId
		if (
			typeof msg.localId !== 'string' ||
			msg.localId.length === 0 ||
			msg.localId.length > MAX_LOCAL_ID_LENGTH ||
			!LOCAL_ID_RE.test(msg.localId)
		) {
			await this.sendError(
				ws,
				'invalid_message',
				'Invalid localId (max 64 chars, alphanumeric/-/_)'
			);
			return;
		}

		// Validate replyTo (untyped from JSON.parse — could be any type)
		if (msg.replyTo !== undefined && msg.replyTo !== null) {
			if (typeof msg.replyTo !== 'number' || !Number.isInteger(msg.replyTo) || msg.replyTo <= 0) {
				await this.sendError(ws, 'invalid_message', 'Invalid replyTo (must be a positive integer)');
				return;
			}
		}

		if (!msg.body || typeof msg.body !== 'string') {
			await this.sendError(ws, 'invalid_message', 'Message body required');
			return;
		}

		const bodyBytes = new TextEncoder().encode(msg.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			await this.sendError(
				ws,
				'invalid_message',
				`Message too large (max ${MAX_BODY_SIZE / 1024}KB)`
			);
			return;
		}

		// [H1] Per-user rate limiting
		if (this.isRateLimited(userId)) {
			await this.sendError(ws, 'rate_limited', 'Too many messages — slow down');
			return;
		}

		if (
			this.walMessageCount >= MAX_WAL_MESSAGES ||
			this.walByteSize + bodyBytes > MAX_WAL_BYTES
		) {
			await this.sendError(ws, 'room_full', 'Room buffer full — try again shortly');
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

		await this.broadcast({ type: 'message', message: payload });

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

		// RAG responder trigger check (non-blocking, after broadcast so user sees their message)
		// Lazy-load config from DB if not yet pushed via /notify-rag-config (e.g., after DO hibernation)
		if (!this.ragConfig && orgId && (msg.body.startsWith('/ask ') || msg.body.includes('@docs'))) {
			try {
				const { roomConfig: roomConfigTable } = await import('./db/schema');
				const { db, client, connectPromise } = createHyperdriveDb(this.env.HYPERDRIVE);
				await connectPromise;
				try {
					const [row] = await db
						.select()
						.from(roomConfigTable)
						.where(eq(roomConfigTable.orgId, orgId))
						.limit(1);
					if (row) {
						this.ragConfig = {
							ragEnabled: row.ragEnabled,
							ragModel: row.ragModel,
							ragTemperature: row.ragTemperature,
							ragMaxTokens: row.ragMaxTokens,
							ragTrigger: row.ragTrigger as 'explicit' | 'always',
							ragProvider: (row.ragProvider ?? 'workers_ai') as 'workers_ai' | 'openai',
							ragBaseUrl: row.ragBaseUrl ?? undefined,
							ragApiKeyId: row.ragApiKeyId ?? undefined,
						};
					}
				} finally {
					await client.end();
				}
			} catch (err) {
				console.error('[ChatRoom] Failed to lazy-load RAG config:', err);
			}
		}
		if (this.ragConfig?.ragEnabled && shouldRespond(msg.body, true, this.ragConfig.ragTrigger)) {
			if (!this.isRagRateLimited(userId, this.ragConfig.ragTrigger)) {
				this.ctx.waitUntil(this.runRagResponse(orgId, msg.body, this.ragConfig).catch(err => {
					console.error('[ChatRoom] RAG response error:', err);
				}));
			}
		}
	}

	// ── Stream Handlers ─────────────────────────────────────────────

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

	private async abortStream(localId: string, reason: string): Promise<void> {
		this.activeStreams.delete(localId);
		await this.broadcast({ type: 'stream_abort', localId, reason });
	}

	// ── REST Ingest (for MCP chat_send) ──────────────────────────────
	// Trust boundary: verified via X-Internal-Secret header (shared HMAC_SIGNING_SECRET).
	// The calling code authenticates the agent via API key before invoking this endpoint.

	private async handleRestIngest(request: Request): Promise<Response> {
		// Verify internal caller
		const internalSecret = request.headers.get('X-Internal-Secret');
		if (!internalSecret || internalSecret !== this.env.HMAC_SIGNING_SECRET) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
		}

		let payload: {
			localId: string;
			senderId: string;
			senderRole: string;
			senderName: string;
			orgId: string;
			body: string;
			replyTo?: number;
			subtype?: string;
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

		// [I6] Validate localId format (same rules as WebSocket path)
		if (
			typeof payload.localId !== 'string' ||
			payload.localId.length === 0 ||
			payload.localId.length > MAX_LOCAL_ID_LENGTH ||
			!LOCAL_ID_RE.test(payload.localId)
		) {
			return new Response(JSON.stringify({ error: 'Invalid localId' }), { status: 400 });
		}

		if (typeof payload.body !== 'string') {
			return new Response(JSON.stringify({ error: 'Body must be a string' }), { status: 400 });
		}

		const bodyBytes = new TextEncoder().encode(payload.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			return new Response(JSON.stringify({ error: 'Message too large' }), { status: 413 });
		}

		// [I5] Rate limit REST ingest (same as WebSocket path)
		if (this.isRateLimited(payload.senderId)) {
			return new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 });
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
			flushed: false,
			...(payload.subtype ? { subtype: payload.subtype } : {})
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
			timestamp,
			...(payload.subtype ? { subtype: payload.subtype } : {})
		};

		await this.broadcast({ type: 'message', message: broadcastPayload });

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

	// ── Edit Handling ────────────────────────────────────────────────

	private async handleEditMessage(
		ws: WebSocket,
		msg: Extract<ClientMessage, { type: 'edit' }>
	): Promise<void> {
		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		const role = this.extractTag(tags, 'role:');
		const orgId = this.extractTag(tags, 'org:');

		if (!userId || !role) {
			await this.sendError(ws, 'unauthorized', 'Missing user identity');
			return;
		}

		if (role === 'viewer') {
			await this.sendError(ws, 'unauthorized', 'Viewers cannot edit messages');
			return;
		}

		if (typeof msg.serverSeqId !== 'number' || !Number.isInteger(msg.serverSeqId) || msg.serverSeqId <= 0) {
			await this.sendError(ws, 'invalid_message', 'Invalid serverSeqId');
			return;
		}

		if (!msg.body || typeof msg.body !== 'string') {
			await this.sendError(ws, 'invalid_message', 'Message body required');
			return;
		}

		const bodyBytes = new TextEncoder().encode(msg.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			await this.sendError(ws, 'invalid_message', `Message too large (max ${MAX_BODY_SIZE / 1024}KB)`);
			return;
		}

		// Look up the stored message
		const stored = await this.ctx.storage.get<StoredMessage>(storageKey(msg.serverSeqId));
		if (!stored) {
			await this.sendError(ws, 'invalid_message', 'Message not found');
			return;
		}

		// Only the sender can edit their own message
		if (stored.senderId !== userId) {
			await this.sendError(ws, 'unauthorized', 'Can only edit your own messages');
			return;
		}

		const editedAt = new Date().toISOString();

		// Update stored message body and editedAt
		stored.body = msg.body;
		stored.editedAt = editedAt;
		await this.ctx.storage.put(storageKey(msg.serverSeqId), stored);

		// If already flushed to DB, queue a DB edit for next flush
		if (stored.flushed && stored.dbId) {
			this.pendingEdits.set(msg.serverSeqId, {
				dbId: stored.dbId,
				body: msg.body,
				editedAt,
				orgId: orgId || stored.orgId
			});

			// Ensure alarm is scheduled to process pending edits
			const existing = await this.ctx.storage.getAlarm();
			if (!existing) {
				await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
			}
		}
		// If not yet flushed, the updated StoredMessage will be flushed with the new body

		// Broadcast edit to all clients
		await this.broadcast({
			type: 'edit',
			serverSeqId: msg.serverSeqId,
			body: msg.body,
			editedAt,
			senderId: userId
		});
	}

	// ── REST Edit (for MCP chat_edit) ────────────────────────────────

	private async handleRestEdit(request: Request): Promise<Response> {
		// Verify internal caller
		const internalSecret = request.headers.get('X-Internal-Secret');
		if (!internalSecret || internalSecret !== this.env.HMAC_SIGNING_SECRET) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
		}

		let payload: {
			serverSeqId: number;
			body: string;
			senderId: string;
			orgId: string;
		};

		try {
			payload = await request.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
		}

		if (!payload.serverSeqId || !payload.body || !payload.senderId || !payload.orgId) {
			return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
		}

		if (typeof payload.body !== 'string') {
			return new Response(JSON.stringify({ error: 'Body must be a string' }), { status: 400 });
		}

		const bodyBytes = new TextEncoder().encode(payload.body).byteLength;
		if (bodyBytes > MAX_BODY_SIZE) {
			return new Response(JSON.stringify({ error: 'Message too large' }), { status: 413 });
		}

		// Look up stored message
		const stored = await this.ctx.storage.get<StoredMessage>(storageKey(payload.serverSeqId));
		if (!stored) {
			return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404 });
		}

		// Verify sender matches
		if (stored.senderId !== payload.senderId) {
			return new Response(JSON.stringify({ error: 'Can only edit own messages' }), { status: 403 });
		}

		const editedAt = new Date().toISOString();

		// Update stored message
		stored.body = payload.body;
		stored.editedAt = editedAt;
		await this.ctx.storage.put(storageKey(payload.serverSeqId), stored);

		// Queue DB edit if already flushed
		if (stored.flushed && stored.dbId) {
			this.pendingEdits.set(payload.serverSeqId, {
				dbId: stored.dbId,
				body: payload.body,
				editedAt,
				orgId: payload.orgId
			});

			const existing = await this.ctx.storage.getAlarm();
			if (!existing) {
				await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
			}
		}

		// Broadcast edit to all connected WebSocket clients
		await this.broadcast({
			type: 'edit',
			serverSeqId: payload.serverSeqId,
			body: payload.body,
			editedAt,
			senderId: payload.senderId
		});

		return new Response(
			JSON.stringify({ ok: true, editedAt }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// ── REST Brief Notification ──────────────────────────────────────

	private async handleNotifyBrief(request: Request): Promise<Response> {
		const internalSecret = request.headers.get('X-Internal-Secret');
		if (!internalSecret || internalSecret !== this.env.HMAC_SIGNING_SECRET) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
		}

		let payload: { version: number; changedBy: string };
		try {
			payload = await request.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
		}

		await this.broadcast({
			type: 'brief_changed',
			version: payload.version,
			changedBy: payload.changedBy
		});

		return new Response(
			JSON.stringify({ ok: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// ── REST Config Changed Notification ────────────────────────────

	private async handleNotifyConfig(request: Request): Promise<Response> {
		const internalSecret = request.headers.get('X-Internal-Secret');
		if (!internalSecret || internalSecret !== this.env.HMAC_SIGNING_SECRET) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
		}

		let payload: { field: 'name' | 'ocr_enabled'; value: string | boolean; changedBy: string };
		try {
			payload = await request.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
		}

		await this.broadcast({
			type: 'room_config_changed',
			field: payload.field,
			value: payload.value,
			changedBy: payload.changedBy
		});

		return new Response(
			JSON.stringify({ ok: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// ── REST Document Indexed Notification ───────────────────────────

	private async handleNotifyDocumentIndexed(request: Request): Promise<Response> {
		const internalSecret = request.headers.get('X-Internal-Secret');
		if (!internalSecret || internalSecret !== this.env.HMAC_SIGNING_SECRET) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
		}

		let payload: { attachmentId: number; filename: string; chunks: number; words: number; pages: number | null };
		try {
			payload = await request.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
		}

		// Broadcast real-time event to connected clients
		await this.broadcast({
			type: 'document_indexed',
			attachmentId: payload.attachmentId,
			filename: payload.filename,
			chunks: payload.chunks
		});

		// Inject persistent system message so agents see it in chat history
		const systemBody = `[System] ${payload.filename} has been indexed (${payload.pages ? `${payload.pages} pages, ` : ''}~${payload.words.toLocaleString()} words, ${payload.chunks} chunks). Agents can query it with doc_search.`;

		// Resolve orgId: prefer stored meta (set by handleRestIngest), fall back to DO name
		const orgId =
			(await this.ctx.storage.get<string>('meta:orgId')) ||
			this.ctx.id.name ||
			'';

		// Write system message to WAL (same pattern as handleMessage)
		const seqId = this.nextLocalId++;
		const timestamp = new Date().toISOString();

		const stored: StoredMessage = {
			localId: `sys-doc-${payload.attachmentId}`,
			orgId,
			senderId: 'system',
			senderRole: 'system',
			senderName: 'System',
			body: systemBody,
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

		// Broadcast the system message
		const msgPayload: ServerMessagePayload = {
			localId: stored.localId,
			serverSeqId: seqId,
			senderId: stored.senderId,
			senderRole: stored.senderRole,
			senderName: stored.senderName,
			body: stored.body,
			timestamp: stored.timestamp
		};
		await this.broadcast({ type: 'message', message: msgPayload });

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
			JSON.stringify({ ok: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// ── REST RAG Config Notification ────────────────────────────────

	private async handleNotifyRagConfig(request: Request): Promise<Response> {
		const internalSecret = request.headers.get('X-Internal-Secret');
		if (!internalSecret || internalSecret !== this.env.HMAC_SIGNING_SECRET) {
			return new Response('Unauthorized', { status: 403 });
		}
		try {
			this.ragConfig = await request.json() as RagConfig;
		} catch {
			return new Response('Invalid JSON', { status: 400 });
		}
		return new Response('OK', { status: 200 });
	}

	// ── RAG Responder ────────────────────────────────────────────────

	private async runRagResponse(orgId: string, messageBody: string, config: RagConfig): Promise<void> {
		if (this.ragResponseActive) {
			// Already generating a RAG response — skip concurrent request
			return;
		}
		this.ragResponseActive = true;

		const localId = `rag-${crypto.randomUUID().replace(/-/g, '')}`;
		const senderId = `rag-${orgId}`;
		const senderName = 'Docs AI';
		const senderRole = 'agent';
		const timestamp = new Date().toISOString();

		const question = extractQuestion(messageBody);

		// 1. Emit synthetic typing indicator
		await this.broadcast({
			type: 'typing', senderId, senderName, active: true
		});

		try {
			// 2. Open DB connection (used for cap check, search, and usage recording)
			const { db, client, connectPromise } = createHyperdriveDb(this.env.HYPERDRIVE);
			await connectPromise;

			try {
				// 2a. Resolve API key for external providers
			let apiKey: string | undefined;
			if (config.ragProvider === 'openai' && config.ragApiKeyId) {
				apiKey = await this.env.CACHE?.get(`rag-key:${config.ragApiKeyId}`) ?? undefined;
				if (!apiKey) {
					await this.ingestRagMessage(localId, senderId, senderName, senderRole, orgId,
						'API key not found. Please reconfigure the RAG provider in room settings.', timestamp);
					return;
				}
			}

			// 2c. Check spending cap before LLM call
				if (await isAiCapReached(db, orgId)) {
					await this.ingestRagMessage(localId, senderId, senderName, senderRole, orgId,
						'Daily AI limit reached. Upgrade to Pro for more.', timestamp);
					return;
				}

				// 2d. Search documents
				const chunks = await searchDocuments(db, this.env.AI, this.env.VECTORIZE, orgId, question, 10);

				if (chunks.length === 0) {
					// No chunks found — send visible error message
					await this.ingestRagMessage(localId, senderId, senderName, senderRole, orgId,
						'No relevant documents found for your question.', timestamp);
					return;
				}

				// 3. Build prompt
				console.log(`[ChatRoom] RAG: ${chunks.length} chunks found, building prompt for: "${question.slice(0, 80)}"`);
				const system = buildSystemPrompt('');
				const prompt = buildUserPrompt(question, chunks);
				console.log(`[ChatRoom] RAG: prompt length ${prompt.length} chars, model: ${config.ragModel}`);

				// 4. Create model and stream (dynamic import to avoid loading AI SDK for every DO)
				const model = createRagModel(config, this.env.AI, apiKey);

				const { streamText } = await import('ai');
				const result = streamText({
					model,
					system,
					prompt,
					temperature: config.ragTemperature ?? 0.3,
					maxOutputTokens: config.ragMaxTokens ?? 2048,
					abortSignal: AbortSignal.timeout(30_000),
				});

				// 5. Broadcast stream_start
				await this.broadcast({
					type: 'stream_start', localId, senderId, senderName, senderRole, timestamp
				});

				// 6. Stream deltas
				let fullBody = '';
				let buffer = '';
				let lastFlush = Date.now();

				for await (const delta of result.textStream) {
					fullBody += delta;
					buffer += delta;
					if (Date.now() - lastFlush >= 100 || buffer.length > 200) {
						await this.broadcast({ type: 'stream_delta', localId, delta: buffer });
						buffer = '';
						lastFlush = Date.now();
					}
				}
				if (buffer) {
					await this.broadcast({ type: 'stream_delta', localId, delta: buffer });
				}

				// 7. Commit final body to WAL via ingest helper
				if (!fullBody.trim()) {
					console.error('[ChatRoom] RAG generation produced empty response — model may have failed silently');
					fullBody = 'I was unable to generate a response. Please try again.';
				}
				await this.ingestRagMessage(localId, senderId, senderName, senderRole, orgId, fullBody, timestamp);

				// 8. Record LLM generation usage
				const today = new Date().toISOString().slice(0, 10);
				try {
					await db
						.insert(aiUsage)
						.values({ orgId, operation: 'llm_generation' as const, count: 1, periodStart: today })
						.onConflictDoUpdate({
							target: [aiUsage.orgId, aiUsage.operation, aiUsage.periodStart],
							set: { count: sql`${aiUsage.count} + 1` },
						});
				} catch (err) {
					console.error('[ChatRoom] Failed to record LLM usage:', err);
				}
			} finally {
				try { await client.end(); } catch { /* already closed */ }
			}

		} catch (err) {
			console.error('[ChatRoom] RAG generation error:', err);
			// Send abort for the stream
			await this.broadcast({ type: 'stream_abort', localId, reason: 'generation_failed' });
			// Send visible error message
			await this.ingestRagMessage(localId + '-err', senderId, senderName, senderRole, orgId,
				'Document AI encountered an error. Please try again.', timestamp);
		} finally {
			this.ragResponseActive = false;
			// Clear typing indicator
			await this.broadcast({
				type: 'typing', senderId, senderName, active: false
			});
		}
	}

	private async ingestRagMessage(
		localId: string, senderId: string, senderName: string, senderRole: string,
		orgId: string, body: string, timestamp: string
	): Promise<void> {
		const seqId = this.nextLocalId++;
		const stored: StoredMessage = {
			localId, orgId, senderId, senderRole, senderName, body,
			timestamp, flushed: false, subtype: 'rag_response'
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

		const payload: ServerMessagePayload = {
			localId, serverSeqId: seqId, senderId, senderRole, senderName,
			body, timestamp, subtype: 'rag_response'
		};

		await this.broadcast({ type: 'message', message: payload });

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
			// [C6] Individual inserts — no wrapping transaction so one poison
			// message (bad FK, constraint violation) doesn't block the entire batch.
			const mappings: Array<{ localId: string; serverSeqId: number; dbId: number }> = [];
			const updates: Record<string, StoredMessage> = {};
			const failed: number[] = [];

			// [C7] Build seqId → dbId map for replyTo translation.
			// Agents send replyTo as serverSeqId (WAL sequence), but the DB FK
			// expects a real messages.id. Resolve from already-flushed DO entries.
			const seqToDbId = new Map<number, number>();
			const allEntries = await this.ctx.storage.list<StoredMessage>({ prefix: 'msg:', limit: 500 });
			for (const [key, msg] of allEntries) {
				if (msg.flushed && msg.dbId) {
					const seqId = parseInt(key.replace('msg:', ''), 10);
					if (!isNaN(seqId)) seqToDbId.set(seqId, msg.dbId);
				}
			}

			for (const { seqId, stored } of toFlush) {
				// Resolve replyTo from WAL seqId to DB id.
				// Agents send serverSeqId as replyTo; the DB expects messages.id.
				let resolvedReplyTo: number | null = null;
				if (stored.replyTo != null) {
					const mapped = seqToDbId.get(stored.replyTo);
					if (mapped) {
						resolvedReplyTo = mapped;
					} else {
						// Not in WAL map — could be a real DB id (from web client) or
						// a stale WAL ref. Pass through; FK constraint will catch invalids.
						resolvedReplyTo = stored.replyTo;
					}
				}

				try {
					const [inserted] = await db
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
							replyTo: resolvedReplyTo,
							editedAt: stored.editedAt ? new Date(stored.editedAt) : null,
							createdAt: new Date(stored.timestamp)
						})
						.returning({ id: messagesTable.id });

					stored.flushed = true;
					stored.dbId = inserted.id;
					seqToDbId.set(seqId, inserted.id); // Update map for later replyTo lookups
					updates[storageKey(seqId)] = stored;
					mappings.push({ localId: stored.localId, serverSeqId: seqId, dbId: inserted.id });
				} catch (insertErr) {
					// Drizzle wraps PG errors: code may be on err.code or err.cause.code
					const pgCode =
						(insertErr as { code?: string })?.code ||
						(insertErr as { cause?: { code?: string } })?.cause?.code;

					// 23503 = FK violation — likely bad replyTo. Retry without replyTo
					// before giving up on the message entirely.
					if (pgCode === '23503' && resolvedReplyTo != null) {
						console.error(
							`[ChatRoom] FK violation on seq=${seqId} replyTo=${resolvedReplyTo}, retrying without replyTo`
						);
						try {
							const [retried] = await db
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
									replyTo: null,
									editedAt: stored.editedAt ? new Date(stored.editedAt) : null,
									createdAt: new Date(stored.timestamp)
								})
								.returning({ id: messagesTable.id });

							stored.flushed = true;
							stored.dbId = retried.id;
							seqToDbId.set(seqId, retried.id);
							updates[storageKey(seqId)] = stored;
							mappings.push({ localId: stored.localId, serverSeqId: seqId, dbId: retried.id });
							continue;
						} catch (retryErr) {
							// Retry also failed — fall through to skip logic
							const retryCode =
								(retryErr as { code?: string })?.code ||
								(retryErr as { cause?: { code?: string } })?.cause?.code;
							if (retryCode && retryCode.startsWith('23')) {
								console.error(
									`[ChatRoom] Skipping poison message seq=${seqId} (pg: ${retryCode}, sender: ${stored.senderId})`,
									retryErr
								);
								stored.flushed = true;
								updates[storageKey(seqId)] = stored;
								failed.push(seqId);
								continue;
							}
							throw retryErr;
						}
					}

					// Other constraint violations (23xxx) are permanent — mark as flushed to skip.
					// Transient errors (connection, timeout) should be retried.
					if (pgCode && pgCode.startsWith('23')) {
						console.error(
							`[ChatRoom] Skipping poison message seq=${seqId} (pg: ${pgCode}, sender: ${stored.senderId})`,
							insertErr
						);
						stored.flushed = true; // Mark as flushed so it's not retried forever
						updates[storageKey(seqId)] = stored;
						failed.push(seqId);
					} else {
						// Transient error — rethrow to trigger retry/degraded logic
						throw insertErr;
					}
				}
			}

			await this.ctx.storage.put(updates);

			const flushedSet = new Set(toFlush.map((f) => f.seqId));
			this.unflushedIds = this.unflushedIds.filter((id) => !flushedSet.has(id));
			await this.ctx.storage.put('meta:unflushedIds', this.unflushedIds);

			if (mappings.length > 0) {
				await this.broadcast({ type: 'id_map', mappings });
			}

			// Backfill messageId on attachments for r2: references in message bodies
			const r2Re = /!\[[^\]]*\]\(r2:([^)]+)\)/g;
			for (const { stored } of toFlush) {
				if (!stored.dbId) continue;
				const keys: string[] = [];
				let match: RegExpExecArray | null;
				while ((match = r2Re.exec(stored.body)) !== null) {
					keys.push(match[1]);
				}
				r2Re.lastIndex = 0;
				if (keys.length > 0) {
					for (const key of keys) {
						await db
							.update(attachments)
							.set({ messageId: stored.dbId })
							.where(and(
								eq(attachments.r2Key, key),
								eq(attachments.orgId, orgId),
								eq(attachments.uploadedBy, stored.senderId)
							))
							.catch((err: unknown) => console.error('[ChatRoom] Attachment backfill failed:', err));
					}
				}
			}

			// Flush pending edits to already-flushed messages
			if (this.pendingEdits.size > 0) {
				const edits = [...this.pendingEdits.values()];
				this.pendingEdits.clear();
				for (const edit of edits) {
					try {
						await db
							.update(messagesTable)
							.set({ body: edit.body, editedAt: new Date(edit.editedAt) })
							.where(and(eq(messagesTable.id, edit.dbId), eq(messagesTable.orgId, edit.orgId)));
					} catch (editErr) {
						console.error(`[ChatRoom] Edit flush failed for dbId=${edit.dbId}:`, editErr);
					}
				}
			}

			await this.pruneOldEntries();

			// Piggyback read cursor flush on same connection
			await this.flushReadCursors(db);
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

		// [ME-11] Detect WAL gap — client's cursor is behind pruned entries
		if (entries.size === 0 && lastKnownSeqId > 0 && this.walMessageCount > 0) {
			await this.safeSend(ws, {
				type: 'error',
				code: 'resync_required',
				message: 'Message history gap detected. Please resync.'
			});
			return;
		}

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
				timestamp: stored.timestamp,
				...(stored.subtype ? { subtype: stored.subtype } : {})
			});
		}

		await this.safeSend(ws, { type: 'history', messages: history });
	}

	// ── Typing ────────────────────────────────────────────────────────

	private async handleTyping(ws: WebSocket, active: boolean): Promise<void> {
		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		const name = this.extractTag(tags, 'name:');

		if (!userId) return;

		await this.broadcast(
			{ type: 'typing', senderId: userId, senderName: name, active },
			ws
		);
	}

	// ── DB Helper ────────────────────────────────────────────────────

	private async withDb<T>(fn: (db: any) => Promise<T>): Promise<T> {
		const { db, client, connectPromise } = createHyperdriveDb(this.env.HYPERDRIVE);
		await connectPromise;
		try {
			return await fn(db);
		} finally {
			try { await client.end(); } catch { /* already closed */ }
		}
	}

	// ── Read Cursor ──────────────────────────────────────────────────

	private async handleReadCursor(ws: WebSocket, lastReadId: number): Promise<void> {
		if (typeof lastReadId !== 'number' || !Number.isInteger(lastReadId) || lastReadId <= 0) {
			return; // Silently ignore invalid read cursors
		}

		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		const orgId = this.extractTag(tags, 'org:');

		if (!userId || !orgId) return;

		// Debounce: store in memory, flush alongside WAL in alarm handler
		const key = `${orgId}:${userId}`;
		const existing = this.pendingReadCursors.get(key);
		if (!existing || lastReadId > existing.lastReadId) {
			this.pendingReadCursors.set(key, { orgId, userId, lastReadId });
		}

		// Schedule alarm for cursor flush if no WAL messages pending (5s debounce)
		if (this.unflushedIds.length === 0) {
			const existingAlarm = await this.ctx.storage.getAlarm();
			if (!existingAlarm) {
				await this.ctx.storage.setAlarm(Date.now() + 5000);
			}
		}
	}

	/** Flush debounced read cursors to DB — called from alarm handler */
	private async flushReadCursors(db: any): Promise<void> {
		if (this.pendingReadCursors.size === 0) return;

		const cursors = [...this.pendingReadCursors.values()];
		this.pendingReadCursors.clear();

		for (const { orgId, userId, lastReadId } of cursors) {
			await db
				.insert(readCursors)
				.values({ orgId, userId, lastReadMessageId: lastReadId, updatedAt: new Date() })
				.onConflictDoUpdate({
					target: [readCursors.orgId, readCursors.userId],
					set: {
						lastReadMessageId: sql`GREATEST(${readCursors.lastReadMessageId}, ${lastReadId})`,
						updatedAt: new Date()
					}
				});
		}
	}

	// ── Command Handling ─────────────────────────────────────────────

	private async handleCommand(ws: WebSocket, name: string, args: string): Promise<void> {
		// Validate command name and args
		if (typeof name !== 'string' || name.length === 0 || name.length > 32 || !/^[a-z]+$/.test(name)) {
			await this.sendError(ws, 'invalid_message', 'Invalid command name');
			return;
		}
		if (typeof args !== 'string' || args.length > 512) {
			await this.sendError(ws, 'invalid_message', 'Command args too long (max 512 chars)');
			return;
		}

		const tags = this.ctx.getTags(ws);
		const userId = this.extractTag(tags, 'user:');
		const role = this.extractTag(tags, 'role:');
		const userName = this.extractTag(tags, 'name:');
		const orgId = this.extractTag(tags, 'org:');

		if (!userId || !role) {
			await this.sendError(ws, 'unauthorized', 'Missing user identity');
			return;
		}

		switch (name) {
			case 'clear':
				if (role !== 'owner') {
					await this.sendError(ws, 'unauthorized', 'Only owner can clear messages');
					return;
				}
				await this.handleClearRoom(orgId, userName);
				break;

			case 'repair': {
				if (role !== 'owner') {
					await this.sendError(ws, 'unauthorized', 'Only owner can repair rooms');
					return;
				}
				const dropWal = args.trim() === 'drop';
				this.flushFailures = 0;
				this.degraded = false;
				await this.ctx.storage.put('meta:flushFailures', 0);

				let detail = 'degraded mode cleared, flush scheduled';
				if (dropWal && this.unflushedIds.length > 0) {
					// Drop unflushed WAL entries (messages lost but room unblocked)
					const keys = this.unflushedIds.map(storageKey);
					for (let i = 0; i < keys.length; i += 128) {
						await this.ctx.storage.delete(keys.slice(i, i + 128));
					}
					console.log(`[ChatRoom] Dropped ${this.unflushedIds.length} unflushed WAL entries`);
					this.unflushedIds = [];
					this.walMessageCount = 0;
					this.walByteSize = 0;
					await this.ctx.storage.put('meta:unflushedIds', []);
					await this.ctx.storage.put('meta:walMessageCount', 0);
					await this.ctx.storage.put('meta:walByteSize', 0);
					await this.ctx.storage.deleteAlarm();
					detail = `degraded mode cleared, ${keys.length} unflushed messages dropped`;
				} else {
					// Schedule an immediate flush attempt
					await this.ctx.storage.setAlarm(Date.now() + 100);
				}

				await this.broadcast({
					type: 'message',
					message: {
						localId: '',
						serverSeqId: 0,
						senderId: 'system',
						senderName: 'System',
						senderRole: 'system',
						body: `Room repaired by ${userName} — ${detail}.`,
						timestamp: new Date().toISOString()
					}
				});
				console.log(`[ChatRoom] Repair by ${userName}: ${detail} (unflushed: ${this.unflushedIds.length})`);
				break;
			}

			case 'approve':
			case 'reject': {
				if (role !== 'owner' && role !== 'lead') {
					await this.sendError(ws, 'unauthorized', `Only owner or lead can ${name} actions`);
					return;
				}
				const argTrimmed = args.trim();
				let actionId: number;
				if (argTrimmed === '') {
					// No ID given — find the most recent pending action in this room
					const latest = await this.withDb(async (db) => {
						const [row] = await db
							.select({ id: pendingActions.id })
							.from(pendingActions)
							.where(and(eq(pendingActions.orgId, orgId), eq(pendingActions.status, 'pending')))
							.orderBy(desc(pendingActions.id))
							.limit(1);
						return row;
					});
					if (!latest) {
						await this.safeSend(ws, {
							type: 'message',
							message: {
								localId: `sys-${Date.now()}`,
								serverSeqId: 0,
								senderId: 'system',
								senderName: 'System',
								senderRole: 'system',
								body: `No pending actions to ${name}.`,
								timestamp: new Date().toISOString()
							}
						});
						return;
					}
					actionId = latest.id;
				} else {
					actionId = parseInt(argTrimmed, 10);
					if (isNaN(actionId) || actionId <= 0) {
						await this.sendError(ws, 'invalid_message', 'Usage: /' + name + ' <action_id>');
						return;
					}
				}
				await this.handleActionApproval(ws, orgId, userId, role, actionId, name);
				break;
			}

			case 'actions': {
				if (role !== 'owner' && role !== 'lead') {
					await this.sendError(ws, 'unauthorized', 'Only owner or lead can list actions');
					return;
				}
				await this.handleListActions(ws, orgId);
				break;
			}

			case 'continue':
				if (role !== 'owner' && role !== 'lead') {
					await this.sendError(ws, 'unauthorized', 'Only owner or lead can resume');
					return;
				}
				// Loop guard resume — broadcast a system message
				await this.broadcast({
					type: 'message',
					message: {
						localId: `sys-${Date.now()}`,
						serverSeqId: 0,
						senderId: 'system',
						senderRole: 'system',
						senderName: 'System',
						body: `${userName} resumed the loop guard`,
						timestamp: new Date().toISOString()
					}
				});
				break;

			case 'whois': {
				// Restrict to owner/lead — members don't need to resolve user details
				if (role !== 'owner' && role !== 'lead') {
					await this.sendError(ws, 'unauthorized', 'Only owner or lead can use /whois');
					return;
				}
				const target = args.trim();
				if (!target) {
					await this.sendError(ws, 'invalid_message', 'Usage: /whois <name>');
					return;
				}
				// Find online user matching the name
				const sockets = this.ctx.getWebSockets();
				let found = false;
				for (const s of sockets) {
					const sTags = this.ctx.getTags(s);
					const sName = this.extractTag(sTags, 'name:');
					if (sName.toLowerCase() === target.toLowerCase()) {
						const sRole = this.extractTag(sTags, 'role:');
						await this.safeSend(ws, {
							type: 'message',
							message: {
								localId: `sys-${Date.now()}`,
								serverSeqId: 0,
								senderId: 'system',
								senderRole: 'system',
								senderName: 'System',
								body: `${sName} — role: ${sRole}`,
								timestamp: new Date().toISOString()
							}
						});
						found = true;
						break;
					}
				}
				if (!found) {
					await this.safeSend(ws, {
						type: 'message',
						message: {
							localId: `sys-${Date.now()}`,
							serverSeqId: 0,
							senderId: 'system',
							senderRole: 'system',
							senderName: 'System',
							body: `User "${target}" not found online`,
							timestamp: new Date().toISOString()
						}
					});
				}
				break;
			}

			case 'ticket': {
				const ticketTitle = args.trim();
				if (!ticketTitle || ticketTitle.length < 3) {
					await this.sendError(ws, 'invalid_message', 'Usage: /ticket <title> (min 3 chars)');
					return;
				}
				try {
					const ticketId = crypto.randomUUID().replace(/-/g, '').slice(0, 21);
					await this.withDb(async (db) => {
						await db.insert(supportTickets).values({
							id: ticketId,
							userId,
							title: ticketTitle.slice(0, 200),
							description: ticketTitle,
							category: 'issue' as const
						});
					});
					await this.broadcast({
						type: 'message',
						message: {
							localId: `sys-${Date.now()}`,
							serverSeqId: 0,
							senderId: 'system',
							senderRole: 'system',
							senderName: 'System',
							body: `${userName} created ticket: ${ticketTitle} → /support/${ticketId}`,
							timestamp: new Date().toISOString()
						}
					});
				} catch (e) {
					console.error('[ChatRoom] Ticket creation failed:', e);
					await this.sendError(ws, 'invalid_message', 'Failed to create ticket');
				}
				break;
			}

			default:
				await this.sendError(ws, 'invalid_message', `Unknown command: /${name}`);
		}
	}

	private async handleActionApproval(
		ws: WebSocket,
		orgId: string,
		userId: string,
		role: string,
		actionId: number,
		action: 'approve' | 'reject'
	): Promise<void> {
		try {
			await this.withDb(async (db) => {
				const [existing] = await db
					.select({
						id: pendingActions.id,
						status: pendingActions.status,
						riskLevel: pendingActions.riskLevel,
						agentUserId: pendingActions.agentUserId
					})
					.from(pendingActions)
					.where(and(eq(pendingActions.id, actionId), eq(pendingActions.orgId, orgId)))
					.limit(1);

				if (!existing) {
					await this.sendError(ws, 'invalid_message', `Action #${actionId} not found`);
					return;
				}
				if (existing.status !== 'pending') {
					await this.sendError(ws, 'invalid_message', `Action #${actionId} already ${existing.status}`);
					return;
				}
				// [S1] Block agent self-approval/rejection
				if (existing.agentUserId === userId) {
					await this.sendError(ws, 'unauthorized', 'Cannot approve/reject your own action');
					return;
				}
				if (action === 'approve' && role === 'lead' && existing.riskLevel === 'high') {
					await this.sendError(ws, 'unauthorized', 'Only owner can approve high-risk actions');
					return;
				}

				// [S2] Atomic update — status guard in WHERE prevents TOCTOU race
				const newStatus = action === 'approve' ? 'approved' : 'rejected';
				const [updated] = await db
					.update(pendingActions)
					.set({
						status: newStatus,
						...(action === 'approve'
							? { approvedBy: userId, approvedAt: new Date() }
							: {})
					})
					.where(and(
						eq(pendingActions.id, actionId),
						eq(pendingActions.orgId, orgId),
						eq(pendingActions.status, 'pending')
					))
					.returning({ id: pendingActions.id });

				if (!updated) {
					await this.sendError(ws, 'invalid_message', `Action #${actionId} is no longer pending`);
					return;
				}

				// [I6] System messages use serverSeqId: 0 — ephemeral, not persisted
				// through WAL. Important status changes are queryable via /api/actions.
				await this.broadcast({
					type: 'message',
					message: {
						localId: `sys-${Date.now()}`,
						serverSeqId: 0,
						senderId: 'system',
						senderRole: 'system',
						senderName: 'System',
						body: `Action #${actionId} ${newStatus}`,
						timestamp: new Date().toISOString()
					}
				});
			});
		} catch (err) {
			console.error('[ChatRoom] Action approval failed:', err);
			await this.sendError(ws, 'internal', 'Failed to process action');
		}
	}

	private async handleListActions(ws: WebSocket, orgId: string): Promise<void> {
		try {
			await this.withDb(async (db) => {
				const actions = await db
					.select({
						id: pendingActions.id,
						actionType: pendingActions.actionType,
						riskLevel: pendingActions.riskLevel,
						description: pendingActions.description,
						requestedBy: pendingActions.requestedBy,
						createdAt: pendingActions.createdAt
					})
					.from(pendingActions)
					.where(and(eq(pendingActions.orgId, orgId), eq(pendingActions.status, 'pending')))
					.orderBy(desc(pendingActions.createdAt))
					.limit(20);

				if (actions.length === 0) {
					await this.safeSend(ws, {
						type: 'message',
						message: {
							localId: `sys-${Date.now()}`,
							serverSeqId: 0,
							senderId: 'system',
							senderRole: 'system',
							senderName: 'System',
							body: 'No pending actions',
							timestamp: new Date().toISOString()
						}
					});
					return;
				}

				const lines = actions.map(
					(a: typeof actions[number]) => `#${a.id} [${a.riskLevel}] ${a.actionType}: ${a.description}`
				);
				await this.safeSend(ws, {
					type: 'message',
					message: {
						localId: `sys-${Date.now()}`,
						serverSeqId: 0,
						senderId: 'system',
						senderRole: 'system',
						senderName: 'System',
						body: `**Pending actions:**\n${lines.join('\n')}`,
						timestamp: new Date().toISOString()
					}
				});
			});
		} catch (err) {
			console.error('[ChatRoom] List actions failed:', err);
			await this.sendError(ws, 'internal', 'Failed to list actions');
		}
	}

	// ── Clear Room ───────────────────────────────────────────────────

	private async handleClearRoom(orgId: string, clearedBy: string): Promise<void> {
		try {
			// Soft-delete messages in DB
			await this.withDb(async (db) => {
				await db
					.update(messagesTable)
					.set({ deletedAt: new Date() })
					.where(and(eq(messagesTable.orgId, orgId), isNull(messagesTable.deletedAt)));
			});

			// Clear WAL storage
			const walKeys = await this.ctx.storage.list({ prefix: 'msg:' });
			if (walKeys.size > 0) {
				await batchDelete(this.ctx.storage, [...walKeys.keys()]);
			}

			// Reset WAL counters
			this.unflushedIds = [];
			this.walMessageCount = 0;
			this.walByteSize = 0;
			await this.ctx.storage.put({
				'meta:unflushedIds': [],
				'meta:walMessageCount': 0,
				'meta:walByteSize': 0
			});

			await this.broadcast({ type: 'clear', clearedBy });
		} catch (err) {
			console.error('[ChatRoom] Clear room failed:', err);
		}
	}

	// ── Presence ──────────────────────────────────────────────────────

	private async broadcastPresenceOffline(ws: WebSocket): Promise<void> {
		try {
			const tags = this.ctx.getTags(ws);
			const userId = this.extractTag(tags, 'user:');
			const name = this.extractTag(tags, 'name:');
			const role = this.extractTag(tags, 'role:');

			if (userId) {
				// Only broadcast offline if no other connections remain for this user
				const remaining = this.ctx.getWebSockets().filter((s) => {
					if (s === ws) return false;
					const sUserId = this.extractTag(this.ctx.getTags(s), 'user:');
					return sUserId === userId;
				});

				if (remaining.length === 0) {
					await this.broadcast(
						{ type: 'presence', senderId: userId, senderName: name, senderRole: role, status: 'offline' },
						ws
					);
				}
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

	// ── RAG Rate Limiting ────────────────────────────────────────────

	private isRagRateLimited(userId: string, trigger: string): boolean {
		const now = Date.now();

		// "always" mode cooldown
		if (trigger === 'always' && now - this.ragLastResponseTime < RAG_ALWAYS_COOLDOWN_MS) {
			return true;
		}

		// Per-room rate limit
		this.ragRoomTimestamps = this.ragRoomTimestamps.filter(t => now - t < RAG_RATE_LIMIT_ROOM_WINDOW_MS);
		if (this.ragRoomTimestamps.length >= RAG_RATE_LIMIT_ROOM_MAX) {
			return true;
		}

		// Per-user rate limit
		const userTs = (this.ragUserTimestamps.get(userId) ?? []).filter(t => now - t < RAG_RATE_LIMIT_USER_WINDOW_MS);
		if (userTs.length >= RAG_RATE_LIMIT_USER_MAX) {
			this.ragUserTimestamps.set(userId, userTs);
			return true;
		}

		// Record this request
		this.ragRoomTimestamps.push(now);
		userTs.push(now);
		this.ragUserTimestamps.set(userId, userTs);
		this.ragLastResponseTime = now;

		return false;
	}

	// ── Helpers ───────────────────────────────────────────────────────

	/** HMAC-sign a JSON string if signing key is available */
	private async signJson(json: string): Promise<string> {
		if (!this.broadcastSigningKey) return json;
		const sig = await crypto.subtle.sign(
			'HMAC',
			this.broadcastSigningKey,
			new TextEncoder().encode(json)
		);
		const hmac = btoa(String.fromCharCode(...new Uint8Array(sig)));
		return json.slice(0, -1) + ',"_hmac":"' + hmac + '"}';
	}

	private async broadcast(msg: ServerMessage, exclude?: WebSocket): Promise<void> {
		const json = await this.signJson(JSON.stringify(msg));
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

	private async safeSend(ws: WebSocket, msg: ServerMessage): Promise<void> {
		try {
			const json = await this.signJson(JSON.stringify(msg));
			ws.send(json);
		} catch {
			// Dead socket
		}
	}

	private async sendError(ws: WebSocket, code: ErrorCode, message: string): Promise<void> {
		await this.safeSend(ws, { type: 'error', code, message });
	}

	// [H8] Decode URI-encoded tag values
	private extractTag(tags: string[], prefix: string): string {
		const tag = tags.find((t) => t.startsWith(prefix));
		return tag ? decodeURIComponent(tag.slice(prefix.length)) : '';
	}

	// [C2] Only prune flushed entries; [M1] Use limit to avoid loading all into memory
	private async pruneOldEntries(): Promise<void> {
		// Skip expensive list if total stored (flushed + unflushed) is small.
		// walMessageCount may overcount slightly (includes unflushed), but this is a
		// conservative early-exit — the storage.list below provides the exact count.
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
