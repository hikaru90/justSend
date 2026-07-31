#!/usr/bin/env node
/**
 * Export selected DB parts to a zip pack.
 *
 * Usage:
 *   pnpm db:export-parts --parts=templates,design --team=1 --out=pack.zip
 *   pnpm db:export-parts --parts=ses --out=ses.zip
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	exportDbParts,
	parsePartsList,
	partsNeedTeam
} from '../src/lib/server/service/db-parts-service.ts';

function parseArgs(argv: string[]) {
	const args: { parts: string | null; team: string | null; out: string | null; help: boolean } = {
		parts: null,
		team: null,
		out: null,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === '--help' || a === '-h') args.help = true;
		else if (a.startsWith('--parts=')) args.parts = a.slice('--parts='.length);
		else if (a === '--parts') args.parts = argv[++i] ?? null;
		else if (a.startsWith('--team=')) args.team = a.slice('--team='.length);
		else if (a === '--team') args.team = argv[++i] ?? null;
		else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
		else if (a === '--out' || a === '-o') args.out = argv[++i] ?? null;
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.parts || !args.out) {
	console.log(`Usage: pnpm db:export-parts --parts=templates,design --team=1 --out=pack.zip

Parts: ses, domains, templates, design
team is required for team-scoped parts (domains, templates, design).`);
	process.exit(args.help ? 0 : 1);
}

const parts = parsePartsList(args.parts);
if (parts.length === 0) {
	console.error('No valid parts in --parts');
	process.exit(1);
}

const teamId = args.team != null ? Number(args.team) : undefined;
if (partsNeedTeam(parts) && (!teamId || !Number.isInteger(teamId))) {
	console.error('--team is required for team-scoped parts');
	process.exit(1);
}

const zip = await exportDbParts({ parts, teamId });
const out = resolve(args.out);
writeFileSync(out, zip);
console.log(`Wrote ${out} (${zip.byteLength} bytes) parts=${parts.join(',')}`);
