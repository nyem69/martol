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
 *
 * Production: Hyperdrive rewrites the connection string to a local proxy and
 * handles TLS at the proxy level → connect with ssl: false.
 *
 * Wrangler dev: Same approach — connect to Hyperdrive local proxy with ssl: false.
 * A local TLS proxy (scripts/pg-tls-proxy.mjs) bridges plaintext TCP to Aiven
 * with TLS, since miniflare's cloudflare:sockets cannot do STARTTLS.
 *
 * @param hyperdrive - The Hyperdrive binding (provides connectionString)
 */
export function createHyperdriveDb(hyperdrive: { connectionString: string }) {
	const connStr = hyperdrive.connectionString.replace(/[?&]sslmode=[^&]*/g, '');

	const client = new pg.Client({
		connectionString: connStr,
		ssl: false
	});

	const connectPromise = client.connect();
	const db = drizzle(client, { schema });

	return { db, client, connectPromise };
}

export type HyperdriveDb = ReturnType<typeof createHyperdriveDb>['db'];
