/**
 * Embedding generation and Vectorize indexing.
 * Uses Workers AI BGE-base-en model (768 dimensions).
 */

import type { TextChunk } from './chunker';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIM = 768;

export interface IndexedChunk extends TextChunk {
	vectorId: string;
}

/**
 * Generate embeddings for text chunks and insert into Vectorize.
 */
export async function embedAndIndex(
	ai: Ai,
	vectorize: VectorizeIndex,
	chunks: TextChunk[],
	metadata: { orgId: string; attachmentId: number; filename: string }
): Promise<IndexedChunk[]> {
	if (chunks.length === 0) return [];

	// Generate embeddings in batch
	const result = await ai.run(EMBEDDING_MODEL, {
		text: chunks.map((c) => c.content),
	});
	const embeddings = (result as { data: number[][] }).data;

	// Build vectors with metadata for filtering
	const vectors: VectorizeVector[] = chunks.map((chunk, i) => {
		const vectorId = `${metadata.attachmentId}-${chunk.index}`;
		return {
			id: vectorId,
			values: embeddings[i],
			metadata: {
				orgId: metadata.orgId,
				attachmentId: metadata.attachmentId,
				filename: metadata.filename,
				chunkIndex: chunk.index,
			},
		};
	});

	// Upsert into Vectorize
	await vectorize.upsert(vectors);

	return chunks.map((chunk) => ({
		...chunk,
		vectorId: `${metadata.attachmentId}-${chunk.index}`,
	}));
}

/**
 * Generate embedding for a single query string.
 */
export async function embedQuery(
	ai: Ai,
	query: string
): Promise<number[]> {
	const result = await ai.run(EMBEDDING_MODEL, { text: [query] });
	return (result as { data: number[][] }).data[0];
}

export function getEmbeddingModel(): string {
	return EMBEDDING_MODEL;
}

export function getEmbeddingDim(): number {
	return EMBEDDING_DIM;
}
