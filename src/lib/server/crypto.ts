import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function createSecureHash(key: string) {
	const salt = randomBytes(16).toString('hex');
	const derivedKey = scryptSync(key, salt, 64);
	return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifySecureHash(key: string, hash: string) {
	const [salt, keyHash] = hash.split(':');
	if (!salt || !keyHash) return false;
	const derivedKey = scryptSync(key, salt, 64);
	const keyBuffer = Buffer.from(keyHash, 'hex');
	if (keyBuffer.length !== derivedKey.length) return false;
	return timingSafeEqual(keyBuffer, derivedKey);
}

export function sha256(input: string) {
	return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 16) {
	return randomBytes(bytes).toString('hex');
}

export function smallId(size = 10) {
	const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
	const bytes = randomBytes(size);
	let id = '';
	for (let i = 0; i < size; i++) {
		id += alphabet[bytes[i]! % alphabet.length];
	}
	return id;
}
