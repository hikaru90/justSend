import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db } from '../../../tests/helpers/db';
import { enqueue } from '../queue';
import { appSettings } from '../db/schema';
import {
	beatWorkerHeartbeat,
	getWorkerStatus,
	WORKER_STALE_MS
} from './worker-status-service';

beforeEach(() => {
	resetDb();
});

describe('worker-status-service', () => {
	it('reports not running with no heartbeat', () => {
		const status = getWorkerStatus();
		expect(status.alive).toBe(false);
		expect(status.heartbeat).toBeNull();
		expect(status.totals).toEqual({ pending: 0, processing: 0, failed: 0 });
	});

	it('reports alive after a fresh heartbeat', () => {
		beatWorkerHeartbeat(['eu-central-1-transaction']);
		const status = getWorkerStatus();
		expect(status.alive).toBe(true);
		expect(status.heartbeat?.queues).toEqual(['eu-central-1-transaction']);
		expect(status.heartbeat?.pid).toBe(process.pid);
	});

	it('aggregates queue depths by status', () => {
		enqueue('eu-central-1-transaction', { emailId: 'a' });
		enqueue('eu-central-1-transaction', { emailId: 'b' });
		enqueue('ses-webhook', { x: 1 });
		beatWorkerHeartbeat(['eu-central-1-transaction']);

		const status = getWorkerStatus();
		expect(status.totals.pending).toBe(3);
		expect(status.queues.find((q) => q.queue === 'eu-central-1-transaction')?.pending).toBe(2);
		expect(status.queues.find((q) => q.queue === 'ses-webhook')?.pending).toBe(1);
	});

	it('treats stale heartbeat as not running', () => {
		beatWorkerHeartbeat(['q']);
		const stale = new Date(Date.now() - WORKER_STALE_MS - 5_000).toISOString();
		db.update(appSettings)
			.set({
				value: JSON.stringify({
					pid: 1,
					startedAt: stale,
					lastBeatAt: stale,
					queues: ['q']
				})
			})
			.where(eq(appSettings.key, 'worker:heartbeat'))
			.run();

		expect(getWorkerStatus().alive).toBe(false);
	});
});
