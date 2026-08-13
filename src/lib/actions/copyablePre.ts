import type { Action } from 'svelte/action';

const COPY_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

const CHECK_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const BUTTON_CLASS =
	'absolute right-1.5 top-1.5 z-10 rounded p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]';

type Enhancement = {
	pre: HTMLPreElement;
	cleanup: () => void;
};

function getPreText(pre: HTMLPreElement): string {
	const code = pre.querySelector('code');
	if (code) return code.textContent ?? '';
	return pre.textContent ?? '';
}

function enhancePre(pre: HTMLPreElement): Enhancement {
	pre.dataset.copyable = 'true';

	const wrapper = document.createElement('div');
	wrapper.className = 'relative';
	wrapper.dataset.copyableWrap = 'true';
	pre.parentNode?.insertBefore(wrapper, pre);
	wrapper.appendChild(pre);

	const text = getPreText(pre);

	const button = document.createElement('button');
	button.type = 'button';
	button.className = BUTTON_CLASS;
	button.setAttribute('aria-label', 'Copy code');
	button.innerHTML = COPY_ICON;

	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const onClick = async () => {
		try {
			await navigator.clipboard.writeText(text);
			button.innerHTML = CHECK_ICON;
			button.setAttribute('aria-label', 'Copied');
			clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				button.innerHTML = COPY_ICON;
				button.setAttribute('aria-label', 'Copy code');
				timeoutId = undefined;
			}, 2000);
		} catch {
			// clipboard unavailable or denied
		}
	};

	button.addEventListener('click', onClick);
	wrapper.appendChild(button);

	return {
		pre,
		cleanup: () => {
			clearTimeout(timeoutId);
			button.removeEventListener('click', onClick);
			button.remove();
			delete pre.dataset.copyable;
			if (wrapper.isConnected && pre.parentNode === wrapper) {
				wrapper.parentNode?.insertBefore(pre, wrapper);
			}
			wrapper.remove();
		},
	};
}

/**
 * Adds copy-to-clipboard buttons to all `<pre>` elements inside a container
 * (e.g. markdown `{@html}`). Re-enhances when the container's DOM changes.
 */
export const copyablePre: Action<HTMLElement> = (node) => {
	let enhancements: Enhancement[] = [];
	let applying = false;

	function refresh() {
		if (applying) return;
		applying = true;
		try {
			const next: Enhancement[] = [];
			for (const enhancement of enhancements) {
				if (enhancement.pre.isConnected) {
					next.push(enhancement);
				} else {
					enhancement.cleanup();
				}
			}
			enhancements = next;
			for (const pre of node.querySelectorAll<HTMLPreElement>('pre:not([data-copyable])')) {
				enhancements.push(enhancePre(pre));
			}
		} finally {
			applying = false;
		}
	}

	refresh();

	const observer = new MutationObserver(refresh);
	observer.observe(node, { childList: true, subtree: true });

	return {
		destroy() {
			observer.disconnect();
			for (const enhancement of enhancements) enhancement.cleanup();
			enhancements = [];
		},
	};
};
