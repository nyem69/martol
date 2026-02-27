/**
 * Database Connection Factory
 *
 * Returns a Drizzle ORM instance connected to PostgreSQL.
 * Uses Hyperdrive in production (Cloudflare Workers) or direct connection in local dev.
 */

import type { CloudflareEnv } from '../../../app.d.ts';

/**
 * Get a database connection from the platform environment.
 * In Cloudflare Workers, uses Hyperdrive. In local dev, uses direct pg connection.
 */
export async function getDb(platform?: App.Platform) {
	if (platform?.env?.HYPERDRIVE) {
		const { createHyperdriveDb } = await import('./hyperdrive');
		return createHyperdriveDb(platform.env.HYPERDRIVE);
	}

	const { createDirectDb } = await import('./direct');
	return createDirectDb();
}
