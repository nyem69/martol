/**
 * WebSocket Upgrade Route — /api/rooms/[roomId]/ws
 *
 * Authenticates the user, verifies org membership,
 * then forwards the WebSocket upgrade to the ChatRoom DO.
 */

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { member } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';

// Allowed origins for WebSocket upgrade (prevents CSWSH)
const WS_ALLOWED_ORIGINS = new Set([
	'http://localhost:5190',
	'http://127.0.0.1:5190',
	'https://martol.app'
]);

export const GET: RequestHandler = async ({ params, locals, platform, request }) => {
	// 0. Origin check — prevent cross-site WebSocket hijacking
	const origin = request.headers.get('origin');
	if (origin && !WS_ALLOWED_ORIGINS.has(origin)) {
		error(403, 'Origin not allowed');
	}

	// 1. Auth check
	const user = locals.user;
	const session = locals.session;

	if (!user || !session) {
		error(401, 'Authentication required');
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

	// 2. Verify org membership and get role
	const [memberRecord] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, roomId), eq(member.userId, user.id)))
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

	// 4. Forward request to DO with user info in headers
	const doUrl = new URL(request.url);
	const headers = new Headers(request.headers);
	headers.set('X-User-Id', user.id);
	headers.set('X-User-Role', memberRecord.role);
	headers.set('X-User-Name', user.name || user.email || 'Unknown');
	headers.set('X-Org-Id', roomId);

	const doRequest = new Request(doUrl.toString(), {
		method: 'GET',
		headers
	});

	return stub.fetch(doRequest);
};
