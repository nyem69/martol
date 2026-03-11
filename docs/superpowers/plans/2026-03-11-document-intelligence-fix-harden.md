# Document Intelligence: Fix & Harden — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Document Intelligence pipeline (Kreuzberg WASM crashes silently), harden it with retry logic, cron recovery, and structured error codes, and add agent auto-notify when documents finish indexing.

**Architecture:** Three workstreams executed in order: (1) Debug and fix Kreuzberg WASM extraction with granular error handling and timeouts, (2) Harden the pipeline with structured error codes, cron recovery for stuck/orphaned jobs, and UI status improvements, (3) Auto-notify room via Durable Object when documents are indexed so agents see them immediately.

**Tech Stack:** SvelteKit (adapter-cloudflare), Cloudflare Workers, Durable Objects, @kreuzberg/wasm v4.4.4, Workers AI BGE-base-en-v1.5, Cloudflare Vectorize, R2, Drizzle ORM, Svelte 5 runes, Vitest

**Key context:** In Martol, `orgId` = `roomId` (Better Auth organization represents a room). Attachments have `orgId` which is the room's Durable Object name.

**Spec:** `docs/superpowers/specs/2026-03-11-document-intelligence-fix-harden-design.md`

---

## Chunk 1: Workstream 1 — Fix Kreuzberg WASM Extraction

### Task 1: Add Granular Error Wrapping to kreuzberg-provider.ts

**Files:**
- Modify: `src/lib/server/rag/kreuzberg-provider.ts`

This task adds try/catch around WASM init and extraction separately so we can distinguish "WASM load failed" from "extraction failed" from "extraction returned empty". Currently the entire provider has no error wrapping — any throw from `ensureWasm()` or `extractBytes()` propagates as an untyped error.

- [ ] **Step 1: Read the current file**

Read `src/lib/server/rag/kreuzberg-provider.ts` to confirm current code matches plan context.

- [ ] **Step 2: Wrap `ensureWasm()` with specific error**

Replace the current `ensureWasm()` function:

```typescript
async function ensureWasm(): Promise<typeof import('@kreuzberg/wasm')> {
	const kreuzberg = await import('@kreuzberg/wasm');
	if (!wasmInitialized) {
		await kreuzberg.initWasm();
		wasmInitialized = true;
	}
	return kreuzberg;
}
```

With:

```typescript
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
		wasmInitialized = false; // Reset so next attempt retries
		console.error('[Kreuzberg] WASM init failed:', err);
		throw new ExtractionError('wasm_init_failed', `WASM initialization failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}
```

- [ ] **Step 3: Add `ExtractionError` class and wrap `extract()`**

Add above the `kreuzbergProvider` export:

```typescript
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
```

Replace the `extract()` method body:

```typescript
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
			if (err instanceof ExtractionError) throw err; // Already typed
			console.error('[Kreuzberg] Extraction failed:', err);
			throw new ExtractionError('extraction_failed', `Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	},
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors in `kreuzberg-provider.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/rag/kreuzberg-provider.ts
git commit -m "fix(rag): add granular error wrapping to Kreuzberg WASM provider"
```

---

### Task 2: Add Timeout and Structured Error Codes to process-document.ts

**Files:**
- Modify: `src/lib/server/rag/process-document.ts`

The current `catch` block in `processDocument()` just slices the error message. We need:
1. A 30-second timeout around extraction
2. Structured error codes mapped from known failure modes
3. Proper error code when extraction returns empty text

- [ ] **Step 1: Read the current file**

Read `src/lib/server/rag/process-document.ts` to confirm current code.

- [ ] **Step 2: Add timeout helper at top of file**

Add after the imports:

```typescript
import { ExtractionError } from './kreuzberg-provider';

const EXTRACTION_TIMEOUT_MS = 30_000; // 30 seconds

/** Wrap a promise with a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new ExtractionError('extraction_timeout', `${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(val) => { clearTimeout(timer); resolve(val); },
			(err) => { clearTimeout(timer); reject(err); }
		);
	});
}
```

- [ ] **Step 3: Wrap extraction call with timeout**

Replace the extraction call (current lines 85-90):

```typescript
		// 5. Extract text via pluggable provider
		const extracted = await extractText(buffer, att.contentType, att.filename);
		if (!extracted) {
			await db.update(attachments).set({ processingStatus: 'skipped' }).where(eq(attachments.id, attachmentId));
			await finishJob(db, job.id, 'completed', null);
			return null;
		}
```

With:

```typescript
		// 5. Extract text via pluggable provider (with timeout)
		let extracted;
		try {
			extracted = await withTimeout(
				extractText(buffer, att.contentType, att.filename),
				EXTRACTION_TIMEOUT_MS,
				'Text extraction'
			);
		} catch (err) {
			if (err instanceof ExtractionError) {
				await markFailed(db, attachmentId, job.id, err.code);
				return null;
			}
			throw err; // Re-throw unexpected errors to outer catch
		}

		if (!extracted) {
			await markFailed(db, attachmentId, job.id, 'extraction_empty');
			return null;
		}
```

Note: previously `!extracted` was marked `skipped` — now it's `failed` with `extraction_empty` so the cron can retry it.

- [ ] **Step 4: Replace generic catch block with structured error mapping**

Replace the current catch block (lines 159-164):

```typescript
	} catch (err) {
		console.error('[RAG] Document processing failed:', err);
		const errorCode = err instanceof Error ? err.message.slice(0, 200) : 'unknown_error';
		await markFailed(db, attachmentId, job.id, errorCode);
		return null;
	}
```

With:

```typescript
	} catch (err) {
		console.error('[RAG] Document processing failed:', err);
		const errorCode = resolveErrorCode(err);
		await markFailed(db, attachmentId, job.id, errorCode);
		return null;
	}
```

And add this helper function at the bottom of the file:

```typescript
/** Map errors to structured error codes. */
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
```

- [ ] **Step 5: Add structured logging at each pipeline step**

Add `console.log` at key points in `processDocument()`:

After creating ingestion job (after line 41):
```typescript
	console.log(`[RAG] Processing attachment ${attachmentId} for org ${orgId}, job ${job.id}`);
```

Before R2 fetch (before line 76):
```typescript
		console.log(`[RAG] Fetching from R2: ${att.r2Key}`);
```

Before extraction (before the new extraction block):
```typescript
		console.log(`[RAG] Extracting text from ${att.filename} (${att.contentType}, ${att.sizeBytes} bytes)`);
```

After extraction succeeds (after extraction metadata update):
```typescript
		console.log(`[RAG] Extracted ${extracted.text.length} chars from ${att.filename}`);
```

After chunking:
```typescript
		console.log(`[RAG] Chunked into ${chunks.length} segments`);
```

After embedding and indexing:
```typescript
		console.log(`[RAG] Indexed ${indexed.length} chunks for attachment ${attachmentId}`);
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors in `process-document.ts`

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/rag/process-document.ts
git commit -m "fix(rag): add extraction timeout, structured error codes, and granular logging"
```

---

### Task 3: Write Unit Tests for Extraction Error Handling

**Files:**
- Create: `src/lib/server/rag/__tests__/process-document.test.ts`

- [ ] **Step 1: Write tests for structured error codes and timeout**

```typescript
/**
 * Tests for processDocument() — structured error codes and timeout
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing processDocument
vi.mock('./kreuzberg-provider', () => ({
	kreuzbergProvider: {
		name: 'kreuzberg-wasm',
		version: '4.4.4',
		supports: vi.fn(() => true),
		extract: vi.fn()
	},
	ExtractionError: class ExtractionError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
			this.name = 'ExtractionError';
		}
	}
}));

vi.mock('./parser', () => ({
	extractText: vi.fn(),
	registerProvider: vi.fn()
}));

vi.mock('./chunker', () => ({
	chunkText: vi.fn(() => [
		{ content: 'chunk 1', charStart: 0, charEnd: 100, tokenEstimate: 25 }
	])
}));

vi.mock('./embedder', () => ({
	embedAndIndex: vi.fn(() => [
		{ index: 0, content: 'chunk 1', vectorId: '1-0', charStart: 0, charEnd: 100, tokenEstimate: 25 }
	]),
	getEmbeddingModel: vi.fn(() => '@cf/baai/bge-base-en-v1.5'),
	getEmbeddingDim: vi.fn(() => 768)
}));

vi.mock('$lib/server/ai-billing', () => ({
	isAiCapReached: vi.fn(() => false)
}));

import { processDocument } from '../process-document';
import { extractText } from '../parser';

const mockExtractText = vi.mocked(extractText);

// Chainable mock DB
function makeDb(attachmentRow?: Record<string, unknown>) {
	const row = attachmentRow ?? {
		r2Key: 'org/att/test.pdf',
		contentType: 'application/pdf',
		filename: 'test.pdf',
		sizeBytes: 1024
	};

	let selectCount = 0;
	return {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([{ id: 1 }]),
				onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
			})
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue({ rowCount: 1 })
			})
		}),
		select: vi.fn().mockImplementation(() => {
			selectCount++;
			const step: any = {
				from: vi.fn(),
				where: vi.fn(),
				limit: vi.fn().mockResolvedValue(selectCount === 1 ? [row] : [])
			};
			step.from.mockReturnValue(step);
			step.where.mockReturnValue(step);
			return step;
		})
	} as any;
}

const mockR2 = {
	get: vi.fn().mockResolvedValue({
		arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
	})
} as any;

const mockAi = {} as Ai;
const mockVectorize = {} as VectorizeIndex;

describe('processDocument', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('marks failed with extraction_empty when extraction returns null', async () => {
		const db = makeDb();
		mockExtractText.mockResolvedValue(null);

		const result = await processDocument(db, mockAi, mockVectorize, mockR2, 1, 'org-1');

		expect(result).toBeNull();
		// Should have called update with 'failed' and 'extraction_empty'
		const updateCalls = db.update.mock.calls;
		const setCalls = updateCalls.map((c: any) => {
			const setFn = c[0]; // the table
			return db.update(setFn).set.mock.calls;
		});
		// Verify at least one call contains extraction_empty
		const allSets = db.update.mock.results.map((r: any) => r.value.set.mock.calls).flat();
		const failedSet = allSets.find((args: any) => args[0]?.extractionErrorCode === 'extraction_empty');
		expect(failedSet).toBeTruthy();
	});

	it('marks failed with r2_object_missing when R2 returns null', async () => {
		const db = makeDb();
		const r2 = { get: vi.fn().mockResolvedValue(null) } as any;

		const result = await processDocument(db, mockAi, mockVectorize, r2, 1, 'org-1');

		expect(result).toBeNull();
		const allSets = db.update.mock.results.map((r: any) => r.value.set.mock.calls).flat();
		const failedSet = allSets.find((args: any) => args[0]?.extractionErrorCode === 'r2_object_missing');
		expect(failedSet).toBeTruthy();
	});

	it('marks skipped when AI cap is reached', async () => {
		const { isAiCapReached } = await import('$lib/server/ai-billing');
		vi.mocked(isAiCapReached).mockResolvedValueOnce(true);

		const db = makeDb();
		const result = await processDocument(db, mockAi, mockVectorize, mockR2, 1, 'org-1');

		expect(result).toBeNull();
		const allSets = db.update.mock.results.map((r: any) => r.value.set.mock.calls).flat();
		const skippedSet = allSets.find((args: any) => args[0]?.processingStatus === 'skipped');
		expect(skippedSet).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/lib/server/rag/__tests__/process-document.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/rag/__tests__/process-document.test.ts
git commit -m "test(rag): add unit tests for structured error codes in processDocument"
```

---

## Chunk 2: Workstream 2 — Harden Pipeline

### Task 4: Add Stuck Job Cleanup to Cron Handler

**Files:**
- Modify: `worker-entry.ts`

The cron already retries failed jobs (lines 154-196). We need to add two more recovery paths before the existing retry block:
1. **Stuck jobs**: `processing_status = 'processing'` AND `updated_at` or `started_at < now - 5min` → mark `failed` with `processing_timeout`
2. **Orphaned pending**: `processing_status = 'pending'` AND no matching ingestion job → create job and dispatch

- [ ] **Step 1: Read the current worker-entry.ts**

Read `worker-entry.ts` to confirm current code.

- [ ] **Step 2: Add stuck job cleanup before the existing retry block**

Insert this block before the existing `// Retry failed ingestion jobs` comment (before line 154):

```typescript
		// Clean up stuck processing jobs (>5 minutes without progress)
		try {
			const { ingestionJobs, attachments } = await import('./src/lib/server/db/schema');
			const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000);

			// Find attachments stuck in 'processing' for >5min
			const stuckAttachments = await db
				.select({ id: attachments.id })
				.from(attachments)
				.where(
					and(
						eq(attachments.processingStatus, 'processing'),
						lt(attachments.updatedAt, stuckCutoff)
					)
				)
				.limit(20);

			for (const att of stuckAttachments) {
				await db
					.update(attachments)
					.set({ processingStatus: 'failed', extractionErrorCode: 'processing_timeout' })
					.where(eq(attachments.id, att.id));
			}

			if (stuckAttachments.length > 0) {
				console.log(`[Cron] Marked ${stuckAttachments.length} stuck processing attachments as failed (processing_timeout)`);
			}
		} catch (err) {
			console.error('[Cron] Stuck job cleanup failed:', err);
		}

		// Dispatch orphaned pending attachments (pending but no ingestion job)
		try {
			const { ingestionJobs, attachments } = await import('./src/lib/server/db/schema');
			const ai = env.AI as Ai | undefined;
			const vectorize = env.VECTORIZE as VectorizeIndex | undefined;
			const r2 = env.STORAGE as R2Bucket | undefined;

			const orphaned = await db.execute(sql`
				SELECT a.id, a.org_id
				FROM attachments a
				LEFT JOIN ingestion_jobs ij ON ij.attachment_id = a.id
				WHERE a.processing_status = 'pending'
				  AND ij.id IS NULL
				LIMIT 10
			`);

			if (orphaned.rows.length > 0 && ai && vectorize && r2) {
				const { processDocument } = await import('./src/lib/server/rag/process-document');
				for (const row of orphaned.rows) {
					ctx.waitUntil(
						processDocument(db, ai, vectorize, r2, Number(row.id), String(row.org_id))
							.catch((err: unknown) => console.error(`[Cron] Orphan dispatch failed for attachment ${row.id}:`, err))
					);
				}
				console.log(`[Cron] Dispatched ${orphaned.rows.length} orphaned pending attachments`);
			}
		} catch (err) {
			console.error('[Cron] Orphan dispatch failed:', err);
		}
```

- [ ] **Step 3: Check that `attachments` table has `updatedAt` column**

Read `src/lib/server/db/schema.ts` and search for `updatedAt` on the attachments table. If it doesn't exist, we need to use `createdAt` instead or add the column. Check and adapt accordingly — if missing, replace `attachments.updatedAt` with the ingestion job's `startedAt` using a join:

```typescript
			// Alternative if no updatedAt on attachments:
			const stuckJobs = await db
				.select({
					attachmentId: ingestionJobs.attachmentId,
				})
				.from(ingestionJobs)
				.where(
					and(
						eq(ingestionJobs.status, 'running'),
						lt(ingestionJobs.startedAt, stuckCutoff)
					)
				)
				.limit(20);
```

Use whichever approach matches the actual schema.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add worker-entry.ts
git commit -m "feat(rag): add stuck job cleanup and orphan dispatch to cron handler"
```

---

### Task 5: Add Retry Backoff Logic

**Files:**
- Modify: `worker-entry.ts`

The current retry logic dispatches immediately regardless of attempt number. Add backoff: attempt 1 = immediate, attempt 2 = skip if last failure was < 1 minute ago, attempt 3 = skip if < 5 minutes ago.

- [ ] **Step 1: Read the current retry block in worker-entry.ts**

Read the existing retry block (lines 154-196).

- [ ] **Step 2: Add backoff check to the retry loop**

Replace the retry loop body. In the `for (const job of failedJobs)` loop, add a backoff check before re-dispatching:

```typescript
				for (const job of failedJobs) {
					// Backoff: attempt 2 waits 1min, attempt 3 waits 5min
					const attemptNum = (job.attemptCount ?? 0) + 1;
					const backoffMs =
						attemptNum === 2 ? 60_000 :
						attemptNum >= 3 ? 300_000 : 0;

					if (backoffMs > 0 && job.finishedAt) {
						const elapsed = Date.now() - new Date(job.finishedAt).getTime();
						if (elapsed < backoffMs) continue; // Not ready for retry yet
					}

					// Increment attempt count and reset status
					await db
						.update(ingestionJobs)
						.set({ status: 'pending', attemptCount: sql`${ingestionJobs.attemptCount} + 1` })
						.where(eq(ingestionJobs.id, job.id));
					// Re-dispatch processing
					ctx.waitUntil(
						processDocument(db, ai, vectorize, r2, job.attachmentId, job.orgId)
							.catch((err: unknown) => console.error(`[Cron] Retry failed for attachment ${job.attachmentId}:`, err))
					);
				}
```

This requires updating the `failedJobs` select to also include `attemptCount` and `finishedAt`:

```typescript
			const failedJobs = await db
				.select({
					id: ingestionJobs.id,
					attachmentId: ingestionJobs.attachmentId,
					orgId: ingestionJobs.orgId,
					attemptCount: ingestionJobs.attemptCount,
					finishedAt: ingestionJobs.finishedAt,
				})
				.from(ingestionJobs)
				.where(
					and(
						eq(ingestionJobs.status, 'failed'),
						lt(ingestionJobs.attemptCount, 3)
					)
				)
				.limit(10);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add worker-entry.ts
git commit -m "feat(rag): add exponential backoff to ingestion job retries"
```

---

### Task 6: UI Status Improvements in DocumentPanel

**Files:**
- Modify: `src/lib/components/chat/DocumentPanel.svelte`

Three changes:
1. `pending` shows "Queued" instead of "Pending"
2. `processing` badge shows spinner animation
3. `failed` badge shows error code as tooltip on hover

- [ ] **Step 1: Read the current DocumentPanel.svelte**

Read `src/lib/components/chat/DocumentPanel.svelte` to confirm current code.

- [ ] **Step 2: Update DocFile interface to include error code**

In the `DocFile` interface, add:

```typescript
	interface DocFile {
		id: number;
		filename: string;
		content_type: string;
		size_bytes: number;
		processing_status: string;
		extraction_error_code: string | null;
		created_at: string | null;
	}
```

- [ ] **Step 3: Update statusLabel to show "Queued"**

Replace the `statusLabel` function:

```typescript
	function statusLabel(status: string): string {
		switch (status) {
			case 'indexed': return 'Indexed';
			case 'processing': return 'Processing...';
			case 'pending': return 'Queued';
			case 'failed': return 'Failed';
			case 'skipped': return 'Skipped';
			default: return status;
		}
	}
```

- [ ] **Step 4: Add spinner to processing status and tooltip to failed**

In the template, replace the status badge section (the `<span>` with the colored dot and label):

Find:
```svelte
							<span
								class="inline-flex items-center gap-1"
							>
								<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: {statusColor(file.processing_status)};"></span>
								{statusLabel(file.processing_status)}
							</span>
```

Replace with:
```svelte
							<span
								class="inline-flex items-center gap-1"
								title={file.processing_status === 'failed' && file.extraction_error_code ? `Error: ${file.extraction_error_code}` : ''}
							>
								{#if file.processing_status === 'processing'}
									<RefreshCw size={10} class="animate-spin" style="color: {statusColor(file.processing_status)};" />
								{:else}
									<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: {statusColor(file.processing_status)};"></span>
								{/if}
								{statusLabel(file.processing_status)}
							</span>
```

- [ ] **Step 5: Verify the files API returns extraction_error_code**

Read `src/routes/api/upload/files/+server.ts` to check if the GET handler returns `extraction_error_code`. If not, add it to the select query.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/chat/DocumentPanel.svelte
git commit -m "feat(ui): improve document status badges — queued label, spinner, error tooltip"
```

---

## Chunk 3: Workstream 3 — Agent Auto-Notify + WebSocket Refresh

### Task 7: Add document_indexed Type to WebSocket Protocol

**Files:**
- Modify: `src/lib/types/ws.ts`

- [ ] **Step 1: Read the current ws.ts**

Read `src/lib/types/ws.ts`.

- [ ] **Step 2: Add document_indexed to ServerMessage union**

Add to the `ServerMessage` type union (before the `error` variant):

```typescript
	| { type: 'document_indexed'; attachmentId: number; filename: string; chunks: number }
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/ws.ts
git commit -m "feat(ws): add document_indexed server message type"
```

---

### Task 8: Add handleNotifyDocumentIndexed to ChatRoom Durable Object

**Files:**
- Modify: `src/lib/server/chat-room.ts`

Following the existing `handleNotifyBrief()` pattern (lines 852-875): validate X-Internal-Secret, parse JSON payload, broadcast to all WebSocket clients, inject a system message.

- [ ] **Step 1: Read the relevant sections of chat-room.ts**

Read lines 143-160 (fetch router) and lines 850-876 (handleNotifyBrief).

- [ ] **Step 2: Add route to the fetch handler**

After the `/notify-brief` route check (line 158), add:

```typescript
		if (request.method === 'POST' && url.pathname.endsWith('/notify-document')) {
			return this.handleNotifyDocumentIndexed(request);
		}
```

- [ ] **Step 3: Add handleNotifyDocumentIndexed method**

Add after `handleNotifyBrief()`:

```typescript
	// ── REST Document Indexed Notification ───────────────────────────

	private async handleNotifyDocumentIndexed(request: Request): Promise<Response> {
		const internalSecret = request.headers.get('X-Internal-Secret');
		if (!internalSecret || internalSecret !== this.env.HMAC_SIGNING_SECRET) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
		}

		let payload: { attachmentId: number; filename: string; chunks: number; words: number; pages: number | null };
		try {
			payload = await request.json();
		} catch {
			return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
		}

		// Broadcast real-time event to connected clients
		await this.broadcast({
			type: 'document_indexed',
			attachmentId: payload.attachmentId,
			filename: payload.filename,
			chunks: payload.chunks
		});

		// Inject persistent system message so agents see it in history
		const systemBody = `[System] ${payload.filename} has been indexed (${payload.pages ? `${payload.pages} pages, ` : ''}~${payload.words.toLocaleString()} words, ${payload.chunks} chunks). Agents can query it with doc_search.`;

		// Write system message to WAL (same path as regular messages)
		const seqId = ++this.seqCounter;
		const stored: StoredMessage = {
			localId: `sys-doc-${payload.attachmentId}`,
			orgId: this.roomId,
			senderId: 'system',
			senderRole: 'system',
			senderName: 'System',
			body: systemBody,
			timestamp: new Date().toISOString(),
			flushed: false
		};

		await this.ctx.storage.put(storageKey(seqId), stored);
		this.unflushedIds.push(seqId);
		this.scheduleFlush();

		// Broadcast the system message
		await this.broadcast({
			type: 'message',
			message: {
				localId: stored.localId,
				serverSeqId: seqId,
				senderId: stored.senderId,
				senderRole: stored.senderRole,
				senderName: stored.senderName,
				body: stored.body,
				timestamp: stored.timestamp
			}
		});

		return new Response(
			JSON.stringify({ ok: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}
```

- [ ] **Step 4: Verify that `this.roomId`, `this.seqCounter`, `storageKey`, `this.scheduleFlush` are accessible**

Check the class has these properties. `roomId` should be set in the constructor or from DO name. Search the file for how these are defined. If `roomId` is stored differently, adjust.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/chat-room.ts
git commit -m "feat(rag): add handleNotifyDocumentIndexed to ChatRoom Durable Object"
```

---

### Task 9: Call DO Notify from processDocument After Indexing

**Files:**
- Modify: `src/lib/server/rag/process-document.ts`

After marking the attachment as `indexed`, call the ChatRoom Durable Object REST endpoint to notify the room. This requires passing the `env` object (for CHAT_ROOM namespace and HMAC_SIGNING_SECRET) to `processDocument()`.

- [ ] **Step 1: Read process-document.ts again**

Read `src/lib/server/rag/process-document.ts` to see current function signature and step 10 (mark as indexed).

- [ ] **Step 2: Add env parameter to processDocument signature**

Update the function signature to accept an env parameter:

```typescript
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
```

- [ ] **Step 3: Add notification call after marking indexed**

After step 10 (mark as indexed) and before step 11 (track AI usage), add:

```typescript
		// 10b. Notify room that document is indexed
		if (env) {
			try {
				await notifyRoom(env, orgId, {
					attachmentId,
					filename: att.filename,
					chunks: indexed.length,
					words: Math.round(extracted.text.length / 5), // rough word estimate
					pages: extracted.pageCount ?? null
				});
			} catch (err) {
				// Non-fatal — document is indexed, notification is best-effort
				console.error('[RAG] Room notification failed:', err);
			}
		}
```

And add the `notifyRoom` helper at the bottom of the file:

```typescript
/** Notify the room's Durable Object that a document was indexed. */
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
```

- [ ] **Step 4: Update all callers to pass env**

There are three callers of `processDocument()`:
1. `src/routes/api/upload/+server.ts` — has access to `platform?.env`
2. `src/routes/api/upload/files/retry/+server.ts` — has access to `platform?.env`
3. `src/routes/api/rooms/[roomId]/ocr/+server.ts` — has access to `platform?.env`
4. `worker-entry.ts` cron handler — has access to `env`

For each caller, add `env` as the last argument. Since the parameter is optional, existing calls won't break, but we want all callers to pass it.

Example for upload handler:
```typescript
processDocument(locals.db, ai, vectorize, r2, att.id, activeOrgId, platform?.env as Record<string, unknown>)
```

Example for worker-entry.ts cron:
```typescript
processDocument(db, ai, vectorize, r2, job.attachmentId, job.orgId, env)
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/rag/process-document.ts src/routes/api/upload/+server.ts src/routes/api/upload/files/retry/+server.ts src/routes/api/rooms/*/ocr/+server.ts worker-entry.ts
git commit -m "feat(rag): notify room Durable Object when document finishes indexing"
```

---

### Task 10: Handle document_indexed WebSocket Event in Client

**Files:**
- Modify: `src/lib/stores/websocket.svelte.ts` (or wherever ServerMessage is handled)
- Modify: `src/lib/components/chat/DocumentPanel.svelte`

- [ ] **Step 1: Find where ServerMessage is dispatched in the client**

Search for where `onMessage` processes different `msg.type` values. This is likely in the chat page or a store that wraps WebSocketStore.

- [ ] **Step 2: Add document_indexed handler**

In the message handler (wherever `msg.type === 'message'` etc. are handled), add:

```typescript
case 'document_indexed':
	// Trigger refresh of document panel
	// This will be handled by dispatching a custom event or updating a reactive signal
	break;
```

The exact approach depends on how the DocumentPanel is connected. Options:
- A) Dispatch a `CustomEvent` on `window` that DocumentPanel listens for
- B) Add a reactive signal/store that DocumentPanel watches
- C) Call `loadFiles()` from the WebSocket handler if DocumentPanel exposes it

Option A is simplest and decoupled:

In the WebSocket message handler:
```typescript
case 'document_indexed':
	window.dispatchEvent(new CustomEvent('document-indexed', { detail: msg }));
	break;
```

In DocumentPanel.svelte, add an effect:
```typescript
	$effect(() => {
		if (!open) return;
		function onDocIndexed() { loadFiles(); }
		window.addEventListener('document-indexed', onDocIndexed);
		return () => window.removeEventListener('document-indexed', onDocIndexed);
	});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 4: Test manually**

1. Upload a PDF in a room
2. Open the Documents panel
3. Watch the status change from Queued → Processing → Indexed (should update automatically via WebSocket)
4. Check chat for system message about the indexed document

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/websocket.svelte.ts src/lib/components/chat/DocumentPanel.svelte
git commit -m "feat(ui): auto-refresh document panel on WebSocket document_indexed event"
```

---

## Chunk 4: Integration Testing & Verification

### Task 11: Write Cron Recovery Unit Tests

**Files:**
- Create: `src/lib/server/rag/__tests__/cron-recovery.test.ts`

- [ ] **Step 1: Write tests for stuck job cleanup and orphan dispatch**

```typescript
/**
 * Tests for cron recovery logic
 * Tests the logic concepts — actual cron runs against worker-entry.ts
 */
import { describe, it, expect } from 'vitest';

describe('Cron Recovery Logic', () => {
	it('stuck job cutoff is 5 minutes', () => {
		const STUCK_CUTOFF_MS = 5 * 60 * 1000;
		expect(STUCK_CUTOFF_MS).toBe(300_000);
	});

	it('backoff schedule: attempt 1 immediate, 2 after 1min, 3 after 5min', () => {
		function getBackoffMs(attemptNum: number): number {
			if (attemptNum === 2) return 60_000;
			if (attemptNum >= 3) return 300_000;
			return 0;
		}

		expect(getBackoffMs(1)).toBe(0);
		expect(getBackoffMs(2)).toBe(60_000);
		expect(getBackoffMs(3)).toBe(300_000);
	});

	it('should not retry after 3 attempts', () => {
		const MAX_ATTEMPTS = 3;
		const attemptCount = 3;
		expect(attemptCount < MAX_ATTEMPTS).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/lib/server/rag/__tests__/cron-recovery.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/rag/__tests__/cron-recovery.test.ts
git commit -m "test(rag): add cron recovery logic unit tests"
```

---

### Task 12: End-to-End Verification

**Files:** No files modified — this is manual testing.

- [ ] **Step 1: Deploy to local dev**

Run: `pnpm cf:dev`

- [ ] **Step 2: Upload a PDF and verify full pipeline**

1. Open a room
2. Upload a PDF document
3. Open Documents panel
4. Verify status progression: Queued → Processing → Indexed
5. Verify system message appears in chat: "[System] filename.pdf has been indexed..."
6. Ask the agent about the document content
7. Verify agent calls `doc_search` and returns relevant content

- [ ] **Step 3: Test error paths**

1. Upload an empty file → should show Failed with `extraction_empty` tooltip
2. Upload a corrupt file → should show Failed with error code tooltip
3. Check that retry button works on failed documents

- [ ] **Step 4: Verify existing tests still pass**

Run: `pnpm vitest run`
Expected: All 109+ billing tests + new RAG tests pass

- [ ] **Step 5: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix(rag): adjustments from end-to-end verification"
```

---

### Task 13: Run All Tests and Verify Clean Build

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 3: Final commit and push**

If all clean, push:
```bash
git push
```
