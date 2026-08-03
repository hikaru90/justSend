<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let { data, children } = $props();

	const domainScoped = $derived(
		!page.url.pathname.startsWith('/domains') &&
			!page.url.pathname.startsWith('/settings') &&
			!page.url.pathname.startsWith('/admin') &&
			!page.url.pathname.startsWith('/create-team') &&
			!page.url.pathname.startsWith('/dev-settings/smtp'),
	);
</script>

{#if !data.team}
	<main class="flex min-h-screen items-center justify-center p-6">
		<Card
			title="Create your team"
			description="Set up the first team for this Owlery instance."
			class="w-full max-w-md"
		>
			<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
				No team yet. Create one to continue, or check pending invites.
			</p>
			<a href="/create-team">
				<Button type="button" class="w-full">Create team</Button>
			</a>
			<p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
				Have an invite? <a href="/join-team" class="underline">View pending invites</a>
			</p>
		</Card>
	</main>
{:else}
	<div class="flex min-h-screen">
		<Sidebar
			user={data.user}
			teams={data.teams}
			teamId={data.teamId}
			domains={data.domains}
			domainId={data.domainId}
		/>
		<main class="flex-1 overflow-y-auto p-6 lg:p-8">
			{#if domainScoped && !data.domainId}
				<div class="flex min-h-[50vh] items-center justify-center">
					<Card
						title="Add a domain"
						description="Pick a sending domain to start using the app. Each domain is its own project."
						class="w-full max-w-md"
					>
						<p class="mb-4 text-sm text-[hsl(var(--muted-foreground))]">
							Dashboard, queue, contacts, campaigns, and other tools are scoped to the selected
							domain.
						</p>
						<a href="/domains">
							<Button type="button" class="w-full">Go to Domains</Button>
						</a>
					</Card>
				</div>
			{:else}
				{@render children()}
			{/if}
		</main>
	</div>
{/if}
