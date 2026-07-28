<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();

	let email = $state('');
	let loading = $state(false);
	let sent = $state(false);
	let error = $state('');

	async function sendMagicLink(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/auth/magic-link', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			if (!res.ok) throw new Error('Failed to send link');
			sent = true;
		} catch {
			error = 'Could not send magic link. Try again.';
		} finally {
			loading = false;
		}
	}
</script>

<main class="flex min-h-screen items-center justify-center p-6">
	<Card title="Sign in to justSend" description="Use a magic link or OAuth provider." class="w-full max-w-md">
		{#if data.error === 'github_not_configured'}
			<p class="mb-4 text-sm text-[hsl(var(--destructive))]">GitHub login is not configured.</p>
		{/if}

		{#if sent}
			<p class="text-sm text-[hsl(var(--muted-foreground))]">
				Check your inbox for a sign-in link. In development, check the server console.
			</p>
		{:else}
			<form class="space-y-4" onsubmit={sendMagicLink}>
				<div>
					<label class="mb-1 block text-sm font-medium" for="email">Email</label>
					<Input id="email" type="email" bind:value={email} required placeholder="you@example.com" />
				</div>
				{#if error}
					<p class="text-sm text-[hsl(var(--destructive))]">{error}</p>
				{/if}
				<Button type="submit" disabled={loading} class="w-full">
					{loading ? 'Sending…' : 'Send magic link'}
				</Button>
			</form>

			<div class="my-6 flex items-center gap-3">
				<div class="h-px flex-1 bg-[hsl(var(--border))]"></div>
				<span class="text-xs text-[hsl(var(--muted-foreground))]">or</span>
				<div class="h-px flex-1 bg-[hsl(var(--border))]"></div>
			</div>

			<div class="flex flex-col gap-2">
				{#if data.githubEnabled}
					<Button variant="outline" href="/api/auth/login/github" class="w-full">Continue with GitHub</Button>
				{/if}
				{#if data.googleEnabled}
					<Button variant="outline" href="/api/auth/login/google" class="w-full">Continue with Google</Button>
				{/if}
			</div>
		{/if}

		<p class="mt-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
			Need an account? <a href="/signup" class="underline">Sign up</a>
		</p>
	</Card>
</main>
