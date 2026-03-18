/**
 * Semantic search over indexed documents for an org.
 * Queries Vectorize with org filter, fetches chunk content from DB,
 * then reranks using cross-encoder for better relevance.
 */

import { embedQuery } from './embedder';
import { documentChunks } from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

const RERANKER_MODEL = '@cf/baai/bge-reranker-base';
const OVERSAMPLE_FACTOR = 2; // Retrieve 2x topK from Vectorize, rerank down to topK

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

	// 2. Oversample from Vectorize (retrieve 2x, rerank to topK)
	const oversampleK = topK * OVERSAMPLE_FACTOR;
	const results = await vectorize.query(queryVector, {
		topK: oversampleK,
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

	let merged = results.matches
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

	// 5. Rerank with cross-encoder (if we have more candidates than needed)
	if (merged.length > topK) {
		merged = await rerankResults(ai, query, merged, topK);
	}

	return merged;
}

/**
 * Rerank search results using Workers AI cross-encoder model.
 * Takes query + candidate results, returns top-N sorted by reranker score.
 */
async function rerankResults(
	ai: Ai,
	query: string,
	candidates: SearchResult[],
	topN: number
): Promise<SearchResult[]> {
	try {
		// Truncate chunk content for reranker input (max ~512 tokens per pair)
		const contexts = candidates.map((c) => ({
			text: c.content.slice(0, 1500),
		}));

		const response = await ai.run(RERANKER_MODEL, {
			query,
			contexts,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);

		// Response is an array of { score: number } in the same order as contexts
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const scores = response as any as Array<{ score: number }>;

		if (Array.isArray(scores) && scores.length === candidates.length) {
			// Attach reranker scores and sort descending
			const scored = candidates.map((c, i) => ({
				...c,
				score: scores[i].score, // Replace vector score with reranker score
			}));
			scored.sort((a, b) => b.score - a.score);
			return scored.slice(0, topN);
		}

		// Fallback: reranker response unexpected, return original order
		console.warn('[Search] Reranker response unexpected, using vector scores');
		return candidates.slice(0, topN);
	} catch (err) {
		// Reranker failed — gracefully degrade to vector-only scores
		console.error('[Search] Reranker failed, using vector scores:', err);
		return candidates.slice(0, topN);
	}
}
