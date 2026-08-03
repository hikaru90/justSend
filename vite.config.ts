import adapter from '@sveltejs/adapter-node';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
			},
			adapter: adapter(),
		}),
	],
	build: {
		// gzip size reporting holds the whole bundle in memory; skip on small CI/Coolify builders
		reportCompressedSize: false,
		sourcemap: false,
	},
	ssr: {
		external: ['better-sqlite3'],
	},
	optimizeDeps: {
		exclude: ['better-sqlite3'],
	},
});
