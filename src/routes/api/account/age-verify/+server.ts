/**
 * POST /api/account/age-verify — Record server-side age verification
 *
 * Auth: session-based. Called once after first OTP verification.
 * Body: { year: number, month: number, day: number }
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { user } from '$lib/server/db/auth-schema';
import { eq } from 'drizzle-orm';

const MIN_AGE = 16;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) error(401, 'Authentication required');
	if (!locals.db) error(503, 'Database unavailable');

	// Already verified — skip
	if (locals.user.ageVerifiedAt) return json({ ok: true });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const year = typeof body.year === 'number' ? body.year : 0;
	const month = typeof body.month === 'number' ? body.month : 0;
	const day = typeof body.day === 'number' ? body.day : 0;

	if (!year || !month || !day || year < 1900 || year > new Date().getFullYear()) {
		error(400, 'Invalid date of birth');
	}

	// Server-side age calculation
	const today = new Date();
	const birthDate = new Date(year, month - 1, day);
	let age = today.getFullYear() - birthDate.getFullYear();
	const monthDiff = today.getMonth() - birthDate.getMonth();
	if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
		age--;
	}

	if (age < MIN_AGE) {
		error(403, 'Age requirement not met');
	}

	// Store ageVerifiedAt — DOB is never stored
	await locals.db
		.update(user)
		.set({ ageVerifiedAt: new Date() })
		.where(eq(user.id, locals.user.id));

	return json({ ok: true });
};
