/**
 * WebSocket Upgrade Route — /api/rooms/[roomId]/ws
 *
 * Authenticates the user, verifies org membership,
 * then forwards the WebSocket upgrade to the ChatRoom DO.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { member, user } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';

// Allowed origins for WebSocket upgrade (prevents CSWSH)
const WS_ALLOWED_ORIGINS = new Set([
	'http://localhost:5190',
	'http://127.0.0.1:5190',
	'capacitor://martol.app',
	'https://martol.app',
	'https://martol.plitix.com'
]);

export const GET: RequestHandler = async ({ params, locals, platform, request }) => {
	// 0. Auth: API key (agents) or session (browsers)
	// Agents skip origin check — server-side scripts, not subject to CSWSH
	const apiKeyHeader = request.headers.get('x-api-key');

	if (!apiKeyHeader) {
		const origin = request.headers.get('origin');
		if (!origin || !WS_ALLOWED_ORIGINS.has(origin)) {
			error(403, 'Origin not allowed');
		}
	}

	const db = locals.db;
	if (!db) {
		error(503, 'Database unavailable');
	}

	const { roomId } = params;

	// Validate roomId format (Better Auth uses nanoid-style IDs)
	if (!roomId || roomId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(roomId)) {
		error(400, 'Invalid room ID');
	}

	let userId: string;
	let userName: string;

	if (apiKeyHeader) {
		// Agent auth via API key
		if (!locals.auth) error(503, 'Auth service unavailable');
		let keyData: any;
		try {
			keyData = await locals.auth.api.verifyApiKey({ body: { key: apiKeyHeader } });
		} catch {
			error(401, 'Invalid API key');
		}
		if (!keyData?.valid || !keyData.key?.userId) {
			error(401, 'Invalid API key');
		}
		userId = keyData.key.userId;

		// Get agent display name
		const [agentUser] = await db
			.select({ name: user.name, username: user.username })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1);
		userName = agentUser?.name || agentUser?.username || `Agent-${userId.slice(0, 6)}`;
	} else {
		// Browser auth via session
		if (!locals.user || !locals.session) {
			error(401, 'Authentication required');
		}
		userId = locals.user.id;
		userName = locals.user.name || locals.user.username || `User-${locals.user.id.slice(0, 6)}`;
	}

	// 2. Verify org membership and get role
	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, roomId), eq(member.userId, userId)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}

	// 3. Get DO stub
	if (!platform?.env?.CHAT_ROOM) {
		error(503, 'Real-time service unavailable');
	}

	const doId = platform.env.CHAT_ROOM.idFromName(roomId);
	const stub = platform.env.CHAT_ROOM.get(doId);

	// 4. Forward request to DO with signed identity headers
	const doUrl = new URL(request.url);
	const headers = new Headers(request.headers);
	const role = memberRecord.role;

	// HMAC-sign identity payload to prevent header spoofing
	const signingKey = platform?.env?.HMAC_SIGNING_SECRET || platform?.env?.BETTER_AUTH_SECRET;
	if (!signingKey) {
		error(503, 'Signing key unavailable');
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

	const doRequest = new Request(doUrl.toString(), {
		method: 'GET',
		headers
	});

	return stub.fetch(doRequest);
};
