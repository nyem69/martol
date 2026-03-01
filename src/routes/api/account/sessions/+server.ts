/**
 * GET  /api/account/sessions — List active sessions
 * DELETE /api/account/sessions — Revoke a specific session
 *
 * Auth: session-based.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { session as sessionTable } from '$lib/server/db/auth-schema';
import { eq, and, gt } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const sessions = await locals.db
		.select({
			id: sessionTable.id,
			createdAt: sessionTable.createdAt,
			expiresAt: sessionTable.expiresAt,
			ipAddress: sessionTable.ipAddress,
			userAgent: sessionTable.userAgent
		})
		.from(sessionTable)
		.where(
			and(
				eq(sessionTable.userId, locals.user.id),
				gt(sessionTable.expiresAt, new Date())
			)
		)
		.orderBy(sessionTable.createdAt);

	return json({
		ok: true,
		data: sessions.map((s: typeof sessions[number]) => ({
			id: s.id,
			current: s.id === locals.session!.id,
			createdAt: s.createdAt.toISOString(),
			expiresAt: s.expiresAt.toISOString(),
			ipAddress: s.ipAddress ?? null,
			userAgent: s.userAgent ?? null
		}))
	});
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	let body: { sessionId: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
	if (!sessionId) {
		error(400, 'Missing sessionId');
	}

	// Prevent revoking current session via this endpoint
	if (sessionId === locals.session.id) {
		return json(
			{ ok: false, error: 'Use sign-out to end your current session.' },
			{ status: 400 }
		);
	}

	// Only delete sessions belonging to the current user
	const result = await locals.db
		.delete(sessionTable)
		.where(
			and(
				eq(sessionTable.id, sessionId),
				eq(sessionTable.userId, locals.user.id)
			)
		)
		.returning({ id: sessionTable.id });

	if (result.length === 0) {
		return json(
			{ ok: false, error: 'Session not found.' },
			{ status: 404 }
		);
	}

	return json({ ok: true });
};
