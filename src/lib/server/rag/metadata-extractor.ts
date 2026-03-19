/**
 * Metadata Extractor — lightweight regex-based extraction
 *
 * Extracts dates, titles, and language hints from document text.
 * No LLM calls — must be fast (<100ms per document).
 */

export interface DocumentMetadata {
	documentDate: string | null;
	documentTitle: string | null;
	language: 'en' | 'ms' | 'mixed' | null;
}

/**
 * Extract metadata from full document text (before chunking).
 * Called once per document, results applied to all chunks.
 */
export function extractDocumentMetadata(text: string, filename: string): DocumentMetadata {
	return {
		documentDate: extractDate(text),
		documentTitle: extractTitle(text, filename),
		language: detectLanguage(text),
	};
}

const DATE_PATTERNS = [
	// ISO
	/\b(\d{4}-\d{2}-\d{2})\b/,
	// DD Month YYYY (English)
	/\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/i,
	// DD Month YYYY (Malay)
	/\b(\d{1,2}\s+(?:Januari|Februari|Mac|April|Mei|Jun|Julai|Ogos|September|Oktober|November|Disember)\s+\d{4})\b/i,
	// MM/DD/YYYY or DD/MM/YYYY
	/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
];

function extractDate(text: string): string | null {
	const sample = text.slice(0, 2000);
	for (const pattern of DATE_PATTERNS) {
		const match = sample.match(pattern);
		if (match) return match[1];
	}
	return null;
}

function extractTitle(text: string, filename: string): string {
	const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
	for (const line of lines.slice(0, 10)) {
		if (line.length > 10 && line.length < 200 && !line.match(/^page\s+\d|^\d+$/i)) {
			return line;
		}
	}
	return filename.replace(/\.[^.]+$/, '');
}

const MALAY_MARKERS = [
	'dan', 'yang', 'untuk', 'dalam', 'dengan', 'ini', 'itu', 'adalah',
	'pada', 'dari', 'oleh', 'kepada', 'bahawa', 'telah', 'akan',
	'hukum', 'fatwa', 'berkenaan',
];

export function detectLanguage(text: string): 'en' | 'ms' | 'mixed' | null {
	const sample = text.slice(0, 1000).toLowerCase();
	const words = sample.split(/\s+/);
	if (words.length < 10) return null;

	const malayCount = words.filter((w) => MALAY_MARKERS.includes(w)).length;
	const malayRatio = malayCount / words.length;

	if (malayRatio > 0.08) return 'ms'; // >8% Malay markers
	if (malayRatio > 0.02) return 'mixed';
	return 'en';
}
