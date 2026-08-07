import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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

const SECRET_PREFIX = 'enc:v1:';

function deriveSecretKey(secret: string) {
	return scryptSync(secret, 'owlery-team-secret', 32);
}

/** Encrypt a reversible secret (e.g. team BYOK API keys) with AUTH_SECRET. */
export function encryptSecret(plaintext: string, secret: string) {
	const key = deriveSecretKey(secret);
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${SECRET_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt a value produced by {@link encryptSecret}. Returns null when not encrypted. */
export function decryptSecret(stored: string, secret: string) {
	if (!stored.startsWith(SECRET_PREFIX)) return null;
	const payload = stored.slice(SECRET_PREFIX.length);
	const [ivHex, tagHex, dataHex] = payload.split(':');
	if (!ivHex || !tagHex || !dataHex) return null;
	const key = deriveSecretKey(secret);
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(dataHex, 'hex')),
		decipher.final(),
	]);
	return decrypted.toString('utf8');
}
