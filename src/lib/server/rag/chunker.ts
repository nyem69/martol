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

/**
 * Heading patterns to detect document structure.
 * Tried in order — first pattern finding 2+ matches wins.
 */
const HEADING_PATTERNS: RegExp[] = [
	/(?:^|\n|\s)\[([A-Z][^\]]{4,200})\]/g,           // [Hukum Membina Masjid]
	/(?:^|\n)#{1,3}\s+(.{5,200})$/gm,                // # Markdown headings
	/(?:^|\n)(?:BAHAGIAN|CHAPTER|SECTION)\s+.+$/gim,  // All-caps sections
	/(?:^|\n)\d+\.\s+[A-Z].{5,200}$/gm,              // 1. Numbered sections
	/FATWA\s+(?:BERKENAAN|DI\s+BAWAH)/gi,             // Fatwa-specific
];

/**
 * Try to split text by detected topic headings.
 * Returns empty array if fewer than 2 headings found (caller falls back to word-based).
 */
export function splitByTopics(text: string, maxWords: number = 500, minWords: number = 100): TextChunk[] {
	if (!text.trim()) return [];

	// Try each heading pattern until one finds 2+ matches
	let headingPositions: number[] = [];
	for (const pattern of HEADING_PATTERNS) {
		// Reset regex state (they have /g flag)
		const re = new RegExp(pattern.source, pattern.flags);
		const positions: number[] = [];
		let match: RegExpExecArray | null;
		while ((match = re.exec(text)) !== null) {
			// Use the start of the full match (skip leading \n if present)
			let pos = match.index;
			if (text[pos] === '\n') pos += 1;
			positions.push(pos);
		}
		if (positions.length >= 2) {
			headingPositions = positions;
			break;
		}
	}

	if (headingPositions.length < 2) return [];

	// Split text into sections at heading positions
	const sections: { text: string; charStart: number; charEnd: number }[] = [];

	// Include any text before the first heading as a preamble section
	if (headingPositions[0] > 0) {
		const preamble = text.slice(0, headingPositions[0]).trim();
		if (preamble) {
			sections.push({ text: preamble, charStart: 0, charEnd: headingPositions[0] });
		}
	}

	// Each heading starts a section that runs until the next heading (or end of text)
	for (let i = 0; i < headingPositions.length; i++) {
		const start = headingPositions[i];
		const end = i + 1 < headingPositions.length ? headingPositions[i + 1] : text.length;
		const sectionText = text.slice(start, end).trim();
		if (sectionText) {
			sections.push({ text: sectionText, charStart: start, charEnd: end });
		}
	}

	// Merge small sections (under minWords) with previous
	const merged: typeof sections = [];
	for (const section of sections) {
		const wordCount = section.text.split(/\s+/).length;
		if (merged.length > 0 && wordCount < minWords) {
			// Merge with previous
			const prev = merged[merged.length - 1];
			prev.text = prev.text + '\n\n' + section.text;
			prev.charEnd = section.charEnd;
		} else {
			merged.push({ ...section });
		}
	}

	// Build final chunks, sub-splitting sections that exceed maxWords
	const chunks: TextChunk[] = [];
	for (const section of merged) {
		const wordCount = section.text.split(/\s+/).length;
		if (wordCount <= maxWords) {
			chunks.push({
				index: chunks.length,
				content: section.text,
				tokenEstimate: wordCount,
				charStart: section.charStart,
				charEnd: section.charEnd,
			});
		} else {
			// Sub-split using existing chunkText with overlap
			const subChunks = chunkText(section.text, maxWords, 50);
			for (const sub of subChunks) {
				chunks.push({
					index: chunks.length,
					content: sub.content,
					tokenEstimate: sub.tokenEstimate,
					// Offset sub-chunk positions relative to the section's position in the full text
					charStart: section.charStart + sub.charStart,
					charEnd: section.charStart + sub.charEnd,
				});
			}
		}
	}

	return chunks;
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
