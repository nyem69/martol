import { describe, it, expect } from 'vitest';
import { chunkText } from './chunker';

describe('chunkText', () => {
	it('returns single chunk for short text', () => {
		const chunks = chunkText('Hello world', 500, 50);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toBe('Hello world');
		expect(chunks[0].index).toBe(0);
		expect(chunks[0].charStart).toBe(0);
		expect(chunks[0].charEnd).toBe(11);
	});

	it('splits long text with overlap', () => {
		const text = 'word '.repeat(600).trim();
		const chunks = chunkText(text, 200, 50);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.tokenEstimate).toBeLessThanOrEqual(250);
		}
	});

	it('preserves chunk ordering via index', () => {
		const text = 'word '.repeat(1000).trim();
		const chunks = chunkText(text, 200, 50);
		for (let i = 0; i < chunks.length; i++) {
			expect(chunks[i].index).toBe(i);
		}
	});

	it('returns empty for empty text', () => {
		expect(chunkText('', 500, 50)).toHaveLength(0);
	});

	it('returns empty for whitespace-only text', () => {
		expect(chunkText('   \n\t  ', 500, 50)).toHaveLength(0);
	});

	it('tracks character offsets correctly', () => {
		const text = 'The quick brown fox jumps over the lazy dog';
		const chunks = chunkText(text, 4, 1);
		// First chunk: "The quick brown fox"
		expect(chunks[0].charStart).toBe(0);
		expect(text.substring(chunks[0].charStart, chunks[0].charEnd)).toBe(
			chunks[0].content
		);
		// All chunks should have valid char ranges
		for (const chunk of chunks) {
			expect(chunk.charStart).toBeGreaterThanOrEqual(0);
			expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
		}
	});
});
