import { describe, expect, it } from 'vitest';
import { createSecureHash, randomToken, sha256, smallId, verifySecureHash } from './crypto';

describe('createSecureHash / verifySecureHash', () => {
	it('round-trips a key', () => {
		const hash = createSecureHash('secret-token');
		expect(verifySecureHash('secret-token', hash)).toBe(true);
	});

	it('rejects a wrong key', () => {
		const hash = createSecureHash('secret-token');
		expect(verifySecureHash('other-token', hash)).toBe(false);
	});

	it('rejects a malformed hash', () => {
		expect(verifySecureHash('secret', 'not-a-hash')).toBe(false);
		expect(verifySecureHash('secret', '')).toBe(false);
	});

	it('produces different salts each time', () => {
		const a = createSecureHash('same');
		const b = createSecureHash('same');
		expect(a).not.toBe(b);
		expect(verifySecureHash('same', a)).toBe(true);
		expect(verifySecureHash('same', b)).toBe(true);
	});
});

describe('sha256', () => {
	it('is deterministic', () => {
		expect(sha256('hello')).toBe(sha256('hello'));
		expect(sha256('hello')).toHaveLength(64);
	});

	it('differs for different inputs', () => {
		expect(sha256('a')).not.toBe(sha256('b'));
	});
});

describe('smallId', () => {
	it('returns the requested length', () => {
		expect(smallId(10)).toHaveLength(10);
		expect(smallId(5)).toHaveLength(5);
	});

	it('uses lowercase alphanumeric charset', () => {
		expect(smallId(32)).toMatch(/^[0-9a-z]+$/);
	});
});

describe('randomToken', () => {
	it('returns hex of expected length', () => {
		expect(randomToken(16)).toHaveLength(32);
		expect(randomToken(8)).toMatch(/^[0-9a-f]+$/);
	});
});
