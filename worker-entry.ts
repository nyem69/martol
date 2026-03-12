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

import { withSentry } from '@sentry/cloudflare';
import svelteKitWorker from './.svelte-kit/cloudflare/_worker.js';

// Durable Object classes
export { ChatRoom } from './src/lib/server/chat-room';

// ── Kreuzberg WASM spike test ──────────────────────────────────────────
// Static WASM import — Wrangler handles .wasm natively (no Vite involved).
// @ts-expect-error — .wasm static import has no TS declaration
import kreuzbergWasm from '@kreuzberg/wasm/kreuzberg_wasm_bg.wasm';
import { initWasm } from '@kreuzberg/wasm';

// Init once at module load; expose the promise globally so SvelteKit routes
// can await it. If init fails, the error is logged but doesn't crash the Worker.
(globalThis as Record<string, unknown>).__kreuzbergReady = initWasm({ wasmModule: kreuzbergWasm })
	.then(() => console.log('[Kreuzberg] WASM initialized successfully'))
	.catch((err: unknown) => console.error('[Kreuzberg] WASM init failed:', err));
// ── End spike test ─────────────────────────────────────────────────────

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
const worker = {
	async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
		// Intercept WebSocket upgrades — SvelteKit can't pass through WS responses.
		// NOTE: WebSocket upgrades are intercepted here before SvelteKit.
		// The route at src/routes/api/rooms/[roomId]/ws/ was removed (ME-21)
		// because it was dead code — this handler always processes WS upgrades first.
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
		const { pendingActions, attachments } = await import('./src/lib/server/db/schema');
		const { eq, and, lt, isNull, sql } = await import('drizzle-orm');

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
		}

		// Clean up orphaned attachments (uploaded but never linked to a message)
		try {
			const orphanCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const orphans = await db.select()
				.from(attachments)
				.where(
					and(
						isNull(attachments.messageId),
						lt(attachments.createdAt, orphanCutoff)
					)
				)
				.limit(100);

			const r2Bucket = env.STORAGE as R2Bucket | undefined;
			for (const orphan of orphans) {
				try {
					if (r2Bucket) {
						await r2Bucket.delete(orphan.r2Key);
					}
					await db.delete(attachments).where(eq(attachments.id, orphan.id));
				} catch (e) {
					console.error('[Cron] Failed to delete orphan attachment:', orphan.id, e);
				}
			}
			if (orphans.length > 0) {
				console.log(`[Cron] Cleaned up ${orphans.length} orphaned attachments`);
			}
		} catch (err) {
			console.error('[Cron] Orphan attachment cleanup failed:', err);
		}

		// Recalculate storage_bytes_used for all orgs (self-heal drift)
		try {
			await db.execute(sql`
				UPDATE subscriptions s
				SET storage_bytes_used = COALESCE(
					(SELECT SUM(size_bytes) FROM attachments a WHERE a.org_id = s.org_id), 0
				)
			`);
			console.log('[Cron] Storage recalculated for all orgs');
		} catch (err) {
			console.error('[Cron] Storage recalculation failed:', err);
		}

		// Purge old ingestion jobs (completed/failed > 30 days)
		try {
			const { ingestionJobs } = await import('./src/lib/server/db/schema');
			const jobRetentionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
			const purged = await db
				.delete(ingestionJobs)
				.where(
					and(
						sql`${ingestionJobs.status} IN ('completed', 'failed')`,
						lt(ingestionJobs.createdAt, jobRetentionCutoff)
					)
				)
				.returning({ id: ingestionJobs.id });
			if (purged.length > 0) {
				console.log(`[Cron] Purged ${purged.length} old ingestion jobs (>30 days)`);
			}
		} catch (err) {
			console.error('[Cron] Ingestion job purge failed:', err);
		}

		// Clean up stuck processing jobs (>5 minutes without progress)
		try {
			const { ingestionJobs, attachments } = await import('./src/lib/server/db/schema');
			const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000);

			const stuckJobs = await db
				.select({
					id: ingestionJobs.id,
					attachmentId: ingestionJobs.attachmentId,
				})
				.from(ingestionJobs)
				.where(
					and(
						eq(ingestionJobs.status, 'running'),
						lt(ingestionJobs.startedAt, stuckCutoff)
					)
				)
				.limit(20);

			for (const job of stuckJobs) {
				await db
					.update(attachments)
					.set({ processingStatus: 'failed', extractionErrorCode: 'processing_timeout' })
					.where(eq(attachments.id, job.attachmentId));
				await db
					.update(ingestionJobs)
					.set({ status: 'failed', error: 'processing_timeout', finishedAt: new Date() })
					.where(eq(ingestionJobs.id, job.id));
			}

			if (stuckJobs.length > 0) {
				console.log(`[Cron] Marked ${stuckJobs.length} stuck processing jobs as failed (processing_timeout)`);
			}
		} catch (err) {
			console.error('[Cron] Stuck job cleanup failed:', err);
		}

		// Dispatch pending attachments with no active (running/pending) ingestion job
		try {
			const ai = env.AI as Ai | undefined;
			const vectorize = env.VECTORIZE as VectorizeIndex | undefined;
			const r2 = env.STORAGE as R2Bucket | undefined;

			const orphaned = await db.execute(sql`
				SELECT a.id, a.org_id
				FROM attachments a
				WHERE a.processing_status = 'pending'
				  AND NOT EXISTS (
					SELECT 1 FROM ingestion_jobs ij
					WHERE ij.attachment_id = a.id AND ij.status IN ('running', 'pending')
				  )
				LIMIT 10
			`);

			if (orphaned.rows.length > 0 && ai && vectorize && r2) {
				const { processDocument } = await import('./src/lib/server/rag/process-document');
				for (const row of orphaned.rows) {
					ctx.waitUntil(
						processDocument(db, ai, vectorize, r2, Number(row.id), String(row.org_id), env)
							.catch((err: unknown) => console.error(`[Cron] Orphan dispatch failed for attachment ${row.id}:`, err))
					);
				}
				console.log(`[Cron] Dispatched ${orphaned.rows.length} orphaned pending attachments`);
			}
		} catch (err) {
			console.error('[Cron] Orphan dispatch failed:', err);
		}

		// Retry failed attachments (max 3 total attempts across all jobs)
		// Only retries attachments still in 'failed' state with no running job
		try {
			const ai = env.AI as Ai | undefined;
			const vectorize = env.VECTORIZE as VectorizeIndex | undefined;
			const r2 = env.STORAGE as R2Bucket | undefined;

			const retryable = await db.execute(sql`
				SELECT a.id AS attachment_id, a.org_id,
					COUNT(ij.id) AS total_attempts,
					MAX(ij.finished_at) AS last_finished
				FROM attachments a
				LEFT JOIN ingestion_jobs ij ON ij.attachment_id = a.id
				WHERE a.processing_status = 'failed'
				  AND NOT EXISTS (
					SELECT 1 FROM ingestion_jobs ij2
					WHERE ij2.attachment_id = a.id AND ij2.status IN ('running', 'pending')
				  )
				GROUP BY a.id, a.org_id
				HAVING COUNT(ij.id) < 3
				LIMIT 5
			`);

			if (retryable.rows.length > 0 && ai && vectorize && r2) {
				const { processDocument } = await import('./src/lib/server/rag/process-document');
				let dispatched = 0;
				for (const row of retryable.rows) {
					const attempts = Number(row.total_attempts);
					const lastFinished = row.last_finished ? new Date(row.last_finished as string) : null;

					// Backoff: attempt 2 waits 1min, attempt 3 waits 5min
					const backoffMs = attempts === 1 ? 60_000 : attempts >= 2 ? 300_000 : 0;
					if (backoffMs > 0 && lastFinished) {
						const elapsed = Date.now() - lastFinished.getTime();
						if (elapsed < backoffMs) continue;
					}

					// Reset attachment to pending (processDocument will set it to processing)
					await db.update(attachments)
						.set({ processingStatus: 'pending', extractionErrorCode: null })
						.where(eq(attachments.id, Number(row.attachment_id)));

					ctx.waitUntil(
						processDocument(db, ai, vectorize, r2, Number(row.attachment_id), String(row.org_id), env)
							.catch((err: unknown) => console.error(`[Cron] Retry failed for attachment ${row.attachment_id}:`, err))
					);
					dispatched++;
				}
				if (dispatched > 0) {
					console.log(`[Cron] Retried ${dispatched} failed attachments`);
				}
			}
		} catch (err) {
			console.error('[Cron] Ingestion job retry failed:', err);
		}

		// Report AI usage to Stripe (daily at midnight UTC only)
		const now = new Date();
		if (now.getUTCHours() === 0 && env.STRIPE_SECRET_KEY && env.STRIPE_AI_METER_ID) {
			try {
				const { reportAiUsageToStripe } = await import('./src/lib/server/ai-billing');
				const reported = await reportAiUsageToStripe(
					db,
					env.STRIPE_SECRET_KEY as string,
					env.STRIPE_AI_METER_ID as string
				);
				if (reported > 0) {
					console.log(`[Cron] Reported AI overage for ${reported} orgs to Stripe`);
				}
			} catch (err) {
				console.error('[Cron] Stripe AI usage reporting failed:', err);
			}
		}

		// TODO: Message retention — requires product decision on retention periods per plan tier.
		// When defined, add a cron job to soft-delete messages older than the retention period
		// and clean up associated R2 objects.

		// Purge IP addresses and user agents older than 90 days from audit tables (ME-19)
		try {
			const { accountAudit, termsAcceptances } = await import('./src/lib/server/db/schema');
			const ipCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
			await db.update(accountAudit)
				.set({ ipAddress: null, userAgent: null })
				.where(lt(accountAudit.createdAt, ipCutoff));
			await db.update(termsAcceptances)
				.set({ ipAddress: null, userAgent: null })
				.where(lt(termsAcceptances.acceptedAt, ipCutoff));
			console.log('[Cron] Purged IP/UA data older than 90 days');
		} catch (err) {
			console.error('[Cron] IP/UA purge failed:', err);
		}

		try { await client.end(); } catch { /* already closed */ }
	}
};

export default withSentry(
	(env: Record<string, unknown>) => ({
		dsn: env.SENTRY_DSN as string,
		tracesSampleRate: 0.1
	}),
	worker
);

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
			env.CACHE as KVNamespace,
			env.ENVIRONMENT as string
		);

		let userId: string;
		let userName: string;

		if (apiKeyHeader) {
			// Agent auth via API key
			let keyData: any;
			try {
				keyData = await auth.api.verifyApiKey({ body: { key: apiKeyHeader } });
			} catch (e) {
				console.error('[WS] verifyApiKey threw:', e);
				return new Response('Invalid API key', { status: 401 });
			}
			if (!keyData?.valid || !keyData.key?.referenceId) {
				return new Response('Invalid API key', { status: 401 });
			}
			userId = keyData.key.referenceId;

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
			userName = session.user.username || session.user.name || `User-${userId.slice(0, 6)}`;
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
		const signingKey = env.HMAC_SIGNING_SECRET as string;
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
