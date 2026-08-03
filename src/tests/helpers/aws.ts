import { vi } from 'vitest';

/**
 * Call vi.mock('$lib/server/aws/ses', ...) at the top of each test file that needs it.
 * These helpers install default mock implementations after the mock is set up.
 */
export function mockSesModule() {
	return {
		addDomain: vi.fn(async () => 'test-public-key'),
		deleteDomain: vi.fn(async () => undefined),
		getDomainIdentity: vi.fn(async () => ({
			VerificationStatus: 'SUCCESS',
			DkimAttributes: { Status: 'SUCCESS', Tokens: [] },
			MailFromAttributes: { MailFromDomainStatus: 'SUCCESS' },
		})),
		sendRawEmail: vi.fn(async () => ({ MessageId: 'ses-message-id-1' })),
		getAccount: vi.fn(async () => ({})),
		addWebhookConfiguration: vi.fn(async () => 'config-set-name'),
		deleteFromSesSuppressionList: vi.fn(async () => undefined),
		buildHeaders: vi.fn(() => ({})),
	};
}

export function mockSnsModule() {
	return {
		createTopic: vi.fn(async () => 'arn:aws:sns:us-east-1:123:topic'),
		deleteTopic: vi.fn(async () => undefined),
		subscribeHttp: vi.fn(async () => 'subscription-arn'),
		confirmSubscription: vi.fn(async () => undefined),
	};
}
