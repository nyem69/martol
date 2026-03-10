/**
 * Document Search API — Martol
 *
 * GET /api/rooms/[roomId]/documents/search?q=...
 * Semantic search over indexed documents for a room (org).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { member } from '$lib/server/db/auth-schema';
import { eq, and } from 'drizzle-orm';
import { searchDocuments } from '$lib/server/rag/search';

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

	try {
		const results = await searchDocuments(locals.db, ai, vectorize, orgId, query, 10);
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
