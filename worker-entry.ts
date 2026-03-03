/**
 * Cloudflare Worker entry point.
 *
 * Re-exports the SvelteKit worker (HTTP handler) and all Durable Object
 * classes so wrangler can discover them from a single entrypoint.
 *
 * WebSocket upgrades are intercepted here before SvelteKit because
 * SvelteKit's response pipeline strips the Cloudflare-specific `webSocket`
 * property from the Response, breaking WS upgrades.
 *
 * IMPORTANT: Do not import pg/drizzle at the top level — pg uses node:fs
 * which wrangler's bundler cannot resolve at the entry module scope.
 * Use dynamic import() inside handlers instead.
 */

import svelteKitWorker from './.svelte-kit/cloudflare/_worker.js';

// Durable Object classes
export { ChatRoom } from './src/lib/server/chat-room';

// Origins allowed for WebSocket upgrade (mirrors hooks.server.ts CORS list)
const WS_ALLOWED_ORIGINS = new Set([
	'http://localhost:5190',
	'http://localhost:8787',
	'http://127.0.0.1:5190',
	'http://127.0.0.1:8787',
	'capacitor://martol.app',
	'https://martol.app',
	'https://martol.plitix.com'
]);

const WS_ROUTE_RE = /^\/api\/rooms\/([^/]+)\/ws$/;

// Combined worker: SvelteKit fetch + WebSocket upgrade + scheduled handler
export default {
	async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
		// Intercept WebSocket upgrades — SvelteKit can't pass through WS responses
		if (request.headers.get('Upgrade') === 'websocket') {
			const url = new URL(request.url);
			const match = url.pathname.match(WS_ROUTE_RE);
			if (match) {
				return handleWebSocketUpgrade(request, env, decodeURIComponent(match[1]));
			}
		}

		// All other requests → SvelteKit
		return svelteKitWorker.fetch(request, env, ctx);
	},

	// Cron Trigger: expire pending actions older than 24h
	async scheduled(event: ScheduledEvent, env: Record<string, unknown>, ctx: ExecutionContext) {
		const hyperdrive = env.HYPERDRIVE as { connectionString: string };
		if (!hyperdrive) {
			console.error('[Cron] HYPERDRIVE binding not available');
			return;
		}

		const { createHyperdriveDb } = await import('./src/lib/server/db/hyperdrive');
		const { pendingActions } = await import('./src/lib/server/db/schema');
		const { eq, and, lt } = await import('drizzle-orm');

		const { db, client, connectPromise } = createHyperdriveDb(hyperdrive);
		await connectPromise;

		try {
			const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const expired = await db
				.update(pendingActions)
				.set({ status: 'expired' })
				.where(
					and(
						eq(pendingActions.status, 'pending'),
						lt(pendingActions.createdAt, cutoff)
					)
				)
				.returning({ id: pendingActions.id });

			if (expired.length > 0) {
				console.log(`[Cron] Expired ${expired.length} pending actions`);
			}
		} catch (err) {
			console.error('[Cron] Action expiry failed:', err);
		}

		// Purge expired pending invitations
		try {
			const { invitation } = await import('./src/lib/server/db/auth-schema');
			const expiredInvites = await db
				.update(invitation)
				.set({ status: 'canceled' })
				.where(
					and(
						eq(invitation.status, 'pending'),
						lt(invitation.expiresAt, new Date())
					)
				)
				.returning({ id: invitation.id });

			if (expiredInvites.length > 0) {
				console.log(`[Cron] Expired ${expiredInvites.length} pending invitations`);
			}
		} catch (err) {
			console.error('[Cron] Invitation purge failed:', err);
		} finally {
			try { await client.end(); } catch { /* already closed */ }
		}
	}
};

/**
 * Handle WebSocket upgrade directly at the Worker level.
 *
 * Auth: session (browsers) or API key (agents).
 * Agents skip origin check — they're server-side scripts, not subject to CSWSH.
 * Membership: verifies user belongs to the room (org).
 * Then forwards the upgrade request to the ChatRoom Durable Object.
 */
async function handleWebSocketUpgrade(
	request: Request,
	env: Record<string, unknown>,
	roomId: string
): Promise<Response> {
	// Validate roomId format
	if (!roomId || roomId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(roomId)) {
		return new Response('Invalid room ID', { status: 400 });
	}

	// API key present → agent auth (skip origin check)
	// No API key → browser auth (enforce origin check against CSWSH)
	const apiKeyHeader = request.headers.get('x-api-key');
	if (!apiKeyHeader) {
		const origin = request.headers.get('origin');
		if (!origin || !WS_ALLOWED_ORIGINS.has(origin)) {
			return new Response('Origin not allowed', { status: 403 });
		}
	}

	const hyperdrive = env.HYPERDRIVE as { connectionString: string };
	if (!hyperdrive) {
		return new Response('Service unavailable', { status: 503 });
	}

	// Dynamic imports to avoid top-level node:fs bundling
	const { createHyperdriveDb } = await import('./src/lib/server/db/hyperdrive');
	const { createAuth } = await import('./src/lib/server/auth');
	const { member, user } = await import('./src/lib/server/db/auth-schema');
	const { eq, and } = await import('drizzle-orm');

	const { db, client, connectPromise } = createHyperdriveDb(hyperdrive);
	await connectPromise;

	try {
		const auth = createAuth(
			db,
			env.BETTER_AUTH_SECRET as string,
			env.APP_BASE_URL as string || 'https://martol.plitix.com',
			{
				resendApiKey: env.RESEND_API_KEY as string,
				emailFrom: (env.EMAIL_FROM as string) || 'noreply@martol.app',
				emailName: (env.EMAIL_NAME as string) || 'Martol'
			},
			env.CACHE as KVNamespace
		);

		let userId: string;
		let userName: string;

		if (apiKeyHeader) {
			// Agent auth via API key
			let keyData: any;
			try {
				keyData = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } });
			} catch {
				return new Response('Invalid API key', { status: 401 });
			}
			if (!keyData?.valid || !keyData.key?.userId) {
				return new Response('Invalid API key', { status: 401 });
			}
			userId = keyData.key.userId;

			// Check revocation in KV
			const kv = env.CACHE as KVNamespace | undefined;
			if (kv && keyData.key.id) {
				const revoked = await kv.get(`revoked:${keyData.key.id}`);
				if (revoked) {
					return new Response('API key revoked', { status: 401 });
				}
			}

			// Get agent display name
			const [agentUser] = await db
				.select({ name: user.name, username: user.username })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);
			userName = agentUser?.name || agentUser?.username || `Agent-${userId.slice(0, 6)}`;
		} else {
			// Browser auth via session cookie
			const session = await auth.api.getSession({ headers: request.headers });
			if (!session?.user || !session?.session) {
				return new Response('Authentication required', { status: 401 });
			}
			userId = session.user.id;
			userName = session.user.name || session.user.username || `User-${userId.slice(0, 6)}`;
		}

		// Verify org membership
		const [memberRecord] = await db
			.select({ role: member.role })
			.from(member)
			.where(and(eq(member.organizationId, roomId), eq(member.userId, userId)))
			.limit(1);

		if (!memberRecord) {
			return new Response('Not a member of this room', { status: 403 });
		}

		// Forward to ChatRoom Durable Object
		const chatRoomNs = env.CHAT_ROOM as DurableObjectNamespace;
		if (!chatRoomNs) {
			return new Response('Real-time service unavailable', { status: 503 });
		}

		const doId = chatRoomNs.idFromName(roomId);
		const stub = chatRoomNs.get(doId);

		const headers = new Headers(request.headers);
		const role = memberRecord.role;

		// HMAC-sign identity payload to prevent header spoofing
		const signingKey = (env.HMAC_SIGNING_SECRET || env.BETTER_AUTH_SECRET) as string;
		if (!signingKey) {
			return new Response('Signing key unavailable', { status: 503 });
		}

		const identityPayload = JSON.stringify({
			userId,
			role,
			userName,
			orgId: roomId,
			timestamp: Date.now()
		});

		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(signingKey),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(identityPayload));
		const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

		headers.set('X-Identity', identityPayload);
		headers.set('X-Identity-Sig', signature);

		return stub.fetch(new Request(request.url, { method: 'GET', headers }));
	} finally {
		try { await client.end(); } catch { /* already closed */ }
	}
}
