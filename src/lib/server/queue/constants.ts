export const QUEUES = {
	SES_WEBHOOK: 'ses-webhook',
	CAMPAIGN_MAIL_PROCESSING: 'campaign-emails-processing',
	CONTACT_BULK_ADD: 'contact-bulk-add',
	CAMPAIGN_BATCH: 'campaign-batch',
	CAMPAIGN_SCHEDULER: 'campaign-scheduler',
	DOMAIN_VERIFICATION: 'domain-verification',
	WEBHOOK_DISPATCH: 'webhook-dispatch',
	WEBHOOK_CLEANUP: 'webhook-cleanup',
	FLOW_STEP: 'flow-step',
	FLOW_WAIT: 'flow-wait',
} as const;

export function transactionalQueueName(region: string) {
	return `${region}-transaction`;
}

export function marketingQueueName(region: string) {
	return `${region}-marketing`;
}
