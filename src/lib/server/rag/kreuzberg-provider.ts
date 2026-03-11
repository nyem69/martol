/**
 * Kreuzberg extraction provider for RAG pipeline.
 *
 * Uses @kreuzberg/wasm to extract text from PDF, Office docs, HTML,
 * email, archives, and other formats. Loaded lazily to avoid WASM
 * overhead in the main request path.
 */

import type { ExtractionProvider, ExtractionResult } from './parser';

/** MIME types Kreuzberg handles (beyond what builtin-text covers). */
const KREUZBERG_TYPES = new Set([
	// Documents
	'application/pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
	'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
	'application/vnd.oasis.opendocument.text', // .odt
	// Spreadsheets
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
	'text/csv',
	// Web / data
	'text/html',
	'application/xml',
	'text/xml',
	'application/json',
	'text/yaml',
	'application/x-yaml',
	// Email
	'message/rfc822', // .eml
	'application/vnd.ms-outlook', // .msg
	// Archives
	'application/zip',
	'application/x-tar',
	'application/x-7z-compressed',
	'application/gzip',
	// Academic
	'application/x-tex',
	'application/x-bibtex',
	'application/x-ipynb+json',
	// Images (OCR — only when explicitly requested)
	'image/png',
	'image/jpeg',
	'image/tiff',
	'image/webp',
	'image/gif',
]);

let wasmInitialized = false;

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

async function ensureWasm(): Promise<typeof import('@kreuzberg/wasm')> {
	try {
		const kreuzberg = await import('@kreuzberg/wasm');
		if (!wasmInitialized) {
			console.log('[Kreuzberg] Initializing WASM...');
			await kreuzberg.initWasm();
			wasmInitialized = true;
			console.log('[Kreuzberg] WASM initialized successfully');
		}
		return kreuzberg;
	} catch (err) {
		wasmInitialized = false;
		console.error('[Kreuzberg] WASM init failed:', err);
		throw new ExtractionError('wasm_init_failed', `WASM initialization failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/** SHA-256 hex digest of a buffer. */
async function sha256(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export const kreuzbergProvider: ExtractionProvider = {
	name: 'kreuzberg-wasm',
	version: '4.4.4',

	supports(contentType: string): boolean {
		return KREUZBERG_TYPES.has(contentType);
	},

	async extract(
		buffer: ArrayBuffer,
		contentType: string,
		_filename: string
	): Promise<ExtractionResult | null> {
		const kreuzberg = await ensureWasm();

		try {
			const bytes = new Uint8Array(buffer);
			const result = await kreuzberg.extractBytes(bytes, contentType);

			const text = result.content?.trim();
			if (!text) return null;

			return {
				text,
				tokenEstimate: Math.ceil(text.length / 4),
				parserName: 'kreuzberg-wasm',
				parserVersion: this.version,
				contentSha256: await sha256(buffer),
				pageCount: result.metadata?.pageCount ?? null,
			};
		} catch (err) {
			if (err instanceof ExtractionError) throw err;
			console.error('[Kreuzberg] Extraction failed:', err);
			throw new ExtractionError('extraction_failed', `Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	},
};
