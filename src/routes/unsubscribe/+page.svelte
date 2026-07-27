<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
</script>

<main class="flex min-h-screen items-center justify-center p-6">
	<Card title="Unsubscribed" class="w-full max-w-md text-center">
		<p class="text-sm text-[hsl(var(--muted-foreground))]">
			{#if data.email}
				<strong>{data.email}</strong> has been unsubscribed.
			{:else}
				You have been unsubscribed.
			{/if}
		</p>
	</Card>
</main>
