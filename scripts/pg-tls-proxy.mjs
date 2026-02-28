/**
 * Local PostgreSQL STARTTLS Proxy for wrangler dev + Aiven
 *
 * Miniflare's cloudflare:sockets cannot do STARTTLS to external databases.
 * This proxy accepts plaintext TCP on a local port, performs the PostgreSQL
 * SSLRequest/STARTTLS handshake with Aiven, then bridges plaintext ↔ TLS.
 *
 * Flow:
 *   pg.Client (ssl:false) → Hyperdrive local proxy → this proxy (plaintext)
 *   this proxy → SSLRequest → Aiven → 'S' → TLS upgrade → encrypted tunnel
 *
 * Usage: node scripts/pg-tls-proxy.mjs
 * Reads PG_HOST, PG_PORT from .dev.vars
 */

import { createServer, Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { readFileSync } from 'node:fs';

// Parse .dev.vars
const vars = {};
try {
	const content = readFileSync('.dev.vars', 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq > 0) {
			vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
		}
	}
} catch {
	console.error('Could not read .dev.vars');
	process.exit(1);
}

const PG_HOST = vars.PG_HOST;
const PG_PORT = parseInt(vars.PG_PORT || '5432', 10);
const LOCAL_PORT = parseInt(process.env.PG_PROXY_PORT || '5434', 10);

if (!PG_HOST) {
	console.error('PG_HOST not found in .dev.vars');
	process.exit(1);
}

// PostgreSQL SSLRequest message: length=8, code=80877103
const SSL_REQUEST = Buffer.alloc(8);
SSL_REQUEST.writeInt32BE(8, 0);
SSL_REQUEST.writeInt32BE(80877103, 4);

const server = createServer((client) => {
	// Pause client until we have a TLS tunnel to Aiven
	client.pause();

	const pgSock = new Socket();

	pgSock.connect(PG_PORT, PG_HOST, () => {
		// Step 1: Send SSLRequest to Aiven
		pgSock.write(SSL_REQUEST);
	});

	pgSock.once('data', (response) => {
		if (response[0] !== 0x53) {
			// 'S' = 0x53 = server supports SSL
			console.error('[proxy] Server does not support SSL');
			client.destroy();
			pgSock.destroy();
			return;
		}

		// Step 2: Upgrade to TLS
		const tlsSock = tlsConnect(
			{
				socket: pgSock,
				rejectUnauthorized: false,
				servername: PG_HOST
			},
			() => {
				// Step 3: TLS established — bridge client ↔ TLS tunnel
				client.pipe(tlsSock);
				tlsSock.pipe(client);
				client.resume();
			}
		);

		tlsSock.on('error', (err) => {
			if (err.code !== 'ECONNRESET') {
				console.error('[proxy] TLS error:', err.message);
			}
			client.destroy();
		});
	});

	pgSock.on('error', (err) => {
		if (err.code !== 'ECONNRESET') {
			console.error('[proxy] target error:', err.message);
		}
		client.destroy();
	});

	client.on('error', (err) => {
		if (err.code !== 'ECONNRESET') {
			console.error('[proxy] client error:', err.message);
		}
		pgSock.destroy();
	});

	client.on('close', () => pgSock.destroy());
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
	console.log(
		`[pg-tls-proxy] 127.0.0.1:${LOCAL_PORT} → ${PG_HOST}:${PG_PORT} (STARTTLS)`
	);
});

server.on('error', (err) => {
	if (err.code === 'EADDRINUSE') {
		console.log(`[pg-tls-proxy] Port ${LOCAL_PORT} already in use (proxy likely running)`);
		process.exit(0);
	}
	throw err;
});
