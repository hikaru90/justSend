#!/usr/bin/env node
/**
 * Pull a remote Owlery SQLite snapshot into the local DATABASE_URL path.
 *
 * Usage:
 *   npm run db:pull -- https://mail.example.com
 *   OWLERY_SESSION=<cookie> npm run db:pull -- https://mail.example.com
 *   npm run db:pull -- https://mail.example.com --cookie 'owlery_session=...'
 *
 * Get the session cookie from the browser while logged in as ADMIN_EMAIL
 * (DevTools → Application → Cookies → owlery_session).
 */
import 'dotenv/config';
import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

function resolveDbPath(url) {
	if (!url || url === ':memory:' || url.startsWith('file::memory:')) {
		throw new Error('DATABASE_URL must point to an on-disk SQLite file');
	}
	const path = url.startsWith('file:') ? url.slice('file:'.length) : url;
	return resolve(process.cwd(), path);
}

function parseArgs(argv) {
	const args = { remote: null, cookie: process.env.OWLERY_SESSION ?? null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--cookie' || a === '-c') {
			args.cookie = argv[++i] ?? null;
		} else if (a === '--help' || a === '-h') {
			args.help = true;
		} else if (!a.startsWith('-') && !args.remote) {
			args.remote = a;
		}
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.remote) {
	console.log(`Usage: npm run db:pull -- <remote-base-url> [--cookie owlery_session=...]

Downloads /admin/database/download from a remote Owlery instance into DATABASE_URL
(${process.env.DATABASE_URL ?? 'file:./data/owlery.db'}).

Requires an admin session cookie (env OWLERY_SESSION or --cookie).`);
	process.exit(args.help ? 0 : 1);
}

if (!args.cookie) {
	console.error('Missing session cookie. Set OWLERY_SESSION or pass --cookie.');
	process.exit(1);
}

const remoteBase = args.remote.replace(/\/$/, '');
const downloadUrl = `${remoteBase}/admin/database/download`;
const dest = resolveDbPath(process.env.DATABASE_URL ?? 'file:./data/owlery.db');
const tmp = `${dest}.pulling`;

mkdirSync(dirname(dest), { recursive: true });

const cookieHeader = args.cookie.includes('=') ? args.cookie : `owlery_session=${args.cookie}`;

console.log(`Fetching ${downloadUrl}`);
const res = await fetch(downloadUrl, {
	headers: { Cookie: cookieHeader, Accept: 'application/vnd.sqlite3, application/octet-stream' },
	redirect: 'manual',
});

if (res.status === 302 || res.status === 303) {
	console.error(
		'Got a redirect — session cookie is missing or expired. Log in as admin and copy owlery_session.',
	);
	process.exit(1);
}
if (res.status === 401 || res.status === 403) {
	console.error(`Unauthorized (${res.status}). Use an ADMIN_EMAIL session cookie.`);
	process.exit(1);
}
if (!res.ok) {
	const body = await res.text().catch(() => '');
	console.error(`Download failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ''}`);
	process.exit(1);
}
if (!res.body) {
	console.error('Empty response body');
	process.exit(1);
}

try {
	await pipeline(res.body, createWriteStream(tmp));
	if (existsSync(dest)) unlinkSync(dest);
	// Drop leftover WAL/SHM so the pulled file opens cleanly
	for (const suffix of ['-wal', '-shm']) {
		const side = `${dest}${suffix}`;
		if (existsSync(side)) unlinkSync(side);
	}
	renameSync(tmp, dest);
	console.log(`Wrote ${dest}`);
} catch (e) {
	if (existsSync(tmp)) unlinkSync(tmp);
	throw e;
}
