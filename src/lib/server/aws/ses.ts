import {
	CreateEmailIdentityCommand,
	DeleteEmailIdentityCommand,
	GetEmailIdentityCommand,
	PutEmailIdentityMailFromAttributesCommand,
	SendEmailCommand,
	CreateConfigurationSetCommand,
	CreateConfigurationSetEventDestinationCommand,
	GetAccountCommand,
	CreateTenantResourceAssociationCommand,
	DeleteTenantResourceAssociationCommand,
	DeleteSuppressedDestinationCommand,
	type EventType,
} from '@aws-sdk/client-sesv2';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { generateKeyPairSync } from 'node:crypto';
import nodemailer from 'nodemailer';
import { smallId } from '../crypto';
import { getSesClient, getStsClient } from './clients';

let accountId: string | undefined;

async function getAccountId(region: string) {
	if (accountId) {
		return accountId;
	}

	const stsClient = getStsClient(region);
	const response = await stsClient.send(new GetCallerIdentityCommand({}));
	accountId = response.Account;
	return accountId;
}

async function getIdentityArn(domain: string, region: string) {
	const account = await getAccountId(region);
	return `arn:aws:ses:${region}:${account}:identity/${domain}`;
}

function generateKeyPair() {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: {
			type: 'spki',
			format: 'pem',
		},
		privateKeyEncoding: {
			type: 'pkcs8',
			format: 'pem',
		},
	});

	const base64PrivateKey = privateKey
		.replace('-----BEGIN PRIVATE KEY-----', '')
		.replace('-----END PRIVATE KEY-----', '')
		.replace(/\n/g, '');

	const base64PublicKey = publicKey
		.replace('-----BEGIN PUBLIC KEY-----', '')
		.replace('-----END PUBLIC KEY-----', '')
		.replace(/\n/g, '');

	return { privateKey: base64PrivateKey, publicKey: base64PublicKey };
}

export async function addDomain(
	domain: string,
	region: string,
	sesTenantId?: string,
	dkimSelector = 'owlery',
): Promise<string> {
	const sesClient = getSesClient(region);

	const { privateKey, publicKey } = generateKeyPair();

	const response = await sesClient.send(
		new CreateEmailIdentityCommand({
			EmailIdentity: domain,
			DkimSigningAttributes: {
				DomainSigningSelector: dkimSelector,
				DomainSigningPrivateKey: privateKey,
			},
		}),
	);

	const emailIdentityResponse = await sesClient.send(
		new PutEmailIdentityMailFromAttributesCommand({
			EmailIdentity: domain,
			MailFromDomain: `mail.${domain}`,
		}),
	);

	if (sesTenantId) {
		const tenantResourceAssociationResponse = await sesClient.send(
			new CreateTenantResourceAssociationCommand({
				TenantName: sesTenantId,
				ResourceArn: await getIdentityArn(domain, region),
			}),
		);

		if (tenantResourceAssociationResponse.$metadata.httpStatusCode !== 200) {
			throw new Error('Failed to associate domain with tenant');
		}
	}

	if (
		response.$metadata.httpStatusCode !== 200 ||
		emailIdentityResponse.$metadata.httpStatusCode !== 200
	) {
		throw new Error('Failed to create domain identity');
	}

	return publicKey;
}

export async function deleteDomain(
	domain: string,
	region: string,
	sesTenantId?: string,
): Promise<boolean> {
	const sesClient = getSesClient(region);

	if (sesTenantId) {
		const tenantResourceAssociationResponse = await sesClient.send(
			new DeleteTenantResourceAssociationCommand({
				TenantName: sesTenantId,
				ResourceArn: await getIdentityArn(domain, region),
			}),
		);

		if (tenantResourceAssociationResponse.$metadata.httpStatusCode !== 200) {
			throw new Error('Failed to delete tenant resource association');
		}
	}

	const response = await sesClient.send(
		new DeleteEmailIdentityCommand({
			EmailIdentity: domain,
		}),
	);

	return response.$metadata.httpStatusCode === 200;
}

export async function getDomainIdentity(domain: string, region: string) {
	const sesClient = getSesClient(region);
	return sesClient.send(
		new GetEmailIdentityCommand({
			EmailIdentity: domain,
		}),
	);
}

const RESERVED_EMAIL_HEADERS = new Set([
	'authentication-results',
	'bcc',
	'cc',
	'content-disposition',
	'content-id',
	'content-length',
	'content-md5',
	'content-transfer-encoding',
	'content-type',
	'date',
	'delivered-to',
	'dkim-signature',
	'domainkey-signature',
	'envelope-to',
	'errors-to',
	'from',
	'message-id',
	'mime-version',
	'received',
	'received-spf',
	'reply-to',
	'return-path',
	'sender',
	'subject',
	'to',
	'x-envelope-to',
	'x-google-dkim-signature',
	'x-original-to',
	'x-received',
]);

const RESERVED_EMAIL_HEADER_PREFIXES = ['arc-', 'resent-', 'x-ses-', 'x-unsend-', 'x-owlery-'];

const HEADER_INJECTION_PATTERN = /[\r\n]/;

function sanitizeCustomHeaders(
	headers?: Record<string, string | null | undefined>,
): Record<string, string> | undefined {
	if (!headers) return undefined;

	const result: Record<string, string> = {};
	for (const [rawName, rawValue] of Object.entries(headers)) {
		if (typeof rawName !== 'string' || typeof rawValue !== 'string') continue;
		const name = rawName.trim();
		const normalizedName = name.toLowerCase();
		if (
			!name ||
			RESERVED_EMAIL_HEADERS.has(normalizedName) ||
			RESERVED_EMAIL_HEADER_PREFIXES.some((prefix) => normalizedName.startsWith(prefix))
		) {
			continue;
		}
		if (HEADER_INJECTION_PATTERN.test(name) || HEADER_INJECTION_PATTERN.test(rawValue)) {
			continue;
		}
		result[name] = rawValue;
	}

	return Object.keys(result).length > 0 ? result : undefined;
}

export function buildHeaders({
	emailId,
	headers,
	unsubUrl,
	isBulk,
	inReplyToMessageId,
}: {
	emailId?: string;
	headers?: Record<string, string>;
	unsubUrl?: string;
	isBulk?: boolean;
	inReplyToMessageId?: string;
}): Record<string, string> {
	const sanitizedHeaders = sanitizeCustomHeaders(headers);
	const sanitizedHeaderNames = new Set(
		Object.keys(sanitizedHeaders ?? {}).map((name) => name.toLowerCase()),
	);

	const defaultHeaders: Record<string, string> = {};

	if (!sanitizedHeaderNames.has('x-entity-ref-id')) {
		defaultHeaders['X-Entity-Ref-ID'] = smallId(21);
	}

	if (emailId) {
		defaultHeaders['X-Justsend-Email-ID'] = emailId;
	}

	if (unsubUrl) {
		if (!sanitizedHeaderNames.has('list-unsubscribe')) {
			defaultHeaders['List-Unsubscribe'] = `<${unsubUrl}>`;
		}
		if (!sanitizedHeaderNames.has('list-unsubscribe-post')) {
			defaultHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
		}
	}

	if (isBulk && !sanitizedHeaderNames.has('precedence')) {
		defaultHeaders['Precedence'] = 'bulk';
	}

	if (inReplyToMessageId) {
		const formattedMessageId = `<${inReplyToMessageId}@email.amazonses.com>`;
		if (!sanitizedHeaderNames.has('in-reply-to')) {
			defaultHeaders['In-Reply-To'] = formattedMessageId;
		}
		if (!sanitizedHeaderNames.has('references')) {
			defaultHeaders['References'] = formattedMessageId;
		}
	}

	return {
		...defaultHeaders,
		...(sanitizedHeaders ?? {}),
	};
}

export async function sendRawEmail({
	to,
	from,
	subject,
	replyTo,
	cc,
	bcc,
	text,
	html,
	attachments,
	region,
	configurationSetName,
	unsubUrl,
	isBulk,
	inReplyToMessageId,
	emailId,
	sesTenantId,
	headers,
}: {
	to?: string[];
	from?: string;
	subject?: string;
	replyTo?: string[];
	cc?: string[];
	bcc?: string[];
	text?: string;
	html?: string;
	attachments?: { filename: string; content: string }[];
	region: string;
	configurationSetName: string;
	unsubUrl?: string;
	isBulk?: boolean;
	inReplyToMessageId?: string;
	emailId?: string;
	sesTenantId?: string;
	headers?: Record<string, string>;
}): Promise<string | undefined> {
	const sesClient = getSesClient(region);

	const { message: messageStream } = await nodemailer
		.createTransport({ streamTransport: true })
		.sendMail({
			from,
			to,
			subject,
			html,
			attachments: attachments?.map((attachment) => ({
				filename: attachment.filename,
				content: attachment.content,
				encoding: 'base64',
			})),
			text,
			replyTo,
			cc,
			bcc,
			headers: buildHeaders({
				emailId,
				headers,
				unsubUrl,
				isBulk,
				inReplyToMessageId,
			}),
		});

	const chunks: Buffer[] = [];
	for await (const chunk of messageStream) {
		chunks.push(chunk as Buffer);
	}
	const finalMessageData = Buffer.concat(chunks);

	const command = new SendEmailCommand({
		Content: {
			Raw: {
				Data: finalMessageData,
			},
		},
		ConfigurationSetName: configurationSetName,
		TenantName: sesTenantId ? sesTenantId : undefined,
	});

	const response = await sesClient.send(command);
	return response.MessageId;
}

export async function getAccount(region: string) {
	const client = getSesClient(region);
	return client.send(new GetAccountCommand({}));
}

export async function addWebhookConfiguration(
	configName: string,
	topicArn: string,
	eventTypes: EventType[],
	region: string,
): Promise<boolean> {
	const sesClient = getSesClient(region);

	const configSetResponse = await sesClient.send(
		new CreateConfigurationSetCommand({
			ConfigurationSetName: configName,
		}),
	);

	if (configSetResponse.$metadata.httpStatusCode !== 200) {
		throw new Error('Failed to create configuration set');
	}

	const response = await sesClient.send(
		new CreateConfigurationSetEventDestinationCommand({
			ConfigurationSetName: configName,
			EventDestinationName: 'owlery_destination',
			EventDestination: {
				Enabled: true,
				MatchingEventTypes: eventTypes,
				SnsDestination: {
					TopicArn: topicArn,
				},
			},
		}),
	);

	return response.$metadata.httpStatusCode === 200;
}

/**
 * Remove email from AWS SES account-level suppression list.
 * Returns true if successful or email wasn't suppressed, false on error.
 */
export async function deleteFromSesSuppressionList(
	email: string,
	region: string,
): Promise<boolean> {
	const sesClient = getSesClient(region);
	try {
		await sesClient.send(
			new DeleteSuppressedDestinationCommand({
				EmailAddress: email,
			}),
		);
		return true;
	} catch (error) {
		if (error instanceof Error && error.name === 'NotFoundException') {
			return true;
		}
		console.error('[ses] Failed to remove email from SES suppression list', {
			email,
			region,
			error,
		});
		return false;
	}
}
