#!/usr/bin/env node
/**
 * Production process supervisor: keeps the web app and queue worker running.
 * Respects app_settings key `worker:control` so the dashboard can start/stop/restart.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appEntry = resolve(root, 'build/index.js');
const workerEntry = resolve(root, 'build/worker.js');
const CONTROL_KEY = 'worker:control';

function databasePath() {
	const url = process.env.DATABASE_URL ?? 'file:./data/owlery.db';
	if (url.startsWith('file:')) {
		return resolve(root, url.slice('file:'.length));
	}
	return resolve(root, url);
}

function readDesiredState() {
	try {
		const dbPath = databasePath();
		if (!existsSync(dbPath)) return 'running';
		const db = new Database(dbPath, { readonly: true, fileMustExist: false });
		try {
			const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CONTROL_KEY);
			if (!row?.value) return 'running';
			const parsed = JSON.parse(row.value);
			return parsed?.desiredState === 'stopped' ? 'stopped' : 'running';
		} finally {
			db.close();
		}
	} catch {
		return 'running';
	}
}

function spawnChild(label, entry) {
	const child = spawn(process.execPath, [entry], {
		stdio: 'inherit',
		env: process.env,
		cwd: root
	});
	child.on('error', (err) => {
		console.error(`[supervisor] ${label} failed to start`, err);
	});
	return child;
}

if (!existsSync(appEntry)) {
	console.error(`[supervisor] missing ${appEntry}`);
	process.exit(1);
}
if (!existsSync(workerEntry)) {
	console.error(`[supervisor] missing ${workerEntry} — run pnpm build`);
	process.exit(1);
}

let shuttingDown = false;
let app = null;
let worker = null;
let workerRestartTimer = null;

function clearWorkerTimer() {
	if (workerRestartTimer) {
		clearTimeout(workerRestartTimer);
		workerRestartTimer = null;
	}
}

function stopWorker() {
	clearWorkerTimer();
	if (!worker || worker.killed) {
		worker = null;
		return;
	}
	const child = worker;
	worker = null;
	child.kill('SIGTERM');
}

function scheduleWorker(delayMs = 750) {
	clearWorkerTimer();
	workerRestartTimer = setTimeout(() => {
		workerRestartTimer = null;
		ensureWorker();
	}, delayMs);
}

function ensureWorker() {
	if (shuttingDown) return;
	const desired = readDesiredState();
	if (desired === 'stopped') {
		stopWorker();
		scheduleWorker(2_000);
		return;
	}
	if (worker && !worker.killed) return;

	console.log('[supervisor] starting worker');
	worker = spawnChild('worker', workerEntry);
	worker.on('exit', (code, signal) => {
		worker = null;
		if (shuttingDown) return;
		console.log(`[supervisor] worker exited code=${code} signal=${signal}`);
		scheduleWorker(readDesiredState() === 'stopped' ? 2_000 : 750);
	});
}

function startApp() {
	console.log('[supervisor] starting app');
	app = spawnChild('app', appEntry);
	app.on('exit', (code, signal) => {
		app = null;
		if (shuttingDown) {
			process.exit(code ?? 0);
			return;
		}
		console.error(`[supervisor] app exited code=${code} signal=${signal} — restarting`);
		setTimeout(startApp, 750);
	});
}

startApp();
ensureWorker();
const controlPoll = setInterval(ensureWorker, 2_000);

function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	clearInterval(controlPoll);
	clearWorkerTimer();
	console.log(`[supervisor] received ${signal}, shutting down`);
	if (worker && !worker.killed) worker.kill('SIGTERM');
	if (app && !app.killed) app.kill('SIGTERM');
	setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log('[supervisor] Owlery app + worker supervised');
