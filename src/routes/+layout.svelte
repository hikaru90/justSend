<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/owlery.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>Owlery</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
