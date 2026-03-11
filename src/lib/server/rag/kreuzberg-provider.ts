/**
 * Document extraction provider for RAG pipeline.
 *
 * Uses unpdf (serverless PDF.js) for PDF extraction — designed for
 * Cloudflare Workers and edge runtimes. Plain text types are decoded
 * directly from the buffer.
 */

import type { ExtractionProvider, ExtractionResult } from './parser';

/** MIME types this provider handles. */
const SUPPORTED_TYPES = new Set([
	// PDF — extracted via unpdf
	'application/pdf',
	// Plain text variants — decoded directly
	'text/plain',
	'text/markdown',
	'text/csv',
	'text/html',
	'application/json',
	'text/yaml',
	'application/x-yaml',
	'application/xml',
	'text/xml',
]);

/** Typed extraction error with structured error code. */
export class ExtractionError extends Error {
	constructor(
		public readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'ExtractionError';
	}
}

/** SHA-256 hex digest of a buffer. */
async function sha256(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Extract text from a PDF using unpdf (serverless PDF.js). */
async function extractPdf(buffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
	const { getDocumentProxy, extractText } = await import('unpdf');
	const pdf = await getDocumentProxy(new Uint8Array(buffer));
	const result = await extractText(pdf, { mergePages: true });
	return { text: result.text as string, pages: result.totalPages };
}

/** Decode plain text from buffer. */
function decodeText(buffer: ArrayBuffer): string {
	return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

export const kreuzbergProvider: ExtractionProvider = {
	name: 'unpdf',
	version: '1.4.0',

	supports(contentType: string): boolean {
		return SUPPORTED_TYPES.has(contentType);
	},

	async extract(
		buffer: ArrayBuffer,
		contentType: string,
		_filename: string
	): Promise<ExtractionResult | null> {
		try {
			let text: string;
			let pageCount: number | null = null;

			if (contentType === 'application/pdf') {
				console.log('[Extract] Using unpdf for PDF extraction');
				const result = await extractPdf(buffer);
				text = result.text;
				pageCount = result.pages;
			} else {
				// Plain text types — decode directly
				text = decodeText(buffer);
			}

			text = text.trim();
			if (!text) return null;

			return {
				text,
				tokenEstimate: Math.ceil(text.length / 4),
				parserName: 'unpdf',
				parserVersion: this.version,
				contentSha256: await sha256(buffer),
				pageCount,
			};
		} catch (err) {
			if (err instanceof ExtractionError) throw err;
			console.error('[Extract] Extraction failed:', err);
			throw new ExtractionError(
				'extraction_failed',
				`Extraction failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	},
};
