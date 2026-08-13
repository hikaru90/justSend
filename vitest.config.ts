import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		pool: 'forks',
		isolate: true,
		setupFiles: ['./src/tests/setup.ts'],
		include: ['src/**/*.test.ts', 'mcp/**/*.test.ts'],
		exclude: ['**/node_modules/**', '**/build/**'],
		env: {
			DATABASE_URL: ':memory:',
			AUTH_SECRET: 'test-auth-secret-change-me',
			NODE_ENV: 'test',
			HOST_URL: 'http://localhost:5173',
			AWS_DEFAULT_REGION: 'us-east-1',
			ADMIN_EMAIL: 'admin@example.com',
		},
		testTimeout: 15000,
	},
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib'),
		},
	},
});
