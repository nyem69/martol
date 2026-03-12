/**
 * Document extraction provider for RAG pipeline.
 *
 * - PDF: extracted via unpdf (serverless PDF.js)
 * - DOCX/XLSX/PPTX: extracted via Kreuzberg WASM (initialized in worker-entry.ts)
 * - Text types: decoded directly from buffer
 */

import type { ExtractionProvider, ExtractionResult } from './parser';

/** MIME types this provider handles. */
const SUPPORTED_TYPES = new Set([
	// PDF — extracted via unpdf
	'application/pdf',
	// Office — extracted via Kreuzberg WASM
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
	'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
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

/** MIME types handled by Kreuzberg WASM (Office formats). */
const KREUZBERG_TYPES = new Set([
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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

/**
 * Extract text from Office documents via Kreuzberg WASM.
 * The Kreuzberg bg module is initialized in worker-entry.ts and
 * exposed on globalThis.__kreuzbergBg.
 */
async function extractOffice(
	buffer: ArrayBuffer,
	contentType: string
): Promise<{ text: string; pages: number | null }> {
	// Wait for Kreuzberg WASM init (set in worker-entry.ts)
	const ready = (globalThis as Record<string, unknown>).__kreuzbergReady as Promise<void> | undefined;
	if (ready) await ready;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const bg = (globalThis as Record<string, unknown>).__kreuzbergBg as any;
	if (!bg || typeof bg.extractBytes !== 'function') {
		throw new ExtractionError(
			'kreuzberg_not_available',
			'Kreuzberg WASM not initialized — Office extraction unavailable'
		);
	}

	const bytes = new Uint8Array(buffer);
	const result = await bg.extractBytes(bytes, contentType, undefined);

	const text = result?.content ?? '';
	const pages = result?.pages ?? null;

	return { text, pages };
}

/** Decode plain text from buffer. */
function decodeText(buffer: ArrayBuffer): string {
	return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

export const kreuzbergProvider: ExtractionProvider = {
	name: 'kreuzberg',
	version: '4.4.4',

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
			let parserName = 'kreuzberg';

			if (contentType === 'application/pdf') {
				console.log('[Extract] Using unpdf for PDF extraction');
				const result = await extractPdf(buffer);
				text = result.text;
				pageCount = result.pages;
				parserName = 'unpdf';
			} else if (KREUZBERG_TYPES.has(contentType)) {
				console.log(`[Extract] Using Kreuzberg WASM for ${contentType}`);
				const result = await extractOffice(buffer, contentType);
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
				parserName,
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
