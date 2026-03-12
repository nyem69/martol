/**
 * Kreuzberg WASM spike test — isolated endpoint to verify if
 * Kreuzberg works on Cloudflare Workers via the global init in worker-entry.ts.
 *
 * GET  /api/debug/kreuzberg-spike — init check
 * POST /api/debug/kreuzberg-spike — extract text from PDF body
 *
 * DELETE THIS ENDPOINT after the spike test is complete.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { extractBytes, isInitialized, getVersion } from '@kreuzberg/wasm';

export const GET: RequestHandler = async () => {
	// The WASM init happens in worker-entry.ts via the global kreuzbergReady promise.
	// By the time a request reaches here, it should already be initialized.
	try {
		// Wait for global init (set in worker-entry.ts)
		const kreuzbergReady = (globalThis as Record<string, unknown>).__kreuzbergReady as Promise<void> | undefined;
		if (kreuzbergReady) {
			await kreuzbergReady;
		}

		return json({
			ok: isInitialized(),
			version: isInitialized() ? getVersion() : null,
			message: isInitialized()
				? 'Kreuzberg WASM initialized successfully on Cloudflare Workers'
				: 'Kreuzberg WASM not initialized — check worker-entry.ts logs'
		});
	} catch (err) {
		return json({
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack?.split('\n').slice(0, 8) ?? null : null,
		}, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const contentType = request.headers.get('content-type') || '';

	try {
		// Wait for global init
		const kreuzbergReady = (globalThis as Record<string, unknown>).__kreuzbergReady as Promise<void> | undefined;
		if (kreuzbergReady) {
			await kreuzbergReady;
		}

		if (!isInitialized()) {
			return json({ ok: false, error: 'Kreuzberg WASM not initialized' }, { status: 503 });
		}

		const buffer = await request.arrayBuffer();
		const bytes = new Uint8Array(buffer);

		const start = performance.now();
		const result = await extractBytes(bytes, contentType);
		const extractMs = Math.round(performance.now() - start);

		return json({
			ok: true,
			version: getVersion(),
			timing: { extractMs },
			contentType,
			inputBytes: bytes.length,
			outputChars: result.content?.length ?? 0,
			preview: result.content?.slice(0, 500) ?? '',
			metadata: result.metadata ?? null
		});
	} catch (err) {
		return json({
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			errorName: err instanceof Error ? err.constructor.name : typeof err,
			stack: err instanceof Error ? err.stack?.split('\n').slice(0, 8) : undefined,
			contentType,
		}, { status: 500 });
	}
};
