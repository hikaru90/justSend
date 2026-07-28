import { z } from 'zod';
import { config } from 'dotenv';

config();

const envSchema = z.object({
	DATABASE_URL: z.string().default('file:./data/owlery.db'),
	HOST_URL: z.string().url().default('http://localhost:5173'),
	AUTH_SECRET: z.string().min(16).default('dev-auth-secret-change-me'),
	ADMIN_EMAIL: z.string().email().optional(),
	FROM_EMAIL: z.string().email().optional(),
	GITHUB_ID: z.string().optional(),
	GITHUB_SECRET: z.string().optional(),
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	AWS_ACCESS_KEY_ID: z.string().optional(),
	AWS_SECRET_ACCESS_KEY: z.string().optional(),
	AWS_DEFAULT_REGION: z.string().default('us-east-1'),
	AWS_SES_ENDPOINT: z.string().optional(),
	AWS_SNS_ENDPOINT: z.string().optional(),
	API_RATE_LIMIT: z.coerce.number().default(10),
	AUTH_EMAIL_RATE_LIMIT: z.coerce.number().default(5),
	OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
	OPENROUTER_API_KEY: z.string().optional(),
	OPENROUTER_MODEL: z.string().default('anthropic/claude-3.5-sonnet'),
	DISCORD_WEBHOOK_URL: z.string().optional(),
	EMAIL_CLEANUP_DAYS: z.coerce.number().optional(),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
	const parsed = envSchema.safeParse(process.env);
	if (!parsed.success) {
		console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
		throw new Error('Invalid environment variables');
	}
	return parsed.data;
}

export const env = loadEnv();

export function isAdminEmail(email: string | null | undefined) {
	return Boolean(env.ADMIN_EMAIL && email && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());
}
