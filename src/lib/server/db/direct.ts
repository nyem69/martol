/**
 * Direct PostgreSQL Connection (Local Development)
 *
 * Uses pg.Pool for local development without Hyperdrive.
 * Connection params from process.env (loaded from .dev.vars via dotenv).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

let pool: pg.Pool | null = null;

/**
 * Create a Drizzle database instance via direct pg.Pool.
 * Pool is cached at module level for local dev (safe — single process).
 */
export function createDirectDb() {
	if (!pool) {
		pool = new pg.Pool({
			host: process.env.PG_HOST,
			port: parseInt(process.env.PG_PORT || '5432', 10),
			user: process.env.PG_USER,
			password: process.env.PG_PASSWORD,
			database: process.env.PG_DATABASE,
			ssl: { rejectUnauthorized: false },
			max: 5
		});
	}

	return drizzle(pool, { schema });
}

export type DirectDb = ReturnType<typeof createDirectDb>;
