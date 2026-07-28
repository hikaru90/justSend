import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db } from '../../../tests/helpers/db';
import { enqueue } from '../queue';
import { appSettings } from '../db/schema';
import {
	beatWorkerHeartbeat,
	getWorkerControl,
	getWorkerStatus,
	requestWorkerAction,
	WORKER_STALE_MS
} from './worker-status-service';

beforeEach(() => {
	resetDb();
});

describe('worker-status-service', () => {
	it('reports offline with no heartbeat', () => {
		const status = getWorkerStatus();
		expect(status.alive).toBe(false);
		expect(status.status).toBe('offline');
		expect(status.heartbeat).toBeNull();
		expect(status.totals).toEqual({ pending: 0, processing: 0, failed: 0 });
	});

	it('reports running after a fresh heartbeat', () => {
		beatWorkerHeartbeat(['eu-central-1-transaction']);
		const status = getWorkerStatus();
		expect(status.alive).toBe(true);
		expect(status.status).toBe('running');
		expect(status.heartbeat?.queues).toEqual(['eu-central-1-transaction']);
		expect(status.heartbeat?.pid).toBe(process.pid);
		expect(status.heartbeat?.state).toBe('running');
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

	it('treats stale heartbeat as offline', () => {
		beatWorkerHeartbeat(['q']);
		const stale = new Date(Date.now() - WORKER_STALE_MS - 5_000).toISOString();
		db.update(appSettings)
			.set({
				value: JSON.stringify({
					pid: 1,
					startedAt: stale,
					lastBeatAt: stale,
					queues: ['q'],
					state: 'running'
				})
			})
			.where(eq(appSettings.key, 'worker:heartbeat'))
			.run();

		expect(getWorkerStatus().alive).toBe(false);
		expect(getWorkerStatus().status).toBe('offline');
	});

	it('stores control actions for pause/stop/start/restart', () => {
		expect(getWorkerControl().desiredState).toBe('running');

		expect(requestWorkerAction('pause').desiredState).toBe('paused');
		beatWorkerHeartbeat(['q'], 'paused');
		expect(getWorkerStatus().status).toBe('paused');

		expect(requestWorkerAction('stop').desiredState).toBe('stopped');
		expect(getWorkerStatus().status).toBe('stopped');

		const before = getWorkerControl().restartNonce;
		const restarted = requestWorkerAction('restart');
		expect(restarted.desiredState).toBe('running');
		expect(restarted.restartNonce).toBe(before + 1);

		expect(requestWorkerAction('start').desiredState).toBe('running');
	});
});
