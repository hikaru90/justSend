import { eq, or } from 'drizzle-orm';
import { db } from '../db';
import { domains } from '../db/schema';
import { enqueue } from '../queue';
import { QUEUES } from '../queue/constants';
import { refreshDomainVerification } from './domain-service';

export type DomainVerificationPayload = {
	domainId?: number;
};

/**
 * Enqueue a domain verification refresh job.
 */
export function queueDomainVerification(domainId?: number): string {
	return enqueue(QUEUES.DOMAIN_VERIFICATION, { domainId } satisfies DomainVerificationPayload);
}

/**
 * Queue handler for {@link QUEUES.DOMAIN_VERIFICATION}. Refreshes SES
 * verification status for the targeted domain, or all domains still awaiting
 * verification.
 */
export async function processDomainVerification(payload: unknown): Promise<void> {
	const { domainId } = (payload ?? {}) as DomainVerificationPayload;

	if (domainId) {
		try {
			await refreshDomainVerification(domainId);
		} catch (error) {
			console.error('[domain-verification] Failed to refresh domain', { domainId, error });
		}
		return;
	}

	const pendingDomains = db
		.select({ id: domains.id })
		.from(domains)
		.where(or(eq(domains.isVerifying, true), eq(domains.status, 'PENDING')))
		.all();

	for (const domain of pendingDomains) {
		try {
			await refreshDomainVerification(domain.id);
		} catch (error) {
			console.error('[domain-verification] Failed to refresh domain', {
				domainId: domain.id,
				error
			});
		}
	}
}
