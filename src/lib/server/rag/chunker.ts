/**
 * Text chunker for RAG embedding pipeline.
 * Splits text into overlapping chunks at word boundaries.
 * Tracks character offsets for citation support.
 */

export interface TextChunk {
	index: number;
	content: string;
	tokenEstimate: number;
	charStart: number;
	charEnd: number;
}

export function chunkText(
	text: string,
	maxTokens: number = 500,
	overlapTokens: number = 50
): TextChunk[] {
	if (!text.trim()) return [];

	const words = text.split(/\s+/);
	const chunks: TextChunk[] = [];
	let start = 0;

	// Pre-compute cumulative char offsets for each word boundary
	const wordStarts: number[] = [];
	let pos = 0;
	for (const word of words) {
		const idx = text.indexOf(word, pos);
		wordStarts.push(idx);
		pos = idx + word.length;
	}

	while (start < words.length) {
		const end = Math.min(start + maxTokens, words.length);
		const content = words.slice(start, end).join(' ');

		const charStart = wordStarts[start];
		const lastWord = words[end - 1];
		const charEnd = wordStarts[end - 1] + lastWord.length;

		chunks.push({
			index: chunks.length,
			content,
			tokenEstimate: end - start,
			charStart,
			charEnd,
		});

		if (end >= words.length) break;
		start = end - overlapTokens;
	}

	return chunks;
}
