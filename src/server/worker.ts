import 'dotenv/config';
import { migrate } from '../lib/server/db/migrate';
import { QueueWorker, recoverStaleJobs } from '../lib/server/queue';
import { QUEUES, marketingQueueName, transactionalQueueName } from '../lib/server/queue/constants';
import { getAllSettings } from '../lib/server/service/ses-settings-service';
import { executeEmail } from '../lib/server/service/email-queue-service';
import { parseSesHook } from '../lib/server/service/ses-hook-parser';
import { processWebhookCall } from '../lib/server/service/webhook-service';
import { processCampaignBatch } from '../lib/server/service/campaign-service';
import { processContactBulkAdd } from '../lib/server/service/contact-service';
import { processDomainVerification, queueDomainVerification } from '../lib/server/service/domain-verification-job';
import { enqueue } from '../lib/server/queue';

migrate();
recoverStaleJobs();

const workers: QueueWorker[] = [];

function start(queue: string, handler: ConstructorParameters<typeof QueueWorker>[1], concurrency = 1) {
	const worker = new QueueWorker(queue, handler, { concurrency, pollIntervalMs: 800 });
	worker.start();
	workers.push(worker);
}

start(QUEUES.SES_WEBHOOK, async (payload) => {
	await parseSesHook(payload as never);
}, 5);

start(QUEUES.WEBHOOK_DISPATCH, processWebhookCall, 3);
start(QUEUES.CAMPAIGN_BATCH, processCampaignBatch, 1);
start(QUEUES.CONTACT_BULK_ADD, processContactBulkAdd, 1);
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
	enqueue(QUEUES.CAMPAIGN_SCHEDULER, {}, { jobId: `campaign-scheduler-${Date.now()}` });
}, 60_000);

setInterval(() => {
	queueDomainVerification();
	recoverStaleJobs();
}, 5 * 60_000);

console.log('[worker] useSend worker running');

function shutdown() {
	console.log('[worker] shutting down');
	for (const w of workers) w.stop();
	process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
