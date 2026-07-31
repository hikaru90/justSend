#!/usr/bin/env node
/**
 * Import selected DB parts from a zip pack.
 *
 * Usage:
 *   pnpm db:import-parts --parts=templates,design --team=1 --file=pack.zip
 *   pnpm db:import-parts --parts=ses --file=ses.zip
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	importDbParts,
	parsePartsList,
	partsNeedTeam
} from '../src/lib/server/service/db-parts-service.ts';

function parseArgs(argv: string[]) {
	const args: { parts: string | null; team: string | null; file: string | null; help: boolean } = {
		parts: null,
		team: null,
		file: null,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a === '--help' || a === '-h') args.help = true;
		else if (a.startsWith('--parts=')) args.parts = a.slice('--parts='.length);
		else if (a === '--parts') args.parts = argv[++i] ?? null;
		else if (a.startsWith('--team=')) args.team = a.slice('--team='.length);
		else if (a === '--team') args.team = argv[++i] ?? null;
		else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
		else if (a === '--file' || a === '-f') args.file = argv[++i] ?? null;
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.parts || !args.file) {
	console.log(`Usage: pnpm db:import-parts --parts=templates,design --team=1 --file=pack.zip

Only the listed parts present in the pack are written; everything else is left alone.`);
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

const zipBytes = readFileSync(resolve(args.file));
const summary = await importDbParts({ parts, teamId, zipBytes });
console.log(JSON.stringify(summary, null, 2));
