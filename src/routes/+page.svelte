<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import logo from '$lib/assets/owlery.svg';
	import logoDark from '$lib/assets/owlery-dark.svg';
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
	<img src={logo} alt="" class="h-16 w-16 dark:hidden" />
	<img src={logoDark} alt="" class="hidden h-16 w-16 dark:block" />
	<h1 class="text-4xl font-bold tracking-tight">Owlery</h1>
	<p class="max-w-md text-center text-[hsl(var(--muted-foreground))]">
		Self-hosted email infrastructure for transactional and marketing email via Amazon SES.
	</p>
	<Button href="/login">Login</Button>
</main>
