/**
 * PATCH /api/rooms/[roomId]/ai-opt-out — Toggle AI opt-out for the current user
 *
 * Auth: session-based. Any room member can toggle their own opt-out status.
 * Body: { optOut: boolean }
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { member } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const db = locals.db;
	const orgId = params.roomId;

	// Parse body
	let body: { optOut: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	if (typeof body.optOut !== 'boolean') {
		return json(
			{ ok: false, error: 'optOut must be a boolean' },
			{ status: 400 }
		);
	}

	// Verify user is a member of this room
	const [memberRecord] = await db
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) {
		error(403, 'Not a member of this room');
	}

	// Update opt-out status
	await db
		.update(member)
		.set({ aiOptOut: body.optOut })
		.where(eq(member.id, memberRecord.id));

	return json({ ok: true, aiOptOut: body.optOut });
};
