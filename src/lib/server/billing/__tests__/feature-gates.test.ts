import { describe, it, expect } from 'vitest';
import { withinLimit } from '$lib/server/feature-gates';

describe('withinLimit', () => {
	it('returns true when usage is below limit', () => {
		expect(withinLimit(5, 10)).toBe(true);
	});

	it('returns false when usage equals limit', () => {
		expect(withinLimit(10, 10)).toBe(false);
	});

	it('returns false when usage exceeds limit', () => {
		expect(withinLimit(15, 10)).toBe(false);
	});

	it('returns true when limit is -1 (unlimited)', () => {
		expect(withinLimit(999999, -1)).toBe(true);
	});

	it('returns true for zero usage with any positive limit', () => {
		expect(withinLimit(0, 1)).toBe(true);
	});

	it('returns true for zero usage with unlimited', () => {
		expect(withinLimit(0, -1)).toBe(true);
	});
});
