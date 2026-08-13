import { describe, expect, it } from 'vitest';
import { cn, cuid, jsonArray, nowIso, parseJsonArray, parseJsonObject } from './utils';

describe('cn', () => {
	it('merges class names', () => {
		expect(cn('a', 'b')).toBe('a b');
	});

	it('dedupes conflicting tailwind classes', () => {
		expect(cn('p-2', 'p-4')).toBe('p-4');
	});
});

describe('jsonArray / parseJsonArray', () => {
	it('round-trips arrays', () => {
		expect(parseJsonArray(jsonArray(['a', 'b']))).toEqual(['a', 'b']);
	});

	it('handles null/undefined', () => {
		expect(jsonArray(null)).toBe('[]');
		expect(parseJsonArray(null)).toEqual([]);
		expect(parseJsonArray(undefined)).toEqual([]);
	});

	it('returns empty array for malformed JSON', () => {
		expect(parseJsonArray('{not-json')).toEqual([]);
	});

	it('returns empty array for non-array JSON', () => {
		expect(parseJsonArray('{"a":1}')).toEqual([]);
	});

	it('coerces array elements to strings', () => {
		expect(parseJsonArray('[1,2]')).toEqual(['1', '2']);
	});
});

describe('parseJsonObject', () => {
	it('parses objects', () => {
		expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
	});

	it('returns fallback for null/malformed', () => {
		expect(parseJsonObject(null)).toEqual({});
		expect(parseJsonObject('nope', { x: 1 })).toEqual({ x: 1 });
	});
});

describe('nowIso', () => {
	it('returns an ISO timestamp', () => {
		const value = nowIso();
		expect(() => new Date(value)).not.toThrow();
		expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe('cuid', () => {
	it('returns a 24-char id', () => {
		expect(cuid()).toHaveLength(24);
	});

	it('generates unique values', () => {
		const ids = new Set(Array.from({ length: 50 }, () => cuid()));
		expect(ids.size).toBe(50);
	});
});
