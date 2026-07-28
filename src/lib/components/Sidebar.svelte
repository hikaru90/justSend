<script lang="ts">
	import { page } from '$app/state';
	import {
		LayoutDashboard,
		ListOrdered,
		Globe,
		Users,
		Megaphone,
		FileText,
		Ban,
		Webhook,
		Settings,
		Code,
		Shield
	} from '@lucide/svelte';
	import { cn } from '$lib/utils';
	import TeamSwitcher from './TeamSwitcher.svelte';

	let {
		user,
		teams,
		teamId
	}: {
		user: { name: string | null; email: string | null; isAdmin: boolean };
		teams: Array<{ id: number; name: string }>;
		teamId: number | null;
	} = $props();

	const links = $derived([
		{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
		{ href: '/emails', label: 'Queue', icon: ListOrdered },
		{ href: '/domains', label: 'Domains', icon: Globe },
		{ href: '/contacts', label: 'Contacts', icon: Users },
		{ href: '/campaigns', label: 'Campaigns', icon: Megaphone },
		{ href: '/templates', label: 'Templates', icon: FileText },
		{ href: '/suppressions', label: 'Suppressions', icon: Ban },
		{ href: '/webhooks', label: 'Webhooks', icon: Webhook },
		{ href: '/settings', label: 'Settings', icon: Settings },
		{ href: '/dev-settings/api-keys', label: 'API Keys', icon: Code }
	]);

	const adminLinks = $derived(
		user.isAdmin
			? [
					{ href: '/admin', label: 'SES Settings', icon: Shield },
					{ href: '/admin/teams', label: 'Teams', icon: Users }
				]
			: []
	);
</script>

<aside
	class="flex h-screen w-64 shrink-0 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))]"
>
	<div class="border-b border-[hsl(var(--sidebar-border))] p-4">
		<a href="/dashboard" class="text-lg font-semibold tracking-tight">justSend</a>
		<div class="mt-3">
			<TeamSwitcher {teams} {teamId} />
		</div>
	</div>

	<nav class="flex-1 space-y-1 overflow-y-auto p-3">
		{#each links as link (link.href)}
			{@const Icon = link.icon}
			<a
				href={link.href}
				class={cn(
					'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-[hsl(var(--accent))]',
					page.url.pathname === link.href || page.url.pathname.startsWith(link.href + '/')
						? 'bg-[hsl(var(--accent))] font-medium'
						: ''
				)}
			>
				<Icon class="h-4 w-4" />
				{link.label}
			</a>
		{/each}

		{#if adminLinks.length > 0}
			<div class="pt-4">
				<p class="mb-2 px-3 text-xs font-medium uppercase tracking-wide opacity-60">Admin</p>
				{#each adminLinks as link (link.href)}
					{@const Icon = link.icon}
					<a
						href={link.href}
						class={cn(
							'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-[hsl(var(--accent))]',
							page.url.pathname.startsWith(link.href)
								? 'bg-[hsl(var(--accent))] font-medium'
								: ''
						)}
					>
						<Icon class="h-4 w-4" />
						{link.label}
					</a>
				{/each}
			</div>
		{/if}
	</nav>

	<div class="border-t border-[hsl(var(--sidebar-border))] p-4">
		<p class="truncate text-sm font-medium">{user.name ?? user.email}</p>
		<form method="POST" action="/api/auth/logout" class="mt-2">
			<button type="submit" class="text-xs text-[hsl(var(--muted-foreground))] hover:underline">
				Sign out
			</button>
		</form>
	</div>
</aside>
