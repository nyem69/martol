/**
 * Document Search API — Martol
 *
 * GET /api/rooms/[roomId]/documents/search?q=...
 * Semantic search over indexed documents for a room (org).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { member } from '$lib/server/db/auth-schema';
import { aiUsage } from '$lib/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { searchDocuments } from '$lib/server/rag/search';
import { isAiCapReached } from '$lib/server/ai-billing';

export const GET: RequestHandler = async ({ url, params, locals, platform }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized');
	if (!locals.db) error(503, 'Database unavailable');

	const orgId = params.roomId;
	if (!orgId) error(400, 'Missing room ID');

	const query = url.searchParams.get('q')?.trim();
	if (!query) error(400, 'Missing search query');

	// Verify membership
	const [memberRecord] = await locals.db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, orgId), eq(member.userId, locals.user.id)))
		.limit(1);

	if (!memberRecord) error(403, 'Not a member of this room');

	const ai = platform?.env?.AI;
	const vectorize = platform?.env?.VECTORIZE;
	if (!ai || !vectorize) {
		return json({ ok: true, data: [] });
	}

	// Check AI usage cap
	if (await isAiCapReached(locals.db, orgId)) {
		return json({ ok: false, error: 'Monthly AI processing cap reached.' }, { status: 429 });
	}

	try {
		const results = await searchDocuments(locals.db, ai, vectorize, orgId, query, 10);

		// Track usage (same counter as agent doc_search)
		const today = new Date().toISOString().slice(0, 10);
		await locals.db
			.insert(aiUsage)
			.values({ orgId, operation: 'vector_query', count: 1, periodStart: today })
			.onConflictDoUpdate({
				target: [aiUsage.orgId, aiUsage.operation, aiUsage.periodStart],
				set: { count: sql`${aiUsage.count} + 1` },
			});

		return json({
			ok: true,
			data: results.map((r) => ({
				content: r.content,
				filename: r.filename,
				score: r.score,
				chunk_index: r.chunkIndex,
				char_start: r.charStart,
				char_end: r.charEnd,
			})),
		});
	} catch (err) {
		console.error('[DocSearch] Search failed:', err);
		return json({ ok: true, data: [] });
	}
};
