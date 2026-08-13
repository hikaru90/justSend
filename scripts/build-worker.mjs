import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'build/worker.js');

mkdirSync(dirname(outfile), { recursive: true });

await build({
	entryPoints: [resolve(root, 'src/server/worker.ts')],
	outfile,
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	packages: 'external',
	alias: {
		$lib: resolve(root, 'src/lib'),
	},
	logLevel: 'info',
});

console.log(`[build-worker] wrote ${outfile}`);
