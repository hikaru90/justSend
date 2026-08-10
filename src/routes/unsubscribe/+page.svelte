<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
</script>

<main class="flex min-h-screen items-center justify-center p-6">
	{#if data.bare}
		<Card title="Manage subscription" class="w-full max-w-md text-center">
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				Use the unsubscribe link from your email to manage your subscription. That link is unique
				to your address and confirms the request.
			</p>
		</Card>
	{:else}
		<Card title="Unsubscribed" class="w-full max-w-md text-center">
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				{#if data.email}
					<strong>{data.email}</strong> has been unsubscribed.
				{:else}
					You have been unsubscribed.
				{/if}
			</p>
		</Card>
	{/if}
</main>
