<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">SMTP</h1>

<Card title="Connection notes">
	<div class="space-y-3 text-sm text-[hsl(var(--muted-foreground))]">
		<p>
			Owlery sends email through Amazon SES via the REST API and background worker — there is no
			built-in SMTP relay in this self-hosted build.
		</p>
		<p>
			Use the <a href="/dev-settings/api-keys" class="underline">REST API</a> with an API key, or
			integrate via your application using the public API at
			<code class="rounded bg-[hsl(var(--muted))] px-1">{data.hostUrl}/api/v1</code>.
		</p>
		<p>For inbound testing in development, use magic-link auth and check server logs for outbound mail.</p>
	</div>
</Card>
