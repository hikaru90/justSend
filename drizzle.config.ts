import type { Config } from 'drizzle-kit';

export default {
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: {
		url: process.env.DATABASE_URL?.replace(/^file:/, '') ?? './data/usesend.db'
	}
} satisfies Config;
