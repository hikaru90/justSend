<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import logo from '$lib/assets/owlery.svg';

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
				body: JSON.stringify({ email }),
			});
			if (!res.ok) throw new Error('Failed');
			sent = true;
		} catch {
			error = 'Could not send magic link.';
		} finally {
			loading = false;
		}
	}
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
	<a href="/" class="flex flex-col items-center gap-2">
		<img src={logo} alt="" class="h-12 w-12" />
		<span class="text-lg font-semibold tracking-tight">Owlery</span>
	</a>
	<Card title="Sign up for Owlery" class="w-full max-w-md">
		<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
			The first user creates the team. Additional users need a team invite before signing up.
		</p>

		{#if sent}
			<p class="text-sm">Check your email for a sign-in link.</p>
		{:else}
			<form class="space-y-4" onsubmit={sendMagicLink}>
				<div>
					<label class="mb-1 block text-sm font-medium" for="email">Email</label>
					<Input id="email" type="email" bind:value={email} required />
				</div>
				{#if error}<p class="text-sm text-[hsl(var(--destructive))]">{error}</p>{/if}
				<Button type="submit" disabled={loading} class="w-full">Send magic link</Button>
			</form>
			<div class="my-4 flex flex-col gap-2">
				<Button variant="outline" href="/api/auth/login/github" class="w-full">GitHub</Button>
				<Button variant="outline" href="/api/auth/login/google" class="w-full">Google</Button>
			</div>
		{/if}
		<p class="mt-4 text-center text-sm">
			Already have an account? <a href="/login" class="underline">Sign in</a>
		</p>
	</Card>
</main>
