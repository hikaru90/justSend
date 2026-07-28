import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { appSettings, queueJobs } from '../db/schema';
import { nowIso } from '$lib/utils';

const HEARTBEAT_KEY = 'worker:heartbeat';
/** Consider the worker dead if no beat within this window. */
export const WORKER_STALE_MS = 20_000;

export type WorkerHeartbeat = {
	pid: number;
	startedAt: string;
	lastBeatAt: string;
	queues: string[];
};

export type QueueDepthRow = {
	queue: string;
	pending: number;
	processing: number;
	failed: number;
};

export type WorkerStatus = {
	alive: boolean;
	heartbeat: WorkerHeartbeat | null;
	staleMs: number;
	totals: { pending: number; processing: number; failed: number };
	queues: QueueDepthRow[];
};

let startedAt: string | null = null;

export function beatWorkerHeartbeat(queues: string[]): void {
	const now = nowIso();
	if (!startedAt) startedAt = now;
	const payload: WorkerHeartbeat = {
		pid: process.pid,
		startedAt,
		lastBeatAt: now,
		queues
	};
	db.insert(appSettings)
		.values({ key: HEARTBEAT_KEY, value: JSON.stringify(payload) })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value: JSON.stringify(payload) }
		})
		.run();
}

function readHeartbeat(): WorkerHeartbeat | null {
	const row = db.select().from(appSettings).where(eq(appSettings.key, HEARTBEAT_KEY)).get();
	if (!row?.value) return null;
	try {
		return JSON.parse(row.value) as WorkerHeartbeat;
	} catch {
		return null;
	}
}

function parseIsoMs(value: string): number {
	const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
	const ms = Date.parse(normalized);
	return Number.isFinite(ms) ? ms : 0;
}

export function getWorkerStatus(): WorkerStatus {
	const heartbeat = readHeartbeat();
	const lastBeatMs = heartbeat ? parseIsoMs(heartbeat.lastBeatAt) : 0;
	const ageMs = lastBeatMs ? Date.now() - lastBeatMs : Number.POSITIVE_INFINITY;
	const alive = ageMs <= WORKER_STALE_MS;

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
		heartbeat,
		staleMs: WORKER_STALE_MS,
		totals,
		queues
	};
}
