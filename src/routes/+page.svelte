<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
	<h1 class="text-4xl font-bold tracking-tight">useSend</h1>
	<p class="max-w-md text-center text-[hsl(var(--muted-foreground))]">
		Self-hosted email infrastructure for transactional and marketing email via Amazon SES.
	</p>
	<Button href="/login">Login</Button>
</main>
