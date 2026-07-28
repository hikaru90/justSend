import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { createHmac, randomBytes } from 'node:crypto';
import { cuid, nowIso, parseJsonArray } from '$lib/utils';
import { db } from '../db';
import {
	domains,
	queueJobs,
	webhookCalls,
	webhooks,
	type WebhookCallStatus,
	type WebhookStatus
} from '../db/schema';
import { enqueue } from '../queue';
import { QUEUES } from '../queue/constants';
import {
	WEBHOOK_EVENT_VERSION,
	type WebhookEventType,
	type WebhookPayloadData
} from '../webhook-events';
import { checkWebhookLimit } from './limit-service';

const WEBHOOK_MAX_ATTEMPTS = 6;
const WEBHOOK_AUTO_DISABLE_THRESHOLD = 30;
const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
const WEBHOOK_RESPONSE_TEXT_LIMIT = 4_096;

type Webhook = typeof webhooks.$inferSelect;
type WebhookCall = typeof webhookCalls.$inferSelect;

function parseNumberArray(value: string | null | undefined): number[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : [];
	} catch {
		return [];
	}
}

function normalizeDomainIds(domainIds?: number[]): number[] {
	if (!domainIds) return [];
	return Array.from(new Set(domainIds));
}

function stringifyPayload(payload: unknown): string {
	if (typeof payload === 'string') {
		return payload;
	}
	try {
		return JSON.stringify(payload);
	} catch {
		return '{}';
	}
}

export function generateSecret(): string {
	return `whsec_${randomBytes(32).toString('hex')}`;
}

async function assertDomainsBelongToTeam(domainIds: number[], teamId: number) {
	const matching = db
		.select({ id: domains.id })
		.from(domains)
		.where(and(inArray(domains.id, domainIds), eq(domains.teamId, teamId)))
		.all();

	if (matching.length !== domainIds.length) {
		throw new Error('One or more domains were not found');
	}
}

/**
 * Create webhook call rows for every active webhook subscribed to `type` (and,
 * optionally, the provided domain), then enqueue them for dispatch.
 */
export async function emit<TType extends WebhookEventType>(
	teamId: number,
	type: TType,
	payload: WebhookPayloadData<TType>,
	options?: { domainId?: number | null }
): Promise<void> {
	const activeWebhooks = db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.teamId, teamId), eq(webhooks.status, 'ACTIVE')))
		.all();

	const domainId = options?.domainId ?? null;

	const matching = activeWebhooks.filter((webhook) => {
		const eventTypes = parseJsonArray(webhook.eventTypes);
		const eventMatches = eventTypes.length === 0 || eventTypes.includes(type);
		if (!eventMatches) return false;

		if (domainId == null) return true;

		const domainIds = parseNumberArray(webhook.domainIds);
		return domainIds.length === 0 || domainIds.includes(domainId);
	});

	if (matching.length === 0) {
		return;
	}

	const payloadString = stringifyPayload(payload);

	for (const webhook of matching) {
		const callId = cuid();
		db.insert(webhookCalls)
			.values({
				id: callId,
				webhookId: webhook.id,
				teamId: webhook.teamId,
				type,
				payload: payloadString,
				status: 'PENDING',
				attempt: 0
			})
			.run();

		enqueue(
			QUEUES.WEBHOOK_DISPATCH,
			{ callId, teamId: webhook.teamId },
			{ jobId: callId, maxAttempts: WEBHOOK_MAX_ATTEMPTS }
		);
	}
}

export function listWebhooks(teamId: number, domainId?: number): Webhook[] {
	const rows = db
		.select()
		.from(webhooks)
		.where(eq(webhooks.teamId, teamId))
		.orderBy(desc(webhooks.createdAt))
		.all();

	if (domainId === undefined) return rows;

	return rows.filter((webhook) => {
		const ids = parseNumberArray(webhook.domainIds);
		// Empty domainIds means "all domains" — include in every domain view.
		return ids.length === 0 || ids.includes(domainId);
	});
}

export function getWebhook(params: { id: string; teamId: number }): Webhook {
	const webhook = db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.id, params.id), eq(webhooks.teamId, params.teamId)))
		.get();

	if (!webhook) {
		throw new Error('Webhook not found');
	}

	return webhook;
}

export async function createWebhook(params: {
	teamId: number;
	userId: number;
	url: string;
	description?: string;
	eventTypes: string[];
	domainIds?: number[];
	secret?: string;
}): Promise<Webhook> {
	const { isLimitReached } = await checkWebhookLimit(params.teamId);
	if (isLimitReached) {
		throw new Error('Webhook limit reached');
	}

	const normalizedDomainIds = normalizeDomainIds(params.domainIds);
	if (normalizedDomainIds.length > 0) {
		await assertDomainsBelongToTeam(normalizedDomainIds, params.teamId);
	}

	const secret = params.secret ?? generateSecret();

	return db
		.insert(webhooks)
		.values({
			id: cuid(),
			teamId: params.teamId,
			domainIds: JSON.stringify(normalizedDomainIds),
			url: params.url,
			description: params.description ?? null,
			secret,
			eventTypes: JSON.stringify(params.eventTypes),
			status: 'ACTIVE',
			createdByUserId: params.userId
		})
		.returning()
		.get();
}

export async function updateWebhook(params: {
	id: string;
	teamId: number;
	url?: string;
	description?: string | null;
	eventTypes?: string[];
	domainIds?: number[];
	rotateSecret?: boolean;
	secret?: string;
}): Promise<Webhook> {
	const webhook = getWebhook({ id: params.id, teamId: params.teamId });

	const secret = params.rotateSecret === true ? generateSecret() : params.secret;

	const normalizedDomainIds =
		params.domainIds === undefined ? undefined : normalizeDomainIds(params.domainIds);

	if (normalizedDomainIds && normalizedDomainIds.length > 0) {
		await assertDomainsBelongToTeam(normalizedDomainIds, params.teamId);
	}

	return db
		.update(webhooks)
		.set({
			url: params.url ?? webhook.url,
			description:
				params.description === undefined ? webhook.description : (params.description ?? null),
			eventTypes:
				params.eventTypes === undefined ? webhook.eventTypes : JSON.stringify(params.eventTypes),
			domainIds:
				normalizedDomainIds === undefined
					? webhook.domainIds
					: JSON.stringify(normalizedDomainIds),
			secret: secret ?? webhook.secret,
			updatedAt: nowIso()
		})
		.where(eq(webhooks.id, webhook.id))
		.returning()
		.get();
}

export function setWebhookStatus(params: {
	id: string;
	teamId: number;
	status: WebhookStatus;
}): Webhook {
	const webhook = getWebhook({ id: params.id, teamId: params.teamId });

	return db
		.update(webhooks)
		.set({
			status: params.status,
			consecutiveFailures: params.status === 'ACTIVE' ? 0 : webhook.consecutiveFailures,
			updatedAt: nowIso()
		})
		.where(eq(webhooks.id, webhook.id))
		.returning()
		.get();
}

export function deleteWebhook(params: { id: string; teamId: number }): Webhook {
	const webhook = getWebhook({ id: params.id, teamId: params.teamId });
	db.delete(webhooks).where(eq(webhooks.id, webhook.id)).run();
	return webhook;
}

export async function retryCall(params: { callId: string; teamId: number }): Promise<string> {
	const call = db
		.select()
		.from(webhookCalls)
		.where(and(eq(webhookCalls.id, params.callId), eq(webhookCalls.teamId, params.teamId)))
		.get();

	if (!call) {
		throw new Error('Webhook call not found');
	}

	db.update(webhookCalls)
		.set({
			status: 'PENDING',
			attempt: 0,
			nextAttemptAt: null,
			lastError: null,
			responseStatus: null,
			responseTimeMs: null,
			responseText: null,
			updatedAt: nowIso()
		})
		.where(eq(webhookCalls.id, call.id))
		.run();

	// Remove any prior terminal queue job so the same jobId can be re-enqueued.
	db.delete(queueJobs)
		.where(and(eq(queueJobs.queue, QUEUES.WEBHOOK_DISPATCH), eq(queueJobs.jobId, call.id)))
		.run();

	enqueue(
		QUEUES.WEBHOOK_DISPATCH,
		{ callId: call.id, teamId: params.teamId },
		{ jobId: call.id, maxAttempts: WEBHOOK_MAX_ATTEMPTS }
	);

	return call.id;
}

export async function testWebhook(params: { webhookId: string; teamId: number }): Promise<string> {
	const webhook = getWebhook({ id: params.webhookId, teamId: params.teamId });

	const payload = {
		test: true,
		webhookId: webhook.id,
		sentAt: nowIso()
	};

	const callId = cuid();
	db.insert(webhookCalls)
		.values({
			id: callId,
			webhookId: webhook.id,
			teamId: webhook.teamId,
			type: 'webhook.test',
			payload: stringifyPayload(payload),
			status: 'PENDING',
			attempt: 0
		})
		.run();

	enqueue(
		QUEUES.WEBHOOK_DISPATCH,
		{ callId, teamId: webhook.teamId },
		{ jobId: callId, maxAttempts: WEBHOOK_MAX_ATTEMPTS }
	);

	return callId;
}

export function listWebhookCalls(params: {
	teamId: number;
	webhookId?: string;
	status?: WebhookCallStatus;
	limit: number;
	cursor?: string;
}): { items: WebhookCall[]; nextCursor: string | null } {
	const conditions = [eq(webhookCalls.teamId, params.teamId)];
	if (params.webhookId) {
		conditions.push(eq(webhookCalls.webhookId, params.webhookId));
	}
	if (params.status) {
		conditions.push(eq(webhookCalls.status, params.status));
	}
	if (params.cursor) {
		conditions.push(lt(webhookCalls.id, params.cursor));
	}

	const calls = db
		.select()
		.from(webhookCalls)
		.where(and(...conditions))
		.orderBy(desc(webhookCalls.createdAt))
		.limit(params.limit + 1)
		.all();

	let nextCursor: string | null = null;
	if (calls.length > params.limit) {
		const next = calls.pop();
		nextCursor = next?.id ?? null;
	}

	return { items: calls, nextCursor };
}

export function getWebhookCall(params: { id: string; teamId: number }): WebhookCall {
	const call = db
		.select()
		.from(webhookCalls)
		.where(and(eq(webhookCalls.id, params.id), eq(webhookCalls.teamId, params.teamId)))
		.get();

	if (!call) {
		throw new Error('Webhook call not found');
	}

	return call;
}

type WebhookDispatchPayload = {
	id: string;
	type: string;
	version: string | null;
	createdAt: string;
	teamId: number;
	data: unknown;
	attempt: number;
};

function buildDispatchPayload(
	call: WebhookCall,
	webhookApiVersion: string | null,
	attempt: number
): WebhookDispatchPayload {
	let parsed: unknown = call.payload;
	try {
		parsed = JSON.parse(call.payload);
	} catch {
		// keep string payload as-is
	}

	return {
		id: call.id,
		type: call.type,
		version: webhookApiVersion ?? WEBHOOK_EVENT_VERSION,
		createdAt: call.createdAt,
		teamId: call.teamId,
		data: parsed,
		attempt
	};
}

function signBody(secret: string, timestamp: string, body: string): string {
	const hmac = createHmac('sha256', secret);
	hmac.update(`${timestamp}.${body}`);
	return `v1=${hmac.digest('hex')}`;
}

class WebhookHttpError extends Error {
	constructor(
		message: string,
		public statusCode: number | null,
		public responseTimeMs: number | null,
		public responseText: string | null
	) {
		super(message);
		this.name = 'WebhookHttpError';
	}
}

async function postWebhook(params: {
	url: string;
	secret: string;
	type: string;
	callId: string;
	body: WebhookDispatchPayload;
}): Promise<{ responseStatus: number; responseTimeMs: number; responseText: string | null }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), WEBHOOK_REQUEST_TIMEOUT_MS);

	const stringBody = JSON.stringify(params.body);
	const timestamp = Date.now().toString();
	const signature = signBody(params.secret, timestamp, stringBody);

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'User-Agent': 'Owlery-Webhook/1.0',
		'X-Owlery-Event': params.type,
		'X-Owlery-Call': params.callId,
		'X-Owlery-Timestamp': timestamp,
		'X-Owlery-Signature': signature,
		'X-Owlery-Retry': params.body.attempt > 1 ? 'true' : 'false'
	};

	const start = Date.now();

	try {
		const response = await fetch(params.url, {
			method: 'POST',
			headers,
			body: stringBody,
			redirect: 'manual',
			signal: controller.signal
		});

		const responseTimeMs = Date.now() - start;
		const responseText = await captureResponseText(response);
		if (response.ok) {
			return { responseStatus: response.status, responseTimeMs, responseText };
		}

		throw new WebhookHttpError(
			`Non-2xx response: ${response.status}`,
			response.status,
			responseTimeMs,
			responseText
		);
	} catch (error) {
		const responseTimeMs = Date.now() - start;
		if (error instanceof WebhookHttpError) {
			throw error;
		}
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw new WebhookHttpError('Webhook request timed out', null, responseTimeMs, null);
		}
		throw new WebhookHttpError(
			error instanceof Error ? error.message : 'Unknown fetch error',
			null,
			responseTimeMs,
			null
		);
	} finally {
		clearTimeout(timeout);
	}
}

async function captureResponseText(response: Response): Promise<string | null> {
	const contentType = response.headers.get('content-type');
	const isText =
		contentType?.startsWith('text/') ||
		contentType?.includes('application/json') ||
		contentType?.includes('application/xml');

	if (!isText) {
		return null;
	}

	const text = await response.text();
	if (text.length > WEBHOOK_RESPONSE_TEXT_LIMIT) {
		return `${text.slice(0, WEBHOOK_RESPONSE_TEXT_LIMIT)}...<truncated>`;
	}
	return text;
}

/**
 * Queue handler for {@link QUEUES.WEBHOOK_DISPATCH}. Signs and POSTs the payload
 * to the webhook target, records the outcome, and rethrows on failure so the
 * queue can schedule a retry (unless the webhook has been auto-disabled).
 */
export async function processWebhookCall(
	payload: unknown,
	job: typeof queueJobs.$inferSelect
): Promise<void> {
	const { callId } = (payload ?? {}) as { callId?: string };
	if (!callId) {
		return;
	}

	const attempt = job.attempts;

	const call = db.select().from(webhookCalls).where(eq(webhookCalls.id, callId)).get();
	if (!call) {
		return;
	}

	const webhook = db.select().from(webhooks).where(eq(webhooks.id, call.webhookId)).get();
	if (!webhook) {
		return;
	}

	if (webhook.status !== 'ACTIVE') {
		db.update(webhookCalls)
			.set({ status: 'DISCARDED', attempt, updatedAt: nowIso() })
			.where(eq(webhookCalls.id, call.id))
			.run();
		return;
	}

	db.update(webhookCalls)
		.set({ status: 'IN_PROGRESS', attempt, updatedAt: nowIso() })
		.where(eq(webhookCalls.id, call.id))
		.run();

	try {
		const body = buildDispatchPayload(call, webhook.apiVersion, attempt);
		const { responseStatus, responseTimeMs, responseText } = await postWebhook({
			url: webhook.url,
			secret: webhook.secret,
			type: call.type,
			callId: call.id,
			body
		});

		db.update(webhookCalls)
			.set({
				status: 'DELIVERED',
				attempt,
				responseStatus,
				responseTimeMs,
				responseText,
				lastError: null,
				nextAttemptAt: null,
				updatedAt: nowIso()
			})
			.where(eq(webhookCalls.id, call.id))
			.run();

		db.update(webhooks)
			.set({ consecutiveFailures: 0, lastSuccessAt: nowIso(), updatedAt: nowIso() })
			.where(eq(webhooks.id, webhook.id))
			.run();
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown webhook error';
		const responseStatus = error instanceof WebhookHttpError ? error.statusCode : null;
		const responseTimeMs = error instanceof WebhookHttpError ? error.responseTimeMs : null;
		const responseText = error instanceof WebhookHttpError ? error.responseText : null;

		const isFinalAttempt = attempt >= WEBHOOK_MAX_ATTEMPTS;

		let autoDisabled = false;
		if (isFinalAttempt) {
			const consecutiveFailures = webhook.consecutiveFailures + 1;
			autoDisabled = consecutiveFailures >= WEBHOOK_AUTO_DISABLE_THRESHOLD;
			db.update(webhooks)
				.set({
					lastFailureAt: nowIso(),
					consecutiveFailures,
					status: autoDisabled ? 'AUTO_DISABLED' : webhook.status,
					updatedAt: nowIso()
				})
				.where(eq(webhooks.id, webhook.id))
				.run();
		} else {
			db.update(webhooks)
				.set({ lastFailureAt: nowIso(), updatedAt: nowIso() })
				.where(eq(webhooks.id, webhook.id))
				.run();
		}

		db.update(webhookCalls)
			.set({
				status: isFinalAttempt ? 'FAILED' : 'PENDING',
				attempt,
				lastError: errorMessage,
				responseStatus: responseStatus ?? null,
				responseTimeMs: responseTimeMs ?? null,
				responseText: responseText ?? null,
				updatedAt: nowIso()
			})
			.where(eq(webhookCalls.id, call.id))
			.run();

		// Auto-disabled webhooks should not keep retrying.
		if (autoDisabled) {
			return;
		}

		throw error;
	}
}
