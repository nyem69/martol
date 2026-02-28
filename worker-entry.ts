/**
 * Cloudflare Worker entry point.
 *
 * Re-exports the SvelteKit worker (HTTP handler) and all Durable Object
 * classes so wrangler can discover them from a single entrypoint.
 */

import svelteKitWorker from './.svelte-kit/cloudflare/_worker.js';
import { createHyperdriveDb } from './src/lib/server/db/hyperdrive';
import { pendingActions } from './src/lib/server/db/schema';
import { eq, and, lt } from 'drizzle-orm';

// Durable Object classes
export { ChatRoom } from './src/lib/server/chat-room';

// Combined worker: SvelteKit fetch + scheduled handler
export default {
	// HTTP handler — delegate to SvelteKit
	fetch: svelteKitWorker.fetch,

	// Cron Trigger: expire pending actions older than 24h
	async scheduled(event: ScheduledEvent, env: Record<string, unknown>, ctx: ExecutionContext) {
		const hyperdrive = env.HYPERDRIVE as { connectionString: string };
		if (!hyperdrive) {
			console.error('[Cron] HYPERDRIVE binding not available');
			return;
		}

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
		} finally {
			try { await client.end(); } catch { /* already closed */ }
		}
	}
};
