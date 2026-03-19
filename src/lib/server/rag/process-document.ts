/**
 * Document processing pipeline: parse → chunk → embed → store.
 * Called asynchronously after upload (not in the request path).
 *
 * Creates an ingestion job for tracking, updates attachment metadata
 * with parser info, and stores chunks with character offsets and
 * embedding metadata for citation and re-indexing support.
 */

import { eq, sql } from 'drizzle-orm';
import { attachments, documentChunks, aiUsage, ingestionJobs } from '$lib/server/db/schema';
import { extractText, registerProvider } from './parser';
import { kreuzbergProvider, ExtractionError } from './kreuzberg-provider';
import { chunkText, splitByTopics } from './chunker';
import { embedAndIndex, getEmbeddingModel, getEmbeddingDim } from './embedder';
import { isAiCapReached } from '$lib/server/ai-billing';
import { extractDocumentMetadata } from './metadata-extractor';

// Register Kreuzberg as the primary provider for PDF, Office, HTML, etc.
// Prepended to the registry so it takes priority over the built-in PDF stub.
registerProvider(kreuzbergProvider);

const EXTRACTION_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new ExtractionError('extraction_timeout', `${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(val) => { clearTimeout(timer); resolve(val); },
			(err) => { clearTimeout(timer); reject(err); }
		);
	});
}

export async function processDocument(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	ai: Ai,
	vectorize: VectorizeIndex,
	r2: R2Bucket,
	attachmentId: number,
	orgId: string,
	env?: Record<string, unknown>
): Promise<{ chunksIndexed: number } | null> {
	// 1. Create ingestion job (non-fatal — pipeline continues even if tracking table fails)
	let jobId: number | null = null;
	try {
		const [job] = await db
			.insert(ingestionJobs)
			.values({
				attachmentId,
				orgId,
				jobType: 'extract',
				status: 'running',
				startedAt: new Date(),
			})
			.returning({ id: ingestionJobs.id });
		jobId = job.id;
		console.log(`[RAG] Processing attachment ${attachmentId} for org ${orgId}, job ${jobId}`);
	} catch (err) {
		console.error(`[RAG] ingestion_jobs insert failed (non-fatal):`, err instanceof Error ? err.message : err);
		console.log(`[RAG] Processing attachment ${attachmentId} for org ${orgId}, no job tracking`);
	}

	// 2. Check spending cap
	if (await isAiCapReached(db, orgId)) {
		await db.update(attachments).set({ processingStatus: 'skipped' }).where(eq(attachments.id, attachmentId));
		await finishJob(db, jobId, 'completed', null);
		console.log(`[RAG] Org ${orgId} AI cap reached, skipping document`);
		return null;
	}

	// 3. Load attachment metadata
	const [att] = await db
		.select({
			r2Key: attachments.r2Key,
			contentType: attachments.contentType,
			filename: attachments.filename,
			sizeBytes: attachments.sizeBytes,
		})
		.from(attachments)
		.where(eq(attachments.id, attachmentId))
		.limit(1);

	if (!att) {
		await finishJob(db, jobId, 'failed', 'attachment_not_found');
		return null;
	}

	// 4. Mark as processing
	await db
		.update(attachments)
		.set({ processingStatus: 'processing' })
		.where(eq(attachments.id, attachmentId));

	try {
		// 4. Fetch from R2
		console.log(`[RAG] Fetching from R2: ${att.r2Key}`);
		const obj = await r2.get(att.r2Key);
		if (!obj) {
			await markFailed(db, attachmentId, jobId, 'r2_object_missing');
			return null;
		}

		const buffer = await obj.arrayBuffer();

		// 5. Extract text via pluggable provider (with timeout)
		console.log(`[RAG] Extracting text from ${att.filename} (${att.contentType}, ${att.sizeBytes} bytes)`);
		let extracted;
		try {
			extracted = await withTimeout(
				extractText(buffer, att.contentType, att.filename),
				EXTRACTION_TIMEOUT_MS,
				'Text extraction'
			);
		} catch (err) {
			if (err instanceof ExtractionError) {
				await markFailed(db, attachmentId, jobId, err.code);
				return null;
			}
			throw err;
		}

		if (!extracted) {
			await markFailed(db, attachmentId, jobId, 'extraction_empty');
			return null;
		}

		// 6. Update attachment with extraction metadata
		console.log(`[RAG] Extracted ${extracted.text.length} chars from ${att.filename}`);
		await db
			.update(attachments)
			.set({
				parserName: extracted.parserName,
				parserVersion: extracted.parserVersion,
				extractedTextBytes: extracted.text.length,
				contentSha256: extracted.contentSha256,
				extractedAt: new Date(),
			})
			.where(eq(attachments.id, attachmentId));

		// 6b. Extract document-level metadata (regex-only, <100ms)
		const metadata = extractDocumentMetadata(extracted.text, att.filename);

		// 7. Chunk — try topic-aware splitting first, fallback to word-based
		let chunks = splitByTopics(extracted.text, 500, 100);
		if (chunks.length > 0) {
			console.log(`[RAG] Topic-aware chunking: ${chunks.length} segments`);
		} else {
			chunks = chunkText(extracted.text, 500, 50);
			console.log(`[RAG] Word-based chunking: ${chunks.length} segments`);
		}
		if (chunks.length === 0) {
			await db.update(attachments).set({ processingStatus: 'skipped' }).where(eq(attachments.id, attachmentId));
			await finishJob(db, jobId, 'completed', null);
			return null;
		}

		// 8. Embed and index
		const indexed = await embedAndIndex(ai, vectorize, chunks, {
			orgId,
			attachmentId,
			filename: att.filename,
		});
		console.log(`[RAG] Indexed ${indexed.length} chunks for attachment ${attachmentId}`);

		// 9. Store chunks in DB with enriched metadata
		const embeddingModel = getEmbeddingModel();
		const embeddingDim = getEmbeddingDim();

		await db.insert(documentChunks).values(
			indexed.map((c) => ({
				attachmentId,
				orgId,
				chunkIndex: c.index,
				content: c.content,
				vectorId: c.vectorId,
				tokenCount: c.tokenEstimate,
				charStart: c.charStart,
				charEnd: c.charEnd,
				chunkHash: null, // TODO: add per-chunk hashing for dedup
				embeddingModel,
				embeddingDim,
				documentDate: metadata.documentDate,
				documentTitle: metadata.documentTitle,
				language: metadata.language,
			}))
		);

		// 10. Mark as indexed
		await db
			.update(attachments)
			.set({ processingStatus: 'indexed', indexedAt: new Date() })
			.where(eq(attachments.id, attachmentId));

		// 10b. Notify room that document is indexed
		if (env) {
			try {
				await notifyRoom(env, orgId, {
					attachmentId,
					filename: att.filename,
					chunks: indexed.length,
					words: Math.round(extracted.text.length / 5),
					pages: extracted.pageCount ?? null
				});
			} catch (err) {
				// Non-fatal — document is indexed, notification is best-effort
				console.error('[RAG] Room notification failed:', err);
			}
		}

		// 11. Track AI usage
		const today = new Date().toISOString().slice(0, 10);
		await db
			.insert(aiUsage)
			.values({ orgId, operation: 'doc_process', count: 1, periodStart: today })
			.onConflictDoUpdate({
				target: [aiUsage.orgId, aiUsage.operation, aiUsage.periodStart],
				set: { count: sql`${aiUsage.count} + 1` },
			});

		// 12. Finish job
		await finishJob(db, jobId, 'completed', null);

		return { chunksIndexed: indexed.length };
	} catch (err) {
		console.error('[RAG] Document processing failed:', err);
		const errorCode = resolveErrorCode(err);
		await markFailed(db, attachmentId, jobId, errorCode);
		return null;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markFailed(db: any, attachmentId: number, jobId: number | null, errorCode: string) {
	await db
		.update(attachments)
		.set({ processingStatus: 'failed', extractionErrorCode: errorCode })
		.where(eq(attachments.id, attachmentId));
	await finishJob(db, jobId, 'failed', errorCode);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finishJob(db: any, jobId: number | null, status: 'completed' | 'failed', error: string | null) {
	if (!jobId) return; // No job tracking — skip
	try {
		await db
			.update(ingestionJobs)
			.set({ status, error, finishedAt: new Date() })
			.where(eq(ingestionJobs.id, jobId));
	} catch (err) {
		console.error(`[RAG] finishJob failed (non-fatal):`, err instanceof Error ? err.message : err);
	}
}

function resolveErrorCode(err: unknown): string {
	if (err instanceof ExtractionError) return err.code;
	if (err instanceof Error) {
		const msg = err.message.toLowerCase();
		if (msg.includes('wasm')) return 'wasm_init_failed';
		if (msg.includes('embedding') || msg.includes('ai gateway')) return 'embedding_failed';
		if (msg.includes('vectorize') || msg.includes('upsert')) return 'vectorize_upsert_failed';
		if (msg.includes('r2') || msg.includes('object not found')) return 'r2_object_missing';
		if (msg.includes('spending cap') || msg.includes('rate limit')) return 'ai_cap_reached';
		return err.message.slice(0, 200);
	}
	return 'unknown_error';
}

/**
 * Clean up existing chunks and vectors for a document before re-processing.
 * Call this before resetting processingStatus to 'pending'.
 */
export async function reprocessDocument(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	vectorize: VectorizeIndex,
	attachmentId: number
): Promise<void> {
	// 1. Get existing vectorIds
	const existingChunks = await db
		.select({ vectorId: documentChunks.vectorId })
		.from(documentChunks)
		.where(eq(documentChunks.attachmentId, attachmentId));

	// 2. Delete from Vectorize
	if (existingChunks.length > 0) {
		const vectorIds = existingChunks.map((c: { vectorId: string }) => c.vectorId);
		try {
			await vectorize.deleteByIds(vectorIds);
		} catch (err) {
			console.error(`[RAG] Vectorize delete failed for attachment ${attachmentId}:`, err);
		}
	}

	// 3. Delete chunks from DB (cascade would handle this, but be explicit)
	await db.delete(documentChunks).where(eq(documentChunks.attachmentId, attachmentId));

	// 4. Reset attachment status
	await db.update(attachments)
		.set({ processingStatus: 'pending', extractionErrorCode: null })
		.where(eq(attachments.id, attachmentId));
}

async function notifyRoom(
	env: Record<string, unknown>,
	roomId: string,
	payload: { attachmentId: number; filename: string; chunks: number; words: number; pages: number | null }
): Promise<void> {
	const chatRoomNs = env.CHAT_ROOM as DurableObjectNamespace | undefined;
	const secret = env.HMAC_SIGNING_SECRET as string | undefined;
	if (!chatRoomNs || !secret) return;

	const doId = chatRoomNs.idFromName(roomId);
	const stub = chatRoomNs.get(doId);

	const res = await stub.fetch(new Request('https://internal/notify-document', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': secret
		},
		body: JSON.stringify(payload)
	}));

	if (!res.ok) {
		console.error(`[RAG] DO notify-document failed: ${res.status} ${await res.text()}`);
	}
}
