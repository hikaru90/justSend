<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { Mic, MicOff, Sparkles } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';

	type SpeechRec = {
		lang: string;
		continuous: boolean;
		interimResults: boolean;
		onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
		onerror: (() => void) | null;
		onend: (() => void) | null;
		start: () => void;
		stop: () => void;
	};

	let {
		value = $bindable(''),
		name = 'instruction',
		disabled = false,
		busy = false,
		placeholder = 'Describe the change… or tap the mic to speak',
		submitLabel = 'Ask Pi',
		hint,
		children
	}: {
		value?: string;
		name?: string;
		disabled?: boolean;
		busy?: boolean;
		placeholder?: string;
		submitLabel?: string;
		hint?: string;
		children?: Snippet;
	} = $props();

	let listening = $state(false);
	let speechError = $state<string | null>(null);
	let recognition = $state<SpeechRec | null>(null);

	const speechSupported = $derived.by(() => {
		if (!browser) return false;
		const w = window as unknown as {
			SpeechRecognition?: new () => SpeechRec;
			webkitSpeechRecognition?: new () => SpeechRec;
		};
		return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
	});

	function stopListening() {
		recognition?.stop();
		listening = false;
	}

	function toggleMic() {
		if (!browser || disabled || busy) return;
		speechError = null;

		if (listening) {
			stopListening();
			return;
		}

		const w = window as unknown as {
			SpeechRecognition?: new () => SpeechRec;
			webkitSpeechRecognition?: new () => SpeechRec;
		};
		const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
		if (!Ctor) {
			speechError = 'Speech recognition is not supported in this browser.';
			return;
		}

		const rec = new Ctor();
		rec.lang = navigator.language || 'en-US';
		rec.continuous = false;
		rec.interimResults = true;
		rec.onresult = (ev) => {
			const parts: string[] = [];
			for (let i = 0; i < ev.results.length; i++) {
				const alt = ev.results[i]?.[0]?.transcript;
				if (alt) parts.push(alt);
			}
			const spoken = parts.join(' ').trim();
			if (spoken) {
				value = value.trim() ? `${value.trim()} ${spoken}` : spoken;
			}
		};
		rec.onerror = () => {
			speechError = 'Could not capture speech. Check microphone permissions.';
			listening = false;
		};
		rec.onend = () => {
			listening = false;
		};

		recognition = rec;
		listening = true;
		try {
			rec.start();
		} catch {
			speechError = 'Could not start the microphone.';
			listening = false;
		}
	}
</script>

<div class="space-y-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-3">
	<div class="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
		<Sparkles class="h-3.5 w-3.5" />
		Edit with Pi
	</div>
	<textarea
		{name}
		rows="3"
		bind:value
		{disabled}
		{placeholder}
		class="w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50"
	></textarea>
	<div class="flex flex-wrap items-center gap-2">
		{#if speechSupported}
			<Button
				type="button"
				size="sm"
				variant={listening ? 'default' : 'outline'}
				disabled={disabled || busy}
				onclick={toggleMic}
				aria-pressed={listening}
				aria-label={listening ? 'Stop listening' : 'Speak instruction'}
			>
				{#if listening}
					<MicOff class="h-3.5 w-3.5" />
					Listening…
				{:else}
					<Mic class="h-3.5 w-3.5" />
					Speak
				{/if}
			</Button>
		{/if}
		{#if children}
			{@render children()}
		{:else}
			<Button type="submit" size="sm" disabled={disabled || busy || !value.trim()}>
				{busy ? 'Pi is editing…' : submitLabel}
			</Button>
		{/if}
	</div>
	{#if speechError}
		<p class="text-xs text-[hsl(var(--destructive))]">{speechError}</p>
	{:else if hint}
		<p class="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>
	{/if}
</div>
