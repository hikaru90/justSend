<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
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
				<div><dt class="text-[hsl(var(--muted-foreground))]">Callback</dt><dd class="truncate">{setting.callbackUrl}</dd></div>
				<div><dt class="text-[hsl(var(--muted-foreground))]">Topic ARN</dt><dd class="truncate font-mono text-xs">{setting.topicArn}</dd></div>
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

<p class="mt-4 text-sm">
	<a href="/admin/teams" class="underline">Manage teams →</a>
</p>
