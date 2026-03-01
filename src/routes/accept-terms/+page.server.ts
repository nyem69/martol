/**
 * Accept Terms Page — Server Load
 *
 * Loads current terms versions and the user's existing acceptances.
 * Returns which types need re-acceptance along with their summaries.
 */

import { redirect, error } from '@sveltejs/kit';
import { termsVersions, termsAcceptances } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.session) redirect(302, '/login');

	const db = locals.db;
	if (!db) error(503, 'Database unavailable');

	const requiredTypes = ['tos', 'privacy', 'aup'] as const;
	const pendingTerms: {
		type: string;
		version: string;
		summary: string;
		url: string;
		versionId: number;
	}[] = [];

	for (const type of requiredTypes) {
		const [latest] = await db
			.select({
				id: termsVersions.id,
				version: termsVersions.version,
				type: termsVersions.type,
				summary: termsVersions.summary,
				url: termsVersions.url
			})
			.from(termsVersions)
			.where(eq(termsVersions.type, type))
			.orderBy(desc(termsVersions.effectiveAt))
			.limit(1);

		if (!latest) continue;

		// Check if user already accepted this version
		const [acceptance] = await db
			.select({ id: termsAcceptances.id })
			.from(termsAcceptances)
			.where(
				and(
					eq(termsAcceptances.userId, locals.user.id),
					eq(termsAcceptances.termsVersionId, latest.id)
				)
			)
			.limit(1);

		if (!acceptance) {
			pendingTerms.push({
				type: latest.type,
				version: latest.version,
				summary: latest.summary,
				url: latest.url,
				versionId: latest.id
			});
		}
	}

	// If nothing pending, user is up to date — send them to chat
	if (pendingTerms.length === 0) {
		redirect(302, '/chat');
	}

	return { pendingTerms };
};
