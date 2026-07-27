import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db, rawDb } from '../../../tests/helpers/db';
import { enqueue, QueueWorker, recoverStaleJobs } from './index';
import { queueJobs } from '../db/schema';
import { nowIso } from '$lib/utils';

beforeEach(() => {
	resetDb();
});

describe('enqueue', () => {
	it('inserts a pending job with payload', () => {
		const id = enqueue('test-queue', { foo: 'bar' });
		const job = db.select().from(queueJobs).where(eq(queueJobs.id, id)).get();
		expect(job).toBeTruthy();
		expect(job!.queue).toBe('test-queue');
		expect(job!.status).toBe('pending');
		expect(JSON.parse(job!.payload)).toEqual({ foo: 'bar' });
		expect(job!.maxAttempts).toBe(5);
	});

	it('respects custom maxAttempts and delayMs', () => {
		const before = Date.now();
		const id = enqueue('delayed', {}, { maxAttempts: 2, delayMs: 5000 });
		const job = db.select().from(queueJobs).where(eq(queueJobs.id, id)).get();
		expect(job!.maxAttempts).toBe(2);
		const runAtMs = new Date(job!.runAt.replace(' ', 'T') + 'Z').getTime();
		expect(runAtMs).toBeGreaterThanOrEqual(before + 4000);
	});

	it('treats duplicate jobId as idempotent', () => {
		const first = enqueue('q', { a: 1 }, { jobId: 'same-id' });
		const second = enqueue('q', { a: 2 }, { jobId: 'same-id' });
		expect(second).toBe('same-id');
		const rows = db.select().from(queueJobs).where(eq(queueJobs.queue, 'q')).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]!.id).toBe(first);
		expect(JSON.parse(rows[0]!.payload)).toEqual({ a: 1 });
	});
});

describe('QueueWorker', () => {
	it('processes a job successfully and marks completed', async () => {
		const handler = vi.fn(async () => undefined);
		enqueue('ok-queue', { n: 1 });

		const worker = new QueueWorker('ok-queue', handler, {
			pollIntervalMs: 50,
			workerId: 'test-worker'
		});
		worker.start();

		await vi.waitFor(
			() => {
				expect(handler).toHaveBeenCalled();
			},
			{ timeout: 3000, interval: 50 }
		);

		worker.stop();

		const job = db.select().from(queueJobs).where(eq(queueJobs.queue, 'ok-queue')).get();
		expect(job!.status).toBe('completed');
		expect(handler).toHaveBeenCalledWith({ n: 1 }, expect.objectContaining({ queue: 'ok-queue' }));
	});

	it('retries on failure under maxAttempts', async () => {
		const handler = vi.fn(async () => {
			throw new Error('transient');
		});
		enqueue('retry-queue', {}, { maxAttempts: 3 });

		const worker = new QueueWorker('retry-queue', handler, {
			pollIntervalMs: 30,
			workerId: 'retry-worker'
		});
		worker.start();

		await vi.waitFor(
			() => {
				expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);
			},
			{ timeout: 3000, interval: 30 }
		);

		worker.stop();

		const job = db.select().from(queueJobs).where(eq(queueJobs.queue, 'retry-queue')).get();
		expect(job!.status).toBe('pending');
		expect(job!.lastError).toBe('transient');
		expect(job!.attempts).toBeGreaterThanOrEqual(1);
	});

	it('marks failed when maxAttempts exhausted', async () => {
		const handler = vi.fn(async () => {
			throw new Error('permanent');
		});
		enqueue('fail-queue', {}, { maxAttempts: 1 });

		const worker = new QueueWorker('fail-queue', handler, {
			pollIntervalMs: 30,
			workerId: 'fail-worker'
		});
		worker.start();

		await vi.waitFor(
			() => {
				const job = db.select().from(queueJobs).where(eq(queueJobs.queue, 'fail-queue')).get();
				expect(job?.status).toBe('failed');
			},
			{ timeout: 3000, interval: 30 }
		);

		worker.stop();
		expect(handler).toHaveBeenCalled();
		const job = db.select().from(queueJobs).where(eq(queueJobs.queue, 'fail-queue')).get();
		expect(job!.lastError).toBe('permanent');
	});
});

describe('recoverStaleJobs', () => {
	it('re-queues processing jobs locked longer than staleMinutes', () => {
		const id = enqueue('stale-q', { x: 1 });
		const oldLock = new Date(Date.now() - 20 * 60_000)
			.toISOString()
			.replace('T', ' ')
			.replace('Z', '');

		rawDb
			.prepare(
				`UPDATE queue_jobs SET status = 'processing', locked_at = ?, locked_by = ?, updated_at = ? WHERE id = ?`
			)
			.run(oldLock, 'dead-worker', nowIso(), id);

		recoverStaleJobs(10);

		const job = db.select().from(queueJobs).where(eq(queueJobs.id, id)).get();
		expect(job!.status).toBe('pending');
		expect(job!.lockedAt).toBeNull();
		expect(job!.lockedBy).toBeNull();
	});

	it('does not recover recently locked jobs', () => {
		const id = enqueue('fresh-q', {});
		const recent = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').replace('Z', '');

		rawDb
			.prepare(
				`UPDATE queue_jobs SET status = 'processing', locked_at = ?, locked_by = ? WHERE id = ?`
			)
			.run(recent, 'alive-worker', id);

		recoverStaleJobs(10);

		const job = db.select().from(queueJobs).where(eq(queueJobs.id, id)).get();
		expect(job!.status).toBe('processing');
		expect(job!.lockedBy).toBe('alive-worker');
	});
});
