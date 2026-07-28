import 'dotenv/config';
import { migrate } from '../lib/server/db/migrate';
import { QueueWorker, recoverStaleJobs, enqueue } from '../lib/server/queue';
import { QUEUES, marketingQueueName, transactionalQueueName } from '../lib/server/queue/constants';
import { getAllSettings } from '../lib/server/service/ses-settings-service';
import { executeEmail } from '../lib/server/service/email-queue-service';
import { parseSesHook } from '../lib/server/service/ses-hook-parser';
import { processWebhookCall } from '../lib/server/service/webhook-service';
import { processCampaignBatch } from '../lib/server/service/campaign-service';
import { processContactBulkAdd } from '../lib/server/service/contact-service';
import { processFlowStep } from '../lib/server/service/flow-engine';
import { processDomainVerification, queueDomainVerification } from '../lib/server/service/domain-verification-job';
import {
	beatWorkerHeartbeat,
	getWorkerControl,
	resetWorkerStartedAt
} from '../lib/server/service/worker-status-service';

migrate();
recoverStaleJobs();
resetWorkerStartedAt();

const workers: QueueWorker[] = [];
const activeQueues: string[] = [];
let processingState: 'running' | 'paused' = 'running';
let seenRestartNonce = getWorkerControl().restartNonce;
let shuttingDown = false;

function start(queue: string, handler: ConstructorParameters<typeof QueueWorker>[1], concurrency = 1) {
	const worker = new QueueWorker(queue, handler, { concurrency, pollIntervalMs: 800 });
	worker.start();
	workers.push(worker);
	activeQueues.push(queue);
}

start(QUEUES.SES_WEBHOOK, async (payload) => {
	await parseSesHook(payload as never);
}, 5);

start(QUEUES.WEBHOOK_DISPATCH, processWebhookCall, 3);
start(QUEUES.CAMPAIGN_BATCH, processCampaignBatch, 1);
start(QUEUES.CONTACT_BULK_ADD, processContactBulkAdd, 1);
start(QUEUES.FLOW_STEP, processFlowStep, 1);
start(QUEUES.FLOW_WAIT, processFlowStep, 1);
start(QUEUES.DOMAIN_VERIFICATION, processDomainVerification, 1);

start(QUEUES.CAMPAIGN_SCHEDULER, async () => {
	const { db } = await import('../lib/server/db');
	const { campaigns } = await import('../lib/server/db/schema');
	const { and, eq, lte, or, isNull } = await import('drizzle-orm');
	const { nowIso } = await import('../lib/utils');
	const due = db
		.select()
		.from(campaigns)
		.where(
			and(
				eq(campaigns.status, 'SCHEDULED'),
				or(isNull(campaigns.scheduledAt), lte(campaigns.scheduledAt, nowIso()))
			)
		)
		.all();
	for (const c of due) {
		enqueue(QUEUES.CAMPAIGN_BATCH, { campaignId: c.id }, { jobId: `campaign-start-${c.id}` });
	}
}, 1);

// Region email queues from SES settings
for (const setting of getAllSettings()) {
	start(
		transactionalQueueName(setting.region),
		async (payload) => {
			await executeEmail(payload as never);
		},
		Math.max(1, Math.floor((setting.sesEmailRateLimit * setting.transactionalQuota) / 100))
	);
	start(
		marketingQueueName(setting.region),
		async (payload) => {
			await executeEmail(payload as never);
		},
		Math.max(1, Math.floor((setting.sesEmailRateLimit * (100 - setting.transactionalQuota)) / 100))
	);
}

enqueue(QUEUES.CAMPAIGN_SCHEDULER, {}, { jobId: 'campaign-scheduler-tick' });
enqueue(
	QUEUES.DOMAIN_VERIFICATION,
	{},
	{ jobId: 'domain-verification-tick', delayMs: 60_000 }
);

// Re-queue periodic jobs
setInterval(() => {
	if (processingState !== 'running') return;
	enqueue(QUEUES.CAMPAIGN_SCHEDULER, {}, { jobId: `campaign-scheduler-${Date.now()}` });
}, 60_000);

setInterval(() => {
	if (processingState !== 'running') return;
	queueDomainVerification();
	recoverStaleJobs();
}, 5 * 60_000);

function applyDesiredState(desired: 'running' | 'paused' | 'stopped') {
	if (desired === 'stopped') {
		console.log('[worker] stop requested — exiting');
		shutdown(0);
		return;
	}

	if (desired === 'paused') {
		if (processingState !== 'paused') {
			console.log('[worker] paused — not claiming new jobs');
			processingState = 'paused';
			for (const w of workers) w.pause();
		}
		return;
	}

	if (processingState !== 'running') {
		console.log('[worker] resumed — claiming jobs');
		processingState = 'running';
		for (const w of workers) w.resume();
	}
}

function pollControl() {
	if (shuttingDown) return;
	const control = getWorkerControl();
	if (control.restartNonce !== seenRestartNonce) {
		console.log('[worker] restart requested — exiting for supervisor relaunch');
		shutdown(0);
		return;
	}
	applyDesiredState(control.desiredState);
}

function tickHeartbeat() {
	beatWorkerHeartbeat(activeQueues, processingState);
}

applyDesiredState(getWorkerControl().desiredState);
tickHeartbeat();
setInterval(tickHeartbeat, 5_000);
setInterval(pollControl, 2_000);

console.log('[worker] Owlery worker running');

function shutdown(code = 0) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log('[worker] shutting down');
	for (const w of workers) w.stop();
	process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
