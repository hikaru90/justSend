<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Team members</h1>

{#if data.role === 'ADMIN'}
	<Card title="Invite member" class="mb-6">
		<form method="POST" action="?/invite" use:enhance class="flex flex-wrap gap-2">
			<Input
				name="email"
				type="email"
				placeholder="email@example.com"
				required
				class="min-w-[200px] flex-1"
			/>
			<select name="role" class="h-9 rounded-md border px-3 text-sm">
				<option value="MEMBER">Member</option>
				<option value="ADMIN">Admin</option>
			</select>
			<Button type="submit">Invite</Button>
		</form>
		{#if form?.error}<p class="mt-2 text-sm text-[hsl(var(--destructive))]">{form.error}</p>{/if}
	</Card>
{/if}

<Card title="Members" class="mb-6">
	<ul class="divide-y">
		{#each data.members as member}
			<li class="flex items-center justify-between py-3">
				<div>
					<p class="font-medium">{member.user.name ?? member.user.email}</p>
					<p class="text-sm text-[hsl(var(--muted-foreground))]">{member.user.email}</p>
				</div>
				<div class="flex items-center gap-2">
					<Badge>{member.role}</Badge>
					{#if data.role === 'ADMIN'}
						<form method="POST" action="?/removeMember" use:enhance>
							<input type="hidden" name="userId" value={member.userId} />
							<Button type="submit" size="sm" variant="ghost">Remove</Button>
						</form>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</Card>

<Card title="Pending invites">
	<ul class="divide-y">
		{#each data.invites as invite}
			<li class="flex items-center justify-between py-3">
				<span>{invite.email} · {invite.role}</span>
				{#if data.role === 'ADMIN'}
					<form method="POST" action="?/deleteInvite" use:enhance>
						<input type="hidden" name="inviteId" value={invite.id} />
						<Button type="submit" size="sm" variant="ghost">Revoke</Button>
					</form>
				{/if}
			</li>
		{:else}
			<li class="py-3 text-sm text-[hsl(var(--muted-foreground))]">No pending invites</li>
		{/each}
	</ul>
</Card>
