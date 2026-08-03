import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function jsonArray(value: string[] | null | undefined): string {
	return JSON.stringify(value ?? []);
}

export function parseJsonArray(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

export function parseJsonObject<T extends Record<string, unknown> = Record<string, unknown>>(
	value: string | null | undefined,
	fallback: T = {} as T,
): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function nowIso() {
	return new Date().toISOString();
}

export function cuid() {
	return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}
