import dotenv from 'dotenv';
dotenv.config({ path: '.dev.vars' });
import { defineConfig } from 'drizzle-kit';

// Load from .dev.vars via dotenv
const connectionString =
	process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ||
	`postgres://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_DATABASE}?sslmode=require`;

export default defineConfig({
	dialect: 'postgresql',
	schema: ['./src/lib/server/db/schema.ts', './src/lib/server/db/auth-schema.ts'],
	out: './drizzle',
	dbCredentials: {
		url: connectionString,
		// TODO: For secure migrations, download Aiven CA cert and use:
		// ssl: { ca: readFileSync('aiven-ca.pem') }
		// Currently using rejectUnauthorized: false for development convenience.
		ssl: { rejectUnauthorized: false }
	}
});
