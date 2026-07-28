import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { appSettings, queueJobs } from '../db/schema';
import { nowIso } from '$lib/utils';

const HEARTBEAT_KEY = 'worker:heartbeat';
const CONTROL_KEY = 'worker:control';

/** Consider the worker dead if no beat within this window. */
export const WORKER_STALE_MS = 20_000;

export type WorkerDesiredState = 'running' | 'paused' | 'stopped';

export type WorkerControl = {
	desiredState: WorkerDesiredState;
	/** Bumped to ask a running worker to exit so the supervisor can restart it. */
	restartNonce: number;
	updatedAt: string;
};

export type WorkerHeartbeat = {
	pid: number;
	startedAt: string;
	lastBeatAt: string;
	queues: string[];
	/** Actual processing state reported by the worker process. */
	state: 'running' | 'paused';
};

export type QueueDepthRow = {
	queue: string;
	pending: number;
	processing: number;
	failed: number;
};

export type WorkerStatus = {
	alive: boolean;
	/** Effective UI state: running | paused | stopped | offline */
	status: 'running' | 'paused' | 'stopped' | 'offline';
	heartbeat: WorkerHeartbeat | null;
	control: WorkerControl;
	staleMs: number;
	totals: { pending: number; processing: number; failed: number };
	queues: QueueDepthRow[];
};

export type WorkerControlAction = 'start' | 'stop' | 'pause' | 'restart';

const DEFAULT_CONTROL: WorkerControl = {
	desiredState: 'running',
	restartNonce: 0,
	updatedAt: '1970-01-01T00:00:00.000Z'
};

let startedAt: string | null = null;

function writeSetting(key: string, value: unknown): void {
	const serialized = JSON.stringify(value);
	db.insert(appSettings)
		.values({ key, value: serialized })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value: serialized }
		})
		.run();
}

function readSetting<T>(key: string): T | null {
	const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
	if (!row?.value) return null;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return null;
	}
}

export function getWorkerControl(): WorkerControl {
	const raw = readSetting<Partial<WorkerControl>>(CONTROL_KEY);
	if (!raw) return { ...DEFAULT_CONTROL };
	const desiredState: WorkerDesiredState =
		raw.desiredState === 'paused' || raw.desiredState === 'stopped' || raw.desiredState === 'running'
			? raw.desiredState
			: 'running';
	return {
		desiredState,
		restartNonce: typeof raw.restartNonce === 'number' ? raw.restartNonce : 0,
		updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : DEFAULT_CONTROL.updatedAt
	};
}

export function setWorkerControl(patch: Partial<Pick<WorkerControl, 'desiredState' | 'restartNonce'>>): WorkerControl {
	const current = getWorkerControl();
	const next: WorkerControl = {
		desiredState: patch.desiredState ?? current.desiredState,
		restartNonce: patch.restartNonce ?? current.restartNonce,
		updatedAt: nowIso()
	};
	writeSetting(CONTROL_KEY, next);
	return next;
}

export function requestWorkerAction(action: WorkerControlAction): WorkerControl {
	const current = getWorkerControl();
	switch (action) {
		case 'start':
			return setWorkerControl({ desiredState: 'running' });
		case 'pause':
			return setWorkerControl({ desiredState: 'paused' });
		case 'stop':
			return setWorkerControl({ desiredState: 'stopped' });
		case 'restart':
			return setWorkerControl({
				desiredState: 'running',
				restartNonce: current.restartNonce + 1
			});
		default: {
			const _exhaustive: never = action;
			throw new Error(`Unknown worker action: ${_exhaustive}`);
		}
	}
}

export function beatWorkerHeartbeat(
	queues: string[],
	state: WorkerHeartbeat['state'] = 'running'
): void {
	const now = nowIso();
	if (!startedAt) startedAt = now;
	const payload: WorkerHeartbeat = {
		pid: process.pid,
		startedAt,
		lastBeatAt: now,
		queues,
		state
	};
	writeSetting(HEARTBEAT_KEY, payload);
}

/** Reset in-process startedAt (used after supervisor-driven restarts / tests). */
export function resetWorkerStartedAt(): void {
	startedAt = null;
}

function parseIsoMs(value: string): number {
	const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
	const ms = Date.parse(normalized);
	return Number.isFinite(ms) ? ms : 0;
}

export function getWorkerStatus(): WorkerStatus {
	const heartbeat = readSetting<WorkerHeartbeat>(HEARTBEAT_KEY);
	const control = getWorkerControl();
	const lastBeatMs = heartbeat ? parseIsoMs(heartbeat.lastBeatAt) : 0;
	const ageMs = lastBeatMs ? Date.now() - lastBeatMs : Number.POSITIVE_INFINITY;
	const alive = ageMs <= WORKER_STALE_MS;

	let status: WorkerStatus['status'];
	if (control.desiredState === 'stopped') {
		status = 'stopped';
	} else if (!alive) {
		status = 'offline';
	} else if (heartbeat?.state === 'paused' || control.desiredState === 'paused') {
		status = 'paused';
	} else {
		status = 'running';
	}

	const rows = db
		.select({
			queue: queueJobs.queue,
			status: queueJobs.status,
			count: sql<number>`count(*)`.mapWith(Number)
		})
		.from(queueJobs)
		.where(inArray(queueJobs.status, ['pending', 'processing', 'failed']))
		.groupBy(queueJobs.queue, queueJobs.status)
		.all();

	const byQueue = new Map<string, QueueDepthRow>();
	const totals = { pending: 0, processing: 0, failed: 0 };

	for (const row of rows) {
		let entry = byQueue.get(row.queue);
		if (!entry) {
			entry = { queue: row.queue, pending: 0, processing: 0, failed: 0 };
			byQueue.set(row.queue, entry);
		}
		if (row.status === 'pending') {
			entry.pending = row.count;
			totals.pending += row.count;
		} else if (row.status === 'processing') {
			entry.processing = row.count;
			totals.processing += row.count;
		} else if (row.status === 'failed') {
			entry.failed = row.count;
			totals.failed += row.count;
		}
	}

	const queues = [...byQueue.values()].sort((a, b) => a.queue.localeCompare(b.queue));

	return {
		alive,
		status,
		heartbeat,
		control,
		staleMs: WORKER_STALE_MS,
		totals,
		queues
	};
}
