import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$lib/server/env';
import { getTopicArns } from '$lib/server/service/ses-settings-service';
import { queueSesHook, type SesEvent } from '$lib/server/service/ses-hook-parser';

export const GET: RequestHandler = async () => {
	return json({ data: 'Hello' });
};

export const POST: RequestHandler = async ({ request }) => {
	const text = await request.text();
	let message: Record<string, unknown>;
	try {
		message = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	// SNS wraps the message; sometimes the body is already the notification
	const type = String(message.Type ?? message.type ?? '');
	const topicArn = String(message.TopicArn ?? '');

	if (type === 'SubscriptionConfirmation') {
		const subscribeUrl = String(message.SubscribeURL ?? '');
		if (subscribeUrl) {
			await fetch(subscribeUrl);
		}
		return json({ ok: true });
	}

	if (env.NODE_ENV === 'production') {
		const allowed = getTopicArns();
		if (allowed.length && topicArn && !allowed.includes(topicArn)) {
			return json({ error: 'Invalid topic' }, { status: 403 });
		}
	}

	let event: SesEvent;
	if (type === 'Notification' && typeof message.Message === 'string') {
		event = JSON.parse(message.Message) as SesEvent;
	} else if (message.eventType) {
		event = message as unknown as SesEvent;
	} else {
		return json({ error: 'Unrecognized SNS payload' }, { status: 400 });
	}

	queueSesHook(event);
	return json({ ok: true });
};
