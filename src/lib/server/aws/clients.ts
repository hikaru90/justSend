import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import { STSClient } from '@aws-sdk/client-sts';
import { env } from '../env';

type AwsCredentialOptions =
	{ credentials: { accessKeyId: string; secretAccessKey: string } } | Record<string, never>;

export function getAwsCredentialOptions(): AwsCredentialOptions {
	const hasKey = Boolean(env.AWS_ACCESS_KEY_ID);
	const hasSecret = Boolean(env.AWS_SECRET_ACCESS_KEY);

	if (hasKey !== hasSecret) {
		throw new Error(
			'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be set or both be omitted',
		);
	}

	if (hasKey) {
		return {
			credentials: {
				accessKeyId: env.AWS_ACCESS_KEY_ID!,
				secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
			},
		};
	}

	return {};
}

export function getSesClient(region: string = env.AWS_DEFAULT_REGION) {
	return new SESv2Client({
		region,
		endpoint: env.AWS_SES_ENDPOINT,
		...getAwsCredentialOptions(),
	});
}

export function getSnsClient(region: string = env.AWS_DEFAULT_REGION) {
	return new SNSClient({
		region,
		endpoint: env.AWS_SNS_ENDPOINT,
		...getAwsCredentialOptions(),
	});
}

export function getStsClient(region: string = env.AWS_DEFAULT_REGION) {
	return new STSClient({
		region,
		...getAwsCredentialOptions(),
	});
}
