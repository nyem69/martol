/**
 * PostgreSQL Database Connection via Cloudflare Hyperdrive
 *
 * Creates a Drizzle ORM instance connected through Hyperdrive
 * for optimized connection pooling in Cloudflare Workers.
 *
 * New client per request — Hyperdrive manages actual pooling at the proxy level.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

/**
 * Create a Drizzle database instance via Hyperdrive.
 * Uses pg.Client (single connection per request) since Hyperdrive pools at origin.
 *
 * In local dev, wrangler passes the real connection string (with sslmode=require).
 * We strip sslmode from the URL and set ssl.rejectUnauthorized=false to handle
 * Aiven's certificate chain.
 *
 * In production Workers, Hyperdrive handles TLS at the proxy level.
 */
export function createHyperdriveDb(hyperdrive: { connectionString: string }) {
	const isCloudflareWorkers = typeof caches !== 'undefined' && 'default' in caches;

	// Strip sslmode from connection string — we'll set SSL config explicitly
	const connStr = hyperdrive.connectionString.replace(/[?&]sslmode=[^&]*/g, '');

	const client = new pg.Client({
		connectionString: connStr,
		ssl: isCloudflareWorkers ? false : { rejectUnauthorized: false }
	});

	const connectPromise = client.connect();
	const db = drizzle(client, { schema });

	return { db, client, connectPromise };
}

export type HyperdriveDb = ReturnType<typeof createHyperdriveDb>['db'];
