<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Card from '$lib/components/ui/Card.svelte';

	let { data } = $props();
</script>

<h1 class="mb-6 text-2xl font-semibold">Teams</h1>

<Card>
	<table class="w-full text-sm">
		<thead class="border-b text-left">
			<tr>
				<th class="p-2">ID</th>
				<th class="p-2">Name</th>
				<th class="p-2">Active</th>
				<th class="p-2">Daily limit</th>
				<th class="p-2">Blocked</th>
			</tr>
		</thead>
		<tbody>
			{#each data.teams as team}
				<tr class="border-b">
					<td class="p-2">{team.id}</td>
					<td class="p-2 font-medium">{team.name}</td>
					<td class="p-2"><Badge variant={team.isActive ? 'success' : 'secondary'}>{team.isActive ? 'Yes' : 'No'}</Badge></td>
					<td class="p-2">{team.dailyEmailLimit}</td>
					<td class="p-2">{team.isBlocked ? 'Yes' : 'No'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</Card>

<p class="mt-4 text-sm"><a href="/admin" class="underline">← SES settings</a></p>
