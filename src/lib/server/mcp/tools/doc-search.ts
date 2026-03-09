/**
 * doc_search — Semantic search over org documents via Vectorize.
 */

import type { AgentContext } from '../auth';
import type { McpResponse, DocSearchResult } from '$lib/types/mcp';
import { searchDocuments } from '$lib/server/rag/search';
import { aiUsage } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';

export async function docSearch(
	params: { query: string; top_k: number },
	agent: AgentContext,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	ai: Ai,
	vectorize: VectorizeIndex
): Promise<McpResponse<DocSearchResult>> {
	const results = await searchDocuments(db, ai, vectorize, agent.orgId, params.query, params.top_k);

	// Track usage
	const today = new Date().toISOString().slice(0, 10);
	await db
		.insert(aiUsage)
		.values({ orgId: agent.orgId, operation: 'vector_query', count: 1, periodStart: today })
		.onConflictDoUpdate({
			target: [aiUsage.orgId, aiUsage.operation, aiUsage.periodStart],
			set: { count: sql`${aiUsage.count} + 1` },
		});

	return {
		ok: true,
		data: {
			results: results.map((r) => ({
				content: r.content,
				filename: r.filename,
				chunk_index: r.chunkIndex,
				score: r.score,
				char_start: r.charStart,
				char_end: r.charEnd,
			})),
			total: results.length,
		},
	};
}
