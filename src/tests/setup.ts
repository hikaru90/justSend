import { migrate } from '../lib/server/db/migrate';

// Env is set via vitest.config.ts `test.env` before this file loads.
// Suppress migrate console noise in test output.
const log = console.log;
console.log = (...args: unknown[]) => {
	if (typeof args[0] === 'string' && args[0].includes('Database migrated')) return;
	log(...args);
};

migrate();

console.log = log;
