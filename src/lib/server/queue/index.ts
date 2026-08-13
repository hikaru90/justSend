import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { cuid, nowIso } from '$lib/utils';
import { db, rawDb } from '../db';
import { queueJobs, type QueueJobStatus } from '../db/schema';

export type JobHandler = (payload: unknown, job: typeof queueJobs.$inferSelect) => Promise<void>;

export type EnqueueOptions = {
	jobId?: string;
	delayMs?: number;
	maxAttempts?: number;
	runAt?: Date | string;
};

function toSqliteDate(date: Date) {
	return date.toISOString().replace('T', ' ').replace('Z', '');
}

export function enqueue(queue: string, payload: unknown, options: EnqueueOptions = {}) {
	const id = cuid();
	const runAt =
		options.runAt instanceof Date
			? toSqliteDate(options.runAt)
			: typeof options.runAt === 'string'
				? options.runAt
				: options.delayMs
					? toSqliteDate(new Date(Date.now() + options.delayMs))
					: nowIso().replace('T', ' ').replace('Z', '');

	try {
		db.insert(queueJobs)
			.values({
				id,
				queue,
				jobId: options.jobId ?? null,
				payload: JSON.stringify(payload ?? {}),
				status: 'pending',
				maxAttempts: options.maxAttempts ?? 5,
				runAt,
				createdAt: nowIso(),
				updatedAt: nowIso(),
			})
			.run();
		console.log('[mail][enqueue] inserted queue_jobs row', {
			queue,
			jobId: options.jobId ?? null,
			id,
			runAt,
		});
		return id;
	} catch (error) {
		// Unique (queue, jobId) — treat as idempotent success
		if (options.jobId && String(error).includes('UNIQUE')) {
			console.log('[mail][enqueue] !!! UNIQUE collision — swallowing as idempotent (no new row)', {
				queue,
				jobId: options.jobId,
			});
			return options.jobId;
		}
		console.error('[mail][enqueue] insert THREW', { queue, jobId: options.jobId ?? null, error });
		throw error;
	}
}

function backoffSeconds(attempt: number) {
	return Math.min(60 * 30, Math.pow(2, attempt) * 5);
}

export class QueueWorker {
	private running = false;
	private paused = false;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly queue: string,
		private readonly handler: JobHandler,
		private readonly opts: {
			concurrency?: number;
			pollIntervalMs?: number;
			workerId?: string;
		} = {},
	) {}

	start() {
		if (this.running) return;
		this.running = true;
		this.paused = false;
		void this.loop();
		console.log(`[queue] worker started: ${this.queue}`);
	}

	pause() {
		this.paused = true;
	}

	resume() {
		this.paused = false;
	}

	stop() {
		this.running = false;
		this.paused = false;
		if (this.timer) clearTimeout(this.timer);
	}

	private async loop() {
		while (this.running) {
			try {
				if (this.paused) {
					await this.sleep(this.opts.pollIntervalMs ?? 1000);
					continue;
				}
				const concurrency = this.opts.concurrency ?? 1;
				const jobs: (typeof queueJobs.$inferSelect)[] = [];
				for (let i = 0; i < concurrency; i++) {
					const job = this.claim();
					if (!job) break;
					jobs.push(job);
				}
				if (jobs.length === 0) {
					await this.sleep(this.opts.pollIntervalMs ?? 1000);
					continue;
				}
				await Promise.all(jobs.map((job) => this.process(job)));
			} catch (error) {
				console.error(`[queue] ${this.queue} loop error`, error);
				await this.sleep(2000);
			}
		}
	}

	private claim() {
		const workerId = this.opts.workerId ?? `worker-${process.pid}`;
		const now = toSqliteDate(new Date());
		const tx = rawDb.transaction(() => {
			const row = rawDb
				.prepare(
					`SELECT * FROM queue_jobs
           WHERE queue = ? AND status = 'pending' AND run_at <= ?
           ORDER BY run_at ASC
           LIMIT 1`,
				)
				.get(this.queue, now) as Record<string, unknown> | undefined;
			if (!row) return null;
			const result = rawDb
				.prepare(
					`UPDATE queue_jobs
           SET status = 'processing', locked_at = ?, locked_by = ?, attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
				)
				.run(now, workerId, nowIso(), row.id);
			if (result.changes === 0) return null;
			const claimed =
				db
					.select()
					.from(queueJobs)
					.where(eq(queueJobs.id, String(row.id)))
					.get() ?? null;
			if (claimed) {
				console.log('[mail][worker] claimed job', {
					queue: this.queue,
					jobId: claimed.id,
					emailJobId: claimed.jobId,
					attempts: claimed.attempts,
				});
			}
			return claimed;
		});
		return tx();
	}

	private async process(job: typeof queueJobs.$inferSelect) {
		console.log('[mail][worker] process START', {
			queue: this.queue,
			jobId: job.id,
			emailJobId: job.jobId,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
		});
		try {
			const payload = JSON.parse(job.payload || '{}');
			await this.handler(payload, job);
			db.update(queueJobs)
				.set({
					status: 'completed' satisfies QueueJobStatus,
					lockedAt: null,
					lockedBy: null,
					updatedAt: nowIso(),
				})
				.where(eq(queueJobs.id, job.id))
				.run();
			console.log('[mail][worker] job COMPLETED', { queue: this.queue, jobId: job.id });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const attempts = job.attempts;
			if (attempts >= job.maxAttempts) {
				db.update(queueJobs)
					.set({
						status: 'failed',
						lastError: message,
						lockedAt: null,
						lockedBy: null,
						updatedAt: nowIso(),
					})
					.where(eq(queueJobs.id, job.id))
					.run();
				console.error(`[mail][worker] job FAILED permanently`, {
					queue: this.queue,
					jobId: job.id,
					message,
				});
			} else {
				const delay = backoffSeconds(attempts);
				const runAt = toSqliteDate(new Date(Date.now() + delay * 1000));
				db.update(queueJobs)
					.set({
						status: 'pending',
						lastError: message,
						runAt,
						lockedAt: null,
						lockedBy: null,
						updatedAt: nowIso(),
					})
					.where(eq(queueJobs.id, job.id))
					.run();
				console.log('[mail][worker] job RETRYING', {
					queue: this.queue,
					jobId: job.id,
					attempts,
					nextRunAt: runAt,
					message,
				});
			}
		}
	}

	private sleep(ms: number) {
		return new Promise((resolve) => {
			this.timer = setTimeout(resolve, ms);
		});
	}
}

export function recoverStaleJobs(staleMinutes = 10) {
	const cutoff = toSqliteDate(new Date(Date.now() - staleMinutes * 60_000));
	rawDb
		.prepare(
			`UPDATE queue_jobs
       SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = ?
       WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < ?`,
		)
		.run(nowIso(), cutoff);
}
