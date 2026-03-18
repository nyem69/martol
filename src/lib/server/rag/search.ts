/**
 * Semantic search over indexed documents for an org.
 * Queries Vectorize with org filter, fetches chunk content from DB.
 */

import { embedQuery } from './embedder';
import { documentChunks } from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

export interface SearchResult {
	content: string;
	filename: string;
	chunkIndex: number;
	score: number;
	attachmentId: number;
	charStart: number | null;
	charEnd: number | null;
}

export async function searchDocuments(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	ai: Ai,
	vectorize: VectorizeIndex,
	orgId: string,
	query: string,
	topK: number = 10
): Promise<SearchResult[]> {
	// 1. Embed the query
	const queryVector = await embedQuery(ai, query);

	// 2. Search Vectorize with org filter
	const results = await vectorize.query(queryVector, {
		topK,
		filter: { orgId },
		returnMetadata: 'all',
	});

	if (!results.matches || results.matches.length === 0) return [];

	// 3. Fetch chunk content from DB (Vectorize metadata doesn't store full text)
	const vectorIds = results.matches.map((m) => m.id);
	const chunks = await db
		.select({
			vectorId: documentChunks.vectorId,
			content: documentChunks.content,
			chunkIndex: documentChunks.chunkIndex,
			attachmentId: documentChunks.attachmentId,
			charStart: documentChunks.charStart,
			charEnd: documentChunks.charEnd,
		})
		.from(documentChunks)
		.where(and(eq(documentChunks.orgId, orgId), inArray(documentChunks.vectorId, vectorIds)));

	// 4. Merge scores with chunk content
	interface ChunkRow {
		vectorId: string;
		content: string;
		chunkIndex: number;
		attachmentId: number;
		charStart: number | null;
		charEnd: number | null;
	}
	const chunkMap = new Map<string, ChunkRow>(
		chunks.map((c: ChunkRow) => [c.vectorId, c] as const)
	);

	return results.matches
		.filter((m) => chunkMap.has(m.id))
		.map((m) => {
			const chunk = chunkMap.get(m.id)!;
			return {
				content: chunk.content,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				filename: (m.metadata as any)?.filename ?? 'unknown',
				chunkIndex: chunk.chunkIndex,
				score: m.score,
				attachmentId: chunk.attachmentId,
				charStart: chunk.charStart,
				charEnd: chunk.charEnd,
			};
		});
}
