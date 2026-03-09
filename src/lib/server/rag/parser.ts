/**
 * Document text extraction for RAG pipeline.
 *
 * Pluggable provider interface: swap in Kreuzberg or other engines
 * by implementing ExtractionProvider and registering via setProvider().
 *
 * Default providers:
 * - text/plain, text/markdown: direct TextDecoder
 * - application/pdf: pdf-parse (Node) — skipped in Workers if unavailable
 */

// ── Extraction result type ──────────────────────────────────

export interface ExtractionResult {
	text: string;
	tokenEstimate: number;
	parserName: string;
	parserVersion: string;
	/** SHA-256 hex digest of the raw input buffer */
	contentSha256: string;
	/** Number of pages extracted (PDF only, null otherwise) */
	pageCount: number | null;
}

// ── Provider interface ──────────────────────────────────────

export interface ExtractionProvider {
	name: string;
	version: string;
	/** Return supported MIME types */
	supports(contentType: string): boolean;
	/** Extract text from buffer */
	extract(
		buffer: ArrayBuffer,
		contentType: string,
		filename: string
	): Promise<ExtractionResult | null>;
}

// ── SHA-256 helper ──────────────────────────────────────────

async function sha256(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ── Built-in: Plain text / Markdown ─────────────────────────

const textProvider: ExtractionProvider = {
	name: 'builtin-text',
	version: '1.0.0',
	supports(contentType: string) {
		return contentType === 'text/plain' || contentType === 'text/markdown';
	},
	async extract(buffer, contentType, _filename) {
		const text = new TextDecoder().decode(buffer);
		if (!text.trim()) return null;
		return {
			text,
			tokenEstimate: Math.ceil(text.length / 4),
			parserName: this.name,
			parserVersion: this.version,
			contentSha256: await sha256(buffer),
			pageCount: null,
		};
	},
};

// ── Built-in: PDF ───────────────────────────────────────────

const pdfProvider: ExtractionProvider = {
	name: 'builtin-pdf',
	version: '1.0.0',
	supports(contentType: string) {
		return contentType === 'application/pdf';
	},
	async extract(buffer, _contentType, _filename) {
		try {
			// pdf-parse works in Node; may fail in Workers (no fs)
			// @ts-expect-error — pdf-parse has no TS declarations; runtime-only dep
			const { default: pdfParse } = await import('pdf-parse');
			const result = await pdfParse(Buffer.from(buffer));
			const text = result.text?.trim();
			if (!text) return null;
			return {
				text,
				tokenEstimate: Math.ceil(text.length / 4),
				parserName: this.name,
				parserVersion: this.version,
				contentSha256: await sha256(buffer),
				pageCount: result.numpages ?? null,
			};
		} catch (err) {
			console.error('[RAG] PDF parse failed:', err);
			return null;
		}
	},
};

// ── Provider registry ───────────────────────────────────────

const providers: ExtractionProvider[] = [textProvider, pdfProvider];

/**
 * Register a custom extraction provider (e.g. Kreuzberg).
 * Custom providers are checked first (prepended to list).
 */
export function registerProvider(provider: ExtractionProvider): void {
	providers.unshift(provider);
}

// ── Main extraction entry point ─────────────────────────────

export async function extractText(
	buffer: ArrayBuffer,
	contentType: string,
	filename: string
): Promise<ExtractionResult | null> {
	for (const provider of providers) {
		if (provider.supports(contentType)) {
			return provider.extract(buffer, contentType, filename);
		}
	}
	// No provider supports this content type
	return null;
}
