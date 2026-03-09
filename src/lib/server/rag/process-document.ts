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
import { extractText } from './parser';
import { chunkText } from './chunker';
import { embedAndIndex, getEmbeddingModel, getEmbeddingDim } from './embedder';
import { isAiCapReached } from '$lib/server/ai-billing';

export async function processDocument(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: any,
	ai: Ai,
	vectorize: VectorizeIndex,
	r2: R2Bucket,
	attachmentId: number,
	orgId: string
): Promise<{ chunksIndexed: number } | null> {
	// 1. Create ingestion job
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

	// 2. Check spending cap
	if (await isAiCapReached(db, orgId)) {
		await db.update(attachments).set({ processingStatus: 'skipped' }).where(eq(attachments.id, attachmentId));
		await finishJob(db, job.id, 'completed', null);
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
		await finishJob(db, job.id, 'failed', 'attachment_not_found');
		return null;
	}

	// 4. Mark as processing
	await db
		.update(attachments)
		.set({ processingStatus: 'processing' })
		.where(eq(attachments.id, attachmentId));

	try {
		// 4. Fetch from R2
		const obj = await r2.get(att.r2Key);
		if (!obj) {
			await markFailed(db, attachmentId, job.id, 'r2_object_missing');
			return null;
		}

		const buffer = await obj.arrayBuffer();

		// 5. Extract text via pluggable provider
		const extracted = await extractText(buffer, att.contentType, att.filename);
		if (!extracted) {
			await db.update(attachments).set({ processingStatus: 'skipped' }).where(eq(attachments.id, attachmentId));
			await finishJob(db, job.id, 'completed', null);
			return null;
		}

		// 6. Update attachment with extraction metadata
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

		// 7. Chunk
		const chunks = chunkText(extracted.text, 500, 50);
		if (chunks.length === 0) {
			await db.update(attachments).set({ processingStatus: 'skipped' }).where(eq(attachments.id, attachmentId));
			await finishJob(db, job.id, 'completed', null);
			return null;
		}

		// 8. Embed and index
		const indexed = await embedAndIndex(ai, vectorize, chunks, {
			orgId,
			attachmentId,
			filename: att.filename,
		});

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
			}))
		);

		// 10. Mark as indexed
		await db
			.update(attachments)
			.set({ processingStatus: 'indexed', indexedAt: new Date() })
			.where(eq(attachments.id, attachmentId));

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
		await finishJob(db, job.id, 'completed', null);

		return { chunksIndexed: indexed.length };
	} catch (err) {
		console.error('[RAG] Document processing failed:', err);
		const errorCode = err instanceof Error ? err.message.slice(0, 200) : 'unknown_error';
		await markFailed(db, attachmentId, job.id, errorCode);
		return null;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markFailed(db: any, attachmentId: number, jobId: number, errorCode: string) {
	await db
		.update(attachments)
		.set({ processingStatus: 'failed', extractionErrorCode: errorCode })
		.where(eq(attachments.id, attachmentId));
	await finishJob(db, jobId, 'failed', errorCode);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finishJob(db: any, jobId: number, status: 'completed' | 'failed', error: string | null) {
	await db
		.update(ingestionJobs)
		.set({ status, error, finishedAt: new Date() })
		.where(eq(ingestionJobs.id, jobId));
}
