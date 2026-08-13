<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import OwlStudio from '$lib/components/studio/OwlStudio.svelte';
	import { ChevronDown } from '@lucide/svelte';
	import { deserialize } from '$app/forms';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { substitutePreviewPlaceholders } from '$lib/design/extractTokens';
	import { serializeOwlDoc, type OwlDoc } from '$lib/email/owl/studio';

	function summaryPart(label: string, value: string): string {
		return `${label}: ${value.trim() || '—'}`;
	}

	let { data, form } = $props();

	let studio = $state<OwlStudio | null>(null);
	let previewTo = $state('');
	let sending = $state(false);
	let saving = $state(false);
	let deletePending = $state(false);
	let saveMessage = $state<string | null>(null);
	let templateName = $state('');
	let testEmail = $state('alex@example.com');
	let testFirstName = $state('Alex');
	let testLastName = $state('River');
	let subject = $state('');
	let templatePrompt = $state('');
	let preheader = $state('');

	$effect.pre(() => {
		previewTo = data.userEmail ?? '';
		templateName = data.template.name;
		subject = data.template.subject;
		templatePrompt = data.template.prompt ?? '';
		preheader = data.owlDoc?.preheader ?? '';
		testEmail = data.studioSnapshot.testVariables?.email ?? 'alex@example.com';
		testFirstName = data.studioSnapshot.testVariables?.firstName ?? 'Alex';
		testLastName = data.studioSnapshot.testVariables?.lastName ?? 'River';
	});

	const testVariables = $derived({
		email: testEmail,
		firstName: testFirstName,
		lastName: testLastName,
	});

	const subjectPreview = $derived(substitutePreviewPlaceholders(subject ?? '', testVariables));

	const owlDoc = $derived((data.owlDoc as OwlDoc | null) ?? null);

	const detailsSummary = $derived(
		[
			summaryPart('Name', templateName),
			summaryPart('Subject', subject),
			summaryPart('Desc', templatePrompt),
			summaryPart('Preheader', preheader),
			summaryPart('email', testEmail),
			summaryPart('firstName', testFirstName),
			summaryPart('lastName', testLastName),
		].join(' · '),
	);

	async function saveTemplate() {
		if (!studio) return;
		saving = true;
		saveMessage = null;
		try {
			const body = new FormData();
			body.append('name', templateName.trim());
			body.append('subject', subject.trim());
			body.append('prompt', templatePrompt.trim());
			body.append('doc', serializeOwlDoc(studio.getCurrentDoc()));
			body.append('email', testEmail.trim());
			body.append('firstName', testFirstName.trim());
			body.append('lastName', testLastName.trim());
			const res = await fetch('?/saveTemplate', {
				method: 'POST',
				body,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
			});
			const result = deserialize(await res.text());
			if (result.type !== 'success') {
				saveMessage =
					result.type === 'failure' && typeof result.data?.error === 'string'
						? result.data.error
						: 'Save failed';
				return;
			}
			const errorCount =
				result.data && typeof result.data === 'object' && 'errorCount' in result.data
					? Number((result.data as { errorCount?: number }).errorCount)
					: 0;
			saveMessage = errorCount
				? `Saved — ${errorCount} compile error${errorCount === 1 ? '' : 's'} to review`
				: 'Saved';
			await invalidateAll();
		} catch {
			saveMessage = 'Save failed';
		} finally {
			saving = false;
		}
	}
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<div>
		<a
			href={resolve('/templates')}
			class="text-sm text-[hsl(var(--muted-foreground))] hover:underline">← Templates</a
		>
		<h1 class="mt-1 text-2xl font-semibold">Edit template</h1>
	</div>
	<div class="flex flex-wrap items-center gap-2">
		{#if deletePending}
			<form method="POST" action="?/delete" use:enhance class="flex flex-wrap items-center gap-2">
				<span class="text-xs text-[hsl(var(--muted-foreground))]">Delete this template?</span>
				<Button type="submit" variant="destructive" size="sm">Confirm delete</Button>
				<Button type="button" variant="outline" size="sm" onclick={() => (deletePending = false)}>
					Cancel
				</Button>
			</form>
		{:else}
			<Button variant="outline" size="sm" onclick={() => (deletePending = true)}>
				Delete template
			</Button>
		{/if}
		<Button onclick={() => void saveTemplate()} disabled={saving || !owlDoc}>
			{saving ? 'Saving…' : 'Save template'}
		</Button>
	</div>
</div>

{#if form?.error}
	<p
		class="mb-4 rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-3 py-2 text-sm text-[hsl(var(--destructive))]"
	>
		{form.error}
	</p>
{/if}
{#if saveMessage}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">{saveMessage}</p>
{/if}
{#if form?.success && form.saved === 'preview'}
	<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
		Preview queued (email id: {form.emailId}).
	</p>
{/if}

{#if data.owlMigrated}
	<p
		class="mb-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-sm"
	>
		{data.owlMigrationNote ?? 'Imported existing sections into the new studio.'} Save to switch this template
		to the Owl editor format.
	</p>
{/if}

{#if data.owlHealed}
	<p
		class="mb-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2 text-sm"
	>
		{data.owlHealNote ??
			'Fixed an inconsistent container background so your container color now applies everywhere.'}{' '}
		Save to keep the fix.
	</p>
{/if}

{#if !data.designReady}
	<Card title="Design system missing" class="mb-4">
		<p class="mb-3 text-sm text-[hsl(var(--muted-foreground))]">
			Optional: add a design system for branded colors and custom sections. You can still build
			emails from the built-in library.
		</p>
		<Button href={resolve('/design-system')} size="sm">Open design system</Button>
	</Card>
{/if}

<div class="mb-3 grid gap-2 lg:grid-cols-[1fr_auto] lg:items-start">
	<details
		class="group min-w-0 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
	>
		<summary
			class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 select-none marker:content-none [&::-webkit-details-marker]:hidden"
		>
			<ChevronDown
				class="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-200 group-open:rotate-180"
				aria-hidden="true"
			/>
			<span class="shrink-0 text-sm font-medium">Template details</span>
			<span
				class="min-w-0 truncate text-xs font-normal text-[hsl(var(--muted-foreground))] group-open:hidden"
				title={detailsSummary}
			>
				{detailsSummary}
			</span>
		</summary>
		<div class="space-y-2 border-t border-[hsl(var(--border))] px-2.5 py-2">
			<div class="flex flex-wrap items-end gap-2">
				<div class="min-w-32 flex-1 space-y-0.5">
					<label class="text-xs text-[hsl(var(--muted-foreground))]" for="tpl-name">Name</label>
					<Input id="tpl-name" class="h-8" bind:value={templateName} required />
				</div>
				<div class="min-w-40 flex-[1.5] space-y-0.5">
					<label class="text-xs text-[hsl(var(--muted-foreground))]" for="tpl-subject"
						>Subject</label
					>
					<Input id="tpl-subject" class="h-8" bind:value={subject} required />
				</div>
				<div class="min-w-48 flex-[2] space-y-0.5">
					<label class="text-xs text-[hsl(var(--muted-foreground))]" for="tpl-prompt"
						>Description</label
					>
					<textarea
						id="tpl-prompt"
						rows="1"
						bind:value={templatePrompt}
						placeholder="What is this email for?"
						class="flex min-h-8 w-full resize-y rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1.5 text-sm"
					></textarea>
				</div>
				<div class="min-w-36 flex-1 space-y-0.5">
					<label class="text-xs text-[hsl(var(--muted-foreground))]" for="tpl-preheader"
						>Preheader</label
					>
					<Input
						id="tpl-preheader"
						class="h-8"
						bind:value={preheader}
						placeholder="Inbox preview text"
					/>
				</div>
			</div>
			<div class="flex flex-wrap items-end gap-2">
				<div class="min-w-36 flex-1 space-y-0.5">
					<label class="font-mono text-xs text-[hsl(var(--muted-foreground))]" for="test-var-email">
						{'{{email}}'}
					</label>
					<Input
						id="test-var-email"
						class="h-8"
						type="email"
						bind:value={testEmail}
						placeholder="alex@example.com"
					/>
				</div>
				<div class="min-w-28 flex-1 space-y-0.5">
					<label
						class="font-mono text-xs text-[hsl(var(--muted-foreground))]"
						for="test-var-firstName"
					>
						{'{{firstName}}'}
					</label>
					<Input
						id="test-var-firstName"
						class="h-8"
						bind:value={testFirstName}
						placeholder="Alex"
					/>
				</div>
				<div class="min-w-28 flex-1 space-y-0.5">
					<label
						class="font-mono text-xs text-[hsl(var(--muted-foreground))]"
						for="test-var-lastName"
					>
						{'{{lastName}}'}
					</label>
					<Input id="test-var-lastName" class="h-8" bind:value={testLastName} placeholder="River" />
				</div>
				{#if subjectPreview !== (subject ?? '')}
					<p class="pb-1.5 text-xs text-[hsl(var(--muted-foreground))]">
						Subject preview: <span class="text-[hsl(var(--foreground))]">{subjectPreview}</span>
					</p>
				{/if}
			</div>
		</div>
	</details>

	<form
		method="POST"
		action="?/sendPreview"
		use:enhance={({ formData }) => {
			sending = true;
			if (studio) formData.set('doc', serializeOwlDoc(studio.getCurrentDoc()));
			formData.set('email', testEmail);
			formData.set('firstName', testFirstName);
			formData.set('lastName', testLastName);
			return async ({ update }) => {
				await update();
				sending = false;
			};
		}}
		class="flex flex-wrap items-end gap-2 lg:justify-end"
	>
		<div class="min-w-40 flex-1 space-y-0.5 lg:min-w-48 lg:flex-none">
			<label class="text-xs text-[hsl(var(--muted-foreground))]" for="preview-to"
				>Send preview</label
			>
			<Input id="preview-to" class="h-8" name="to" type="email" bind:value={previewTo} required />
		</div>
		<Button type="submit" size="sm" disabled={sending || !data.previewFrom}>
			{sending ? 'Sending…' : 'Send'}
		</Button>
		<a
			href={resolve(`/templates/${data.template.id}/export?download=1`)}
			class="inline-flex h-8 items-center text-xs text-[hsl(var(--muted-foreground))] underline"
		>
			Download
		</a>
	</form>
</div>

{#if owlDoc}
	<OwlStudio
		bind:this={studio}
		bind:preheader
		doc={owlDoc}
		templateId={data.template.id}
		{templateName}
		templateSubject={subject}
		templateDescription={templatePrompt}
		starters={data.owlStarters}
		designSections={data.owlDesignSections}
		designColors={data.designColors}
		designTokens={data.designTokens}
		logoAssets={data.logoAssets}
		imageAssets={data.imageAssets}
		piConfigured={data.piConfigured}
		{testVariables}
		onSubjectSuggest={(s) => (subject = s)}
	/>
{:else}
	<p class="text-sm text-[hsl(var(--muted-foreground))]">
		This template could not be opened in the studio. Create a new template to start composing.
	</p>
{/if}
