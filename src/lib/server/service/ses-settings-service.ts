import { eq } from 'drizzle-orm';
import type { EventType } from '@aws-sdk/client-sesv2';
import { cuid } from '$lib/utils';
import { db } from '../db';
import { env } from '../env';
import { sesSettings } from '../db/schema';
import { smallId } from '../crypto';
import * as sns from '../aws/sns';
import * as ses from '../aws/ses';

export type SesSetting = typeof sesSettings.$inferSelect;

const GENERAL_EVENTS: EventType[] = [
	'BOUNCE',
	'COMPLAINT',
	'DELIVERY',
	'DELIVERY_DELAY',
	'REJECT',
	'RENDERING_FAILURE',
	'SEND',
	'SUBSCRIPTION'
];

const cache = new Map<string, SesSetting>();
let topicArns: string[] = [];
let initialized = false;

function refreshCache(): void {
	const settings = db.select().from(sesSettings).all();
	cache.clear();
	topicArns = [];
	for (const setting of settings) {
		cache.set(setting.region, setting);
		if (setting.topicArn) {
			topicArns.push(setting.topicArn);
		}
	}
}

function checkInitialized(): void {
	if (!initialized) {
		refreshCache();
		initialized = true;
	}
}

export function getSetting(region: string = env.AWS_DEFAULT_REGION): SesSetting | null {
	checkInitialized();
	return cache.get(region) ?? null;
}

export function getAllSettings(): SesSetting[] {
	checkInitialized();
	return Array.from(cache.values());
}

export function getTopicArns(): string[] {
	checkInitialized();
	return topicArns;
}

async function isValidUsesendUrl(url: string) {
	try {
		const response = await fetch(`${url}/api/ses_callback`, { method: 'GET' });
		return {
			isValid: response.status === 200,
			code: response.status,
			error: response.statusText
		};
	} catch (e) {
		return {
			isValid: false,
			code: 500,
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

/**
 * Creates the four SES configuration sets (general / click / open / full) for a
 * setting and persists their names + success flags.
 */
async function registerConfigurationSet(setting: SesSetting): Promise<SesSetting> {
	if (!setting.topicArn) {
		throw new Error('Setting does not have a topic ARN');
	}

	const configGeneral = `${setting.idPrefix}-${setting.region}-unsend-general`;
	const generalStatus = await ses.addWebhookConfiguration(
		configGeneral,
		setting.topicArn,
		GENERAL_EVENTS,
		setting.region
	);

	const configClick = `${setting.idPrefix}-${setting.region}-unsend-click`;
	const clickStatus = await ses.addWebhookConfiguration(
		configClick,
		setting.topicArn,
		[...GENERAL_EVENTS, 'CLICK'],
		setting.region
	);

	const configOpen = `${setting.idPrefix}-${setting.region}-unsend-open`;
	const openStatus = await ses.addWebhookConfiguration(
		configOpen,
		setting.topicArn,
		[...GENERAL_EVENTS, 'OPEN'],
		setting.region
	);

	const configFull = `${setting.idPrefix}-${setting.region}-unsend-full`;
	const fullStatus = await ses.addWebhookConfiguration(
		configFull,
		setting.topicArn,
		[...GENERAL_EVENTS, 'CLICK', 'OPEN'],
		setting.region
	);

	return db
		.update(sesSettings)
		.set({
			configGeneral,
			configGeneralSuccess: generalStatus,
			configClick,
			configClickSuccess: clickStatus,
			configOpen,
			configOpenSuccess: openStatus,
			configFull,
			configFullSuccess: fullStatus
		})
		.where(eq(sesSettings.id, setting.id))
		.returning()
		.get();
}

export async function createSesSetting({
	region,
	usesendUrl,
	sendingRateLimit,
	transactionalQuota
}: {
	region: string;
	usesendUrl: string;
	sendingRateLimit: number;
	transactionalQuota: number;
}): Promise<SesSetting> {
	checkInitialized();
	if (cache.has(region)) {
		throw new Error(`SesSetting for region ${region} already exists`);
	}

	const parsedUrl = usesendUrl.endsWith('/')
		? usesendUrl.substring(0, usesendUrl.length - 1)
		: usesendUrl;

	const validation = await isValidUsesendUrl(parsedUrl);
	if (!validation.isValid) {
		throw new Error(
			`Callback URL: ${usesendUrl} is not valid, status: ${validation.code} message: ${validation.error}`
		);
	}

	const idPrefix = smallId(10);
	let topicArn: string | undefined;
	let settingId: string | undefined;

	try {
		const topicName = `${idPrefix}-${region}-unsend`;
		topicArn = await sns.createTopic(topicName, region);
		if (!topicArn) {
			throw new Error('Failed to create SNS topic');
		}

		const setting = db
			.insert(sesSettings)
			.values({
				id: cuid(),
				region,
				callbackUrl: `${parsedUrl}/api/ses_callback`,
				topic: topicName,
				topicArn,
				sesEmailRateLimit: sendingRateLimit,
				transactionalQuota,
				idPrefix
			})
			.returning()
			.get();

		settingId = setting.id;
		refreshCache();

		await sns.subscribeHttp(topicArn, setting.callbackUrl, setting.region);

		const updated = await registerConfigurationSet(setting);
		refreshCache();

		return updated;
	} catch (error) {
		if (topicArn) {
			try {
				await sns.deleteTopic(topicArn, region);
			} catch (deleteError) {
				console.error('[ses-settings] Failed to delete SNS topic after error', deleteError);
			}
		}
		if (settingId) {
			db.delete(sesSettings).where(eq(sesSettings.id, settingId)).run();
		}
		refreshCache();
		throw error;
	}
}

export async function updateSesSetting({
	id,
	sendingRateLimit,
	transactionalQuota
}: {
	id: string;
	sendingRateLimit: number;
	transactionalQuota: number;
}): Promise<SesSetting> {
	checkInitialized();

	const setting = db
		.update(sesSettings)
		.set({
			transactionalQuota,
			sesEmailRateLimit: sendingRateLimit
		})
		.where(eq(sesSettings.id, id))
		.returning()
		.get();

	refreshCache();
	return setting;
}
