/**
 * Room Name API — Martol
 *
 * PATCH /api/rooms/[roomId]/name — Rename room (owner/admin only)
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { organization, member } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';

const MAX_NAME_LENGTH = 100;

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;

	// Verify owner/admin
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);
	if (!memberRecord) error(403, 'Not a member of this room');
	if (memberRecord.role !== 'owner' && memberRecord.role !== 'admin') {
		error(403, 'Only owners and admins can rename rooms');
	}

	let body: { name: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	if (typeof body.name !== 'string') error(400, 'name must be a string');

	const newName = body.name.trim();
	if (newName.length === 0) error(400, 'name cannot be empty');
	if (newName.length > MAX_NAME_LENGTH) error(400, `name exceeds ${MAX_NAME_LENGTH} characters`);

	await locals.db
		.update(organization)
		.set({ name: newName })
		.where(eq(organization.id, orgId));

	// Broadcast config change to connected WebSocket clients
	if (platform?.env?.CHAT_ROOM && platform?.env?.HMAC_SIGNING_SECRET) {
		try {
			const doId = platform.env.CHAT_ROOM.idFromName(orgId);
			const stub = platform.env.CHAT_ROOM.get(doId);
			await stub.fetch(new Request('https://do/notify-config', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': platform.env.HMAC_SIGNING_SECRET
				},
				body: JSON.stringify({ field: 'name', value: newName, changedBy: locals.user!.id })
			}));
		} catch {
			// Non-critical — client will see update on next page load
		}
	}

	return json({ ok: true, name: newName });
};
