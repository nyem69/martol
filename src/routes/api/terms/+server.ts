/**
 * POST /api/terms — Record terms acceptance server-side
 *
 * Records user's acceptance of ToS and/or Privacy Policy with IP and user agent.
 * Called after successful OTP verification during login flow.
 */

import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { termsAcceptances, termsVersions } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	if (!locals.user || !locals.session) {
		error(401, 'Authentication required');
	}
	if (!locals.db) {
		error(503, 'Database unavailable');
	}

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const acceptedTypes = body.types as string[] | undefined;

	if (!Array.isArray(acceptedTypes) || acceptedTypes.length === 0) {
		error(400, 'Missing accepted types');
	}

	const validTypes = ['tos', 'privacy', 'aup'];
	for (const t of acceptedTypes) {
		if (!validTypes.includes(t)) {
			error(400, `Invalid type: ${t}`);
		}
	}

	const ipAddress = getClientAddress();
	const userAgent = request.headers.get('user-agent') || '';

	// Get current versions for each type
	for (const type of acceptedTypes) {
		const [currentVersion] = await locals.db
			.select({ id: termsVersions.id })
			.from(termsVersions)
			.where(eq(termsVersions.type, type as 'tos' | 'privacy' | 'aup'))
			.orderBy(desc(termsVersions.effectiveAt))
			.limit(1);

		if (!currentVersion) {
			// No version exists yet — create a placeholder v1.0.0
			const [inserted] = await locals.db
				.insert(termsVersions)
				.values({
					version: `${type}-1.0.0`,
					type: type as 'tos' | 'privacy' | 'aup',
					summary: 'Initial version',
					url:
						type === 'tos'
							? '/legal/terms'
							: type === 'aup'
								? '/legal/aup'
								: '/legal/privacy',
					effectiveAt: new Date()
				})
				.returning({ id: termsVersions.id });

			await locals.db.insert(termsAcceptances).values({
				userId: locals.user.id,
				termsVersionId: inserted.id,
				ipAddress,
				userAgent
			});
		} else {
			// Check if already accepted this version
			const [existing] = await locals.db
				.select({ id: termsAcceptances.id })
				.from(termsAcceptances)
				.where(
					and(
						eq(termsAcceptances.userId, locals.user.id),
						eq(termsAcceptances.termsVersionId, currentVersion.id)
					)
				)
				.limit(1);

			if (!existing) {
				await locals.db.insert(termsAcceptances).values({
					userId: locals.user.id,
					termsVersionId: currentVersion.id,
					ipAddress,
					userAgent
				});
			}
		}
	}

	return json({ ok: true });
};
