/**
 * PATCH /api/admin/users/[id]/role — Toggle user admin role
 *
 * Auth: admin only.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { user } from '$lib/server/db/auth-schema';
import { eq } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');
	if (!locals.isAdmin) error(403, 'Admin access required');

	// Cannot change own role
	if (params.id === locals.user.id) {
		error(400, 'Cannot change your own role');
	}

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const role = typeof body.role === 'string' ? body.role : '';

	if (role !== 'user' && role !== 'admin') {
		error(400, 'Role must be "user" or "admin"');
	}

	const [updated] = await locals.db
		.update(user)
		.set({ role, updatedAt: new Date() })
		.where(eq(user.id, params.id))
		.returning({ id: user.id, role: user.role, name: user.name });

	if (!updated) error(404, 'User not found');

	return json({ ok: true, data: updated });
};
