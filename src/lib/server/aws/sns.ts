import {
	CreateTopicCommand,
	DeleteTopicCommand,
	SubscribeCommand,
	ConfirmSubscriptionCommand,
} from '@aws-sdk/client-sns';
import { getSnsClient } from './clients';

export async function createTopic(topic: string, region: string): Promise<string | undefined> {
	const client = getSnsClient(region);
	const data = await client.send(new CreateTopicCommand({ Name: topic }));
	return data.TopicArn;
}

export async function deleteTopic(topicArn: string, region: string): Promise<void> {
	const client = getSnsClient(region);
	await client.send(new DeleteTopicCommand({ TopicArn: topicArn }));
}

export async function subscribeHttp(
	topicArn: string,
	endpointUrl: string,
	region: string,
): Promise<string | undefined> {
	const client = getSnsClient(region);
	const data = await client.send(
		new SubscribeCommand({
			Protocol: 'https',
			TopicArn: topicArn,
			Endpoint: endpointUrl,
		}),
	);
	return data.SubscriptionArn;
}

export async function confirmSubscription(
	topicArn: string,
	token: string,
	region: string,
): Promise<string | undefined> {
	const client = getSnsClient(region);
	const data = await client.send(
		new ConfirmSubscriptionCommand({
			TopicArn: topicArn,
			Token: token,
		}),
	);
	return data.SubscriptionArn;
}
