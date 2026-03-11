/**
 * Unit tests for structured error codes in processDocument.
 *
 * Tests that the pipeline correctly calls markFailed with the right
 * extractionErrorCode when extraction returns null, R2 returns null,
 * or the AI cap is reached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Schema mock ─────────────────────────────────────────────────────────────
// Table references are used as arguments to eq() — mocked so they don't throw.
vi.mock('$lib/server/db/schema', () => ({
	attachments: {
		id: 'id',
		r2Key: 'r2Key',
		contentType: 'contentType',
		filename: 'filename',
		sizeBytes: 'sizeBytes',
		processingStatus: 'processingStatus',
		extractionErrorCode: 'extractionErrorCode',
		parserName: 'parserName',
		parserVersion: 'parserVersion',
		extractedTextBytes: 'extractedTextBytes',
		contentSha256: 'contentSha256',
		extractedAt: 'extractedAt',
		indexedAt: 'indexedAt',
	},
	documentChunks: {},
	aiUsage: {
		orgId: 'orgId',
		operation: 'operation',
		periodStart: 'periodStart',
		count: 'count',
	},
	ingestionJobs: {
		id: 'id',
		attachmentId: 'attachmentId',
		orgId: 'orgId',
		status: 'status',
		error: 'error',
		finishedAt: 'finishedAt',
		attemptCount: 'attemptCount',
	},
}));

// ── Parser mock ──────────────────────────────────────────────────────────────
// registerProvider is called at module level — must be mocked before import.
const mockExtractText = vi.fn();
vi.mock('../parser', () => ({
	extractText: (...args: any[]) => mockExtractText(...args),
	registerProvider: vi.fn(),
}));

// ── Kreuzberg provider mock ──────────────────────────────────────────────────
vi.mock('../kreuzberg-provider', () => ({
	kreuzbergProvider: { name: 'kreuzberg-wasm', version: '4.4.4', supports: vi.fn(), extract: vi.fn() },
	ExtractionError: class ExtractionError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
			this.name = 'ExtractionError';
		}
	},
}));

// ── Chunker / Embedder mocks ─────────────────────────────────────────────────
vi.mock('../chunker', () => ({
	chunkText: vi.fn().mockReturnValue([{ content: 'chunk', start: 0, end: 5 }]),
}));

vi.mock('../embedder', () => ({
	embedAndIndex: vi.fn().mockResolvedValue([
		{ index: 0, content: 'chunk', vectorId: 'v1', tokenEstimate: 2, charStart: 0, charEnd: 5 },
	]),
	getEmbeddingModel: vi.fn().mockReturnValue('bge-small-en'),
	getEmbeddingDim: vi.fn().mockReturnValue(384),
}));

// ── AI billing mock ──────────────────────────────────────────────────────────
const mockIsAiCapReached = vi.fn();
vi.mock('$lib/server/ai-billing', () => ({
	isAiCapReached: (...args: any[]) => mockIsAiCapReached(...args),
}));

// ── Import SUT after all mocks are registered ────────────────────────────────
import { processDocument } from '../process-document';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(attachmentRow?: Record<string, unknown>) {
	const row = attachmentRow ?? {
		r2Key: 'org/att/test.pdf',
		contentType: 'application/pdf',
		filename: 'test.pdf',
		sizeBytes: 1024,
	};

	const updateSets: any[] = [];

	return {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([{ id: 1 }]),
				onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
			}),
		}),
		update: vi.fn().mockImplementation(() => {
			const setCall: any = {};
			setCall.set = vi.fn().mockImplementation((vals: any) => {
				updateSets.push(vals);
				return { where: vi.fn().mockResolvedValue({ rowCount: 1 }) };
			});
			return setCall;
		}),
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([row]),
				}),
			}),
		}),
		_updateSets: updateSets,
	} as any;
}

function makeR2(returnNull = false) {
	return {
		get: vi.fn().mockResolvedValue(
			returnNull
				? null
				: { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }
		),
	} as any;
}

const fakeAi = {} as any;
const fakeVectorize = {} as any;

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	mockIsAiCapReached.mockResolvedValue(false);
});

describe('processDocument error handling', () => {
	it('marks failed with extraction_empty when extraction returns null', async () => {
		mockExtractText.mockResolvedValue(null);

		const db = makeDb();
		const r2 = makeR2();

		const result = await processDocument(db, fakeAi, fakeVectorize, r2, 42, 'org-1');

		expect(result).toBeNull();

		const failedSet = db._updateSets.find(
			(s: any) => s.extractionErrorCode === 'extraction_empty'
		);
		expect(failedSet).toBeTruthy();
		expect(failedSet.processingStatus).toBe('failed');
	});

	it('marks failed with r2_object_missing when R2 returns null', async () => {
		const db = makeDb();
		const r2 = makeR2(true); // get() returns null

		const result = await processDocument(db, fakeAi, fakeVectorize, r2, 42, 'org-1');

		expect(result).toBeNull();

		const failedSet = db._updateSets.find(
			(s: any) => s.extractionErrorCode === 'r2_object_missing'
		);
		expect(failedSet).toBeTruthy();
		expect(failedSet.processingStatus).toBe('failed');
	});

	it('marks skipped when AI cap is reached', async () => {
		mockIsAiCapReached.mockResolvedValue(true);

		const db = makeDb();
		const r2 = makeR2();

		const result = await processDocument(db, fakeAi, fakeVectorize, r2, 42, 'org-1');

		expect(result).toBeNull();

		const skippedSet = db._updateSets.find(
			(s: any) => s.processingStatus === 'skipped'
		);
		expect(skippedSet).toBeTruthy();
		// Should NOT have called R2 at all
		expect(r2.get).not.toHaveBeenCalled();
	});
});
