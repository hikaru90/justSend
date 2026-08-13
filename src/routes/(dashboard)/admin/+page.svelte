<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';
	import type { ImportSummary } from '$lib/types/db-parts';

	let { data, form } = $props();

	let exportParts = $state<string[]>([]);
	let importParts = $state<string[]>([]);
	let exportTeamId = $state('');
	let importTeamId = $state('');
	let importFile = $state<File | null>(null);

	$effect.pre(() => {
		const teamId = typeof data.currentTeamId === 'number' ? String(data.currentTeamId) : '';
		exportTeamId = teamId;
		importTeamId = teamId;
	});
	let importFileName = $state('');
	let importBusy = $state(false);
	let importError = $state<string | null>(null);
	let importSummary = $state<ImportSummary | null>(null);

	const exportNeedsTeam = $derived(
		exportParts.some((id) => data.dbParts.find((p) => p.id === id)?.scope === 'team'),
	);
	const importNeedsTeam = $derived(
		importParts.some((id) => data.dbParts.find((p) => p.id === id)?.scope === 'team'),
	);

	const exportPartsQuery = $derived(exportParts.join(','));
	const importPartsQuery = $derived(importParts.join(','));

	function togglePart(list: 'export' | 'import', id: string) {
		if (list === 'export') {
			exportParts = exportParts.includes(id)
				? exportParts.filter((p) => p !== id)
				: [...exportParts, id];
		} else {
			importParts = importParts.includes(id)
				? importParts.filter((p) => p !== id)
				: [...importParts, id];
		}
	}

	async function runImport() {
		importError = null;
		importSummary = null;
		if (importParts.length === 0) {
			importError = 'Select at least one part';
			return;
		}
		if (importNeedsTeam && !importTeamId) {
			importError = 'Select a team';
			return;
		}
		if (!importFile) {
			importError = 'Choose a parts zip file';
			return;
		}
		const labels = importParts
			.map((id) => data.dbParts.find((p) => p.id === id)?.label ?? id)
			.join(', ');
		if (
			!confirm(
				`Replace these parts on this instance?\n\n${labels}\n\nOnly the selected parts are written. Everything else (including SES/domains if not selected) stays unchanged.`,
			)
		) {
			return;
		}

		importBusy = true;
		try {
			const body = new FormData();
			body.set('parts', importPartsQuery);
			if (importTeamId) body.set('teamId', importTeamId);
			if (data.currentDomainId != null) body.set('domainId', String(data.currentDomainId));
			body.set('file', importFile);
			const res = await fetch('/admin/database/parts/import', { method: 'POST', body });
			const text = await res.text();
			let payload: ImportSummary & { message?: string };
			try {
				payload = JSON.parse(text) as ImportSummary & { message?: string };
			} catch {
				throw new Error(text || res.statusText);
			}
			if (!res.ok) throw new Error(payload.message ?? (text || res.statusText));
			importSummary = payload;
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import failed';
		} finally {
			importBusy = false;
		}
	}

	function onFileChange(e: Event) {
		const files = (e.currentTarget as HTMLInputElement).files;
		importFile = files?.[0] ?? null;
		importFileName = importFile?.name ?? '';
	}
</script>

<h1 class="mb-6 text-2xl font-semibold">Settings</h1>

<Card title="Add SES region" class="mb-6">
	<form
		method="POST"
		action="?/create"
		use:enhance={() => {
			return async ({ update }) => {
				await update({ reset: false });
			};
		}}
		class="grid gap-3 sm:grid-cols-2"
	>
		<Input name="region" placeholder="us-east-1" required />
		<Input name="owleryUrl" value={data.defaultUrl} required />
		<Input name="sendingRateLimit" type="number" value="1" />
		<Input name="transactionalQuota" type="number" value="50" />
		<Button type="submit" class="sm:col-span-2">Create SES setting</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<div class="space-y-3">
	{#each data.settings as setting (setting.region)}
		<Card title={setting.region}>
			<dl class="grid gap-2 text-sm sm:grid-cols-2">
				<div>
					<dt class="text-[hsl(var(--muted-foreground))]">Callback</dt>
					<dd class="truncate">{setting.callbackUrl}</dd>
				</div>
				<div>
					<dt class="text-[hsl(var(--muted-foreground))]">Topic ARN</dt>
					<dd class="truncate font-mono text-xs">{setting.topicArn}</dd>
				</div>
				<div>
					<dt class="text-[hsl(var(--muted-foreground))]">Config sets</dt>
					<dd class="flex flex-wrap gap-1">
						<Badge variant={setting.configGeneralSuccess ? 'success' : 'secondary'}>General</Badge>
						<Badge variant={setting.configClickSuccess ? 'success' : 'secondary'}>Click</Badge>
						<Badge variant={setting.configOpenSuccess ? 'success' : 'secondary'}>Open</Badge>
						<Badge variant={setting.configFullSuccess ? 'success' : 'secondary'}>Full</Badge>
					</dd>
				</div>
			</dl>
		</Card>
	{/each}
</div>

<Card title="Export database parts" class="mt-6 mb-6">
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Download selected slices of the database. Use this to move templates and design system without
		overwriting SES or domains.
	</p>

	<fieldset class="mb-4 space-y-2">
		<legend class="mb-1 text-sm font-medium">Parts to export</legend>
		{#each data.dbParts as part (part.id)}
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={exportParts.includes(part.id)}
					onchange={() => togglePart('export', part.id)}
				/>
				<span>{part.label}</span>
				<span class="text-xs text-[hsl(var(--muted-foreground))]">({part.scope})</span>
			</label>
		{/each}
	</fieldset>

	{#if data.teams.length > 0}
		<label class="mb-4 block text-sm">
			<span class="mb-1 block font-medium">Team</span>
			<select
				class="h-9 w-full max-w-sm rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm"
				bind:value={exportTeamId}
			>
				{#if !exportTeamId}
					<option value="">Select team…</option>
				{/if}
				{#each data.teams as team (team.id)}
					<option value={String(team.id)}>{team.name} (#{team.id})</option>
				{/each}
			</select>
		</label>
	{/if}

	{#if exportParts.length > 0 && (!exportNeedsTeam || exportTeamId)}
		<Button
			href={`/admin/database/parts/export?parts=${encodeURIComponent(exportPartsQuery)}${exportTeamId ? `&teamId=${encodeURIComponent(exportTeamId)}` : ''}`}
		>
			Export selected
		</Button>
	{:else}
		<Button disabled>Export selected</Button>
	{/if}
</Card>

<Card title="Import database parts" class="mb-6">
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Import a previously exported parts zip. Only the parts you select below are written. Imported
		templates are attached to your currently selected domain
		{#if data.currentDomainId != null}
			(#{data.currentDomainId}).
		{:else}
			(select a domain in the header first).
		{/if}
	</p>

	<fieldset class="mb-4 space-y-2">
		<legend class="mb-1 text-sm font-medium">Parts to import</legend>
		{#each data.dbParts as part (part.id)}
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={importParts.includes(part.id)}
					onchange={() => togglePart('import', part.id)}
				/>
				<span>{part.label}</span>
				<span class="text-xs text-[hsl(var(--muted-foreground))]">({part.scope})</span>
			</label>
		{/each}
	</fieldset>

	{#if data.teams.length > 0}
		<label class="mb-4 block text-sm">
			<span class="mb-1 block font-medium">Team</span>
			<select
				class="h-9 w-full max-w-sm rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm"
				bind:value={importTeamId}
			>
				{#if !importTeamId}
					<option value="">Select team…</option>
				{/if}
				{#each data.teams as team (team.id)}
					<option value={String(team.id)}>{team.name} (#{team.id})</option>
				{/each}
			</select>
		</label>
	{/if}

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<label class="inline-flex cursor-pointer">
			<span
				class="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[hsl(var(--border))] bg-transparent px-4 text-sm font-medium hover:bg-[hsl(var(--accent))]"
			>
				Choose file
			</span>
			<input type="file" accept=".zip,application/zip" class="sr-only" onchange={onFileChange} />
		</label>
		<span class="text-sm text-[hsl(var(--muted-foreground))]">
			{importFileName || 'No file selected'}
		</span>
	</div>

	<Button type="button" variant="outline" disabled={importBusy} onclick={runImport}>
		{importBusy ? 'Importing…' : 'Import selected parts'}
	</Button>
	{#if importError}
		<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{importError}</p>
	{/if}
	{#if importSummary}
		<pre
			class="mt-3 max-h-48 overflow-auto rounded-md bg-[hsl(var(--muted))] p-3 text-xs">{JSON.stringify(
				importSummary,
				null,
				2,
			)}</pre>
	{/if}
</Card>

<Card title="Full database snapshot" class="mb-6">
	<p class="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
		Download a consistent SQLite snapshot for local development. Stop the local app before replacing
		your <code class="text-xs">./data/*.db</code> file.
	</p>
	<Button href="/admin/database/download" variant="outline">Download full database</Button>
</Card>

<p class="mt-4 text-sm">
	<a href="/admin/teams" class="underline">Manage teams →</a>
</p>
