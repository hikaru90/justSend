<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';
	import type { ImportSummary } from '$lib/types/db-parts';

	let { data, form } = $props();

	let selectedParts = $state<string[]>([]);
	let teamId = $state('');
	let importFile = $state<FileList | null>(null);
	let importBusy = $state(false);
	let importError = $state<string | null>(null);
	let importSummary = $state<ImportSummary | null>(null);

	const defaultTeamId = $derived(data.teams.length === 1 ? String(data.teams[0]!.id) : '');
	const effectiveTeamId = $derived(teamId || defaultTeamId);

	const needsTeam = $derived(
		selectedParts.some((id) => data.dbParts.find((p) => p.id === id)?.scope === 'team'),
	);

	const partsQuery = $derived(selectedParts.join(','));

	function togglePart(id: string) {
		if (selectedParts.includes(id)) {
			selectedParts = selectedParts.filter((p) => p !== id);
		} else {
			selectedParts = [...selectedParts, id];
		}
	}

	async function runImport() {
		importError = null;
		importSummary = null;
		if (selectedParts.length === 0) {
			importError = 'Select at least one part';
			return;
		}
		if (needsTeam && !effectiveTeamId) {
			importError = 'Select a team';
			return;
		}
		const file = importFile?.[0];
		if (!file) {
			importError = 'Choose a parts zip file';
			return;
		}
		const labels = selectedParts
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
			body.set('parts', partsQuery);
			if (effectiveTeamId) body.set('teamId', effectiveTeamId);
			if (data.currentDomainId != null) body.set('domainId', String(data.currentDomainId));
			body.set('file', file);
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
</script>

<h1 class="mb-6 text-2xl font-semibold">SES settings</h1>

<Card title="Add region" class="mb-6">
	<form method="POST" action="?/create" use:enhance class="grid gap-3 sm:grid-cols-2">
		<Input name="region" placeholder="us-east-1" required />
		<Input name="owleryUrl" value={data.defaultUrl} required />
		<Input name="sendingRateLimit" type="number" value="1" />
		<Input name="transactionalQuota" type="number" value="50" />
		<Button type="submit" class="sm:col-span-2">Create SES setting</Button>
	</form>
	{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
</Card>

<div class="space-y-3">
	{#each data.settings as setting}
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

<Card title="Database parts" class="mt-6 mb-6">
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Export or import selected slices of the database. Unselected parts on the target are never
		touched. Use this to move templates and design system without overwriting SES or domains.
		Imported templates are attached to your currently selected domain
		{#if data.currentDomainId != null}
			(#{data.currentDomainId}).
		{:else}
			(select a domain in the header first).
		{/if}
	</p>

	<fieldset class="mb-4 space-y-2">
		<legend class="mb-1 text-sm font-medium">Parts</legend>
		{#each data.dbParts as part}
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={selectedParts.includes(part.id)}
					onchange={() => togglePart(part.id)}
				/>
				<span>{part.label}</span>
				<span class="text-xs text-[hsl(var(--muted-foreground))]">({part.scope})</span>
			</label>
		{/each}
	</fieldset>

	{#if needsTeam || data.teams.length > 0}
		<label class="mb-4 block text-sm">
			<span class="mb-1 block font-medium">Team</span>
			<select
				class="h-9 w-full max-w-sm rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm"
				bind:value={teamId}
			>
				{#if data.teams.length !== 1}
					<option value="">Select team…</option>
				{/if}
				{#each data.teams as team}
					<option value={String(team.id)}>{team.name} (#{team.id})</option>
				{/each}
			</select>
		</label>
	{/if}

	<div class="mb-4 flex flex-wrap gap-2">
		{#if selectedParts.length > 0 && (!needsTeam || effectiveTeamId)}
			<Button
				href={`/admin/database/parts/export?parts=${encodeURIComponent(partsQuery)}${effectiveTeamId ? `&teamId=${encodeURIComponent(effectiveTeamId)}` : ''}`}
			>
				Export selected
			</Button>
		{:else}
			<Button disabled>Export selected</Button>
		{/if}
	</div>

	<div class="border-t border-[hsl(var(--border))] pt-4">
		<p class="mb-2 text-sm font-medium">Import pack</p>
		<input
			type="file"
			accept=".zip,application/zip"
			class="mb-3 block w-full max-w-md text-sm"
			onchange={(e) => {
				importFile = (e.currentTarget as HTMLInputElement).files;
			}}
		/>
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
	</div>
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
